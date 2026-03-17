"""
Ruta: backend/app/services/bot/incidencias_service.py
Versión: 1.5.1

Descripción:
Servicio de negocio para incidencias del BOT de alquileres.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from backend.app.db import models
from backend.app.repositories.bot.incidencias_repository import IncidenciasBotRepository
from backend.app.schemas.bot.incidencias import (
    BotCitaIncidenciaResumen,
    BotIncidenciaActionResponse,
    BotIncidenciaAssignProviderRequest,
    BotIncidenciaCreateRequest,
    BotIncidenciaCreateResponse,
    BotIncidenciaDetailResponse,
    BotIncidenciaListItem,
    BotIncidenciaListResponse,
    BotIncidenciaPendienteListResponse,
    BotIncidenciaResumen,
    BotIncidenciaScheduleVisitRequest,
    BotIncidenciaScheduleVisitResponse,
    BotIncidenciaTakeRequest,
    BotLocalidadListItem,
    BotLocalidadListResponse,
    BotProveedorCreateRequest,
    BotProveedorCreateResponse,
    BotProveedorListItem,
    BotProveedorListResponse,
    BotResponsableActual,
    BotTenantActiveVisitResponse,
    BotTenantVisitResponseRequest,
    BotTenantVisitResponseResponse,
)
from backend.app.utils.bot.ids import (
    generate_asignacion_incidencia_id,
    generate_cita_incidencia_id,
    generate_historial_estado_id,
    generate_incidencia_codigo,
    generate_incidencia_id,
)
from backend.app.utils.id_utils import generate_proveedor_id
from backend.app.db import models


ALLOWED_ROLES = {"inquilino", "avalista", "gestor"}

ALLOWED_CATEGORIAS = {
    "fontaneria",
    "electricidad",
    "cerrajeria",
    "electrodomesticos",
    "humedad",
    "climatizacion",
    "otros",
}

ESTADO_INICIAL = "new"

ACTIVE_ESTADOS = {
    "new",
    "under_review",
    "awaiting_provider_assignment",
    "scheduled",
    "in_progress",
    "awaiting_parts",
    "pending_follow_up",
}

ASIGNACION_TIPO_GESTOR = "gestor"
ASIGNACION_TIPO_SUPERVISOR = "supervisor"
ASIGNACION_TIPO_PROVEEDOR = "proveedor"

ASIGNACION_ESTADO_ACTIVE = "active"
ASIGNACION_ESTADO_INACTIVE = "inactive"
ASIGNACION_ESTADO_CANCELLED = "cancelled"

PRIORIDAD_MAP = {
    "baja": "low",
    "media": "normal",
    "alta": "high",
    "urgente": "urgent",
}

PRIORIDAD_LABELS = {
    "low": "Baja",
    "normal": "Media",
    "high": "Alta",
    "urgent": "Urgente",
}

ESTADO_LABELS = {
    "new": "Nueva",
    "under_review": "En gestión",
    "awaiting_provider_assignment": "Pendiente de asignación de proveedor",
    "awaiting_quote": "Pendiente de presupuesto",
    "quote_submitted": "Presupuesto recibido",
    "quote_approved": "Presupuesto aprobado",
    "scheduled": "Visita programada",
    "tenant_confirmed": "Confirmada por inquilino",
    "tenant_reschedule_requested": "Reprogramación solicitada",
    "in_progress": "En curso",
    "awaiting_parts": "Pendiente de piezas",
    "pending_follow_up": "Pendiente de seguimiento",
    "resolved": "Resuelta",
    "closed": "Cerrada",
    "cancelled": "Cancelada",
}

ESTADO_CITA_LABELS = {
    "proposed": "Programada",
    "confirmed": "Confirmada",
    "rescheduled": "Reprogramada",
    "completed": "Completada",
    "missed": "No realizada",
    "cancelled": "Cancelada",
}

ESTADO_INQUILINO_LABELS = {
    "pending_confirmation": "Pendiente de confirmación",
    "confirmed": "Confirmado",
    "reschedule_requested": "Reprogramación solicitada",
    "rejected": "Rechazado",
}

PROVEEDOR_RAMA_INCIDENCIAS = "servicios_alquileres"
PROVEEDOR_BOT_USER_ID = 2

CITA_ESTADO_PROPOSED = "proposed"
CITA_ESTADO_CONFIRMED = "confirmed"
CITA_ESTADO_RESCHEDULED = "rescheduled"
CITA_ESTADO_COMPLETED = "completed"
CITA_ESTADO_MISSED = "missed"
CITA_ESTADO_CANCELLED = "cancelled"

CITA_INQUILINO_PENDING_CONFIRMATION = "pending_confirmation"
CITA_INQUILINO_CONFIRMED = "confirmed"
CITA_INQUILINO_RESCHEDULE_REQUESTED = "reschedule_requested"
CITA_INQUILINO_REJECTED = "rejected"

TENANT_ACTION_CONFIRM = "confirm"
TENANT_ACTION_REJECT = "reject"
TENANT_ACTION_RESCHEDULE = "reschedule"


def _http_400(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _http_404(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _estado_label(value: str | None) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_LABELS.get(value, value)


def _prioridad_label(value: str | None) -> str:
    if not value:
        return "Sin prioridad"
    return PRIORIDAD_LABELS.get(value, value)


def _estado_cita_label(value: str | None) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_CITA_LABELS.get(value, value)


def _estado_inquilino_label(value: str | None) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_INQUILINO_LABELS.get(value, value)


def _build_incidencia_resumen(incidencia) -> BotIncidenciaResumen:
    return BotIncidenciaResumen(
        id=incidencia.id,
        codigo=incidencia.codigo,
        estado=incidencia.estado,
        estado_label=_estado_label(incidencia.estado),
        categoria=incidencia.categoria,
        titulo=incidencia.titulo,
        prioridad=incidencia.prioridad,
        prioridad_label=_prioridad_label(incidencia.prioridad),
        fecha_creacion=incidencia.fecha_creacion,
        contrato_id=incidencia.contrato_id,
        patrimonio_id=incidencia.patrimonio_id,
    )


def _build_cita_resumen(cita) -> BotCitaIncidenciaResumen | None:
    if not cita:
        return None

    proveedor = getattr(cita, "proveedor", None)

    return BotCitaIncidenciaResumen(
        id=cita.id,
        proveedor_id=cita.proveedor_id,
        proveedor_nombre=proveedor.nombre if proveedor else None,
        fecha_inicio_programada=cita.fecha_inicio_programada,
        fecha_fin_programada=cita.fecha_fin_programada,
        estado_cita=cita.estado_cita,
        estado_cita_label=_estado_cita_label(cita.estado_cita),
        estado_inquilino=cita.estado_inquilino,
        estado_inquilino_label=_estado_inquilino_label(cita.estado_inquilino),
    )


def _assert_persona_is_active_gestor_of_contrato(
    repo: IncidenciasBotRepository,
    *,
    contrato_id: str,
    gestor_persona_id: str,
):
    gestor_participante = repo.get_active_gestor_for_contrato(contrato_id)
    if not gestor_participante:
        _http_400("El contrato no tiene un gestor activo asignado")

    if gestor_participante.persona_id != gestor_persona_id:
        _http_403_or_400_gestor_not_allowed()

    return gestor_participante


def _assert_persona_is_inquilino_of_contrato(
    repo: IncidenciasBotRepository,
    *,
    contrato_id: str,
    inquilino_persona_id: str,
):
    inquilino_participante = repo.get_contrato_participante_by_rol(
        contrato_id=contrato_id,
        persona_id=inquilino_persona_id,
        rol="inquilino",
    )
    if not inquilino_participante:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona indicada no puede responder esta cita como inquilino",
        )
    return inquilino_participante


def _http_403_or_400_gestor_not_allowed() -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="La persona indicada no puede gestionar esta incidencia",
    )


def _resolve_ubicacion_from_localidad_id(db: Session, localidad_id: int) -> dict:
    loc = (
        db.query(models.Localidad)
        .options(
            joinedload(models.Localidad.region).joinedload(models.Region.pais)
        )
        .filter(models.Localidad.id == localidad_id)
        .first()
    )
    if not loc:
        _http_400("localidad_id inválido (no existe).")

    region = getattr(loc, "region", None)
    pais_obj = getattr(region, "pais", None) if region else None

    return {
        "localidad_id": loc.id,
        "localidad": getattr(loc, "nombre", None),
        "comunidad": getattr(region, "nombre", None) if region else None,
        "pais": getattr(pais_obj, "nombre", None) if pais_obj else None,
    }


def create_incidencia_bot(
    db: Session,
    payload: BotIncidenciaCreateRequest,
) -> BotIncidenciaCreateResponse:
    repo = IncidenciasBotRepository(db)

    contrato = repo.get_contrato_by_id(payload.contrato_id)
    if not contrato:
        _http_404("Contrato no encontrado")

    if contrato.estado != "activo":
        _http_400("El contrato no está activo")

    if contrato.inactivatedon is not None:
        _http_400("El contrato está inactivo")

    patrimonio = repo.get_patrimonio_by_id(payload.patrimonio_id)
    if not patrimonio:
        _http_404("Patrimonio no encontrado")

    if contrato.patrimonio_id != payload.patrimonio_id:
        _http_400("El patrimonio no corresponde al contrato")

    persona = repo.get_persona_by_id(payload.persona_reporta_id)
    if not persona:
        _http_404("Persona reportante no encontrada")

    participante = repo.get_contrato_participante(
        contrato_id=payload.contrato_id,
        persona_id=payload.persona_reporta_id,
    )
    if not participante:
        _http_400("La persona no está vinculada al contrato")

    rol_reporta_normalized = (payload.rol_reporta or "").strip().lower()
    rol_real_normalized = (participante.rol or "").strip().lower()

    if rol_reporta_normalized not in ALLOWED_ROLES:
        _http_400("Rol reporta no permitido")

    if rol_reporta_normalized != rol_real_normalized:
        _http_400("El rol reporta no coincide con el rol del contrato")

    prioridad_input = (payload.prioridad or "").strip().lower()
    prioridad_db = PRIORIDAD_MAP.get(prioridad_input)
    if not prioridad_db:
        _http_400("Prioridad no válida")

    categoria_normalized = (payload.categoria or "").strip().lower()
    if categoria_normalized not in ALLOWED_CATEGORIAS:
        _http_400("Categoría no válida")

    incidencia_id = generate_incidencia_id()
    codigo = generate_incidencia_codigo()

    try:
        incidencia = repo.create_incidencia(
            incidencia_id=incidencia_id,
            codigo=codigo,
            contrato_id=payload.contrato_id,
            patrimonio_id=payload.patrimonio_id,
            persona_reporta_id=payload.persona_reporta_id,
            rol_reporta=rol_reporta_normalized,
            categoria=categoria_normalized,
            titulo=payload.titulo,
            descripcion=payload.descripcion.strip(),
            prioridad=prioridad_db,
            estado=ESTADO_INICIAL,
            telefono_inquilino_snapshot=persona.telefono,
            notas_acceso=payload.notas_acceso,
        )

        repo.create_historial_estado(
            historial_id=generate_historial_estado_id(),
            incidencia_id=incidencia_id,
            estado_anterior=None,
            estado_nuevo=ESTADO_INICIAL,
            persona_cambia_id=payload.persona_reporta_id,
            rol_cambia=rol_reporta_normalized,
            nota="Alta inicial de incidencia desde BOT",
        )

        repo.commit()
        repo.refresh(incidencia)

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al crear la incidencia: {str(e.orig)}",
        )

    except Exception:
        repo.rollback()
        raise

    return BotIncidenciaCreateResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Incidencia creada correctamente",
    )


def get_incidencia_detail_by_id(db: Session, incidencia_id: str) -> BotIncidenciaDetailResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id_with_context(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    responsable_actual = None
    if incidencia.proveedor_actual_id:
        proveedor = incidencia.proveedor_actual
        responsable_actual = BotResponsableActual(
            tipo="proveedor",
            id=incidencia.proveedor_actual_id,
            nombre=proveedor.nombre if proveedor else None,
        )
    elif incidencia.gestor_actual_id:
        responsable_actual = BotResponsableActual(
            tipo="gestor",
            id=incidencia.gestor_actual_id,
            nombre=incidencia.gestor_actual.nombre_completo if incidencia.gestor_actual else None,
        )
    elif incidencia.supervisor_actual_id:
        responsable_actual = BotResponsableActual(
            tipo="supervisor",
            id=incidencia.supervisor_actual_id,
            nombre=incidencia.supervisor_actual.nombre_completo if incidencia.supervisor_actual else None,
        )

    ultima_cita = repo.get_last_cita_by_incidencia(incidencia.id)

    return BotIncidenciaDetailResponse(
        ok=True,
        id=incidencia.id,
        codigo=incidencia.codigo,
        contrato_id=incidencia.contrato_id,
        patrimonio_id=incidencia.patrimonio_id,
        persona_reporta_id=incidencia.persona_reporta_id,
        rol_reporta=incidencia.rol_reporta,
        categoria=incidencia.categoria,
        titulo=incidencia.titulo,
        descripcion=incidencia.descripcion,
        prioridad=incidencia.prioridad,
        prioridad_label=_prioridad_label(incidencia.prioridad),
        estado=incidencia.estado,
        estado_label=_estado_label(incidencia.estado),
        telefono_inquilino_snapshot=incidencia.telefono_inquilino_snapshot,
        notas_acceso=incidencia.notas_acceso,
        fecha_creacion=incidencia.fecha_creacion,
        fecha_actualizacion=incidencia.fecha_actualizacion,
        fecha_cierre=incidencia.fecha_cierre,
        responsable_actual=responsable_actual,
        ultima_cita=_build_cita_resumen(ultima_cita),
    )


def get_incidencia_detail_by_codigo(db: Session, codigo: str) -> BotIncidenciaDetailResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_codigo(codigo)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    return get_incidencia_detail_by_id(db=db, incidencia_id=incidencia.id)


def list_incidencias_by_contrato(db: Session, contrato_id: str) -> BotIncidenciaListResponse:
    repo = IncidenciasBotRepository(db)

    contrato = repo.get_contrato_by_id(contrato_id)
    if not contrato:
        _http_404("Contrato no encontrado")

    rows = repo.list_incidencias_by_contrato(contrato_id)

    items = []
    for incidencia, proveedor, gestor in rows:
        items.append(
            BotIncidenciaListItem(
                id=incidencia.id,
                codigo=incidencia.codigo,
                estado=incidencia.estado,
                estado_label=_estado_label(incidencia.estado),
                categoria=incidencia.categoria,
                titulo=incidencia.titulo,
                prioridad=incidencia.prioridad,
                prioridad_label=_prioridad_label(incidencia.prioridad),
                fecha_creacion=incidencia.fecha_creacion,
                proveedor_actual_id=incidencia.proveedor_actual_id,
                proveedor_actual_nombre=proveedor.nombre if proveedor else None,
                gestor_actual_id=incidencia.gestor_actual_id,
                gestor_actual_nombre=gestor.nombre_completo if gestor else None,
                localidad=getattr(getattr(incidencia, "patrimonio", None), "localidad", None),
            )
        )

    return BotIncidenciaListResponse(ok=True, items=items)


def list_active_incidencias_for_bot(
    db: Session,
    gestor_persona_id: str,
) -> BotIncidenciaPendienteListResponse:
    repo = IncidenciasBotRepository(db)

    gestor = repo.get_persona_by_id(gestor_persona_id)
    if not gestor:
        _http_404("Gestor no encontrado")

    rows = repo.list_active_incidencias(
        estados_activos=ACTIVE_ESTADOS,
        gestor_persona_id=gestor_persona_id,
    )

    items = []
    for incidencia, proveedor, gestor_actual in rows:
        items.append(
            BotIncidenciaListItem(
                id=incidencia.id,
                codigo=incidencia.codigo,
                estado=incidencia.estado,
                estado_label=_estado_label(incidencia.estado),
                categoria=incidencia.categoria,
                titulo=incidencia.titulo,
                prioridad=incidencia.prioridad,
                prioridad_label=_prioridad_label(incidencia.prioridad),
                fecha_creacion=incidencia.fecha_creacion,
                proveedor_actual_id=incidencia.proveedor_actual_id,
                proveedor_actual_nombre=proveedor.nombre if proveedor else None,
                gestor_actual_id=incidencia.gestor_actual_id,
                gestor_actual_nombre=gestor_actual.nombre_completo if gestor_actual else None,
                localidad=getattr(getattr(incidencia, "patrimonio", None), "localidad", None),
            )
        )

    return BotIncidenciaPendienteListResponse(ok=True, items=items)


def take_incidencia_bot(
    db: Session,
    incidencia_id: str,
    payload: BotIncidenciaTakeRequest,
) -> BotIncidenciaActionResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    gestor = repo.get_persona_by_id(payload.gestor_persona_id)
    if not gestor:
        _http_404("Gestor no encontrado")

    _assert_persona_is_active_gestor_of_contrato(
        repo,
        contrato_id=incidencia.contrato_id,
        gestor_persona_id=payload.gestor_persona_id,
    )

    estado_anterior = incidencia.estado

    try:
        repo.close_active_assignments_by_tipo(
            incidencia_id=incidencia.id,
            tipo_asignacion="gestor",
        )

        repo.create_asignacion_incidencia(
            asignacion_id=generate_asignacion_incidencia_id(),
            incidencia_id=incidencia.id,
            tipo_asignacion="gestor",
            estado=ASIGNACION_ESTADO_ACTIVE,
            gestor_id=payload.gestor_persona_id,
            asignado_por_persona_id=payload.gestor_persona_id,
            nota=payload.nota,
        )

        repo.update_incidencia_gestor_actual(
            incidencia=incidencia,
            gestor_actual_id=payload.gestor_persona_id,
        )
        repo.update_incidencia_estado(
            incidencia=incidencia,
            estado="under_review",
        )

        repo.create_historial_estado(
            historial_id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="under_review",
            persona_cambia_id=payload.gestor_persona_id,
            rol_cambia="gestor",
            nota=payload.nota or "Incidencia tomada en gestión por gestor",
        )

        repo.commit()
        repo.refresh(incidencia)

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al tomar la incidencia: {str(e.orig)}",
        )
    except Exception:
        repo.rollback()
        raise

    return BotIncidenciaActionResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Incidencia tomada en gestión correctamente",
    )


def list_proveedores_bot(db: Session) -> BotProveedorListResponse:
    repo = IncidenciasBotRepository(db)

    proveedores = repo.list_proveedores(
        only_active=True,
        rama_id=PROVEEDOR_RAMA_INCIDENCIAS,
    )

    items = [
        BotProveedorListItem(
            id=p.id,
            nombre=p.nombre,
            telefono=p.telefono,
            email=p.email,
            localidad=p.localidad,
            activo=bool(p.activo),
        )
        for p in proveedores
    ]

    return BotProveedorListResponse(ok=True, items=items)

def search_localidades_bot(
    db: Session,
    search: str,
    limit: int = 10,
) -> BotLocalidadListResponse:
    search_normalized = (search or "").strip()
    if len(search_normalized) < 2:
        _http_400("Debes indicar al menos 2 caracteres para buscar la localidad")

    rows = (
        db.query(models.Localidad)
        .join(models.Region, models.Region.id == models.Localidad.region_id)
        .join(models.Pais, models.Pais.id == models.Region.pais_id)
        .filter(models.Localidad.nombre.ilike(f"%{search_normalized}%"))
        .order_by(models.Localidad.nombre.asc())
        .limit(limit)
        .all()
    )

    items = []
    for loc in rows:
        region = getattr(loc, "region", None) or getattr(loc, "region_rel", None)
        pais = None
        if region is not None:
            pais = getattr(region, "pais", None) or getattr(region, "pais_rel", None)

        items.append(
            BotLocalidadListItem(
                id=loc.id,
                nombre=loc.nombre,
                region_nombre=getattr(region, "nombre", None),
                pais_nombre=getattr(pais, "nombre", None),
            )
        )

    return BotLocalidadListResponse(ok=True, items=items)

def create_proveedor_bot(
    db: Session,
    payload: BotProveedorCreateRequest,
) -> BotProveedorCreateResponse:
    repo = IncidenciasBotRepository(db)

    gestor = repo.get_persona_by_id(payload.gestor_persona_id)
    if not gestor:
        _http_404("Gestor no encontrado")

    nombre_normalizado = (payload.nombre or "").strip()

    if not nombre_normalizado:
        _http_400("El nombre del proveedor es obligatorio")

    if not payload.localidad_id or payload.localidad_id <= 0:
        _http_400("La localidad del proveedor es obligatoria")

    existing = repo.get_proveedor_by_nombre(
        nombre=nombre_normalizado,
        user_id=PROVEEDOR_BOT_USER_ID,
    )
    if existing:
        _http_400("Ya existe un proveedor con ese nombre para el contexto BOT")

    try:
        proveedor = repo.create_proveedor_bot(
            proveedor_id=generate_proveedor_id(db),
            user_id=PROVEEDOR_BOT_USER_ID,
            nombre=nombre_normalizado,
            rama_id=PROVEEDOR_RAMA_INCIDENCIAS,
            localidad_id=payload.localidad_id,
            acepta_urgencias=payload.acepta_urgencias,
            activo=True,
            cif=(payload.cif or "").strip() or None,
            telefono=(payload.telefono or "").strip() or None,
            persona_contacto=(payload.persona_contacto or "").strip() or None,
        )

        repo.commit()
        repo.refresh(proveedor)

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al crear proveedor: {str(e.orig)}",
        )
    except Exception:
        repo.rollback()
        raise

    return BotProveedorCreateResponse(
        ok=True,
        proveedor=BotProveedorListItem(
            id=proveedor.id,
            nombre=proveedor.nombre,
            telefono=proveedor.telefono,
            email=proveedor.email,
            localidad=proveedor.localidad,
            activo=bool(proveedor.activo),
        ),
        mensaje="Proveedor creado correctamente",
    )

def assign_provider_bot(
    db: Session,
    incidencia_id: str,
    payload: BotIncidenciaAssignProviderRequest,
) -> BotIncidenciaActionResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    gestor = repo.get_persona_by_id(payload.gestor_persona_id)
    if not gestor:
        _http_404("Gestor no encontrado")

    proveedor = repo.get_proveedor_by_id(payload.proveedor_id)
    if not proveedor:
        _http_404("Proveedor no encontrado")

    _assert_persona_is_active_gestor_of_contrato(
        repo,
        contrato_id=incidencia.contrato_id,
        gestor_persona_id=payload.gestor_persona_id,
    )

    estado_anterior = incidencia.estado

    try:
        repo.close_active_assignments_by_tipo(
            incidencia_id=incidencia.id,
            tipo_asignacion="proveedor",
        )

        repo.create_asignacion_incidencia(
            asignacion_id=generate_asignacion_incidencia_id(),
            incidencia_id=incidencia.id,
            tipo_asignacion="proveedor",
            estado=ASIGNACION_ESTADO_ACTIVE,
            proveedor_id=payload.proveedor_id,
            asignado_por_persona_id=payload.gestor_persona_id,
            nota=payload.nota,
        )

        repo.update_incidencia_gestor_actual(
            incidencia=incidencia,
            gestor_actual_id=payload.gestor_persona_id,
        )
        repo.update_incidencia_proveedor_actual(
            incidencia=incidencia,
            proveedor_actual_id=payload.proveedor_id,
        )
        repo.update_incidencia_estado(
            incidencia=incidencia,
            estado="awaiting_provider_assignment" if not payload.proveedor_id else "under_review",
        )

        repo.create_historial_estado(
            historial_id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo=incidencia.estado,
            persona_cambia_id=payload.gestor_persona_id,
            rol_cambia="gestor",
            nota=payload.nota or f"Proveedor asignado: {proveedor.nombre}",
        )

        repo.commit()
        repo.refresh(incidencia)

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al asignar proveedor: {str(e.orig)}",
        )
    except Exception:
        repo.rollback()
        raise

    return BotIncidenciaActionResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Proveedor asignado correctamente",
    )


def schedule_visit_bot(
    db: Session,
    incidencia_id: str,
    payload: BotIncidenciaScheduleVisitRequest,
) -> BotIncidenciaScheduleVisitResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    gestor = repo.get_persona_by_id(payload.gestor_persona_id)
    if not gestor:
        _http_404("Gestor no encontrado")

    proveedor = repo.get_proveedor_by_id(payload.proveedor_id)
    if not proveedor:
        _http_404("Proveedor no encontrado")

    _assert_persona_is_active_gestor_of_contrato(
        repo,
        contrato_id=incidencia.contrato_id,
        gestor_persona_id=payload.gestor_persona_id,
    )

    if payload.fecha_fin_programada and payload.fecha_fin_programada < payload.fecha_inicio_programada:
        _http_400("La fecha fin no puede ser anterior a la fecha inicio")

    estado_anterior = incidencia.estado

    try:
        repo.update_incidencia_gestor_actual(
            incidencia=incidencia,
            gestor_actual_id=payload.gestor_persona_id,
        )
        repo.update_incidencia_proveedor_actual(
            incidencia=incidencia,
            proveedor_actual_id=payload.proveedor_id,
        )
        repo.update_incidencia_estado(
            incidencia=incidencia,
            estado="scheduled",
        )

        cita = repo.create_cita_incidencia(
            cita_id=generate_cita_incidencia_id(),
            incidencia_id=incidencia.id,
            proveedor_id=payload.proveedor_id,
            fecha_inicio_programada=payload.fecha_inicio_programada,
            fecha_fin_programada=payload.fecha_fin_programada,
            estado_inquilino=CITA_INQUILINO_PENDING_CONFIRMATION,
            estado_cita=CITA_ESTADO_PROPOSED,
            propuesta_por_persona_id=payload.gestor_persona_id,
            confirmada_por_persona_id=None,
            fecha_confirmacion=None,
            motivo_reprogramacion=payload.motivo_reprogramacion,
        )

        repo.create_historial_estado(
            historial_id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="scheduled",
            persona_cambia_id=payload.gestor_persona_id,
            rol_cambia="gestor",
            nota=payload.nota or "Visita programada",
        )

        repo.commit()
        repo.refresh(incidencia)
        repo.refresh(cita)

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al programar visita: {str(e.orig)}",
        )
    except Exception:
        repo.rollback()
        raise

    cita = repo.get_last_cita_by_incidencia(incidencia.id)

    return BotIncidenciaScheduleVisitResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        cita=_build_cita_resumen(cita),
        mensaje="Visita programada correctamente",
    )


def get_active_visit_for_tenant_bot(
    db: Session,
    incidencia_id: str,
    inquilino_persona_id: str,
) -> BotTenantActiveVisitResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    inquilino = repo.get_persona_by_id(inquilino_persona_id)
    if not inquilino:
        _http_404("Inquilino no encontrado")

    _assert_persona_is_inquilino_of_contrato(
        repo,
        contrato_id=incidencia.contrato_id,
        inquilino_persona_id=inquilino_persona_id,
    )

    cita = repo.get_active_cita_by_incidencia(incidencia.id)
    if not cita:
        _http_404("La incidencia no tiene una cita activa para gestionar")

    return BotTenantActiveVisitResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        cita=_build_cita_resumen(cita),
        mensaje="Cita activa recuperada correctamente",
    )


def tenant_visit_response_bot(
    db: Session,
    incidencia_id: str,
    payload: BotTenantVisitResponseRequest,
) -> BotTenantVisitResponseResponse:
    repo = IncidenciasBotRepository(db)

    incidencia = repo.get_incidencia_by_id(incidencia_id)
    if not incidencia:
        _http_404("Incidencia no encontrada")

    inquilino = repo.get_persona_by_id(payload.inquilino_persona_id)
    if not inquilino:
        _http_404("Inquilino no encontrado")

    _assert_persona_is_inquilino_of_contrato(
        repo,
        contrato_id=incidencia.contrato_id,
        inquilino_persona_id=payload.inquilino_persona_id,
    )

    cita_activa = repo.get_active_cita_by_incidencia(incidencia.id)
    if not cita_activa:
        _http_404("La incidencia no tiene una cita activa para responder")

    now = datetime.utcnow()
    accion = (payload.accion or "").strip().lower()
    estado_anterior = incidencia.estado

    try:
        if accion == TENANT_ACTION_CONFIRM:
            repo.update_cita_estado(cita_activa, CITA_ESTADO_CONFIRMED)
            repo.update_cita_estado_inquilino(cita_activa, CITA_INQUILINO_CONFIRMED)
            repo.update_cita_confirmacion(
                cita_activa,
                confirmada_por_persona_id=payload.inquilino_persona_id,
                fecha_confirmacion=now,
            )
            repo.update_incidencia_estado(incidencia, "scheduled")

            repo.create_historial_estado(
                historial_id=generate_historial_estado_id(),
                incidencia_id=incidencia.id,
                estado_anterior=estado_anterior,
                estado_nuevo="scheduled",
                persona_cambia_id=payload.inquilino_persona_id,
                rol_cambia="inquilino",
                nota=payload.nota or "Cita confirmada por el inquilino",
            )

            repo.commit()
            repo.refresh(incidencia)
            repo.refresh(cita_activa)

            return BotTenantVisitResponseResponse(
                ok=True,
                incidencia=_build_incidencia_resumen(incidencia),
                cita=_build_cita_resumen(cita_activa),
                mensaje="La cita ha quedado confirmada correctamente",
            )

        if accion == TENANT_ACTION_REJECT:
            repo.update_cita_estado(cita_activa, CITA_ESTADO_CANCELLED)
            repo.update_cita_estado_inquilino(cita_activa, CITA_INQUILINO_REJECTED)
            repo.update_cita_confirmacion(
                cita_activa,
                confirmada_por_persona_id=payload.inquilino_persona_id,
                fecha_confirmacion=now,
            )
            repo.update_incidencia_estado(incidencia, "under_review")

            repo.create_historial_estado(
                historial_id=generate_historial_estado_id(),
                incidencia_id=incidencia.id,
                estado_anterior=estado_anterior,
                estado_nuevo="under_review",
                persona_cambia_id=payload.inquilino_persona_id,
                rol_cambia="inquilino",
                nota=payload.nota or "Cita rechazada por el inquilino",
            )

            repo.commit()
            repo.refresh(incidencia)
            repo.refresh(cita_activa)

            return BotTenantVisitResponseResponse(
                ok=True,
                incidencia=_build_incidencia_resumen(incidencia),
                cita=_build_cita_resumen(cita_activa),
                mensaje="La cita ha quedado rechazada correctamente",
            )

        if accion == TENANT_ACTION_RESCHEDULE:
            if not payload.fecha_inicio_programada:
                _http_400("Debes indicar una nueva fecha/hora de inicio para reprogramar")

            if payload.fecha_fin_programada and payload.fecha_fin_programada < payload.fecha_inicio_programada:
                _http_400("La fecha fin no puede ser anterior a la fecha inicio")

            repo.update_cita_estado(cita_activa, CITA_ESTADO_RESCHEDULED)
            repo.update_cita_estado_inquilino(cita_activa, CITA_INQUILINO_RESCHEDULE_REQUESTED)
            repo.update_cita_confirmacion(
                cita_activa,
                confirmada_por_persona_id=payload.inquilino_persona_id,
                fecha_confirmacion=now,
            )
            repo.update_cita_motivo_reprogramacion(
                cita_activa,
                payload.motivo_reprogramacion,
            )

            nueva_cita = repo.create_cita_incidencia(
                cita_id=generate_cita_incidencia_id(),
                incidencia_id=incidencia.id,
                proveedor_id=cita_activa.proveedor_id,
                fecha_inicio_programada=payload.fecha_inicio_programada,
                fecha_fin_programada=payload.fecha_fin_programada,
                estado_inquilino=CITA_INQUILINO_PENDING_CONFIRMATION,
                estado_cita=CITA_ESTADO_PROPOSED,
                propuesta_por_persona_id=payload.inquilino_persona_id,
                confirmada_por_persona_id=None,
                fecha_confirmacion=None,
                motivo_reprogramacion=payload.motivo_reprogramacion,
            )

            repo.update_incidencia_estado(incidencia, "scheduled")

            repo.create_historial_estado(
                historial_id=generate_historial_estado_id(),
                incidencia_id=incidencia.id,
                estado_anterior=estado_anterior,
                estado_nuevo="scheduled",
                persona_cambia_id=payload.inquilino_persona_id,
                rol_cambia="inquilino",
                nota=payload.nota or "Reprogramación solicitada por el inquilino",
            )

            repo.commit()
            repo.refresh(incidencia)
            repo.refresh(nueva_cita)

            return BotTenantVisitResponseResponse(
                ok=True,
                incidencia=_build_incidencia_resumen(incidencia),
                cita=_build_cita_resumen(nueva_cita),
                mensaje="La reprogramación ha quedado registrada correctamente",
            )

        _http_400("Acción de inquilino no válida")

    except IntegrityError as e:
        repo.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al responder la cita: {str(e.orig)}",
        )
    except Exception:
        repo.rollback()
        raise