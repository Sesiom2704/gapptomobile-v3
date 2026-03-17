"""
Archivo: backend/app/main.py
Versión: 1.3.0

Descripción:
Punto de entrada principal del backend de GapptoMobile v3.

Funcionalidades incluidas:
- Creación de la instancia FastAPI
- Configuración CORS
- Endpoints base: /, /health, /api/health, /ready
- Endpoint debug: /__routes
- Middleware debug de Authorization en gastos-cotidianos
- Registro de routers de negocio api/v1
- Registro del nuevo router principal del dominio BOT
- Registro del nuevo router GAPPTO de gestión de incidencias
- Registro del router técnico de gestión de BD

Cambios de esta versión:
- Se registra el nuevo router `gestion_incidencias_router`.
- Se mantiene intacta la estructura previa del bootstrap.
- No se altera el router BOT existente.
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# 0) Carga de variables de entorno (backend/.env) ANTES de importar engine
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None  # fallback (si no tienes python-dotenv)

if load_dotenv:
    BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
    if BACKEND_ENV.is_file():
        load_dotenv(BACKEND_ENV)
        print(f"[startup] Loaded env: {BACKEND_ENV}")
    else:
        load_dotenv()

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from sqlalchemy import text as sa_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.db.session import engine, get_db
from backend.app.google_creds_bootstrap import ensure_gcp_creds_file


# ---------------------------------------------------------------------------
# 1) Generador de operation_id únicos
# ---------------------------------------------------------------------------
def custom_generate_unique_id(route: APIRoute) -> str:
    """
    Genera un operation_id estable y único para OpenAPI.

    - Evita colisiones si reusas nombres de funciones.
    - Patrón: <tag>_<route.name>
    """
    tag_prefix = route.tags[0] if route.tags else "default"
    return f"{tag_prefix}_{route.name}"


# ---------------------------------------------------------------------------
# 2) Crear la app FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(
    title="GapptoMobile v3 API",
    version="0.1.0",
    description="Backend v3 de GapptoMobile (estructura limpia, misma BD).",
    generate_unique_id_function=custom_generate_unique_id,
)


# ---------------------------------------------------------------------------
# 3) CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, restringir
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 4) Evento startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup() -> None:
    """
    Arranque del backend.

    - Prepara credenciales de Google Sheets (si están configuradas).
    - Comprueba conectividad con la BD principal (engine).
    """
    import os

    print("[startup] DB_URL_NEON set?      ", bool(os.getenv("DB_URL_NEON")))
    print("[startup] DB_URL_SUPABASE set?  ", bool(os.getenv("DB_URL_SUPABASE")))
    print("[startup] GOOGLE_SHEETS_ID set? ", bool(os.getenv("GOOGLE_SHEETS_ID")))
    print("[startup] GOOGLE_APPLICATION_CREDENTIALS =", os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))

    try:
        creds_path = ensure_gcp_creds_file()
        if creds_path:
            print(f"[startup] Google creds listo: {creds_path}")
        else:
            print("[startup] Google creds no configurado (OK si no usas Sheets).")
    except Exception as e:
        print(f"[startup] Error preparando Google creds (no bloqueante): {e}")

    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
    except SQLAlchemyError as e:
        print(f"[startup] Error al comprobar la BD: {e}")


# ---------------------------------------------------------------------------
# 5) Endpoints básicos
# ---------------------------------------------------------------------------
@app.get("/", tags=["core"])
def root() -> dict:
    """Endpoint raíz de la API."""
    return {"message": "GapptoMobile v3 backend is running"}


@app.get("/health", tags=["core"])
def health_simple() -> dict:
    """
    Healthcheck simple:
    - servidor vivo (sin tocar BD).
    """
    return {"status": "ok"}


@app.get("/api/health", tags=["core"])
def health_api(db: Session = Depends(get_db)) -> dict:
    """
    Healthcheck completo:
    - SELECT 1 a BD.
    - Mantener por compatibilidad.
    """
    try:
        db.execute(sa_text("SELECT 1"))
        return {"status": "ok", "db": "reachable"}
    except SQLAlchemyError as e:
        return {"status": "error", "db": "unreachable", "detail": str(e)}


@app.get("/ready", tags=["core"])
def ready(db: Session = Depends(get_db)) -> dict:
    """
    Readiness check (recomendado para app móvil):
    - servidor vivo + BD accesible
    """
    try:
        db.execute(sa_text("SELECT 1"))
        return {"status": "ok", "db": "reachable"}
    except SQLAlchemyError as e:
        return {"status": "error", "db": "unreachable", "detail": str(e)}


@app.get("/__routes", tags=["debug"])
def list_routes():
    """Listado de rutas (útil para depurar prefijos)."""
    return sorted(
        [
            {"path": r.path, "name": r.name, "methods": sorted(list(getattr(r, "methods", []) or []))}
            for r in app.router.routes
        ],
        key=lambda x: x["path"],
    )


# ---------------------------------------------------------------------------
# 5.b) Middleware debug (solo para una ruta concreta)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def log_auth_header(request: Request, call_next):
    """
    Debug puntual: inspecciona Authorization en gastos-cotidianos.
    Mantengo tu comportamiento actual para no perder utilidad.
    """
    if request.url.path.startswith("/api/v1/gastos-cotidianos"):
        auth = request.headers.get("authorization")
        print(f"[DEBUG] {request.method} {request.url.path} authorization={auth!r}")
    return await call_next(request)


# ---------------------------------------------------------------------------
# 6) Routers de negocio (v1)
# ---------------------------------------------------------------------------
from backend.app.api.v1 import (
    auth_router,
    gastos_router,
    ingresos_router,
    gastos_cotidianos_router,
    cuentas_router,
    proveedores_router,
    tipos_router,
    ramas_router,
    patrimonio_router,
    prestamos_router,
    users_router,
    debug_router,
    day_to_day_analysis_router,
    balance_router,
    extraordinarios_router,
    monthly_summary_router,
    movimientos_cuenta_router,
    ramas_gasto_router,
    tipos_gasto_router,
    ubicaciones_router,
    analytics_router,
    cierre_mensual_router,
    db_router,
    reinicio_router,
    inversiones_router,
    endeudamiento_router,
    gestion_alquiler_router,
    subsegmentos_proveedores_router,
    gestion_incidencias_router,  # NUEVO
)

# Router principal BOT en nueva ubicación
from backend.app.api.v1.bot.router import router as bot_router

API_V1 = "/api/v1"

app.include_router(auth_router.router, prefix=API_V1)

app.include_router(gastos_router.router, prefix=f"{API_V1}/gastos")
app.include_router(ingresos_router.router, prefix=f"{API_V1}/ingresos")
app.include_router(gastos_cotidianos_router.router, prefix=f"{API_V1}/gastos-cotidianos")

app.include_router(cuentas_router.router, prefix=API_V1)
app.include_router(proveedores_router.router, prefix=API_V1)
app.include_router(tipos_router.router, prefix=API_V1)
app.include_router(ramas_router.router, prefix=API_V1)
app.include_router(subsegmentos_proveedores_router.router, prefix=API_V1)
app.include_router(patrimonio_router.router, prefix=API_V1)
app.include_router(prestamos_router.router, prefix=API_V1)
app.include_router(users_router.router, prefix=API_V1)
app.include_router(day_to_day_analysis_router.router, prefix=API_V1)
app.include_router(balance_router.router, prefix=API_V1)
app.include_router(extraordinarios_router.router, prefix=API_V1)
app.include_router(monthly_summary_router.router, prefix=API_V1)
app.include_router(movimientos_cuenta_router.router, prefix=API_V1)
app.include_router(ramas_gasto_router.router, prefix=API_V1)
app.include_router(tipos_gasto_router.router, prefix=API_V1)
app.include_router(ubicaciones_router.router, prefix=API_V1)
app.include_router(analytics_router.router, prefix=API_V1)
app.include_router(cierre_mensual_router.router, prefix=API_V1)
app.include_router(reinicio_router.router, prefix=API_V1)
app.include_router(inversiones_router.router, prefix=API_V1)
app.include_router(endeudamiento_router.router, prefix=API_V1)
app.include_router(gestion_alquiler_router.router, prefix=API_V1)

# NUEVO: GAPPTO incidencias bajo /api/v1/gestion-incidencias/*
app.include_router(gestion_incidencias_router.router, prefix=API_V1)

# BOT: base estable /api/v1/bot/*
app.include_router(bot_router, prefix=API_V1)

# Router técnico BD: /api/db/*
app.include_router(db_router.router, prefix="/api")

# Debug router legado
app.include_router(debug_router.router)