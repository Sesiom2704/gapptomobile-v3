# backend/app/utils/db/dbsync/postgres_adapter.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import (
    MetaData,
    Table,
    Column,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.sql import quoted_name


@dataclass
class ColumnInfo:
    name: str
    type: str
    nullable: bool


@dataclass
class TableInfo:
    full_name: str            # "public.users"
    schema: str               # "public"
    name: str                 # "users"
    columns: List[ColumnInfo]
    primary_key: List[str]
    is_view: bool = False     # vista/materialized view
    row_count: Optional[int] = None


class PostgresAdapter:
    """
    Adapter Postgres para SyncEngine (backend/app/utils/db/core.py).

    CONTRATO (según tu SyncEngine):
      - list_tables() -> List[str]
      - table_info(full_name) -> TableInfo
      - read_table(full_name) -> (headers: List[str], rows: List[Tuple[Any,...]])
      - ensure_table_from_source(source_engine, full_name) -> None
      - write_table(full_name, headers, rows, execute, allow_destructive) -> None

    Notas operativas:
      - execute=False => NO escribe (dry-run).
      - allow_destructive=False => comportamiento conservador:
          * si la tabla existe, no la altera (no drop/alter)
          * en write_table: usa TRUNCATE + INSERT (si execute=True)
      - allow_destructive=True:
          * permite DROP + recreate en algunos casos (si tú lo activas).
    """

    def __init__(self, db_url: str):
        self.db_url = db_url

        # OJO: prepare_threshold debe ser INT, no string.
        # Si lo pasas en URL como "prepare_threshold=0" está bien,
        # pero además lo fijamos en connect_args para evitar sorpresas.
        self.engine: Engine = create_engine(
            db_url,
            pool_pre_ping=True,
            future=True,
            connect_args={
                "connect_timeout": 10,
                "sslmode": "require",
                "options": "-c search_path=public",
                "prepare_threshold": 0,
            },
        )
        self._insp = inspect(self.engine)

    # ---------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------
    @staticmethod
    def _split_full_name(full_name: str) -> Tuple[str, str]:
        full = (full_name or "").strip()
        if "." in full:
            s, t = full.split(".", 1)
            return s.strip('"'), t.strip('"')
        return "public", full.strip('"')

    def _table_exists(self, schema: str, table: str) -> bool:
        return table in set(self._insp.get_table_names(schema=schema))

    def _view_exists(self, schema: str, name: str) -> bool:
        return name in set(self._insp.get_view_names(schema=schema))

    # ---------------------------------------------------------------------
    # API: discovery
    # ---------------------------------------------------------------------
    def list_tables(self) -> List[str]:
        """
        Devuelve tablas y vistas como 'schema.name'.
        Tu db_router después filtra public.*.
        """
        out: List[str] = []
        for schema in self._insp.get_schema_names():
            for t in self._insp.get_table_names(schema=schema):
                out.append(f"{schema}.{t}")
            for v in self._insp.get_view_names(schema=schema):
                out.append(f"{schema}.{v}")
        # dedupe manteniendo orden
        return list(dict.fromkeys(out))

    # ---------------------------------------------------------------------
    # API: table_info
    # ---------------------------------------------------------------------
    def table_info(self, full_name: str) -> TableInfo:
        schema, name = self._split_full_name(full_name)

        cols_raw = self._insp.get_columns(name, schema=schema)
        cols = [
            ColumnInfo(
                name=c["name"],
                type=str(c.get("type", "")),
                nullable=bool(c.get("nullable", True)),
            )
            for c in cols_raw
        ]

        pk = self._insp.get_pk_constraint(name, schema=schema) or {}
        pk_cols = list(pk.get("constrained_columns") or [])

        is_view = self._view_exists(schema, name)

        # row_count es útil para debug, pero no debe romper nada si falla
        row_count: Optional[int] = None
        try:
            with self.engine.connect() as conn:
                row_count = conn.execute(
                    text(f'SELECT COUNT(*) FROM "{schema}"."{name}"')
                ).scalar_one()
        except Exception:
            row_count = None

        return TableInfo(
            full_name=f"{schema}.{name}",
            schema=schema,
            name=name,
            columns=cols,
            primary_key=pk_cols,
            is_view=is_view,
            row_count=row_count,
        )

    # ---------------------------------------------------------------------
    # API: read_table  (ESTO era lo que te faltaba)
    # ---------------------------------------------------------------------
    def read_table(self, full_name: str) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        """
        Lee todas las filas de una tabla (uso en SyncEngine).
        Devuelve headers (orden de columnas) + rows (tuplas).

        - Usa ORDER BY por PK si existe; si no, ordena por la primera columna
          para tener resultados deterministas (útil en comparaciones).
        """
        info = self.table_info(full_name)
        if info.is_view:
            # Views: se pueden leer igualmente.
            pass

        headers = [c.name for c in info.columns]
        if not headers:
            return [], []

        order_cols = info.primary_key or [headers[0]]
        order_sql = ", ".join([f'"{c}"' for c in order_cols if c in headers]) or f'"{headers[0]}"'

        schema, name = info.schema, info.name
        sql = text(f'SELECT * FROM "{schema}"."{name}" ORDER BY {order_sql}')

        with self.engine.connect() as conn:
            res = conn.execute(sql)
            rows = res.fetchall()

        # rows ya son tuplas (Row), las convertimos a tuple puro por estabilidad
        return headers, [tuple(r) for r in rows]

    # ---------------------------------------------------------------------
    # API: ensure_table_from_source  (Postgres -> Postgres)
    # ---------------------------------------------------------------------
    def ensure_table_from_source(self, source_engine: Engine, full_name: str) -> None:
        """
        Crea la tabla en destino si NO existe, clonando estructura desde origen
        usando reflection de SQLAlchemy.

        Conservador:
        - Si existe => no hace nada.
        - No intenta replicar índices/constraints complejas (más allá del schema básico
          que SQLAlchemy refleje para CREATE TABLE).
        """
        schema, name = self._split_full_name(full_name)

        # Si es vista en el origen, aquí NO la creamos como tabla.
        # Tu SyncEngine ya filtra views cuando allow_destructive=False.
        dest_insp = inspect(self.engine)
        if name in set(dest_insp.get_table_names(schema=schema)):
            return

        md = MetaData(schema=schema)

        # Reflejamos SOLO esa tabla desde el engine origen
        Table(name, md, autoload_with=source_engine)

        # Creamos en destino
        md.create_all(self.engine, checkfirst=True)

    # ---------------------------------------------------------------------
    # API: write_table
    # ---------------------------------------------------------------------
    def write_table(
        self,
        full_name: str,
        headers: List[str],
        rows: Sequence[Tuple[Any, ...]],
        *,
        execute: bool,
        allow_destructive: bool,
    ) -> None:
        """
        Escribe datos en Postgres.

        Estrategia (simple y fiable):
        - Si execute=False => no escribe.
        - Si tabla no existe:
            * crea tabla con columnas TEXT si no se ha clonado antes
              (esto cubre el caso Sheets -> Postgres, donde SyncEngine no llama a ensure_table_from_source).
        - Si existe:
            * allow_destructive=False => TRUNCATE + INSERT
            * allow_destructive=True  => TRUNCATE + INSERT (y opcionalmente podrías DROP+recreate,
              pero no lo aplico automáticamente para no arriesgar datos)
        """
        if not execute:
            return

        schema, name = self._split_full_name(full_name)

        # 1) Asegurar tabla existe (caso Sheets -> Postgres)
        if not self._table_exists(schema, name):
            if not headers:
                # Nada que crear
                return
            self._create_text_table(schema, name, headers)

        # 2) TRUNCATE (conservador, pero deja el schema intacto)
        with self.engine.begin() as conn:
            conn.execute(text(f'TRUNCATE TABLE "{schema}"."{name}"'))

            if not rows:
                return

            # 3) INSERT masivo
            col_sql = ", ".join([f'"{c}"' for c in headers])
            val_sql = ", ".join([f":v{i}" for i in range(len(headers))])
            ins = text(f'INSERT INTO "{schema}"."{name}" ({col_sql}) VALUES ({val_sql})')

            batch: List[Dict[str, Any]] = []
            for r in rows:
                # Asegura longitud y mapea por posición
                rr = list(r) + [None] * max(0, len(headers) - len(r))
                rr = rr[: len(headers)]
                batch.append({f"v{i}": rr[i] for i in range(len(headers))})

            conn.execute(ins, batch)

    # ---------------------------------------------------------------------
    # Internal: create TEXT table (Sheets -> Postgres)
    # ---------------------------------------------------------------------
    def _create_text_table(self, schema: str, name: str, headers: List[str]) -> None:
        """
        Crea una tabla básica con columnas TEXT.
        Se usa cuando el origen no es Postgres (p.ej. Sheets) y por tanto no hay reflection.
        """
        md = MetaData(schema=schema)
        cols = []
        for h in headers:
            # quoted_name preserva case y evita problemas con palabras reservadas
            colname = quoted_name(h, quote=True)
            cols.append(Column(colname, text("").type))  # placeholder, lo corregimos abajo

        # SQLAlchemy no expone TEXT directamente así con text("").type de forma elegante.
        # Usamos Column(String) suele servir, pero prefiero TEXT literal en SQL.
        # Para mantener esto simple y fiable, generamos SQL manual:
        cols_sql = ", ".join([f'"{h}" TEXT' for h in headers])

        with self.engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
            conn.execute(text(f'CREATE TABLE "{schema}"."{name}" ({cols_sql})'))
