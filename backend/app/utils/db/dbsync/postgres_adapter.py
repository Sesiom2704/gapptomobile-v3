# backend/app/utils/db/dbsync/postgres_adapter.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


@dataclass
class PostgresAdapter:
    """
    Adapter Postgres genérico.
    Se usa como 'source' o 'dest' en el SyncEngine.

    Requisitos mínimos que cubre:
    - list_tables(): devuelve tablas en formato "schema.table"
    - get_columns(full_table): devuelve columnas (name + type string)
    - read_rows(full_table): lee filas (list[dict]) para volcarlas a Sheets u otro destino
    - write_rows(full_table, rows): inserta filas (modo simple)
      (En tu SyncEngine real probablemente uses COPY/UPSERT; esto es base estable.)
    """
    db_url: str
    engine: Engine | None = None

    def __post_init__(self) -> None:
        self.engine = create_engine(self.db_url, pool_pre_ping=True)

    # -------------------------
    # Introspección
    # -------------------------
    def list_tables(self) -> List[str]:
        """
        Lista tablas y vistas (según lo que exponga el inspector).
        Devuelve siempre "schema.table".
        """
        assert self.engine is not None
        insp = inspect(self.engine)

        out: List[str] = []

        for schema in insp.get_schema_names():
            # Normalmente nos interesa public, pero lo devolvemos todo
            try:
                for t in insp.get_table_names(schema=schema):
                    out.append(f"{schema}.{t}")
            except Exception:
                pass

            # vistas
            try:
                for v in insp.get_view_names(schema=schema):
                    out.append(f"{schema}.{v}")
            except Exception:
                pass

        # Orden estable
        return sorted(list(dict.fromkeys(out)))

    def get_columns(self, full_table: str) -> List[Dict[str, Any]]:
        """
        Devuelve columnas con nombre y tipo.
        """
        assert self.engine is not None
        schema, table = self._split(full_table)
        insp = inspect(self.engine)
        cols = insp.get_columns(table_name=table, schema=schema)
        # Normaliza type a str
        for c in cols:
            c["type"] = str(c.get("type"))
        return cols

    # -------------------------
    # Lectura / escritura
    # -------------------------
    def read_rows(self, full_table: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Lectura simple de filas. Para sync real, tu core puede paginar.
        """
        assert self.engine is not None
        schema, table = self._split(full_table)

        sql = f'SELECT * FROM "{schema}"."{table}"'
        if limit is not None and limit > 0:
            sql += f" LIMIT {int(limit)}"

        with self.engine.connect() as conn:
            res = conn.execute(text(sql))
            cols = list(res.keys())
            rows = [dict(zip(cols, r)) for r in res.fetchall()]
        return rows

    def write_rows(self, full_table: str, rows: Sequence[Dict[str, Any]]) -> int:
        """
        Escritura simple (INSERT).
        Si tu SyncEngine ya tiene UPSERT/COPY, probablemente no uses esto.
        """
        if not rows:
            return 0

        assert self.engine is not None
        schema, table = self._split(full_table)

        # columnas a partir de la primera fila
        columns = list(rows[0].keys())
        col_sql = ", ".join([f'"{c}"' for c in columns])
        val_sql = ", ".join([f":{c}" for c in columns])

        sql = text(f'INSERT INTO "{schema}"."{table}" ({col_sql}) VALUES ({val_sql})')

        with self.engine.begin() as conn:
            conn.execute(sql, list(rows))
        return len(rows)

    # -------------------------
    # Utils
    # -------------------------
    def _split(self, full_table: str) -> Tuple[str, str]:
        if "." not in full_table:
            # fallback: asume public
            return "public", full_table
        schema, table = full_table.split(".", 1)
        return schema, table
