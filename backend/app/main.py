# backend/app/main.py

"""
Punto de entrada principal del backend de GapptoMobile v3.

Aquí definimos:
- La instancia de FastAPI.
- La configuración básica de CORS.
- Endpoints de salud (/health y /api/health).
- El arranque de la aplicación (evento startup) y uso de la base de datos.

Más adelante:
- Iremos añadiendo los routers de negocio en backend/app/api/v1/*
  (gastos, ingresos, daybyday, balance, etc.) sin perder funcionalidades.
"""

from typing import Callable

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from sqlalchemy import text as sa_text
from sqlalchemy.exc import SQLAlchemyError

from backend.app.db.session import engine, get_db
from backend.app.db.base import Base
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# 1) Generador de operation_id únicos
# ---------------------------------------------------------------------------
def custom_generate_unique_id(route: APIRoute) -> str:
    """
    Genera un identificador único para cada operación de la API.

    ¿Para qué sirve esto?
    ---------------------
    - FastAPI genera por defecto operation_id a partir del nombre de la función.
    - Si tienes muchas rutas o reusas nombres, puede haber colisiones en la
      documentación OpenAPI/Swagger.
    - Con este generador, usamos un patrón estable y legible:
        <nombre_router>_<nombre_función>
      por ejemplo: "gastos_listar_gastos" o "ingresos_crear_ingreso".
    """
    # route.name es el nombre de la función de Python que maneja la ruta.
    # route.tags suele contener el "módulo" o categoría (por ejemplo ["gastos"]).
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
# 3) Configuración de CORS
# ---------------------------------------------------------------------------
# En desarrollo permitimos todo (*) para no tener problemas con el frontend.
# Más adelante podemos restringir a la URL real de la app móvil / web.
origins = [
    "*",  # ⚠️ Permite cualquier origen. En producción, mejor restringir.
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,        # Quién puede hacer peticiones
    allow_credentials=True,
    allow_methods=["*"],          # Qué métodos HTTP se permiten
    allow_headers=["*"],          # Qué cabeceras se permiten
)


# ---------------------------------------------------------------------------
# 4) Evento de arranque (startup)
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup() -> None:
    """
    Código que se ejecuta cuando arranca la aplicación.

    Aquí podemos:
    - Comprobar que la conexión a la base de datos funciona.
    - (Opcional) crear tablas si estamos en desarrollo.
      En producción, preferiremos manejar la estructura con Alembic.
    """
    # Opción 1 (recomendada): solo comprobar conexión.
    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
    except SQLAlchemyError as e:
        # En un entorno real, aquí usaríamos logging en lugar de print.
        print(f"[startup] Error al comprobar la BD: {e}")

    # Opción 2 (solo para desarrollo):
    # --------------------------------
    # Si quisieras crear todas las tablas definidas en Base.metadata
    # descomenta esta línea, pero OJO: en una BD ya en producción
    # lo normal es usar migraciones (Alembic), no create_all().
    #
    # Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------------------
# 5) Endpoints básicos
# ---------------------------------------------------------------------------
@app.get("/", tags=["core"])
def root() -> dict:
    """
    Endpoint raíz de la API.

    Útil como prueba rápida de que el servidor está respondiendo.
    """
    return {"message": "GapptoMobile v3 backend is running"}


@app.get("/health", tags=["core"])
def health_simple() -> dict:
    """
    Healthcheck simple.

    No comprueba la base de datos, solo responde "ok".
    Útil para un test muy rápido de que el servidor está levantado.
    """
    return {"status": "ok"}


@app.get("/api/health", tags=["core"])
def health_api(db: Session = Depends(get_db)) -> dict:
    """
    Healthcheck completo de la API.

    - Abre una sesión de base de datos con get_db.
    - Ejecuta un SELECT 1.
    - Devuelve información sobre si la conexión ha ido bien.

    Si hay algún problema de conexión con la BD, devuelve status = "error"
    y un mensaje con el detalle del error.
    """
    try:
        # Usamos la sesión "db" que nos inyecta FastAPI mediante Depends(get_db)
        db.execute(sa_text("SELECT 1"))
        return {"status": "ok", "db": "reachable"}
    except SQLAlchemyError as e:
        return {"status": "error", "db": "unreachable", "detail": str(e)}

@app.get("/__routes", tags=["debug"])
def list_routes():
    return sorted(
        [
            {"path": r.path, "name": r.name, "methods": sorted(list(getattr(r, "methods", []) or []))}
            for r in app.router.routes
        ],
        key=lambda x: x["path"],
    )


# ---------------------------------------------------------------------------
# 6) Routers de negocio (v1) - MAPEADOS POR MÓDULO
# ---------------------------------------------------------------------------
# Objetivo:
# - Evitar colisiones tipo /api/v1/pendientes (¿pendientes de qué?)
# - Alinear el backend con el contrato real del móvil:
#     /api/v1/gastos/...
#     /api/v1/ingresos/...
#     /api/v1/gastos-cotidianos/...
#     /api/v1/movimientos-cuenta/...
#     /api/v1/ubicaciones/...
#
# Regla:
# - Routers "de dominio" van namespaced: /api/v1/<modulo>
# - auth_router ya trae prefix="/auth" dentro del router -> solo se le aplica /api/v1
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
)

API_V1 = "/api/v1"

# auth_router ya tiene prefix interno "/auth"
app.include_router(auth_router.router, prefix=API_V1)

# Routers planos -> namespace aquí
app.include_router(gastos_router.router,            prefix=f"{API_V1}/gastos")
app.include_router(ingresos_router.router,          prefix=f"{API_V1}/ingresos")
app.include_router(gastos_cotidianos_router.router, prefix=f"{API_V1}/gastos-cotidianos")

# Routers que YA llevan /cuentas, /tipos, /ramas, etc. dentro -> solo /api/v1
app.include_router(cuentas_router.router,      prefix=API_V1)
app.include_router(proveedores_router.router,  prefix=API_V1)
app.include_router(tipos_router.router,        prefix=API_V1)
app.include_router(ramas_router.router,        prefix=API_V1)
app.include_router(patrimonio_router.router,   prefix=API_V1)
app.include_router(prestamos_router.router,    prefix=API_V1)
app.include_router(users_router.router,        prefix=API_V1)
