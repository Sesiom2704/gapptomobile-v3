from __future__ import annotations

import base64
import json
import os
import time
from datetime import date, datetime, time as dtime
from decimal import Decimal
from typing import Any, List, Sequence, Tuple
from uuid import UUID


class SheetsAdapter:
    """
    Adapter Google Sheets para SyncEngine.

    Convención:
      - Cada tabla se representa como una worksheet cuyo título es el full_name:
        "public.tipo_gasto", "public.users", etc.
      - La fila 1 contiene headers (nombres de columnas).
      - Desde fila 2 en adelante, datos.

    Requisitos:
      - gspread
      - google-auth
    """

    def __init__(self, spreadsheet_id: str, creds_path: str):
        self.spreadsheet_id = (spreadsheet_id or "").strip()
        self.creds_path = (creds_path or "").strip()

        if not self.spreadsheet_id:
            raise RuntimeError("GOOGLE_SHEETS_ID vacío (spreadsheet_id).")
        if not self.creds_path:
            raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS vacío (creds_path).")
        if not os.path.isfile(self.creds_path):
            raise RuntimeError(f"Creds file no existe: {self.creds_path}")

        try:
            import gspread  # type: ignore
            from google.oauth2.service_account import Credentials  # type: ignore
        except Exception as e:
            raise RuntimeError(
                "Dependencias Sheets no instaladas. Instala: gspread google-auth"
            ) from e

        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        creds = Credentials.from_service_account_file(self.creds_path, scopes=scopes)

        self.gc = gspread.authorize(creds)
        self.sh = self._with_retry(self.gc.open_by_key, self.spreadsheet_id)

    # -----------------------------
    # Robustez: retry/backoff (429/5xx)
    # -----------------------------
    def _with_retry(self, fn, *args, **kwargs):
        """
        Wrapper simple para tolerar rate limits / picos 5xx.

        - Reintentos exponenciales (hasta ~30s).
        - Detecta 429 y mensajes típicos "Quota exceeded".
        """
        for attempt in range(7):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                msg = repr(e)
                is_429 = ("429" in msg) or ("Quota exceeded" in msg) or ("RATE_LIMIT" in msg)
                is_5xx = any(code in msg for code in ["500", "502", "503", "504"])
                if is_429 or is_5xx:
                    sleep_s = min(2 ** attempt, 30)
                    time.sleep(sleep_s)
                    continue
                raise
        raise RuntimeError("Sheets API: demasiados reintentos (429/5xx).")

    # -----------------------------
    # Normalización de valores (CRÍTICO)
    # -----------------------------
    def _to_cell_value(self, v: Any) -> Any:
        """
        Convierte tipos Python no serializables (datetime, Decimal, UUID, etc.)
        a valores que gspread/Sheets aceptan sin romper serialización JSON.

        Política:
          - None -> ""
          - bool/int/float/str -> se dejan
          - datetime/date/time -> ISO8601
          - Decimal/UUID -> str
          - dict/list -> json
          - bytes -> base64
          - fallback -> str
        """
        if v is None:
            return ""

        # Tipos básicos
        if isinstance(v, (str, int, float, bool)):
            return v

        # Fechas/horas
        if isinstance(v, (datetime, date, dtime)):
            # ISO (Sheets lo deja como string; si quieres formato fecha real,
            # ya lo formateas en la hoja)
            return v.isoformat()

        # Numéricos/IDs no JSON
        if isinstance(v, (Decimal, UUID)):
            return str(v)

        # Bytes
        if isinstance(v, (bytes, bytearray, memoryview)):
            b = bytes(v)
            return base64.b64encode(b).decode("ascii")

        # Estructuras
        if isinstance(v, (dict, list, tuple)):
            try:
                return json.dumps(v, ensure_ascii=False)
            except Exception:
                return str(v)

        # Fallback
        return str(v)

    def _normalize_matrix(self, rows: Sequence[Tuple[Any, ...]]) -> List[List[Any]]:
        """
        Convierte rows (tuplas) a matriz lista para ws.update().
        """
        out: List[List[Any]] = []
        for r in rows:
            out.append([self._to_cell_value(x) for x in r])
        return out

    # -----------------------------
    # Helpers
    # -----------------------------
    def list_tables(self) -> List[str]:
        """Lista worksheets -> títulos => tablas disponibles."""
        wss = self._with_retry(self.sh.worksheets)
        return [ws.title for ws in wss]

    def _get_or_create_ws(self, title: str):
        try:
            return self._with_retry(self.sh.worksheet, title)
        except Exception:
            return self._with_retry(self.sh.add_worksheet, title=title, rows=2000, cols=60)

    def ensure_headers(self, table: str, headers: List[str]) -> None:
        """
        Asegura que la fila 1 tiene los headers esperados.
        OJO: esto implica lecturas (row_values). Por eso SyncEngine lo llama solo en execute=True.
        """
        ws = self._get_or_create_ws(table)
        current = self._with_retry(ws.row_values, 1)
        if current == headers:
            return
        self._with_retry(ws.update, "A1", [headers])

    def read_table(self, table: str) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        """
        Lee tabla desde Sheet.
        Nota: es una operación de lectura cara (cuota). Úsala cuando el SOURCE sea Sheets.
        """
        ws = self._get_or_create_ws(table)
        values = self._with_retry(ws.get_all_values)
        if not values:
            return [], []
        headers = values[0]
        data_rows = values[1:]
        return headers, [tuple(r) for r in data_rows]

    def write_table(
        self,
        table: str,
        headers: List[str],
        rows: Sequence[Tuple[Any, ...]],
        *,
        execute: bool,
        allow_destructive: bool,
    ) -> None:
        """
        Escribe en Sheet.

        - execute=False => no escribe (dry-run).
        - execute=True:
            - asegura headers
            - limpia contenido previo
            - escribe data desde A2
        """
        ws = self._get_or_create_ws(table)

        if not execute:
            return

        # Aseguramos headers (esto lee/actualiza)
        self.ensure_headers(table, headers)

        # Normalizamos filas (EVITA TypeError datetime no JSON serializable)
        data = self._normalize_matrix(rows)

        # Limpieza
        if allow_destructive:
            self._with_retry(ws.clear)
            self._with_retry(ws.update, "A1", [headers])
        else:
            self._with_retry(ws.batch_clear, ["A2:ZZ"])

        if not data:
            return

        self._with_retry(ws.update, "A2", data)
