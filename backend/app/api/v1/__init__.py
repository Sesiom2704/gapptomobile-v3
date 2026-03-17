"""
Ruta: backend/app/api/v1/__init__.py
Versión: 1.1.0
Descripción:
Inicializador del paquete api.v1.

Funcionalidades incluidas:
- Expone de forma centralizada los routers v1 usados por main.py.
- Mantiene una lista explícita en __all__ para imports limpios.
- Añade soporte al nuevo router de gestión de incidencias GAPPTO.

Notas de diseño:
- Este fichero debe mantenerse alineado con los imports agregados en backend/app/main.py.
- Si se registra un router nuevo en main.py y no se importa aquí, el arranque fallará.
"""

from . import (
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
    gestion_incidencias_router,
)

__all__ = [
    "auth_router",
    "gastos_router",
    "ingresos_router",
    "gastos_cotidianos_router",
    "cuentas_router",
    "proveedores_router",
    "tipos_router",
    "ramas_router",
    "patrimonio_router",
    "prestamos_router",
    "users_router",
    "debug_router",
    "day_to_day_analysis_router",
    "balance_router",
    "extraordinarios_router",
    "monthly_summary_router",
    "movimientos_cuenta_router",
    "ramas_gasto_router",
    "tipos_gasto_router",
    "ubicaciones_router",
    "analytics_router",
    "cierre_mensual_router",
    "db_router",
    "reinicio_router",
    "inversiones_router",
    "endeudamiento_router",
    "gestion_alquiler_router",
    "subsegmentos_proveedores_router",
    "gestion_incidencias_router",
]