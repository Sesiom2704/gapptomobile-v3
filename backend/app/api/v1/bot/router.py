"""
Archivo: backend/app/api/v1/bot/router.py
Versión: 1.0.0

Descripción:
Router principal del dominio BOT. Agrupa todos los endpoints específicos
del canal conversacional para mantenerlos separados de los routers de backoffice.

Funcionalidades incluidas:
- Registro de subrouters BOT
- Separación de autenticación/contexto inicial
- Separación de incidencias
- Base común para futuras fases del BOT

Notas de diseño:
- Este router será el punto de entrada estable para BOT_SERVICE.
- La ruta base recomendada es /api/v1/bot.
- Cada submódulo BOT debe vivir dentro de app/api/v1/bot/.
- No debe mezclarse aquí lógica de negocio; solo composición de routers.
"""

from fastapi import APIRouter

from backend.app.api.v1.bot.auth import router as bot_auth_router
from backend.app.api.v1.bot.incidencias import router as bot_incidencias_router

router = APIRouter(prefix="/bot", tags=["BOT"])

router.include_router(bot_auth_router)
router.include_router(bot_incidencias_router)