"""
/**
 * Ruta: backend/app/utils/db/dbsync/sheets_adapter.py
 * Versión: 1.0.0
 * Descripción:
 * Adaptador de Google Sheets para el motor de sincronización de GAPPTO Mobile 3.0.
 *
 * Funcionalidades incluidas:
 * - Conecta con Google Sheets mediante cuenta de servicio.
 * - Abre un spreadsheet por ID.
 * - Lista tablas disponibles a partir de worksheets.
 * - Crea worksheets si no existen.
 * - Asegura cabeceras esperadas en cada worksheet.
 * - Lee tablas completas desde Google Sheets.
 * - Normaliza tipos Python no serializables a valores válidos para Sheets.
 * - Asegura capacidad mínima de grid antes de escribir.
 * - Permite escritura en modo execute/dry-run.
 * - Permite limpieza destructiva o parcial antes de escribir.
 * - Escribe datos desde Neon/Supabase/otras fuentes a Google Sheets.
 *
 * Ajustes de esta versión:
 * - Se refuerza el sistema de reintentos ante errores 429 y 5xx.
 * - Se añade backoff exponencial con jitter para reducir bloqueos por cuota.
 * - Se cachean worksheets ya abiertas para evitar llamadas repetidas innecesarias.
 * - Se cachean cabeceras validadas para reducir lecturas repetidas de fila 1.
 * - Se evita una resolución duplicada de worksheet al asegurar cabeceras desde write_table().
 * - Se mantiene la compatibilidad funcional con la lógica existente.
 *
 * Notas de diseño:
 * - El objetivo es reducir errores de rate limit sin cambiar el contrato público del adapter.
 * - No se eliminan capacidades actuales; se optimiza la forma de llamar a Google Sheets.
 * - La reducción de llamadas repetidas es clave para evitar 429 en sincronizaciones largas.
 * - La normalización de valores se mantiene separada de la lógica de escritura.
 */
"""

from __future__ import annotations

import base64
import json
import os
import random
import time
from datetime import date, datetime, time as dtime
from decimal import Decimal
from typing import Any, Dict, List, Sequence, Set, Tuple
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

        # Cache local para evitar pedir a Google la misma worksheet varias veces
        # durante una misma ejecución.
        self._ws_cache: Dict[str, Any] = {}

        # Cache de headers ya validados en esta ejecución.
        # Clave: nombre de tabla.
        self._validated_headers: Set[str] = set()

    # -----------------------------
    # Robustez: retry/backoff (429/5xx)
    # -----------------------------
    def _with_retry(self, fn, *args, **kwargs):
        """
        Wrapper robusto para tolerar rate limits / picos 5xx.

        Mejoras respecto a una versión simple:
        - Reintentos exponenciales.
        - Jitter aleatorio para evitar reintentos sincronizados.
        - Detección de 429, quota/rate limit y códigos 5xx habituales.
        - Mantiene la misma firma de uso que el código original.
        """
        max_retries = 7
        base_sleep_s = 1.0
        max_sleep_s = 30.0
        last_error = None

        for attempt in range(max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                last_error = e
                msg = repr(e)

                is_429 = (
                    "429" in msg
                    or "Quota exceeded" in msg
                    or "RATE_LIMIT" in msg
                    or "rateLimitExceeded" in msg
                    or "RESOURCE_EXHAUSTED" in msg
                    or "Too Many Requests" in msg
                )
                is_5xx = any(code in msg for code in ["500", "502", "503", "504"])

                if not (is_429 or is_5xx):
                    raise

                # Backoff exponencial + jitter
                sleep_s = min(base_sleep_s * (2 ** attempt), max_sleep_s)
                sleep_s += random.uniform(0, 0.5)
                time.sleep(sleep_s)

        raise RuntimeError(f"Sheets API: demasiados reintentos (429/5xx). Error: {last_error}")

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
        """
        Lista worksheets -> títulos => tablas disponibles.
        """
        wss = self._with_retry(self.sh.worksheets)

        # Alimentamos cache para futuras operaciones.
        for ws in wss:
            title = getattr(ws, "title", None)
            if title:
                self._ws_cache[title] = ws

        return [ws.title for ws in wss]

    def _get_or_create_ws(self, title: str):
        """
        Devuelve una worksheet existente o la crea si no existe.

        Incluye cache local para evitar reconsultar la misma hoja varias veces
        en la misma ejecución.
        """
        if title in self._ws_cache:
            return self._ws_cache[title]

        try:
            ws = self._with_retry(self.sh.worksheet, title)
            self._ws_cache[title] = ws
            return ws
        except Exception:
            ws = self._with_retry(self.sh.add_worksheet, title=title, rows=2000, cols=60)
            self._ws_cache[title] = ws
            return ws

    def _ensure_headers_ws(self, ws, table: str, headers: List[str]) -> None:
        """
        Variante interna de ensure_headers que trabaja con una worksheet ya resuelta.

        Esto evita:
        - volver a pedir la worksheet
        - releer headers si ya se validaron en esta ejecución
        """
        if table in self._validated_headers:
            return

        current = self._with_retry(ws.row_values, 1)
        if current != headers:
            self._with_retry(ws.update, "A1", [headers], value_input_option="RAW")

        self._validated_headers.add(table)

    def ensure_headers(self, table: str, headers: List[str]) -> None:
        """
        Asegura que la fila 1 tiene los headers esperados.

        OJO: esto implica lecturas (row_values). Por eso SyncEngine lo llama
        solo en execute=True.
        """
        ws = self._get_or_create_ws(table)
        self._ensure_headers_ws(ws, table, headers)

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
        """
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
        try:
            current_rows = int(getattr(ws, "row_count", 0) or 0)
            current_cols = int(getattr(ws, "col_count", 0) or 0)
        except Exception:
            current_rows = 0
            current_cols = 0

        need_rows = max(min_rows, current_rows or 0)
        need_cols = max(min_cols, current_cols or 0)

        if current_rows >= need_rows and current_cols >= need_cols:
            return

        try:
            self._with_retry(ws.resize, rows=need_rows, cols=need_cols)
        except Exception:
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
        min_rows = max(2, 1 + max(data_rows_len, 1))

        # Necesitamos al menos tantas columnas como headers.
        # Se mantiene un mínimo razonable de 60 para evitar fallos por hojas recién creadas
        # o con grid demasiado ajustado.
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

        Ajuste importante:
        - Se evita resolver dos veces la misma worksheet en la misma operación.
        - Se reduce el número de lecturas repetidas de headers cuando la tabla
          ya ha sido validada durante esta ejecución.
        """
        ws = self._get_or_create_ws(table)

        if not execute:
            return

        # Normalizamos filas (EVITA TypeError datetime no JSON serializable)
        data = self._normalize_matrix(rows)

        # Asegurar capacidad mínima antes de cualquier operación sobre A1/A2
        self._ensure_minimum_for_a2_ops(ws, headers_len=len(headers), data_rows_len=len(data))

        # Asegurar headers sin volver a resolver la worksheet
        self._ensure_headers_ws(ws, table, headers)

        # Limpieza
        if allow_destructive:
            # Limpia todo el contenido previo y vuelve a dejar headers
            self._with_retry(ws.clear)
            self._with_retry(ws.update, "A1", [headers], value_input_option="RAW")

            # Tras clear, asegurar otra vez capacidad mínima por robustez.
            self._ensure_minimum_for_a2_ops(ws, headers_len=len(headers), data_rows_len=len(data))

            # Ya hemos dejado headers actualizados explícitamente.
            self._validated_headers.add(table)
        else:
            # Limpiamos solo el bloque de datos, no la hoja completa.
            # Así evitamos rangos demasiado grandes e innecesarios.
            last_col_idx = max(len(headers), 1)

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

        # Escritura de datos en bloque.
        self._with_retry(ws.update, "A2", data, value_input_option="RAW")