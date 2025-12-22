# backend/app/db/session.py
"""
Gestión de la conexión a la base de datos (SQLAlchemy).

Puntos clave:
- Construimos engine desde settings.resolve_database_url()
- connect_args fuerza parámetros críticos en el driver psycopg:
  - prepare_threshold=0 (INT): evita problemas con prepared statements y poolers
  - options: search_path
  - connect_timeout, sslmode
- NullPool opcional: recomendado cuando pasas por pooler (p.ej. Supabase pooler/PgBouncer)
"""

from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from backend.app.core.config import settings


def _should_use_nullpool(db_url: str) -> bool:
    """
    Decide si usar NullPool.

    Cuándo conviene:
    - Si DB_USE_NULLPOOL está activado.
    - Si detectamos host/puerto típicos de poolers (ej: supabase pooler 6543).
    """
    if str(settings.DB_USE_NULLPOOL).lower() in ("1", "true", "yes"):
        return True

    try:
        p = urlparse(db_url)
        host = (p.hostname or "").lower()
        port = p.port or 0
        # Heurística útil: supabase pooler o puertos típicos de poolers
        if "pooler.supabase.com" in host or port == 6543:
            return True
    except Exception:
        pass

    return False


# 1) Resolver URL final de BD (Neon por defecto si así configuras DB_DEFAULT)
DATABASE_URL = settings.resolve_database_url()

# 2) connect_args “finos” (muy parecido a tu V2)
#    Importante: prepare_threshold DEBE ser int, no string.
connect_args = {
    "connect_timeout": 10,
    "sslmode": "require",
    # Asegura el esquema, incluso si la URL ya trae options.
    # (No hace daño; el server usará el último SET si se repite.)
    "options": "-c search_path=public",
    # Clave para evitar el TypeError y problemas de prepared statements:
    "prepare_threshold": 0,
}

engine_kwargs = dict(
    pool_pre_ping=True,
    future=True,
    connect_args=connect_args,
)

# 3) Pooling: NullPool cuando procede
if _should_use_nullpool(DATABASE_URL):
    engine_kwargs["poolclass"] = NullPool

engine = create_engine(DATABASE_URL, **engine_kwargs)


# 4) Mitigación para poolers (PgBouncer): limpiar prepared statements al conectar
@event.listens_for(engine, "connect")
def _pgbouncer_cleanup(dbapi_connection, connection_record):
    """
    Algunos poolers no llevan bien prepared statements persistentes.
    DEALLOCATE ALL suele ser un “parche” efectivo para evitar errores raros.
    """
    cur = dbapi_connection.cursor()
    try:
        cur.execute("DEALLOCATE ALL;")
    except Exception:
        pass
    finally:
        cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_db():
    """
    Dependencia FastAPI:
    - abre sesión
    - fuerza search_path a public
    - cierra sesión al finalizar
    """
    db = SessionLocal()
    try:
        db.execute(text("SET search_path TO public;"))
        yield db
    finally:
        db.close()
