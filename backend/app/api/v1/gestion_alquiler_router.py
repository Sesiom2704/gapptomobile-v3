"""
Archivo: backend/app/api/v1/gestion_alquiler_router.py
Versión: 3.2.1

Descripción:
- API v1 del módulo de gestión de alquileres.
- Mantiene personas, contratos, participantes y resumen activo por patrimonio.
- Integra sincronización automática con ingresos recurrentes asociados a contratos.
- Añade soporte a objeto_alquiler en contratos.
- Añade endpoint para calcular opciones disponibles de contrato por patrimonio.
- Bloquea solapes funcionales con contratos activos ya existentes.

Reglas nuevas:
1. contratos.objeto_alquiler es obligatorio.
2. Las opciones disponibles dependen del patrimonio:
   - completa siempre
   - vivienda solo si hay garaje o trastero
   - garaje / trastero si existen
   - vivienda + garaje / vivienda + trastero / garaje + trastero según proceda
   - habitaciones solo si habitaciones > 1
3. Si existe un contrato activo incompatible, la opción se devuelve deshabilitada.
4. ingresos.concepto pasa a:
   - ALQ SIN_INQ <REFERENCIA> si no hay inquilinos
   - ALQ <NOMBRE_TRUNCADO_8> <REFERENCIA> si hay inquilinos
"""

from __future__ import annotations

import re
from typing import List, Optional
from datetime import datetime

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
    ContratoObjetoOpcionOut,
    ContratoObjetoOpcionesOut,
)
from backend.app.utils.text_utils import normalize_upper_ascii
from backend.app.utils.id_utils import generate_ingreso_id
from backend.app.api.v1.auth_router import require_user

router = APIRouter(
    prefix="/gestion-alquiler",
    tags=["gestion-alquiler"],
)

OBJETO_ALQUILER_LABELS = {
    "completa": "Completa",
    "vivienda": "Vivienda",
    "garaje": "Garaje",
    "trastero": "Trastero",
    "garaje_trastero": "Garaje + Trastero",
    "vivienda_garaje": "Vivienda + Garaje",
    "vivienda_trastero": "Vivienda + Trastero",
}

OBJETO_ALQUILER_ALLOWED_BASE = {
    "completa",
    "vivienda",
    "garaje",
    "trastero",
    "garaje_trastero",
    "vivienda_garaje",
    "vivienda_trastero",
}


# ==========================================================
# Helpers generales
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


def _get_default_tipo_ingreso_alquiler_id() -> str:
    return "VIV-TIPO_INGRESO-FKV95F"


def _get_default_rama_ingreso_alquiler_id() -> str:
    return "VIV-TIPORAMAINGRESO-6F29A938"


def _get_default_cuenta_alquiler_id() -> str:
    return "BANCO-679A92B7"


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


def _get_ingreso_by_contrato(
    db: Session,
    contrato_id: str,
    user_id: int,
) -> Optional[models.Ingreso]:
    return (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == user_id,
            models.Ingreso.contrato_alquiler == contrato_id,
        )
        .order_by(models.Ingreso.createon.desc())
        .first()
    )


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
            if bool(p.es_principal):
                inquilino_principal = nombre
            else:
                inquilinos.append(nombre)
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


def _get_objeto_alquiler_label(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    if code in OBJETO_ALQUILER_LABELS:
        return OBJETO_ALQUILER_LABELS[code]
    if code.startswith("habitacion_"):
        match = re.match(r"^habitacion_(\d+)$", code)
        if match:
            return f"Hab {match.group(1)}"
    return code


def _contrato_to_schema(row: models.Contrato) -> ContratoSchema:
    patrimonio = row.patrimonio_rel
    objeto_alquiler = getattr(row, "objeto_alquiler", None) or "completa"

    return ContratoSchema(
        id=row.id,
        user_id=row.user_id,
        patrimonio_id=row.patrimonio_id,
        objeto_alquiler=objeto_alquiler,
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
        objeto_alquiler_label=_get_objeto_alquiler_label(objeto_alquiler),
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


def _is_contrato_no_operativo(contrato: models.Contrato) -> bool:
    estado = (contrato.estado or "").strip().lower()
    contrato_inactivo = contrato.inactivatedon is not None
    return estado in {"finalizado", "cancelado"} or contrato_inactivo


# ==========================================================
# Helpers de objeto_alquiler y compatibilidad
# ==========================================================

def _get_tipo_inmueble_code(patrimonio: models.Patrimonio) -> str:
    """
    Extrae el código real de tipo_inmueble tanto si llega como string
    como si llega como enum SQLAlchemy/Postgres.
    """
    raw = getattr(patrimonio, "tipo_inmueble", None)

    if raw is None:
        return ""

    # Caso enum Python / SQLAlchemy
    if hasattr(raw, "value"):
        return str(raw.value or "").strip().upper()

    # Caso nombre de enum
    if hasattr(raw, "name"):
        return str(raw.name or "").strip().upper()

    return str(raw).strip().upper()

def _is_habitacion_code(value: str) -> bool:
    return bool(re.match(r"^habitacion_\d+$", value or ""))


def _parse_habitacion_num(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    match = re.match(r"^habitacion_(\d+)$", value)
    if not match:
        return None
    return int(match.group(1))


def _validate_objeto_alquiler_code(value: Optional[str]) -> str:
    code = (value or "").strip().lower()
    if code in OBJETO_ALQUILER_ALLOWED_BASE or _is_habitacion_code(code):
        return code
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Objeto de alquiler no válido",
    )


def _build_allowed_objeto_codes_for_patrimonio(patrimonio: models.Patrimonio) -> list[str]:
    habitaciones = int(getattr(patrimonio, "habitaciones", 0) or 0)
    garaje = bool(getattr(patrimonio, "garaje", False))
    trastero = bool(getattr(patrimonio, "trastero", False))
    tipo_inmueble = _get_tipo_inmueble_code(patrimonio)

    if tipo_inmueble != "VIVIENDA":
        return ["completa"]

    options: list[str] = ["completa"]

    # Vivienda solo se muestra cuando hay anexos
    if garaje or trastero:
        options.append("vivienda")

    if garaje:
        options.append("garaje")

    if trastero:
        options.append("trastero")

    if garaje and trastero:
        options.append("garaje_trastero")

    if garaje:
        options.append("vivienda_garaje")

    if trastero:
        options.append("vivienda_trastero")

    # Habitaciones solo si hay más de 1
    if habitaciones > 1:
        for i in range(1, habitaciones + 1):
            options.append(f"habitacion_{i}")

    return options

def _objeto_uses_garaje(code: str) -> bool:
    return code in {"completa", "garaje", "garaje_trastero", "vivienda_garaje"}


def _objeto_uses_trastero(code: str) -> bool:
    return code in {"completa", "trastero", "garaje_trastero", "vivienda_trastero"}


def _objeto_housing_mode(code: str) -> str:
    """
    Devuelve:
    - 'completa'
    - 'vivienda'
    - 'habitacion'
    - 'none'
    """
    if code == "completa":
        return "completa"
    if code in {"vivienda", "vivienda_garaje", "vivienda_trastero"}:
        return "vivienda"
    if _is_habitacion_code(code):
        return "habitacion"
    return "none"


def _objeto_conflicts(candidate: str, existing: str) -> bool:
    """
    Comprueba incompatibilidad funcional.

    Reglas:
    - completa bloquea todo y queda bloqueada por todo
    - vivienda (o vivienda+anexos) bloquea vivienda y habitaciones
    - habitación solo choca con la misma habitación, con vivienda, o con completa
    - garaje choca con cualquier opción que use garaje
    - trastero choca con cualquier opción que use trastero
    """
    c = candidate
    e = existing

    if c == "completa" or e == "completa":
        return True

    c_mode = _objeto_housing_mode(c)
    e_mode = _objeto_housing_mode(e)

    # Vivienda completa vs vivienda / habitaciones
    if c_mode == "vivienda" and e_mode in {"vivienda", "habitacion"}:
        return True
    if e_mode == "vivienda" and c_mode in {"vivienda", "habitacion"}:
        return True

    # Habitación concreta vs misma habitación
    if c_mode == "habitacion" and e_mode == "habitacion":
        return _parse_habitacion_num(c) == _parse_habitacion_num(e)

    # Garaje
    if _objeto_uses_garaje(c) and _objeto_uses_garaje(e):
        return True

    # Trastero
    if _objeto_uses_trastero(c) and _objeto_uses_trastero(e):
        return True

    return False


def _get_active_contracts_for_patrimonio(
    db: Session,
    patrimonio_id: str,
    user_id: int,
    exclude_contrato_id: Optional[str] = None,
) -> list[models.Contrato]:
    query = (
        db.query(models.Contrato)
        .filter(
            models.Contrato.user_id == user_id,
            models.Contrato.patrimonio_id == patrimonio_id,
            models.Contrato.estado == "activo",
            models.Contrato.inactivatedon.is_(None),
        )
    )

    if exclude_contrato_id:
        query = query.filter(models.Contrato.id != exclude_contrato_id)

    return query.all()


def _build_objeto_alquiler_options_for_patrimonio(
    db: Session,
    patrimonio: models.Patrimonio,
    user_id: int,
    exclude_contrato_id: Optional[str] = None,
) -> list[ContratoObjetoOpcionOut]:
    allowed_codes = _build_allowed_objeto_codes_for_patrimonio(patrimonio)
    active_contracts = _get_active_contracts_for_patrimonio(
        db=db,
        patrimonio_id=patrimonio.id,
        user_id=user_id,
        exclude_contrato_id=exclude_contrato_id,
    )

    result: list[ContratoObjetoOpcionOut] = []

    for code in allowed_codes:
        conflict_with: list[str] = []

        for existing in active_contracts:
            existing_code = getattr(existing, "objeto_alquiler", None) or "completa"
            if _objeto_conflicts(code, existing_code):
                conflict_with.append(_get_objeto_alquiler_label(existing_code) or existing_code)

        enabled = len(conflict_with) == 0
        disabled_reason = None

        if not enabled:
            disabled_reason = f"No disponible: conflicto con contrato activo ({', '.join(conflict_with)})"

        result.append(
            ContratoObjetoOpcionOut(
                code=code,
                label=_get_objeto_alquiler_label(code) or code,
                enabled=enabled,
                disabled_reason=disabled_reason,
            )
        )

    return result


def _ensure_objeto_alquiler_is_valid_for_patrimonio(
    db: Session,
    patrimonio: models.Patrimonio,
    user_id: int,
    objeto_alquiler: str,
    exclude_contrato_id: Optional[str] = None,
) -> None:
    options = _build_objeto_alquiler_options_for_patrimonio(
        db=db,
        patrimonio=patrimonio,
        user_id=user_id,
        exclude_contrato_id=exclude_contrato_id,
    )

    selected = next((o for o in options if o.code == objeto_alquiler), None)

    if selected is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El objeto de alquiler no es válido para este patrimonio",
        )

    if not selected.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=selected.disabled_reason or "El objeto de alquiler no está disponible",
        )


# ==========================================================
# Helpers de ingresos automáticos por contrato
# ==========================================================

def _get_first_inquilino_name_for_concept(contrato: models.Contrato) -> str:
    """
    Regla definida:
    - usar el primer inquilino activo por fecha de creación
    - truncado a 8 caracteres
    - si no existe, usar SIN_INQ
    """
    participantes = [
        p for p in (contrato.participantes or [])
        if getattr(p, "inactivatedon", None) is None
        and p.rol == "inquilino"
        and p.persona is not None
    ]

    participantes.sort(key=lambda p: (p.createon or datetime.min, p.id or ""))

    if not participantes:
        return "SIN_INQ"

    nombre = str(participantes[0].persona.nombre_completo or "").strip()
    if not nombre:
        return "SIN_INQ"

    normalized = normalize_upper_ascii(nombre)
    return normalized[:8] if normalized else "SIN_INQ"


def _build_ingreso_concepto_for_contrato(contrato: models.Contrato) -> str:
    referencia = (
        getattr(contrato.patrimonio_rel, "referencia", None)
        or contrato.patrimonio_id
        or "SIN_REFERENCIA"
    )

    tenant = _get_first_inquilino_name_for_concept(contrato)
    return normalize_upper_ascii(f"ALQ {tenant} {referencia}")


def _create_ingreso_for_contrato(
    db: Session,
    contrato: models.Contrato,
    user_id: int,
) -> models.Ingreso:
    now = datetime.utcnow()
    contrato_no_operativo = _is_contrato_no_operativo(contrato)

    ingreso = models.Ingreso(
        id=generate_ingreso_id(db),
        rango_cobro="1-3",
        periodicidad="MENSUAL",
        tipo_id=_get_default_tipo_ingreso_alquiler_id(),
        rama_id=_get_default_rama_ingreso_alquiler_id(),
        referencia_vivienda_id=contrato.patrimonio_id,
        contrato_alquiler=contrato.id,
        concepto=_build_ingreso_concepto_for_contrato(contrato),
        importe=float(contrato.renta_mensual) if contrato.renta_mensual is not None else 0.0,
        activo=not contrato_no_operativo,
        cobrado=False,
        createon=now,
        modifiedon=now,
        fecha_inicio=contrato.fecha_inicio,
        kpi=not contrato_no_operativo,
        ingresos_cobrados=0,
        inactivatedon=now if contrato_no_operativo else None,
        cuenta_id=_get_default_cuenta_alquiler_id(),
        user_id=user_id,
        ultimo_ingreso_on=None,
        omitido_este_mes=False,
        ultimo_omitido_on=None,
        omitido_count=0,
    )
    db.add(ingreso)
    return ingreso


def _sync_ingreso_for_contrato(
    db: Session,
    contrato: models.Contrato,
    user_id: int,
) -> models.Ingreso:
    ingreso = _get_ingreso_by_contrato(db, contrato.id, user_id)

    if ingreso is None:
        ingreso = _create_ingreso_for_contrato(db, contrato, user_id)
        return ingreso

    now = datetime.utcnow()
    contrato_no_operativo = _is_contrato_no_operativo(contrato)

    ingreso.rango_cobro = "1-3"
    ingreso.periodicidad = "MENSUAL"
    ingreso.tipo_id = _get_default_tipo_ingreso_alquiler_id()
    ingreso.rama_id = _get_default_rama_ingreso_alquiler_id()
    ingreso.referencia_vivienda_id = contrato.patrimonio_id
    ingreso.contrato_alquiler = contrato.id
    ingreso.concepto = _build_ingreso_concepto_for_contrato(contrato)
    ingreso.importe = float(contrato.renta_mensual) if contrato.renta_mensual is not None else 0.0
    ingreso.fecha_inicio = contrato.fecha_inicio
    ingreso.cuenta_id = _get_default_cuenta_alquiler_id()
    ingreso.modifiedon = now

    if contrato_no_operativo:
        ingreso.activo = False
        ingreso.kpi = False
        if ingreso.inactivatedon is None:
            ingreso.inactivatedon = now
    else:
        ingreso.activo = True
        ingreso.kpi = True
        ingreso.inactivatedon = None

    return ingreso


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
    return [PersonaSchema.model_validate(r) for r in rows]


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
    return PersonaSchema.model_validate(row)


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
    return PersonaSchema.model_validate(row)


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
    return PersonaSchema.model_validate(row)


# ==========================================================
# CONTRATOS
# ==========================================================

@router.get(
    "/contratos",
    response_model=List[ContratoSchema],
    summary="Listar contratos",
)
def listar_contratos(
    patrimonio_id: Optional[str] = Query(
        None,
        description="Filtra contratos por vivienda/patrimonio.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    query = (
        db.query(models.Contrato)
        .options(
            joinedload(models.Contrato.patrimonio_rel),
            joinedload(models.Contrato.participantes).joinedload(models.ContratoParticipante.persona),
        )
        .filter(models.Contrato.user_id == current_user.id)
    )

    if patrimonio_id:
        _get_owned_patrimonio(db, patrimonio_id, current_user.id)
        query = query.filter(models.Contrato.patrimonio_id == patrimonio_id)

    rows = (
        query
        .order_by(
            models.Contrato.patrimonio_id.asc(),
            models.Contrato.fecha_inicio.desc(),
            models.Contrato.createon.desc(),
        )
        .all()
    )

    return [_contrato_to_schema(r) for r in rows]


@router.get(
    "/patrimonios/{patrimonio_id}/opciones-contrato",
    response_model=ContratoObjetoOpcionesOut,
    summary="Opciones válidas de objeto de alquiler para un patrimonio",
)
def get_opciones_contrato_por_patrimonio(
    patrimonio_id: str,
    contrato_id_exclude: Optional[str] = Query(
        None,
        description="Contrato a excluir del cálculo, útil en edición."
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patrimonio = _get_owned_patrimonio(db, patrimonio_id, current_user.id)

    if contrato_id_exclude:
        _get_owned_contrato(db, contrato_id_exclude, current_user.id)

    opciones = _build_objeto_alquiler_options_for_patrimonio(
        db=db,
        patrimonio=patrimonio,
        user_id=current_user.id,
        exclude_contrato_id=contrato_id_exclude,
    )

    return ContratoObjetoOpcionesOut(
        patrimonio_id=patrimonio.id,
        opciones=opciones,
    )


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
    patrimonio = _get_owned_patrimonio(db, payload.patrimonio_id, current_user.id)
    estado = _validate_estado_contrato(payload.estado)
    objeto_alquiler = _validate_objeto_alquiler_code(payload.objeto_alquiler)

    _ensure_objeto_alquiler_is_valid_for_patrimonio(
        db=db,
        patrimonio=patrimonio,
        user_id=current_user.id,
        objeto_alquiler=objeto_alquiler,
        exclude_contrato_id=None,
    )

    row = models.Contrato(
        user_id=current_user.id,
        patrimonio_id=payload.patrimonio_id,
        objeto_alquiler=objeto_alquiler,
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
    db.flush()

    contrato_loaded = _get_owned_contrato(db, row.id, current_user.id)

    _create_ingreso_for_contrato(
        db=db,
        contrato=contrato_loaded,
        user_id=current_user.id,
    )

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
    patrimonio = _get_owned_patrimonio(db, row.patrimonio_id, current_user.id)

    next_estado = row.estado
    if payload.estado is not None:
        next_estado = _validate_estado_contrato(payload.estado)

    next_objeto_alquiler = getattr(row, "objeto_alquiler", None) or "completa"
    if payload.objeto_alquiler is not None:
        next_objeto_alquiler = _validate_objeto_alquiler_code(payload.objeto_alquiler)

    _ensure_objeto_alquiler_is_valid_for_patrimonio(
        db=db,
        patrimonio=patrimonio,
        user_id=current_user.id,
        objeto_alquiler=next_objeto_alquiler,
        exclude_contrato_id=row.id,
    )

    if payload.objeto_alquiler is not None:
        row.objeto_alquiler = next_objeto_alquiler
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

    contrato_loaded = _get_owned_contrato(db, row.id, current_user.id)

    _sync_ingreso_for_contrato(
        db=db,
        contrato=contrato_loaded,
        user_id=current_user.id,
    )

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

    objeto_alquiler = getattr(row, "objeto_alquiler", None) or "completa"

    return ContratoResumenActivoOut(
        contrato_id=row.id,
        estado=row.estado,
        fecha_inicio=row.fecha_inicio,
        fecha_fin=row.fecha_fin,
        renta_mensual=float(row.renta_mensual) if row.renta_mensual is not None else None,
        fianza=float(row.fianza) if row.fianza is not None else None,
        incremento_ipc=bool(getattr(row, "incremento_ipc", False)),
        objeto_alquiler=objeto_alquiler,
        objeto_alquiler_label=_get_objeto_alquiler_label(objeto_alquiler),
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

    return [
        ContratoParticipanteSchema(
            id=r.id,
            contrato_id=r.contrato_id,
            persona_id=r.persona_id,
            rol=r.rol,
            es_principal=bool(r.es_principal),
            observaciones=r.observaciones,
            createon=r.createon,
            modifiedon=r.modifiedon,
            inactivatedon=r.inactivatedon,
            nombre_completo=getattr(r.persona, "nombre_completo", None),
            dni=getattr(r.persona, "dni", None),
            telefono=getattr(r.persona, "telefono", None),
            email=getattr(r.persona, "email", None),
        )
        for r in rows
    ]


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
    db.flush()

    contrato_loaded = _get_owned_contrato(db, contrato.id, current_user.id)
    _sync_ingreso_for_contrato(
        db=db,
        contrato=contrato_loaded,
        user_id=current_user.id,
    )

    db.commit()
    db.refresh(row)

    row = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(models.ContratoParticipante.id == row.id)
        .first()
    )

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
        nombre_completo=getattr(row.persona, "nombre_completo", None),
        dni=getattr(row.persona, "dni", None),
        telefono=getattr(row.persona, "telefono", None),
        email=getattr(row.persona, "email", None),
    )


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

    db.flush()

    contrato_loaded = _get_owned_contrato(db, row.contrato_id, current_user.id)
    _sync_ingreso_for_contrato(
        db=db,
        contrato=contrato_loaded,
        user_id=current_user.id,
    )

    db.commit()
    db.refresh(row)

    row = (
        db.query(models.ContratoParticipante)
        .options(joinedload(models.ContratoParticipante.persona))
        .filter(models.ContratoParticipante.id == row.id)
        .first()
    )
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
        nombre_completo=getattr(row.persona, "nombre_completo", None),
        dni=getattr(row.persona, "dni", None),
        telefono=getattr(row.persona, "telefono", None),
        email=getattr(row.persona, "email", None),
    )


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

    row.inactivatedon = datetime.utcnow()
    db.flush()

    contrato_loaded = _get_owned_contrato(db, row.contrato_id, current_user.id)
    _sync_ingreso_for_contrato(
        db=db,
        contrato=contrato_loaded,
        user_id=current_user.id,
    )

    db.commit()
    return None