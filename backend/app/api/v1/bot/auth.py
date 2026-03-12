"""
Archivo: backend/app/api/v1/bot/auth.py
Versión: 1.0.0

Descripción:
Router específico de autenticación y contexto inicial del BOT de alquileres.

Funcionalidades incluidas:
- Endpoint de login conversacional por DNI + teléfono
- Delegación de lógica al servicio auth_service
- Respuesta preparada para selección posterior de contrato por el BOT

Notas de diseño:
- Este archivo separa claramente la capa HTTP de la lógica de negocio.
- BOT_SERVICE debe consumir este endpoint como entrada principal
  de autenticación conversacional.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.bot.auth import BotAuthLoginIn, BotAuthLoginOut
from backend.app.services.bot.auth_service import get_bot_auth_context

router = APIRouter(prefix="/auth", tags=["BOT Auth"])


@router.post(
    "/login",
    response_model=BotAuthLoginOut,
    summary="Autenticación inicial del BOT por DNI + teléfono",
)
def bot_login(
    payload: BotAuthLoginIn,
    db: Session = Depends(get_db),
):
    return get_bot_auth_context(
        db=db,
        dni=payload.dni,
        telefono=payload.telefono,
    )