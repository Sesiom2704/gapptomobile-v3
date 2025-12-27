# backend/app/utils/db/dbsync/postgres_adapter.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

from sqlalchemy import (
    Column,
    MetaData,
    Table,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError


@dataclass(frozen=True)
class TableInfo:
    full_name: str
    schema: str
    name: str
    is_view: bool  # True si es VIEW o MATVIEW


class PostgresAdapter:
    """
    Adapter Postgres para SyncEngine.

    Características:
      - Conecta con SQLAlchemy+psycopg.
      - Introspección:
          list_tables, table_info, read_table, ensure_table_from_source, write_table.
      - NUEVO (blindaje FK):
          list_fk_edges(): devuelve aristas (child -> parent) por constraints FK.

    Nota importante:
      - Para evitar problemas con poolers/prepared statements, es recomendable
        incluir prepare_threshold=0 (INT). Aquí lo forzamos en connect_args.
    """

    def __init__(self, db_url: str):
        self.db_url = (db_url or "").strip().strip('"').strip("'")
        if not self.db_url:
            raise RuntimeError("DB URL vacía para PostgresAdapter")

        # Engine “ligero” para jobs puntuales (sync).
        self.engine: Engine = create_engine(
            self.db_url,
            pool_pre_ping=True,
            future=True,
            connect_args={
                "connect_timeout": 10,
                "sslmode": "require",
                # CLAVE: psycopg3 espera int, no string (evita TypeError)
                "prepare_threshold": 0,
            },
        )

    # -----------------------------
    # Introspección
    # -----------------------------
    def list_tables(self) -> List[str]:
        """
        Devuelve tablas candidatas en public, incluyendo:
          - tablas (relkind 'r')
          - vistas (relkind 'v')
          - matviews (relkind 'm')
        """
        q = text(
            """
            SELECT n.nspname AS schema, c.relname AS name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r','v','m')
            ORDER BY n.nspname, c.relname
            """
        )
        with self.engine.connect() as conn:
            rows = conn.execute(q).fetchall()
        return [f"{r.schema}.{r.name}" for r in rows]

    def table_info(self, full_name: str) -> TableInfo:
        schema, name = self._split(full_name)

        q = text(
            """
            SELECT c.relkind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :schema AND c.relname = :name
            LIMIT 1
            """
        )
        with self.engine.connect() as conn:
            relkind = conn.execute(q, {"schema": schema, "name": name}).scalar()

        # relkind: r=table, v=view, m=matview
        is_view = relkind in ("v", "m")
        return TableInfo(full_name=full_name, schema=schema, name=name, is_view=is_view)

    def list_fk_edges(self, *, schema: str = "public") -> List[Tuple[str, str]]:
        """
        Devuelve relaciones FK como aristas (child_full_name, parent_full_name)
        con nombres SIEMPRE cualificados (schema.table).

        Esto evita que regclass::text devuelva nombres sin schema cuando el search_path incluye public.
        """
        q = text(
            """
            SELECT
            child_ns.nspname  AS child_schema,
            child_cl.relname  AS child_name,
            parent_ns.nspname AS parent_schema,
            parent_cl.relname AS parent_name
            FROM pg_constraint con
            JOIN pg_class child_cl ON child_cl.oid = con.conrelid
            JOIN pg_namespace child_ns ON child_ns.oid = child_cl.relnamespace
            JOIN pg_class parent_cl ON parent_cl.oid = con.confrelid
            JOIN pg_namespace parent_ns ON parent_ns.oid = parent_cl.relnamespace
            WHERE con.contype = 'f'
            """
        )
        with self.engine.connect() as conn:
            rows = conn.execute(q).fetchall()

        edges: List[Tuple[str, str]] = []
        for r in rows:
            child = f"{r.child_schema}.{r.child_name}"
            parent = f"{r.parent_schema}.{r.parent_name}"

            if schema:
                if r.child_schema != schema:
                    continue
                if r.parent_schema != schema:
                    continue

            edges.append((child, parent))

        return edges

    def truncate_tables(
        self,
        full_names: List[str],
        *,
        allow_destructive: bool,
    ) -> None:
        """
        Trunca múltiples tablas en una única sentencia TRUNCATE.

        Motivo:
        Postgres no permite truncar una tabla referenciada por FK
        salvo que incluyas también las tablas hijas en el mismo TRUNCATE,
        o uses CASCADE.

        - allow_destructive=False:
            TRUNCATE ... RESTART IDENTITY (sin CASCADE) pero con TODAS las tablas a la vez
        - allow_destructive=True:
            añade CASCADE

        Nota:
        Ignora views/matviews; solo tablas reales (relkind='r').
        """
        if not full_names:
            return

        # Filtrar solo tablas reales en destino (evitar vistas/matviews)
        real_tables: List[str] = []
        for full in full_names:
            try:
                info = self.table_info(full)
                if info.is_view:
                    continue
                schema, name = info.schema, info.name
                real_tables.append(f'"{schema}"."{name}"')
            except Exception:
                # Si algo no se puede inspeccionar, lo saltamos para no bloquear todo el truncate
                continue

        if not real_tables:
            return

        sql = "TRUNCATE TABLE " + ", ".join(real_tables) + " RESTART IDENTITY"
        if allow_destructive:
            sql += " CASCADE"

        try:
            with self.engine.begin() as conn:
                conn.execute(text(sql))
        except SQLAlchemyError as e:
            raise RuntimeError(
                f"TRUNCATE multi-tabla falló. allow_destructive={allow_destructive}. Error: {e}"
            ) from e


    # -----------------------------
    # Lectura / Escritura
    # -----------------------------
    def read_table(self, full_name: str) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        """
        Lee tabla/vista completa (SELECT *).

        Para tablas grandes, considera paginar; en tu caso (tablas auxiliares),
        suele ser suficiente.
        """
        schema, name = self._split(full_name)
        sql = text(f'SELECT * FROM "{schema}"."{name}"')
        with self.engine.connect() as conn:
            res = conn.execute(sql)
            headers = list(res.keys())
            rows = [tuple(r) for r in res.fetchall()]
        return headers, rows

    def ensure_table_from_source(self, source_engine: Engine, full_name: str) -> None:
        """
        Crea la tabla en el destino si no existe, reflejando columnas del origen.

        - Si es view/matview: NO creamos.
        - Si ya existe en destino: no hace nada.
        """
        info = self.table_info(full_name)
        if info.is_view:
            return

        schema, name = info.schema, info.name
        dest_inspector = inspect(self.engine)

        if name in dest_inspector.get_table_names(schema=schema):
            return

        # Reflejar columnas desde source_engine
        src_inspector = inspect(source_engine)
        cols = src_inspector.get_columns(name, schema=schema)
        if not cols:
            raise RuntimeError(f"No se pudieron obtener columnas de {full_name} en source")

        md = MetaData(schema=schema)
        columns: List[Column] = []
        for c in cols:
            col_name = c["name"]
            col_type = c["type"]
            nullable = bool(c.get("nullable", True))
            columns.append(Column(col_name, col_type, nullable=nullable))

        t = Table(name, md, *columns)
        md.create_all(self.engine, tables=[t])

    def write_table(
        self,
        full_name: str,
        headers: List[str],
        rows: Sequence[Tuple[Any, ...]],
        *,
        execute: bool,
        allow_destructive: bool,
        clear_first: bool = True,
    ) -> None:
        """
        Escribe en Postgres.

        - execute=False => no escribe
        - execute=True:
            - crea tabla si no existe (fallback)
            - si clear_first=True: limpia (antes era TRUNCATE por tabla)
            - INSERT por lotes
        """
        if not execute:
            return

        schema, name = self._split(full_name)
        ins = inspect(self.engine)

        # Si no existe, creamos una tabla “mínima” con TEXT (fallback)
        if name not in ins.get_table_names(schema=schema):
            if allow_destructive:
                self._drop_if_exists(schema, name)
            self._create_text_table(schema, name, headers)

        # Limpieza opcional (por defecto sí, pero en el job lo desactivaremos tras el pre-truncate)
        if clear_first:
            truncate_sql = f'TRUNCATE TABLE "{schema}"."{name}" RESTART IDENTITY'
            if allow_destructive:
                truncate_sql += " CASCADE"

            try:
                with self.engine.begin() as conn:
                    conn.execute(text(truncate_sql))
            except SQLAlchemyError as e:
                raise RuntimeError(
                    f"TRUNCATE falló en {schema}.{name}. allow_destructive={allow_destructive}. Error: {e}"
                ) from e

        if not rows:
            return

        md = MetaData(schema=schema)
        t = Table(name, md, autoload_with=self.engine)

        batch_size = 1000
        with self.engine.begin() as conn:
            for i in range(0, len(rows), batch_size):
                chunk = rows[i : i + batch_size]
                payload = [dict(zip(headers, r)) for r in chunk]
                conn.execute(t.insert(), payload)


    # -----------------------------
    # Helpers internos
    # -----------------------------
    def _split(self, full_name: str) -> tuple[str, str]:
        if "." in full_name:
            schema, name = full_name.split(".", 1)
            return schema, name
        return "public", full_name

    def _drop_if_exists(self, schema: str, name: str) -> None:
        try:
            with self.engine.begin() as conn:
                conn.execute(text(f'DROP TABLE IF EXISTS "{schema}"."{name}" CASCADE'))
        except SQLAlchemyError:
            raise

    def _create_text_table(self, schema: str, name: str, headers: List[str]) -> None:
        """
        Crea tabla básica con columnas TEXT (fallback).
        """
        cols_sql = ", ".join([f'"{h}" TEXT NULL' for h in headers])
        ddl = f'CREATE TABLE IF NOT EXISTS "{schema}"."{name}" ({cols_sql})'
        with self.engine.begin() as conn:
            conn.execute(text(ddl))
