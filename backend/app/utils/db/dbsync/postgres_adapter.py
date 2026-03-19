"""
/**
 * Ruta: backend/app/utils/db/dbsync/postgres_adapter.py
 * Versión: 1.0.0
 * Descripción:
 * Adaptador Postgres para el motor de sincronización de GAPPTO Mobile 3.0.
 *
 * Funcionalidades incluidas:
 * - Conecta con bases Postgres mediante SQLAlchemy.
 * - Lista tablas, vistas y vistas materializadas del schema public.
 * - Obtiene información de tablas y detecta si son view o matview.
 * - Lee tablas completas mediante SELECT *.
 * - Lista dependencias FK como relaciones child -> parent.
 * - Lista tablas reales del destino.
 * - Ejecuta truncado multi-tabla controlado.
 * - Refleja estructura de una tabla origen en destino cuando es necesario.
 * - Escribe datos en Postgres por lotes.
 * - Coacciona valores provenientes de Sheets a tipos compatibles con Postgres.
 * - Crea tablas fallback con columnas TEXT si no existen.
 *
 * Ajustes de esta versión:
 * - Se mejora la claridad del código y de los comentarios internos.
 * - Se refuerza el tipado y la legibilidad de helpers internos.
 * - Se mantiene intacto el contrato funcional del adapter.
 * - Se conserva el comportamiento existente de lectura, truncado, coerción e inserción.
 *
 * Notas de diseño:
 * - Este adapter no se modifica de forma agresiva para no romper la sync actual.
 * - La coerción de tipos sigue siendo especialmente importante para Sheets -> Postgres.
 * - La creación fallback con columnas TEXT se mantiene como red de seguridad.
 * - La lógica de estructura y escritura permanece separada para facilitar mantenimiento.
 */
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Sequence, Tuple
from uuid import UUID

from sqlalchemy import Column, MetaData, Table, create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

# Tipos SQLAlchemy para coerción
from sqlalchemy.sql.sqltypes import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)


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
      - Blindaje FK:
          list_fk_edges(): devuelve aristas (child -> parent) por constraints FK.

    Nota:
      - Para evitar problemas con poolers/prepared statements, incluimos prepare_threshold=0.
    """

    def __init__(self, db_url: str):
        self.db_url = (db_url or "").strip().strip('"').strip("'")
        if not self.db_url:
            raise RuntimeError("DB URL vacía para PostgresAdapter")

        self.engine: Engine = create_engine(
            self.db_url,
            pool_pre_ping=True,
            future=True,
            connect_args={
                "connect_timeout": 10,
                "sslmode": "require",
                "prepare_threshold": 0,  # psycopg3 espera int
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
        """
        Devuelve información básica de una tabla, incluyendo si es view/matview.
        """
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
        Devuelve relaciones FK como aristas:
          (child_full_name, parent_full_name)

        Los nombres se devuelven siempre cualificados como schema.table.
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

    def list_real_tables(self, *, schema: str = "public") -> List[str]:
        """
        Devuelve SOLO tablas reales (relkind='r') del schema indicado.
        """
        q = text(
            """
            SELECT n.nspname AS schema, c.relname AS name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :schema
              AND c.relkind = 'r'
            ORDER BY n.nspname, c.relname
            """
        )
        with self.engine.connect() as conn:
            rows = conn.execute(q, {"schema": schema}).fetchall()
        return [f"{r.schema}.{r.name}" for r in rows]

    def truncate_tables(
        self,
        full_names: List[str],
        *,
        allow_destructive: bool,
    ) -> None:
        """
        Trunca múltiples TABLAS en una única sentencia TRUNCATE.

        Solo actúa sobre tablas reales existentes.
        """
        if not full_names:
            return

        existing = set(self.list_real_tables(schema="public"))

        to_truncate: List[str] = []
        for full in full_names:
            if full in existing:
                schema, name = self._split(full)
                to_truncate.append(f'"{schema}"."{name}"')

        if not to_truncate:
            return

        sql = "TRUNCATE TABLE " + ", ".join(to_truncate) + " RESTART IDENTITY"
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
        Lee tabla o vista completa mediante SELECT *.
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

        Reglas:
        - Si el objeto es view/matview, no crea nada.
        - Si la tabla ya existe en destino, no hace nada.
        """
        info = self.table_info(full_name)
        if info.is_view:
            return

        schema, name = info.schema, info.name
        dest_inspector = inspect(self.engine)

        if name in dest_inspector.get_table_names(schema=schema):
            return

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

    # -----------------------------
    # Coerción de tipos (CRÍTICO para Sheets -> Postgres)
    # -----------------------------
    def _coerce_value_for_column(self, col, value: Any) -> Any:
        """
        Convierte valores provenientes de Sheets al tipo esperado por Postgres.

        Reglas principales:
        - None -> None
        - "" -> None para tipos no texto
        - numeric: "82,58" -> 82.58
        - bool: "TRUE"/"FALSE"/"1"/"0" -> bool
        - date/datetime: parse ISO8601
        - UUID -> str
        """
        if value is None:
            return None

        # Normalización de strings
        if isinstance(value, str):
            v = value.strip()

            # Vacío: para no text, se trata como NULL
            if v == "":
                if isinstance(col.type, (String, Text)):
                    return ""
                return None

            # Boolean
            if isinstance(col.type, Boolean):
                vv = v.lower()
                if vv in ("true", "t", "1", "yes", "y", "si", "sí"):
                    return True
                if vv in ("false", "f", "0", "no", "n"):
                    return False
                return v

            # Integer-like
            if isinstance(col.type, (SmallInteger, Integer, BigInteger)):
                # Permite "2.0" o "2,0" desde Sheets
                vv = (
                    v.replace(".", "").replace(",", ".")
                    if v.count(",") == 1 and v.count(".") == 0
                    else v
                )
                try:
                    return int(float(vv.replace(",", ".")))
                except Exception:
                    return v

            # Float/Numeric
            if isinstance(col.type, (Float, Numeric)):
                vv = v.replace(" ", "")
                if "," in vv and "." not in vv:
                    vv = vv.replace(",", ".")
                try:
                    if isinstance(col.type, Numeric):
                        return Decimal(vv)
                    return float(vv)
                except Exception:
                    return v

            # Date
            if isinstance(col.type, Date) and not isinstance(col.type, DateTime):
                try:
                    if "T" in v:
                        return datetime.fromisoformat(v).date()
                    return date.fromisoformat(v)
                except Exception:
                    return v

            # DateTime
            if isinstance(col.type, DateTime):
                try:
                    return datetime.fromisoformat(v)
                except Exception:
                    return v

            # Strings normales o UUIDs almacenados como texto
            return v

        # Tipos ya correctos
        if isinstance(value, (bool, int, float, Decimal, datetime, date)):
            return value

        if isinstance(value, UUID):
            return str(value)

        # Fallback
        return value

    def _coerce_rows_to_table_types(
        self,
        table_obj: Table,
        headers: List[str],
        rows: Sequence[Tuple[Any, ...]],
    ) -> List[Tuple[Any, ...]]:
        """
        Coacciona cada celda según el tipo de la columna en destino.

        Solo afecta a columnas que existan en destino.
        """
        col_by_name = {c.name: c for c in table_obj.columns}
        out: List[Tuple[Any, ...]] = []

        for r in rows:
            rr: List[Any] = []
            for h, v in zip(headers, r):
                col = col_by_name.get(h)
                if col is None:
                    # Columna no existe en destino.
                    # Lo dejamos tal cual para no alterar comportamiento.
                    rr.append(v)
                else:
                    rr.append(self._coerce_value_for_column(col, v))
            out.append(tuple(rr))

        return out

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
            - clear_first: TRUNCATE (si no se hizo pre-truncate global)
            - INSERT por lotes
            - COERCIÓN: si rows vienen como strings (Sheets), convertimos a tipos destino.
        """
        if not execute:
            return

        schema, name = self._split(full_name)
        ins = inspect(self.engine)

        # Si no existe, creamos una tabla mínima con TEXT (fallback)
        if name not in ins.get_table_names(schema=schema):
            if allow_destructive:
                self._drop_if_exists(schema, name)
            self._create_text_table(schema, name, headers)

        # Limpieza opcional
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

        # COERCIÓN (aquí se arregla el "82,58" -> 82.58)
        coerced_rows = self._coerce_rows_to_table_types(t, headers, rows)

        batch_size = 1000
        with self.engine.begin() as conn:
            for i in range(0, len(coerced_rows), batch_size):
                chunk = coerced_rows[i : i + batch_size]
                payload = [dict(zip(headers, r)) for r in chunk]
                conn.execute(t.insert(), payload)

    # -----------------------------
    # Helpers internos
    # -----------------------------
    def _split(self, full_name: str) -> tuple[str, str]:
        """
        Divide schema.table en (schema, table).
        Si no viene schema, asume public.
        """
        if "." in full_name:
            schema, name = full_name.split(".", 1)
            return schema, name
        return "public", full_name

    def _drop_if_exists(self, schema: str, name: str) -> None:
        """
        Elimina la tabla si existe.
        """
        try:
            with self.engine.begin() as conn:
                conn.execute(text(f'DROP TABLE IF EXISTS "{schema}"."{name}" CASCADE'))
        except SQLAlchemyError:
            raise

    def _create_text_table(self, schema: str, name: str, headers: List[str]) -> None:
        """
        Crea una tabla básica con columnas TEXT NULL como fallback.
        """
        cols_sql = ", ".join([f'"{h}" TEXT NULL' for h in headers])
        ddl = f'CREATE TABLE IF NOT EXISTS "{schema}"."{name}" ({cols_sql})'
        with self.engine.begin() as conn:
            conn.execute(text(ddl))