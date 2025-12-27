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

    def _a1_to_col_index(self, a1_col: str) -> int:
        """""
        Convierte letras de columna (A, Z, AA, ZZ) a índice 1-based.
        """
        a1_col = (a1_col or "").strip().upper()
        n = 0
        for ch in a1_col:
            if not ("A" <= ch <= "Z"):
                continue
            n = n * 26 + (ord(ch) - ord("A") + 1)
        return max(n, 1)

    def _ensure_grid_capacity(self, ws, *, min_rows: int, min_cols: int) -> None:
        """
        Asegura que la worksheet tenga al menos min_rows x min_cols.

        Esto evita errores del tipo:
        Range (X!A2:ZZ) exceeds grid limits. Max rows: 1, max columns: N
        """
        # gspread Worksheet suele exponer row_count y col_count
        try:
            current_rows = int(getattr(ws, "row_count", 0) or 0)
            current_cols = int(getattr(ws, "col_count", 0) or 0)
        except Exception:
            current_rows = 0
            current_cols = 0

        # Si no podemos leer row/col, intentamos forzar un resize “seguro”
        need_rows = max(min_rows, current_rows or 0)
        need_cols = max(min_cols, current_cols or 0)

        # Si ya cumple, no hacer nada
        if current_rows >= need_rows and current_cols >= need_cols:
            return

        # gspread: resize(rows=..., cols=...)
        # OJO: algunos backends de Sheets fallan si intentas reducir; aquí solo ampliamos.
        try:
            self._with_retry(ws.resize, rows=need_rows, cols=need_cols)
        except Exception:
            # fallback: intentar ampliar solo rows o cols
            if current_rows < need_rows:
                self._with_retry(ws.resize, rows=need_rows)
            if current_cols < need_cols:
                self._with_retry(ws.resize, cols=need_cols)

    def _ensure_minimum_for_a2_ops(self, ws, *, headers_len: int, data_rows_len: int) -> None:
        """
        Asegura capacidad mínima para:
        - tener fila 1 headers
        - poder operar sobre A2:...
        - escribir data en A2 con data_rows_len filas y headers_len columnas
        """
        # Necesitamos al menos 2 filas para que exista A2, incluso si no hay datos.
        min_rows = max(2, 1 + max(data_rows_len, 1))  # headers + al menos 1 fila de data (o espacio)
        # Necesitamos al menos tantas columnas como headers y, por seguridad, hasta ZZ si vamos a limpiar A2:ZZ.
        # ZZ = 702 columnas. Es grande, pero Sheets lo soporta y evita el error para siempre.
        # Si prefieres algo menos agresivo, usa max(headers_len, 60).
        min_cols = max(headers_len, 60)
        self._ensure_grid_capacity(ws, min_rows=min_rows, min_cols=min_cols)

    
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
            - asegura capacidad mínima de grid (evita Invalid range)
            - limpia contenido previo
            - escribe data desde A2
        """
        ws = self._get_or_create_ws(table)

        if not execute:
            return

        # Normalizamos filas (EVITA TypeError datetime no JSON serializable)
        data = self._normalize_matrix(rows)

        # Asegurar capacidad mínima (CRÍTICO para evitar A2:ZZ > grid)
        self._ensure_minimum_for_a2_ops(ws, headers_len=len(headers), data_rows_len=len(data))

        # Aseguramos headers (esto lee/actualiza)
        self.ensure_headers(table, headers)

        # Limpieza
        if allow_destructive:
            self._with_retry(ws.clear)
            self._with_retry(ws.update, "A1", [headers])
            # Tras clear, asegurar otra vez capacidad mínima (clear a veces deja grid mínimo en ciertos casos)
            self._ensure_minimum_for_a2_ops(ws, headers_len=len(headers), data_rows_len=len(data))
        else:
            # En vez de A2:ZZ (que depende de grid), limpiamos dinámicamente hasta el ancho real que usamos
            # y hasta un número razonable de columnas.
            # Calculamos última columna según headers_len (mínimo 1)
            last_col_idx = max(len(headers), 1)
            # Convertimos índice a letra (A1). Implementación simple.
            def idx_to_a1_col(n: int) -> str:
                s = ""
                while n > 0:
                    n, r = divmod(n - 1, 26)
                    s = chr(ord("A") + r) + s
                return s or "A"

            last_col = idx_to_a1_col(last_col_idx)
            rng = f"A2:{last_col}"
            self._with_retry(ws.batch_clear, [rng])

        if not data:
            return

        # Escribir data
        self._with_retry(ws.update, "A2", data)
