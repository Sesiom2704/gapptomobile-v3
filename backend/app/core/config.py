# backend/app/core/config.py
"""
Configuración central del backend (V3).

Objetivos del diseño:
1) Evitar credenciales "hardcodeadas" en código.
2) Tener UNA fuente de verdad para la BD en runtime:
   - DATABASE_URL (principal)
   - DB_URL_NEON / DB_URL_SUPABASE (alternativas / fallback)
3) Normalizar la URL de Postgres:
   - driver psycopg (no psycopg2)
   - sslmode=require
   - search_path=public
4) Preparar flags típicos de staging/producción sin duplicar lógica.

NOTA práctica (Render):
- En Render, no pongas valores entre comillas. Ej: DATABASE_URL=postgresql+...
  Si pones DATABASE_URL="postgresql+..." las comillas forman parte del valor.
"""

from __future__ import annotations

import os
import re
from typing import List, Optional

from pydantic_settings import BaseSettings


def _strip_wrapping_quotes(value: str) -> str:
    """
    Elimina comillas envolventes si el usuario las puso en el .env o en Render.
    Ej: '"abc"' -> 'abc'
    """
    v = (value or "").strip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        return v[1:-1].strip()
    return v


def _ensure_psycopg_driver(url: str) -> str:
    """
    Fuerza a usar psycopg3 en SQLAlchemy:
    - postgresql://...                -> postgresql+psycopg://...
    - postgresql+psycopg2://...       -> postgresql+psycopg://...
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
    - En V2 usabas 'options=-c search_path=public' para asegurar esquemas.
    - En V3 conviene mantenerlo para evitar sorpresas con search_path.
    """
    if "options=" in url:
        return url
    # URL-encoded: "-c search_path=public" -> "-c%20search_path%3Dpublic"
    return _append_query_param(url, "options", "-c%20search_path%3Dpublic")


def _csv_to_list(value: str) -> List[str]:
    """
    Convierte 'a,b,c' -> ['a','b','c'] ignorando vacíos.
    """
    v = (value or "").strip()
    if not v:
        return []
    return [x.strip() for x in v.split(",") if x.strip()]


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

    # ---- CORS (en staging puede ser '*' si quieres, pero mejor controlado)
    # Se puede definir como CSV en env: "http://a,http://b"
    CORS_ORIGINS: str = ""

    # ---- base de datos: una "default" y posibilidad de forzar
    DB_DEFAULT: str = "neon"      # tu preferencia
    FORCE_DB: str = ""           # "", "neon" o "supabase"
    DB_USE_NULLPOOL: bool = False

    # Fuente principal de BD
    DATABASE_URL: Optional[str] = None

    # Alternativas (compatibilidad con V2 / multi-DB)
    DB_URL_NEON: Optional[str] = None
    DB_URL_SUPABASE: Optional[str] = None

    # ---- Admin / features
    ADMIN_EMAILS: str = ""
    ENABLE_DEBUG_ENDPOINTS: bool = False
    RUN_MIGRATIONS_ON_STARTUP: bool = False
    BOOTSTRAP_CREATE_ALL: bool = False

    # ---- Google Sheets
    GOOGLE_SHEETS_ID: str = ""
    # Debe ser el JSON COMPLETO, no una ruta. En Render pegar el JSON entero.
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

    def resolve_database_url(self) -> str:
        """
        Decide qué URL de BD usar.

        Orden (lógico y predecible):
        1) Si FORCE_DB está definido:
           - supabase -> DB_URL_SUPABASE
           - neon     -> DB_URL_NEON (o DATABASE_URL si apunta a neon)
        2) Si DATABASE_URL existe -> usarla
        3) Si DB_DEFAULT=neon -> DB_URL_NEON
           Si DB_DEFAULT=supabase -> DB_URL_SUPABASE
        4) Si no hay nada -> error explícito
        """
        force = (self.FORCE_DB or "").strip().lower()

        # Normaliza entradas (por si vienen con comillas)
        database_url = _strip_wrapping_quotes(self.DATABASE_URL or "")
        neon_url = _strip_wrapping_quotes(self.DB_URL_NEON or "")
        supa_url = _strip_wrapping_quotes(self.DB_URL_SUPABASE or "")

        if force in ("supabase", "1", "true", "yes"):
            if not supa_url:
                raise RuntimeError("FORCE_DB=supabase pero DB_URL_SUPABASE está vacío.")
            chosen = supa_url
        elif force in ("neon",):
            # Si hay DB_URL_NEON úsala; si no, cae a DATABASE_URL
            chosen = neon_url or database_url
            if not chosen:
                raise RuntimeError("FORCE_DB=neon pero no hay DB_URL_NEON ni DATABASE_URL.")
        else:
            # Sin forzar: DATABASE_URL gana (es el estándar)
            if database_url:
                chosen = database_url
            else:
                # fallback según DB_DEFAULT
                if (self.DB_DEFAULT or "").strip().lower() == "supabase":
                    chosen = supa_url
                else:
                    chosen = neon_url

        if not chosen:
            raise RuntimeError(
                "No hay URL de base de datos. Define DATABASE_URL (recomendado) o DB_URL_NEON/DB_URL_SUPABASE."
            )

        # Normalizaciones: driver, sslmode, search_path
        chosen = _ensure_psycopg_driver(chosen)
        chosen = _ensure_sslmode_require(chosen)
        chosen = _ensure_search_path_public(chosen)

        return chosen


# Instancia global
settings = Settings()
