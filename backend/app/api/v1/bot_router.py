"""
Archivo: backend/app/api/v1/bot_router.py
Versión: 1.0.0

Descripción:
Router API v1 específico para el BOT de alquileres.

Funcionalidades incluidas:
- Autenticación conversacional por DNI + teléfono
- Normalización segura de DNI y teléfono
- Obtención de persona activa
- Obtención de contratos activos asociados
- Devolución de rol por contrato
- Devolución de vivienda asociada por contrato
- Respuesta preparada para selección posterior de contrato por el BOT

Decisiones de diseño:
- Se crea en archivo independiente para no mezclar la lógica conversacional
  con el router de backoffice de gestión de alquileres.
- No modifica funcionalidades existentes.
- No altera datos existentes en base de datos.
- Compara por valores normalizados, pero conserva el dato almacenado tal cual.
- Devuelve siempre un error genérico de seguridad:
    "credenciales no validas"
  para no revelar si falló el DNI, el teléfono o la existencia de contratos.

Reglas de validación:
- persona.inactivatedon IS NULL
- contratos_participantes.inactivatedon IS NULL
- contratos.estado = 'activo'
- contratos.inactivatedon IS NULL
- patrimonio del mismo user_id propietario
- roles válidos: inquilino | avalista | gestor
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.bot_auth import (
    BotAuthLoginIn,
    BotAuthLoginOut,
    BotAuthPersonaOut,
    BotAuthContratoOut,
    BotAuthViviendaOut,
)

router = APIRouter(
    prefix="/bot",
    tags=["bot"],
)

BOT_INVALID_CREDENTIALS_DETAIL = "credenciales no validas"
BOT_ALLOWED_ROLES = {"inquilino", "avalista", "gestor"}


# ==========================================================
# Helpers de normalización
# ==========================================================

def _normalize_dni_for_bot(value: Optional[str]) -> Optional[str]:
    """
    Normaliza DNI/NIF/NIE para comparación.

    Reglas:
    - trim de espacios laterales
    - eliminación de espacios internos
    - eliminación de guiones
    - mayúsculas

    Ejemplos:
    - '12345678z'    -> '12345678Z'
    - '12345678-z'   -> '12345678Z'
    - ' x1234567l '  -> 'X1234567L'
    """
    if not value:
        return None

    normalized = str(value).strip().upper()
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace("-", "")

    return normalized or None


def _normalize_phone_for_bot(value: Optional[str]) -> Optional[str]:
    """
    Normaliza teléfonos españoles para comparación segura.

    Reglas acordadas:
    - elimina espacios, guiones, paréntesis y puntos
    - si llega con 9 dígitos -> se transforma a +34XXXXXXXXX
    - si llega con 34 + 9 dígitos -> se transforma a +34XXXXXXXXX
    - si llega con +34 + 9 dígitos -> se conserva como +34XXXXXXXXX

    Ejemplos:
    - '666555444'        -> '+34666555444'
    - '34666555444'      -> '+34666555444'
    - '+34666555444'     -> '+34666555444'
    - '666 55 54 44'     -> '+34666555444'

    Nota:
    - De momento el sistema solo normaliza para comparar.
    - No modifica los datos almacenados en base.
    """
    if not value:
        return None

    phone = str(value).strip()

    # Conservamos el '+' solo si está al inicio. El resto de caracteres
    # no numéricos se eliminan.
    has_plus_prefix = phone.startswith("+")
    digits_only = re.sub(r"\D", "", phone)

    if not digits_only:
        return None

    # Caso 1: número nacional español de 9 dígitos
    if len(digits_only) == 9:
        return f"+34{digits_only}"

    # Caso 2: formato con prefijo país sin '+'
    if len(digits_only) == 11 and digits_only.startswith("34"):
        return f"+{digits_only}"

    # Caso 3: si ya venía con + y tras limpiar queda correcto
    if has_plus_prefix and len(digits_only) == 11 and digits_only.startswith("34"):
        return f"+{digits_only}"

    # Caso fallback:
    # se devuelve con '+' si originalmente lo traía, o el valor de dígitos tal cual
    # para no introducir errores silenciosos con otros formatos futuros.
    if has_plus_prefix:
        return f"+{digits_only}"

    return digits_only


def _raise_invalid_credentials() -> None:
    """
    Lanza siempre el mismo error de seguridad para evitar filtrado de
    información sensible sobre la existencia de personas o contratos.
    """
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=BOT_INVALID_CREDENTIALS_DETAIL,
    )


# ==========================================================
# Helper de autenticación BOT
# ==========================================================

def _get_bot_auth_context(
    db: Session,
    dni: str,
    telefono: str,
) -> BotAuthLoginOut:
    """
    Resuelve la autenticación del BOT y devuelve el contexto inicial
    de la persona autenticada.

    Flujo:
    1. Normaliza DNI y teléfono de entrada.
    2. Recorre personas activas con DNI informado.
    3. Compara DNI y teléfono ya normalizados.
    4. Si encuentra persona válida, busca sus contratos activos y roles vigentes.
    5. Devuelve persona + contratos + vivienda.
    6. Si no hay coincidencia válida, devuelve error genérico.

    Nota importante:
    - En el modelo actual no existe un endpoint BOT autenticado por user backoffice.
    - Por ello esta búsqueda se apoya en la coherencia relacional:
      persona -> contratos_participantes -> contrato -> patrimonio
    - Solo se aceptan relaciones activas y contratos en estado 'activo'.
    """
    normalized_dni = _normalize_dni_for_bot(dni)
    normalized_phone = _normalize_phone_for_bot(telefono)

    if not normalized_dni or not normalized_phone:
        _raise_invalid_credentials()

    # Candidatos razonables:
    # - persona activa
    # - con dni no nulo
    # - con teléfono no nulo
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
        persona_dni_normalized = _normalize_dni_for_bot(persona.dni)
        persona_phone_normalized = _normalize_phone_for_bot(persona.telefono)

        if (
            persona_dni_normalized == normalized_dni
            and persona_phone_normalized == normalized_phone
        ):
            matched_persona = persona
            break

    if matched_persona is None:
        _raise_invalid_credentials()

    # Buscamos contratos activos, participantes activos y patrimonio asociado
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

            models.Persona.inactivatedon.is_(None),
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

        # Blindaje adicional por si en el futuro aparecen más roles
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
                vivienda=BotAuthViviendaOut(
                    patrimonio_id=patrimonio.id,
                    referencia=patrimonio.referencia,
                    direccion_completa=patrimonio.direccion_completa,
                    localidad=patrimonio.localidad,
                ),
            )
        )

    # Aunque la persona exista, si no tiene contratos válidos para el BOT,
    # la respuesta debe ser la misma por seguridad.
    if not contratos_out:
        _raise_invalid_credentials()

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


# ==========================================================
# Endpoints BOT
# ==========================================================

@router.post(
    "/auth/login",
    response_model=BotAuthLoginOut,
    summary="Autenticación inicial del BOT por DNI + teléfono",
)
def bot_login(
    payload: BotAuthLoginIn,
    db: Session = Depends(get_db),
):
    """
    Endpoint de entrada para autenticación conversacional del BOT.

    Uso esperado:
    - El BOT recoge DNI y teléfono del usuario.
    - Llama a este endpoint.
    - Si la autenticación es válida, obtiene:
        - persona
        - contratos activos
        - rol por contrato
        - vivienda asociada
    - Si hay varios contratos, el BOT debe pedir selección.

    Seguridad:
    - Ante cualquier fallo, devuelve:
        'credenciales no validas'
    """
    return _get_bot_auth_context(
        db=db,
        dni=payload.dni,
        telefono=payload.telefono,
    )