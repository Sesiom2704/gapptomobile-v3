"""
Ruta: backend/app/core/config.py
Versión: 1.1.0
Descripción:
Configuración central del backend de GAPPTO Mobile.

Funcionalidades incluidas:
- Lectura de variables de entorno mediante Pydantic Settings.
- Resolución de URL principal de base de datos.
- Soporte para DATABASE_URL legacy/principal.
- Soporte para DB_URL_NEON y DB_URL_SUPABASE.
- Normalización de URLs PostgreSQL para SQLAlchemy + psycopg3.
- Garantía de sslmode=require.
- Garantía de search_path=public.
- Soporte de FORCE_DB para forzar una base concreta.
- Soporte de DB_DEFAULT como fallback.
- Nueva resolución explícita por clave: "neon" o "supabase".

Ajustes de esta versión:
- Se añade resolve_database_url_for_key(db_key).
- Se mantiene resolve_database_url() para compatibilidad con código existente.
- Se añade normalize_db_key() para validar "neon" / "supabase".
- Se mantiene el comportamiento anterior cuando no llega selector de base.
- Se prepara el backend para que get_db pueda elegir conexión según X-DB.

Reglas funcionales:
- FORCE_DB tiene prioridad cuando se usa resolve_database_url().
- Si no hay header X-DB, se mantiene la lógica antigua.
- Si X-DB=supabase, se usa DB_URL_SUPABASE si está configurada.
- Si X-DB=neon, se usa DB_URL_NEON si está configurada.
- Si una URL específica no existe, se usa fallback seguro o error explícito.

Notas de diseño:
- No se guardan credenciales en código.
- Las URLs vienen de .env o variables de entorno de Render.
- GAPPTO Mobile 2.0 no debería romperse porque si no envía X-DB seguirá usando la base por defecto.
"""

from __future__ import annotations

import re
from typing import List, Optional

from pydantic_settings import BaseSettings


DBKey = str


def _strip_wrapping_quotes(value: str) -> str:
    """
    Elimina comillas envolventes si el usuario las puso en el .env o en Render.

    Ejemplo:
    - '"abc"' -> 'abc'
    - "'abc'" -> 'abc'
    """
    v = (value or "").strip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        return v[1:-1].strip()
    return v


def _ensure_psycopg_driver(url: str) -> str:
    """
    Fuerza a usar psycopg3 en SQLAlchemy:
    - postgresql://...          -> postgresql+psycopg://...
    - postgresql+psycopg2://... -> postgresql+psycopg://...
    """
    u = url.strip()
    u = re.sub(r"^postgresql\+psycopg2://", "postgresql+psycopg://", u)
    u = re.sub(r"^postgresql://", "postgresql+psycopg://", u)
    return u


def _append_query_param(url: str, key: str, value: str) -> str:
    """
    Añade un query param si no existe ya.
    """
    if re.search(rf"(^|[?&]){re.escape(key)}=", url):
        return url

    sep = "&" if "?" in url else "?"
    return f"{url}{sep}{key}={value}"


def _ensure_sslmode_require(url: str) -> str:
    """
    Garantiza sslmode=require si no viene en la URL.
    """
    return _append_query_param(url, "sslmode", "require")


def _ensure_search_path_public(url: str) -> str:
    """
    Garantiza options=-c search_path=public si no viene ya.

    Importante:
    - Si la URL ya trae options, no la tocamos.
    - En session.py además se ejecuta SET search_path TO public por seguridad.
    """
    if "options=" in url:
        return url

    # URL-encoded: "-c search_path=public" -> "-c%20search_path%3Dpublic"
    return _append_query_param(url, "options", "-c%20search_path%3Dpublic")


def _normalize_database_url(url: str) -> str:
    """
    Aplica todas las normalizaciones necesarias a una URL de Postgres.
    """
    chosen = _strip_wrapping_quotes(url or "")

    if not chosen:
        return ""

    chosen = _ensure_psycopg_driver(chosen)
    chosen = _ensure_sslmode_require(chosen)
    chosen = _ensure_search_path_public(chosen)

    return chosen


def _csv_to_list(value: str) -> List[str]:
    """
    Convierte 'a,b,c' -> ['a','b','c'] ignorando vacíos.
    """
    v = (value or "").strip()
    if not v:
        return []

    return [x.strip() for x in v.split(",") if x.strip()]


def normalize_db_key(value: Optional[str], fallback: str = "neon") -> str:
    """
    Normaliza una clave de base.

    Valores válidos:
    - neon
    - supabase

    Si viene vacío o inválido, devuelve fallback.
    """
    raw = (value or "").strip().lower()

    if raw in ("neon", "supabase"):
        return raw

    fb = (fallback or "").strip().lower()
    if fb in ("neon", "supabase"):
        return fb

    return "neon"


class Settings(BaseSettings):
    """
    Ajustes de la aplicación.

    Nota:
    - BaseSettings lee variables de entorno y valida tipos.
    - En Render, todo viene como string; Pydantic convierte a int/bool/etc.
    """

    # ---- entorno general
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"

    # ---- seguridad / JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # ---- CORS
    # Se puede definir como CSV en env: "http://a,http://b"
    CORS_ORIGINS: str = ""

    # ---- base de datos
    DB_DEFAULT: str = "neon"
    FORCE_DB: str = ""
    DB_USE_NULLPOOL: bool = False

    # Fuente principal de BD / compatibilidad legacy
    DATABASE_URL: Optional[str] = None

    # Alternativas multi-BD
    DB_URL_NEON: Optional[str] = None
    DB_URL_SUPABASE: Optional[str] = None

    # ---- Admin / features
    ADMIN_EMAILS: str = ""
    ENABLE_DEBUG_ENDPOINTS: bool = False
    RUN_MIGRATIONS_ON_STARTUP: bool = False
    BOOTSTRAP_CREATE_ALL: bool = False

    # ---- Google Sheets
    GOOGLE_SHEETS_ID: str = ""
    GOOGLE_CREDENTIALS_JSON: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def cors_origins_list(self) -> List[str]:
        return _csv_to_list(self.CORS_ORIGINS)

    @property
    def admin_emails_list(self) -> List[str]:
        return _csv_to_list(self.ADMIN_EMAILS)

    @property
    def default_db_key(self) -> str:
        """
        Devuelve DB_DEFAULT validado.
        """
        return normalize_db_key(self.DB_DEFAULT, fallback="neon")

    def resolve_database_url(self) -> str:
        """
        Decide qué URL de BD usar para compatibilidad con el comportamiento anterior.

        Orden:
        1) Si FORCE_DB está definido:
           - supabase -> DB_URL_SUPABASE
           - neon     -> DB_URL_NEON o DATABASE_URL
        2) Si DATABASE_URL existe -> usarla
        3) Si DB_DEFAULT=neon -> DB_URL_NEON
           Si DB_DEFAULT=supabase -> DB_URL_SUPABASE
        4) Si no hay nada -> error explícito

        Esta función se mantiene para:
        - engine default
        - startup
        - código antiguo que no usa X-DB
        """
        force = (self.FORCE_DB or "").strip().lower()

        database_url = _strip_wrapping_quotes(self.DATABASE_URL or "")
        neon_url = _strip_wrapping_quotes(self.DB_URL_NEON or "")
        supa_url = _strip_wrapping_quotes(self.DB_URL_SUPABASE or "")

        if force in ("supabase", "1", "true", "yes"):
            if not supa_url:
                raise RuntimeError("FORCE_DB=supabase pero DB_URL_SUPABASE está vacío.")
            chosen = supa_url

        elif force in ("neon",):
            chosen = neon_url or database_url
            if not chosen:
                raise RuntimeError("FORCE_DB=neon pero no hay DB_URL_NEON ni DATABASE_URL.")

        else:
            # Sin forzar: se mantiene el comportamiento anterior.
            # DATABASE_URL gana porque suele ser la variable principal en Render.
            if database_url:
                chosen = database_url
            else:
                if self.default_db_key == "supabase":
                    chosen = supa_url
                else:
                    chosen = neon_url

        if not chosen:
            raise RuntimeError(
                "No hay URL de base de datos. Define DATABASE_URL o DB_URL_NEON/DB_URL_SUPABASE."
            )

        return _normalize_database_url(chosen)

    def resolve_database_url_for_key(self, db_key: Optional[str]) -> str:
        """
        Devuelve la URL concreta para una base solicitada por request.

        Se usa desde get_db() cuando llega el header:
        - X-DB=neon
        - X-DB=supabase

        Importante:
        - Esta función NO usa FORCE_DB como prioridad absoluta porque el objetivo
          es poder cambiar por request.
        - Si quieres bloquear todo a una sola BD en producción, entonces sí debes
          configurar FORCE_DB y no usar selector dinámico.
        """
        key = normalize_db_key(db_key, fallback=self.default_db_key)

        database_url = _strip_wrapping_quotes(self.DATABASE_URL or "")
        neon_url = _strip_wrapping_quotes(self.DB_URL_NEON or "")
        supa_url = _strip_wrapping_quotes(self.DB_URL_SUPABASE or "")

        if key == "supabase":
            chosen = supa_url

            if not chosen:
                raise RuntimeError("X-DB=supabase pero DB_URL_SUPABASE está vacío.")

            return _normalize_database_url(chosen)

        # key == "neon"
        chosen = neon_url or database_url

        if not chosen:
            raise RuntimeError("X-DB=neon pero no hay DB_URL_NEON ni DATABASE_URL.")

        return _normalize_database_url(chosen)


# Instancia global
settings = Settings()