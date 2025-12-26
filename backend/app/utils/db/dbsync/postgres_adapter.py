# backend/app/utils/db/dbsync/postgres_adapter.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


@dataclass
class ColumnInfo:
    name: str
    type: str
    nullable: bool


@dataclass
class TableInfo:
    full_name: str              # e.g. "public.users"
    schema: str                 # e.g. "public"
    name: str                   # e.g. "users"
    columns: List[ColumnInfo]
    primary_key: List[str]
    is_view: bool = False       # VIEW / MATVIEW
    row_count: Optional[int] = None


class PostgresAdapter:
    """
    Adapter Postgres para SyncEngine.

    Contrato mínimo esperado por tu SyncEngine/routers:
    - list_tables() -> List[str]  (nombres "schema.table")
    - table_info(full_name) -> TableInfo  (columnas, pk, view)
    - fetch_rows(full_name, limit=None, offset=None) -> (rows, columns)
        rows: List[Tuple[Any,...]]
        columns: List[str]
    """

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.engine: Engine = create_engine(
            db_url,
            pool_pre_ping=True,
            future=True,
            # IMPORTANTÍSIMO para Render + psycopg + prepared statements:
            connect_args={
                "connect_timeout": 10,
                "sslmode": "require",
                "options": "-c search_path=public",
                "prepare_threshold": 0,  # debe ser int (no string)
            },
        )
        self._inspector = inspect(self.engine)

    # ---------------------------
    # Descubrimiento de tablas
    # ---------------------------
    def list_tables(self) -> List[str]:
        """
        Devuelve tablas + vistas en formato 'schema.name'.
        En tu caso, normalmente usas public.*
        """
        out: List[str] = []

        schemas = self._inspector.get_schema_names()
        for schema in schemas:
            # tablas
            for t in self._inspector.get_table_names(schema=schema):
                out.append(f"{schema}.{t}")
            # vistas
            for v in self._inspector.get_view_names(schema=schema):
                out.append(f"{schema}.{v}")

        # dedupe manteniendo orden
        return list(dict.fromkeys(out))

    # ---------------------------
    # Metadatos (ESTO FALTABA)
    # ---------------------------
    def table_info(self, full_name: str) -> TableInfo:
        """
        Metadatos estructurales de la tabla/vista.

        Esto es lo que te está rompiendo el job en Render:
        SyncEngine llama a src.table_info(...)
        """
        schema, name = self._split_full_name(full_name)

        # columns
        cols_raw = self._inspector.get_columns(name, schema=schema)
        columns = [
            ColumnInfo(
                name=c["name"],
                type=str(c.get("type", "")),
                nullable=bool(c.get("nullable", True)),
            )
            for c in cols_raw
        ]

        # primary key
        pk = self._inspector.get_pk_constraint(name, schema=schema) or {}
        pk_cols = list(pk.get("constrained_columns") or [])

        # is_view (si aparece en view_names)
        is_view = name in set(self._inspector.get_view_names(schema=schema))

        # row_count (opcional, no imprescindible)
        row_count = None
        try:
            with self.engine.connect() as conn:
                row_count = conn.execute(
                    text(f'SELECT COUNT(*) FROM "{schema}"."{name}"')
                ).scalar_one()
        except Exception:
            # si es vista compleja o permisos, no bloqueamos
            row_count = None

        return TableInfo(
            full_name=f"{schema}.{name}",
            schema=schema,
            name=name,
            columns=columns,
            primary_key=pk_cols,
            is_view=is_view,
            row_count=row_count,
        )

    # ---------------------------
    # Lectura de filas
    # ---------------------------
    def fetch_rows(
        self,
        full_name: str,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        order_by: Optional[List[str]] = None,
    ) -> Tuple[List[Tuple[Any, ...]], List[str]]:
        """
        Lee datos para exportar a Sheets o insertar en destino.
        Devuelve: (rows, columns)
        """
        schema, name = self._split_full_name(full_name)

        info = self.table_info(full_name)
        colnames = [c.name for c in info.columns]

        if not colnames:
            return [], []

        # Order by: si hay PK, úsala; si no, por primera columna
        if order_by is None:
            order_by = info.primary_key or [colnames[0]]

        order_sql = ", ".join([f'"{c}"' for c in order_by if c in colnames]) or f'"{colnames[0]}"'
        sql = f'SELECT * FROM "{schema}"."{name}" ORDER BY {order_sql}'
        params: Dict[str, Any] = {}

        if limit is not None:
            sql += " LIMIT :limit"
            params["limit"] = int(limit)
        if offset is not None:
            sql += " OFFSET :offset"
            params["offset"] = int(offset)

        with self.engine.connect() as conn:
            res = conn.execute(text(sql), params)
            rows = res.fetchall()

        return rows, colnames

    # ---------------------------
    # Helpers
    # ---------------------------
    @staticmethod
    def _split_full_name(full_name: str) -> Tuple[str, str]:
        if "." in full_name:
            s, n = full_name.split(".", 1)
            return s.strip('"'), n.strip('"')
        # default schema
        return "public", full_name.strip('"')
