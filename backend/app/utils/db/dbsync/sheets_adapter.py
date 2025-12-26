# backend/app/utils/db/dbsync/sheets_adapter.py
from __future__ import annotations

from typing import Any, List, Sequence, Tuple

import os


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
    - google.oauth2.service_account
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
        self.sh = self.gc.open_by_key(self.spreadsheet_id)

    def list_tables(self) -> List[str]:
        """Lista worksheets -> títulos => tablas disponibles."""
        return [ws.title for ws in self.sh.worksheets()]

    def _get_or_create_ws(self, title: str):
        try:
            return self.sh.worksheet(title)
        except Exception:
            # create worksheet: rows/cols iniciales conservadores
            return self.sh.add_worksheet(title=title, rows=2000, cols=60)

    def ensure_headers(self, table: str, headers: List[str]) -> None:
        ws = self._get_or_create_ws(table)
        current = ws.row_values(1)
        if current == headers:
            return
        # Set headers row
        ws.update("A1", [headers])

    def read_table(self, table: str) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        ws = self._get_or_create_ws(table)
        values = ws.get_all_values()
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
            - borra contenido previo (si allow_destructive True) o limpia rango usado
            - escribe data desde A2
        """
        ws = self._get_or_create_ws(table)
        self.ensure_headers(table, headers)

        if not execute:
            return

        # Convertimos rows a strings/valores para gspread
        data = []
        for r in rows:
            data.append([("" if v is None else v) for v in r])

        # Limpieza: si no destructivo, limpiamos “área usada” a partir de A2.
        # Si destructivo, también puede borrarse todo menos headers.
        if allow_destructive:
            # Clear whole sheet then restore headers
            ws.clear()
            ws.update("A1", [headers])
        else:
            # Limpieza conservadora: limpiar rango grande (A2:ZZ)
            ws.batch_clear(["A2:ZZ"])

        if not data:
            return

        # Escritura desde A2
        ws.update("A2", data)
