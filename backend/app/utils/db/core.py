# backend/app/utils/db/core.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.app.utils.db.dbsync.postgres_adapter import PostgresAdapter
from backend.app.utils.db.dbsync.sheets_adapter import SheetsAdapter


class SyncEngine:
    """
    Motor de sincronización “tabla a tabla”.

    Mantiene el mismo contrato conceptual que venías usando:
      engine.mirror(tables=[...], execute=..., allow_destructive=...)

    Reglas:
    - source y dest pueden ser Postgres o Sheets.
    - Si el destino es Postgres: creamos tabla si no existe (schema básico) y escribimos.
    - Si el destino es Sheets: worksheet por tabla, headers + filas.
    - Views/MATVIEW:
        - En modo allow_destructive=False las saltamos para evitar conflictos (DuplicateTable, etc.)
    """

    def __init__(self, source, dest, config: Optional[Dict[str, Any]] = None):
        self.source = source
        self.dest = dest
        self.config = config or {}

    def mirror(
        self,
        *,
        tables: List[str],
        exclude: Optional[List[str]],
        execute: bool,
        allow_destructive: bool,
    ) -> None:
        """
        Replica cada tabla:
        - lee headers+rows desde source
        - asegura estructura en destino
        - escribe (si execute=True) o simula (execute=False)
        """
        for full_name in tables:
            if exclude and full_name in set(exclude):
                print(f"[mirror] {full_name}: skip (excluded)")
                continue

            # Si el source es Postgres, detectamos si es view/matview
            if isinstance(self.source, PostgresAdapter):
                info = self.source.table_info(full_name)
                if info.is_view and not allow_destructive:
                    print(f"{full_name} es VIEW/MATVIEW. allow_drop=False → skip para evitar DuplicateTable")
                    print(f"[mirror] {full_name}: DRY-RUN (no write)" if not execute else f"[mirror] {full_name}: skip view")
                    continue

            print(f"[mirror] {full_name}: begin")

            # --- Read ---
            if isinstance(self.source, PostgresAdapter):
                headers, rows = self.source.read_table(full_name)
            elif isinstance(self.source, SheetsAdapter):
                headers, rows = self.source.read_table(full_name)
            else:
                raise RuntimeError(f"source adapter no soportado: {type(self.source)}")

            # --- Ensure destination structure ---
            if isinstance(self.dest, PostgresAdapter) and isinstance(self.source, PostgresAdapter):
                # Creamos tabla en destino desde reflection del engine origen.
                self.dest.ensure_table_from_source(self.source.engine, full_name)

            if isinstance(self.dest, SheetsAdapter):
                # Asegura headers en worksheet
                self.dest.ensure_headers(full_name, headers)
                print(f"[Sheets] {full_name}: headers OK")

            # --- Write ---
            if isinstance(self.dest, PostgresAdapter):
                self.dest.write_table(
                    full_name,
                    headers,
                    rows,
                    execute=execute,
                    allow_destructive=allow_destructive,
                )
            elif isinstance(self.dest, SheetsAdapter):
                self.dest.write_table(
                    full_name,
                    headers,
                    rows,
                    execute=execute,
                    allow_destructive=allow_destructive,
                )
                if execute:
                    print(f"[Sheets] {full_name}: wrote {len(rows)} rows")
            else:
                raise RuntimeError(f"dest adapter no soportado: {type(self.dest)}")

            if not execute:
                print(f"[mirror] {full_name}: DRY-RUN (no write)")
            else:
                print(f"[mirror] {full_name}: wrote OK")

            print("[mirror] done")
