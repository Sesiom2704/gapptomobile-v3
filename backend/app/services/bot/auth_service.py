"""
Archivo: backend/app/services/bot/auth_service.py
Versión: 1.0.0

Descripción:
Servicio de autenticación conversacional del BOT de alquileres.

Funcionalidades incluidas:
- Normalización segura de DNI y teléfono
- Búsqueda de persona activa
- Obtención de contratos activos y roles válidos
- Construcción del contexto inicial del BOT

Notas de diseño:
- Este servicio encapsula la lógica de autenticación BOT para no cargar
  el router con lógica de negocio.
- Devuelve un error genérico de seguridad cuando las credenciales no
  pueden validarse.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db import models
from backend.app.schemas.bot.auth import (
    BotAuthContratoOut,
    BotAuthLoginOut,
    BotAuthPersonaOut,
    BotAuthViviendaOut,
)

BOT_INVALID_CREDENTIALS_DETAIL = "credenciales no validas"
BOT_ALLOWED_ROLES = {"inquilino", "avalista", "gestor"}


def normalize_dni_for_bot(value: Optional[str]) -> Optional[str]:
    if not value:
        return None

    normalized = str(value).strip().upper()
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace("-", "")
    return normalized or None


def normalize_phone_for_bot(value: Optional[str]) -> Optional[str]:
    if not value:
        return None

    phone = str(value).strip()
    has_plus_prefix = phone.startswith("+")
    digits_only = re.sub(r"\D", "", phone)

    if not digits_only:
        return None

    if len(digits_only) == 9:
        return f"+34{digits_only}"

    if len(digits_only) == 11 and digits_only.startswith("34"):
        return f"+{digits_only}"

    if has_plus_prefix and len(digits_only) == 11 and digits_only.startswith("34"):
        return f"+{digits_only}"

    if has_plus_prefix:
        return f"+{digits_only}"

    return digits_only


def raise_invalid_credentials() -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=BOT_INVALID_CREDENTIALS_DETAIL,
    )


def get_bot_auth_context(
    db: Session,
    dni: str,
    telefono: str,
) -> BotAuthLoginOut:
    normalized_dni = normalize_dni_for_bot(dni)
    normalized_phone = normalize_phone_for_bot(telefono)

    if not normalized_dni or not normalized_phone:
        raise_invalid_credentials()

    candidate_personas = (
        db.query(models.Persona)
        .filter(
            models.Persona.inactivatedon.is_(None),
            models.Persona.dni.is_not(None),
            models.Persona.telefono.is_not(None),
        )
        .all()
    )

    matched_persona = None

    for persona in candidate_personas:
        persona_dni_normalized = normalize_dni_for_bot(persona.dni)
        persona_phone_normalized = normalize_phone_for_bot(persona.telefono)

        if (
            persona_dni_normalized == normalized_dni
            and persona_phone_normalized == normalized_phone
        ):
            matched_persona = persona
            break

    if matched_persona is None:
        raise_invalid_credentials()

    rows = (
        db.query(models.ContratoParticipante, models.Contrato, models.Patrimonio)
        .join(
            models.Contrato,
            models.Contrato.id == models.ContratoParticipante.contrato_id,
        )
        .join(
            models.Patrimonio,
            models.Patrimonio.id == models.Contrato.patrimonio_id,
        )
        .filter(
            models.ContratoParticipante.persona_id == matched_persona.id,
            models.ContratoParticipante.inactivatedon.is_(None),
            models.Contrato.estado == "activo",
            models.Contrato.inactivatedon.is_(None),
            models.Patrimonio.user_id == models.Contrato.user_id,
        )
        .order_by(
            models.Contrato.fecha_inicio.desc(),
            models.Contrato.createon.desc(),
        )
        .all()
    )

    contratos_out: list[BotAuthContratoOut] = []

    for participante, contrato, patrimonio in rows:
        rol = (participante.rol or "").strip().lower()

        if rol not in BOT_ALLOWED_ROLES:
            continue

        contratos_out.append(
            BotAuthContratoOut(
                contrato_id=contrato.id,
                rol=rol,
                es_principal=bool(participante.es_principal),
                estado=contrato.estado,
                fecha_inicio=contrato.fecha_inicio,
                fecha_fin=contrato.fecha_fin,
                objeto_alquiler=contrato.objeto_alquiler,
                vivienda=BotAuthViviendaOut(
                    patrimonio_id=patrimonio.id,
                    referencia=patrimonio.referencia,
                    direccion_completa=patrimonio.direccion_completa,
                    localidad=patrimonio.localidad,
                ),
            )
        )

    if not contratos_out:
        raise_invalid_credentials()

    return BotAuthLoginOut(
        persona=BotAuthPersonaOut(
            id=matched_persona.id,
            nombre_completo=matched_persona.nombre_completo,
            dni=matched_persona.dni,
            telefono=matched_persona.telefono,
            email=matched_persona.email,
        ),
        contratos=contratos_out,
        requiere_seleccion_contrato=len(contratos_out) > 1,
    )