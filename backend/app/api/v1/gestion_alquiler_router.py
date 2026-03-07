"""
API v1 - GESTIÓN DE ALQUILERES

Incluye:
- Personas
- Contratos
- Participantes de contrato
- Resumen activo por patrimonio (para detalle de propiedad en mobile)

Reglas generales:
- Todas las entidades están ligadas a user_id.
- Cada usuario solo puede ver y modificar sus propios registros.
- La lógica de validación funcional mínima se resuelve aquí.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.gestion_alquiler import (
    PersonaSchema,
    PersonaCreate,
    PersonaUpdate,
    PersonaPickerOut,
    ContratoSchema,
    ContratoCreate,
    ContratoUpdate,
    ContratoResumenActivoOut,
    ContratoParticipanteCreate,
    ContratoParticipanteUpdate,
    ContratoParticipanteSchema,
    ParticipantesResumenOut,
)
from backend.app.utils.text_utils import normalize_upper_ascii
from backend.app.api.v1.auth_router import require_user

router = APIRouter(
    prefix="/gestion-alquiler",
    tags=["gestion-alquiler"],
)


# ==========================================================
# Helpers
# ==========================================================

def _normalize_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    v = str(value).strip()
    for ch in [" ", "-", "(", ")", "."]:
        v = v.replace(ch, "")
    return v or None


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return str(value).strip().lower() or None


def _get_owned_patrimonio(db: Session, patrimonio_id: str, user_id: int) -> models.Patrimonio:
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    return row


def _get_owned_persona(db: Session, persona_id: str, user_id: int) -> models.Persona:
    row = db.get(models.Persona, persona_id)
    if not row or row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Persona no encontrada",
        )
    return row


def _get_owned_contrato(db: Session, contrato_id: str, user_id: int) -> models.Contrato:
    row = (
        db.query(models.Contrato)
        .options(
            joinedload(models.Contrato.patrimonio_rel),
            joinedload(models.Contrato.participantes).joinedload(models.ContratoParticipante.persona),
        )
        .filter(
            models.Contrato.id == contrato_id,
            models.Contrato.user_id == user_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contrato no encontrado",
        )
    return row


def _build_participantes_resumen(contrato: models.Contrato) -> ParticipantesResumenOut:
    participantes = [
        p for p in (contrato.participantes or [])
        if getattr(p, "inactivatedon", None) is None and p.persona is not None
    ]

    inquilino_principal: Optional[str] = None
    inquilinos: list[str] = []
    avalistas: list[str] = []
    gestor: Optional[str] = None

    for p in participantes:
        nombre = p.persona.nombre_completo or p.persona.id

        if p.rol == "inquilino":
            inquilinos.append(nombre)
            if bool(p.es_principal):
                inquilino_principal = nombre

        elif p.rol == "avalista":
            avalistas.append(nombre)

        elif p.rol == "gestor":
            if gestor is None:
                gestor = nombre

    return ParticipantesResumenOut(
        inquilino_principal=inquilino_principal,
        inquilinos=inquilinos,
        avalistas=avalistas,
        gestor=gestor,
    )


def _persona_to_schema(row: models.Persona) -> PersonaSchema:
    return PersonaSchema.model_validate(row)


def _participante_to_schema(row: models.ContratoParticipante) -> ContratoParticipanteSchema:
    persona = row.persona
    return ContratoParticipanteSchema(
        id=row.id,
        contrato_id=row.contrato_id,
        persona_id=row.persona_id,
        rol=row.rol,
        es_principal=bool(row.es_principal),
        observaciones=row.observaciones,
        createon=row.createon,
        modifiedon=row.modifiedon,
        inactivatedon=row.inactivatedon,
        nombre_completo=getattr(persona, "nombre_completo", None),
        dni=getattr(persona, "dni", None),
        telefono=getattr(persona, "telefono", None),
        email=getattr(persona, "email", None),
    )


def _contrato_to_schema(row: models.Contrato) -> ContratoSchema:
    patrimonio = row.patrimonio_rel
    return ContratoSchema(
        id=row.id,
        user_id=row.user_id,
        patrimonio_id=row.patrimonio_id,
        fecha_inicio=row.fecha_inicio,
        fecha_fin=row.fecha_fin,
        renta_mensual=float(row.renta_mensual) if row.renta_mensual is not None else None,
        fianza=float(row.fianza) if row.fianza is not None else None,
        estado=row.estado,
        incremento_ipc=bool(getattr(row, "incremento_ipc", False)),
        incluye_luz=bool(row.incluye_luz),
        incluye_agua=bool(row.incluye_agua),
        incluye_internet=bool(row.incluye_internet),
        observaciones=row.observaciones,
        createon=row.createon,
        modifiedon=row.modifiedon,
        inactivatedon=row.inactivatedon,
        referencia_vivienda=getattr(patrimonio, "referencia", None),
        direccion_completa=getattr(patrimonio, "direccion_completa", None),
        participantes_resumen=_build_participantes_resumen(row),
    )


def _validate_estado_contrato(estado: Optional[str]) -> str:
    allowed = {"activo", "pendiente", "finalizado", "cancelado"}
    value = (estado or "activo").strip().lower()
    if value not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estado de contrato no válido",
        )
    return value


def _validate_rol_participante(rol: Optional[str]) -> str:
    allowed = {"inquilino", "avalista", "gestor"}
    value = (rol or "").strip().lower()
    if value not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol de participante no válido",
        )
    return value


# ==========================================================
# PERSONAS
# ==========================================================

@router.get(
    "/personas",
    response_model=List[PersonaSchema],
    summary="Listar personas",
)
def listar_personas(
    q: Optional[str] = Query(None, description="Búsqueda por nombre, DNI o teléfono."),
    activas: Optional[bool] = Query(True, description="Filtrar personas activas."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    query = db.query(models.Persona).filter(models.Persona.user_id == current_user.id)

    if activas is True:
        query = query.filter(models.Persona.inactivatedon.is_(None))
    elif activas is False:
        query = query.filter(models.Persona.inactivatedon.is_not(None))

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (models.Persona.nombre_completo.ilike(like))
            | (models.Persona.dni.ilike(like))
            | (models.Persona.telefono.ilike(like))
        )

    rows = query.order_by(models.Persona.nombre_completo.asc()).all()
    return [_persona_to_schema(r) for r in rows]


@router.get(
    "/personas/picker",
    response_model=List[PersonaPickerOut],
    summary="Listado reducido de personas para pickers",
)
def picker_personas(
    q: Optional[str] = Query(None, description="Búsqueda por nombre, DNI o teléfono."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    query = db.query(models.Persona).filter(
        models.Persona.user_id == current_user.id,
        models.Persona.inactivatedon.is_(None),
    )

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (models.Persona.nombre_completo.ilike(like))
            | (models.Persona.dni.ilike(like))
            | (models.Persona.telefono.ilike(like))
        )

    rows = query.order_by(models.Persona.nombre_completo.asc()).all()

    return [
        PersonaPickerOut(
            id=r.id,
            nombre_completo=r.nombre_completo,
            dni=r.dni,
            telefono=r.telefono,
        )
        for r in rows
    ]


@router.get(
    "/personas/{persona_id}",
    response_model=PersonaSchema,
    summary="Detalle de persona",
)
def get_persona(
    persona_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _get_owned_persona(db, persona_id, current_user.id)
    return _persona_to_schema(row)


@router.post(
    "/personas",
    response_model=PersonaSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Crear persona",
)
def crear_persona(
    payload: PersonaCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = models.Persona(
        user_id=current_user.id,
        nombre_completo=normalize_upper_ascii(payload.nombre_completo),
        dni=normalize_upper_ascii(payload.dni),
        telefono=_normalize_phone(payload.telefono),
        email=_normalize_email(payload.email),
        fecha_nacimiento=payload.fecha_nacimiento,
        observaciones=payload.observaciones,
    )

    db.add(row)
    db.commit()
    db.refresh(row)
    return _persona_to_schema(row)


@router.put(
    "/personas/{persona_id}",
    response_model=PersonaSchema,
    summary="Actualizar persona",
)
def actualizar_persona(
    persona_id: str,
    payload: PersonaUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _get_owned_persona(db, persona_id, current_user.id)

    if payload.nombre_completo is not None:
        row.nombre_completo = normalize_upper_ascii(payload.nombre_completo)

    if payload.dni is not None:
        row.dni = normalize_upper_ascii(payload.dni)

    if payload.telefono is not None:
        row.telefono = _normalize_phone(payload.telefono)

    if payload.email is not None:
        row.email = _normalize_email(payload.email)

    if payload.fecha_nacimiento is not None:
        row.fecha_nacimiento = payload.fecha_nacimiento

    if payload.observaciones is not None:
        row.observaciones = payload.observaciones

    if payload.inactivatedon is not None:
        row.inactivatedon = payload.inactivatedon

    db.commit()
    db.refresh(row)
    return _persona_to_schema(row)


# ==========================================================
# CONTRATOS
# ==========================================================

@router.post(
    "/contratos",
    response_model=ContratoSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Crear contrato",
)
def crear_contrato(
    payload: ContratoCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _get_owned_patrimonio(db, payload.patrimonio_id, current_user.id)

    estado = _validate_estado_contrato(payload.estado)

    if estado == "activo":
        existing = (
            db.query(models.Contrato)
            .filter(
                models.Contrato.user_id == current_user.id,
                models.Contrato.patrimonio_id == payload.patrimonio_id,
                models.Contrato.estado == "activo",
                models.Contrato.inactivatedon.is_(None),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un contrato activo para esta vivienda",
            )

    row = models.Contrato(
        user_id=current_user.id,
        patrimonio_id=payload.patrimonio_id,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        renta_mensual=payload.renta_mensual,
        fianza=payload.fianza,
        estado=estado,
        incremento_ipc=bool(payload.incremento_ipc),
        incluye_luz=bool(payload.incluye_luz),
        incluye_agua=bool(payload.incluye_agua),
        incluye_internet=bool(payload.incluye_internet),
        observaciones=payload.observaciones,
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    row = _get_owned_contrato(db, row.id, current_user.id)
    return _contrato_to_schema(row)


@router.get(
    "/contratos/{contrato_id}",
    response_model=ContratoSchema,
    summary="Detalle de contrato",
)
def get_contrato(
    contrato_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _get_owned_contrato(db, contrato_id, current_user.id)
    return _contrato_to_schema(row)


@router.put(
    "/contratos/{contrato_id}",
    response_model=ContratoSchema,
    summary="Actualizar contrato",
)
def actualizar_contrato(
    contrato_id: str,
    payload: ContratoUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _get_owned_contrato(db, contrato_id, current_user.id)

    next_estado = row.estado
    if payload.estado is not None:
        next_estado = _validate_estado_contrato(payload.estado)

    if next_estado == "activo":
        existing = (
            db.query(models.Contrato)
            .filter(
                models.Contrato.user_id == current_user.id,
                models.Contrato.patrimonio_id == row.patrimonio_id,
                models.Contrato.estado == "activo",
                models.Contrato.inactivatedon.is_(None),
                models.Contrato.id != row.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe otro contrato activo para esta vivienda",
            )

    if payload.fecha_inicio is not None:
        row.fecha_inicio = payload.fecha_inicio
    if payload.fecha_fin is not None:
        row.fecha_fin = payload.fecha_fin
    if payload.renta_mensual is not None:
        row.renta_mensual = payload.renta_mensual
    if payload.fianza is not None:
        row.fianza = payload.fianza
    if payload.estado is not None:
        row.estado = next_estado
    if payload.incremento_ipc is not None:
        row.incremento_ipc = bool(payload.incremento_ipc)
    if payload.incluye_luz is not None:
        row.incluye_luz = bool(payload.incluye_luz)
    if payload.incluye_agua is not None:
        row.incluye_agua = bool(payload.incluye_agua)
    if payload.incluye_internet is not None:
        row.incluye_internet = bool(payload.incluye_internet)
    if payload.observaciones is not None:
        row.observaciones = payload.observaciones
    if payload.inactivatedon is not None:
        row.inactivatedon = payload.inactivatedon

    db.commit()
    db.refresh(row)

    row = _get_owned_contrato(db, row.id, current_user.id)
    return _contrato_to_schema(row)


@router.get(
    "/patrimonios/{patrimonio_id}/resumen-activo",
    response_model=Optional[ContratoResumenActivoOut],
    summary="Resumen del contrato activo de una vivienda",
)
def get_resumen_contrato_activo_por_patrimonio(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _get_owned_patrimonio(db, patrimonio_id, current_user.id)

    row = (
        db.query(models.Contrato)
        .options(
            joinedload(models.Contrato.participantes).joinedload(models.ContratoParticipante.persona)
        )
        .filter(
            models.Contrato.user_id == current_user.id,
            models.Contrato.patrimonio_id == patrimonio_id,
            models.Contrato.estado == "activo",
            models.Contrato.inactivatedon.is_(None),
        )
        .order_by(models.Contrato.fecha_inicio.desc())
        .first()
    )

    if not row:
        return None

    return ContratoResumenActivoOut(
        contrato_id=row.id,
        estado=row.estado,
        fecha_inicio=row.fecha_inicio,
        fecha_fin=row.fecha_fin,
        renta_mensual=float(row.renta_mensual) if row.renta_mensual is not None else None,
        fianza=float(row.fianza) if row.fianza is not None else None,
        incremento_ipc=bool(getattr(row, "incremento_ipc", False)),
        participantes_resumen=_build_participantes_resumen(row),
    )


# ==========================================================
# PARTICIPANTES
# ==========================================================

@router.get(
    "/contratos/{contrato_id}/participantes",
    response_model=List[ContratoParticipanteSchema],
    summary="Listar participantes de un contrato",
)
def listar_participantes_contrato(
    contrato_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _get_owned_contrato(db, contrato_id, current_user.id)

    rows = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(
            models.ContratoParticipante.user_id == current_user.id,
            models.ContratoParticipante.contrato_id == contrato_id,
            models.ContratoParticipante.inactivatedon.is_(None),
        )
        .all()
    )

    return [_participante_to_schema(r) for r in rows]


@router.post(
    "/contratos/{contrato_id}/participantes",
    response_model=ContratoParticipanteSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Añadir participante a un contrato",
)
def crear_participante_contrato(
    contrato_id: str,
    payload: ContratoParticipanteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    contrato = _get_owned_contrato(db, contrato_id, current_user.id)
    persona = _get_owned_persona(db, payload.persona_id, current_user.id)

    rol = _validate_rol_participante(payload.rol)
    es_principal = bool(payload.es_principal)

    if es_principal:
        if rol != "inquilino":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo un inquilino puede marcarse como principal",
            )

        existing_principal = (
            db.query(models.ContratoParticipante)
            .filter(
                models.ContratoParticipante.user_id == current_user.id,
                models.ContratoParticipante.contrato_id == contrato.id,
                models.ContratoParticipante.rol == "inquilino",
                models.ContratoParticipante.es_principal.is_(True),
                models.ContratoParticipante.inactivatedon.is_(None),
            )
            .first()
        )
        if existing_principal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un inquilino principal para este contrato",
            )

    duplicated = (
        db.query(models.ContratoParticipante)
        .filter(
            models.ContratoParticipante.user_id == current_user.id,
            models.ContratoParticipante.contrato_id == contrato.id,
            models.ContratoParticipante.persona_id == persona.id,
            models.ContratoParticipante.rol == rol,
            models.ContratoParticipante.inactivatedon.is_(None),
        )
        .first()
    )
    if duplicated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La persona ya está asignada a este contrato con ese rol",
        )

    row = models.ContratoParticipante(
        user_id=current_user.id,
        contrato_id=contrato.id,
        persona_id=persona.id,
        rol=rol,
        es_principal=es_principal,
        observaciones=payload.observaciones,
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    row = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(models.ContratoParticipante.id == row.id)
        .first()
    )

    return _participante_to_schema(row)


@router.put(
    "/contratos/participantes/{participante_id}",
    response_model=ContratoParticipanteSchema,
    summary="Actualizar participante de contrato",
)
def actualizar_participante_contrato(
    participante_id: str,
    payload: ContratoParticipanteUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(
            models.ContratoParticipante.id == participante_id,
            models.ContratoParticipante.user_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participante no encontrado",
        )

    next_rol = row.rol
    if payload.rol is not None:
        next_rol = _validate_rol_participante(payload.rol)

    next_principal = row.es_principal
    if payload.es_principal is not None:
        next_principal = bool(payload.es_principal)

    if next_principal and next_rol != "inquilino":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo un inquilino puede marcarse como principal",
        )

    if next_principal:
        existing_principal = (
            db.query(models.ContratoParticipante)
            .filter(
                models.ContratoParticipante.user_id == current_user.id,
                models.ContratoParticipante.contrato_id == row.contrato_id,
                models.ContratoParticipante.rol == "inquilino",
                models.ContratoParticipante.es_principal.is_(True),
                models.ContratoParticipante.inactivatedon.is_(None),
                models.ContratoParticipante.id != row.id,
            )
            .first()
        )
        if existing_principal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe otro inquilino principal para este contrato",
            )

    row.rol = next_rol
    row.es_principal = next_principal

    if payload.observaciones is not None:
        row.observaciones = payload.observaciones
    if payload.inactivatedon is not None:
        row.inactivatedon = payload.inactivatedon

    db.commit()
    db.refresh(row)

    row = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(models.ContratoParticipante.id == row.id)
        .first()
    )
    return _participante_to_schema(row)


@router.delete(
    "/contratos/participantes/{participante_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar lógicamente participante de contrato",
)
def eliminar_participante_contrato(
    participante_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = (
        db.query(models.ContratoParticipante)
        .filter(
            models.ContratoParticipante.id == participante_id,
            models.ContratoParticipante.user_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participante no encontrado",
        )

    from datetime import datetime
    row.inactivatedon = datetime.utcnow()

    db.commit()
    return None