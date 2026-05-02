"""
Ruta: backend/app/db/session.py
Versión: 1.1.0
Descripción:
Gestión de sesiones SQLAlchemy para GAPPTO Mobile.

Funcionalidades incluidas:
- Creación de engine SQLAlchemy por base de datos.
- Soporte para Neon y Supabase.
- Selección dinámica de base por request usando header X-DB.
- Compatibilidad con el engine y SessionLocal antiguos.
- NullPool opcional para poolers como Supabase PgBouncer.
- Limpieza defensiva de prepared statements en conexiones.
- Forzado de search_path=public por sesión.

Ajustes de esta versión:
- get_db ahora puede leer Request y elegir base por X-DB.
- Se mantienen engine y SessionLocal como aliases de la base por defecto.
- Se crean sesiones independientes para neon y supabase.
- Si no llega X-DB, se usa la configuración previa mediante settings.resolve_database_url().
- Se añade logging claro para verificar qué base se está usando.

Reglas funcionales:
- X-DB=supabase usa DB_URL_SUPABASE.
- X-DB=neon usa DB_URL_NEON o DATABASE_URL como fallback.
- Sin X-DB usa el comportamiento anterior.
- Header inválido usa el comportamiento anterior.
- Todos los endpoints que usan Depends(get_db) quedan cubiertos.

Notas de diseño:
- No se modifica ningún router existente.
- No se cambia la firma de los endpoints.
- No se rompe GAPPTO Mobile 2.0 si no envía X-DB.
"""

from __future__ import annotations

from typing import Dict, Optional
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from backend.app.core.config import normalize_db_key, settings


DBKey = str


def _should_use_nullpool(db_url: str) -> bool:
    """
    Decide si usar NullPool.

    Cuándo conviene:
    - Si DB_USE_NULLPOOL está activado.
    - Si detectamos host/puerto típicos de poolers.
    """
    if str(settings.DB_USE_NULLPOOL).lower() in ("1", "true", "yes"):
        return True

    try:
        p = urlparse(db_url)
        host = (p.hostname or "").lower()
        port = p.port or 0

        # Heurística útil: Supabase pooler o puertos típicos de poolers.
        if "pooler.supabase.com" in host or port == 6543:
            return True
    except Exception:
        pass

    return False


def _safe_url_label(db_url: str) -> str:
    """
    Devuelve una etiqueta segura para logs sin exponer credenciales.
    """
    try:
        p = urlparse(db_url)
        host = p.hostname or "unknown-host"
        port = f":{p.port}" if p.port else ""
        db_name = (p.path or "").lstrip("/") or "unknown-db"
        return f"{host}{port}/{db_name}"
    except Exception:
        return "<db-url>"


def _make_engine(db_url: str, label: str) -> Engine:
    """
    Construye un engine SQLAlchemy con la configuración común del proyecto.
    """
    connect_args = {
        "connect_timeout": 10,
        "sslmode": "require",
        "options": "-c search_path=public",
        "prepare_threshold": 0,
    }

    engine_kwargs = dict(
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
    )

    if _should_use_nullpool(db_url):
        engine_kwargs["poolclass"] = NullPool

    created_engine = create_engine(db_url, **engine_kwargs)

    @event.listens_for(created_engine, "connect")
    def _pgbouncer_cleanup(dbapi_connection, connection_record):
        """
        Algunos poolers no llevan bien prepared statements persistentes.
        DEALLOCATE ALL suele evitar errores raros con PgBouncer/poolers.
        """
        cur = dbapi_connection.cursor()
        try:
            cur.execute("DEALLOCATE ALL;")
        except Exception:
            pass
        finally:
            cur.close()

    print(f"[DB] engine creado: {label} -> {_safe_url_label(db_url)}")

    return created_engine


def _make_sessionmaker(created_engine: Engine):
    """
    Crea sessionmaker estándar del proyecto.
    """
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=created_engine,
        future=True,
    )


def _get_header_db_key(request: Optional[Request]) -> Optional[str]:
    """
    Lee X-DB del request.

    FastAPI normaliza headers, pero request.headers.get("x-db") funciona
    aunque el cliente mande "X-DB".
    """
    if request is None:
        return None

    try:
        raw = request.headers.get("x-db")
    except Exception:
        return None

    if not raw:
        return None

    return raw.strip().lower()


# ---------------------------------------------------------------------
# Engines y SessionLocal por base
# ---------------------------------------------------------------------

# Engine default:
# - Mantiene comportamiento antiguo.
# - Se usa si no llega X-DB o si algún código importa directamente engine.
DEFAULT_DATABASE_URL = settings.resolve_database_url()
engine = _make_engine(DEFAULT_DATABASE_URL, "default")
SessionLocal = _make_sessionmaker(engine)


# Engines específicos:
# - Se crean explícitamente para poder cambiar por request.
# - Si alguna URL específica no existe, no impedimos arrancar si no se usa.
_engines_by_key: Dict[str, Engine] = {}
_sessionmakers_by_key: Dict[str, sessionmaker] = {}


def _register_engine_for_key(db_key: DBKey) -> None:
    """
    Registra engine/sessionmaker para una base concreta.

    Si falla porque falta una URL específica, lo dejamos en log.
    Eso evita romper entornos donde solo exista una base.
    """
    key = normalize_db_key(db_key, fallback=settings.default_db_key)

    try:
        db_url = settings.resolve_database_url_for_key(key)
        db_engine = _make_engine(db_url, key)

        _engines_by_key[key] = db_engine
        _sessionmakers_by_key[key] = _make_sessionmaker(db_engine)
    except Exception as e:
        print(f"[DB] Aviso: no se pudo crear engine para {key}: {e}")


_register_engine_for_key("neon")
_register_engine_for_key("supabase")


def _select_sessionmaker(request: Optional[Request]) -> tuple[str, sessionmaker]:
    """
    Selecciona el sessionmaker correcto.

    Lógica:
    - X-DB=supabase -> SessionLocal supabase si existe.
    - X-DB=neon -> SessionLocal neon si existe.
    - Sin X-DB / inválido -> SessionLocal default.
    """
    raw_header = _get_header_db_key(request)

    if raw_header in ("neon", "supabase"):
        key = normalize_db_key(raw_header, fallback=settings.default_db_key)

        selected = _sessionmakers_by_key.get(key)
        if selected is not None:
            return key, selected

        print(f"[DB] X-DB={key} recibido, pero no hay engine registrado. Uso default.")
        return "default", SessionLocal

    if raw_header:
        print(f"[DB] X-DB inválido recibido: {raw_header}. Uso default.")

    return "default", SessionLocal


def get_db(request: Request):
    """
    Dependencia FastAPI:
    - lee X-DB si viene en headers
    - abre sesión contra la base seleccionada
    - fuerza search_path a public
    - cierra sesión al finalizar

    Ejemplos:
    - X-DB=supabase -> Supabase
    - X-DB=neon     -> Neon
    - sin X-DB      -> default antiguo
    """
    selected_key, selected_sessionmaker = _select_sessionmaker(request)

    db: Session = selected_sessionmaker()

    try:
        db.execute(text("SET search_path TO public;"))

        # Log de verificación. Si molesta en producción, se puede condicionar por ENV.
        try:
            path = request.url.path if request is not None else "unknown-path"
        except Exception:
            path = "unknown-path"

        print(f"[DB] request={path} selected_db={selected_key}")

        yield db
    finally:
        db.close()