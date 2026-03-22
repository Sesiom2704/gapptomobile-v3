"""
Ruta: backend/app/api/v1/gestion_incidencias_router.py
Versión: 1.3.0
Descripción:
API v1 de gestión de incidencias para GAPPTO.

Funcionalidades incluidas:
- Listado de incidencias activas visibles para el usuario autenticado.
- Listado de incidencias por contrato del usuario autenticado.
- Detalle de incidencia por id.
- Listado de proveedores activos para incidencias.
- Asignación de proveedor a incidencia.
- Programación de visita para incidencia.
- Actualización controlada de campos editables de incidencia.
- Exposición de referencia de vivienda y dirección completa.
- Validación y actualización controlada de estado.
- Corrección de trazabilidad de historial al cambiar estado.
- Exposición de resultado de visita en resumen y detalle.
- Exposición de presupuestos asociados a la incidencia.
- Registro de resultado de visita desde GAPPTO como apoyo operativo.
- Creación de presupuesto asociado a incidencia.
- Decisión de presupuesto por propietario autenticado.
- Confirmación de resolución por inquilino autenticado.
- Cierre formal de incidencia por gestor autenticado.

Notas de diseño:
- Esta capa está pensada para GAPPTO Mobile / backoffice, no para BOT.
- La autenticación y autorización se resuelven con require_user.
- No se asume que user.id sea igual a persona.id.
- Para la trazabilidad funcional de acciones operativas:
  - se intenta resolver una persona gestora activa del contrato perteneciente al usuario;
  - si no existe una única persona gestora clara, se devuelve error funcional explícito.
- La edición controlada no permite cambios de proveedor/cita por este endpoint.
- GAPPTO sigue siendo canal de consulta y apoyo; estos endpoints se exponen
  para mantener coherencia funcional y reutilización de lógica de dominio.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.gestion_incidencias import (
    GestionCitaIncidenciaItem,
    GestionCitaIncidenciaResumen,
    GestionCloseIncidentRequest,
    GestionCloseIncidentResponse,
    GestionCreateIncidentQuoteRequest,
    GestionCreateIncidentQuoteResponse,
    GestionDecideIncidentQuoteRequest,
    GestionDecideIncidentQuoteResponse,
    GestionHistorialEstadoIncidenciaItem,
    GestionIncidentQuoteSummary,
    GestionIncidenciaActionResponse,
    GestionIncidenciaAssignProviderRequest,
    GestionIncidenciaDetailResponse,
    GestionIncidenciaListItem,
    GestionIncidenciaListResponse,
    GestionIncidenciaResumen,
    GestionIncidenciaScheduleVisitRequest,
    GestionIncidenciaScheduleVisitResponse,
    GestionIncidenciaUpdateRequest,
    GestionIncidenciaUpdateResponse,
    GestionProveedorListItem,
    GestionProveedorListResponse,
    GestionResponsableActual,
    GestionTenantResolutionConfirmationRequest,
    GestionTenantResolutionConfirmationResponse,
    GestionVisitResultRequest,
    GestionVisitResultResponse,
)
from backend.app.utils.bot.ids import (
    generate_asignacion_incidencia_id,
    generate_cita_incidencia_id,
    generate_historial_estado_id,
    generate_nota_incidencia_id,
    generate_presupuesto_incidencia_id,
)

router = APIRouter(
    prefix="/gestion-incidencias",
    tags=["gestion-incidencias"],
)

ACTIVE_ESTADOS = {
    "new",
    "under_review",
    "awaiting_provider_assignment",
    "scheduled",
    "in_progress",
    "awaiting_parts",
    "pending_follow_up",
}

PROVEEDOR_RAMA_INCIDENCIAS = "servicios_alquileres"

ASIGNACION_ESTADO_ACTIVE = "active"
ASIGNACION_ESTADO_INACTIVE = "inactive"

CITA_ESTADO_PROPOSED = "proposed"
CITA_ESTADO_COMPLETED = "completed"
CITA_ESTADO_MISSED = "missed"

CITA_INQUILINO_PENDING_CONFIRMATION = "pending_confirmation"

VISIT_RESULT_LABELS = {
    "resolved_on_visit": "Resuelto en visita",
    "requires_quote": "Requiere presupuesto",
    "requires_new_visit": "Requiere nueva visita",
    "no_show": "No asistencia",
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

PRIORIDAD_LABELS = {
    "low": "Baja",
    "normal": "Media",
    "high": "Alta",
    "urgent": "Urgente",
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

ALLOWED_ESTADOS = {
    "new",
    "under_review",
    "awaiting_provider_assignment",
    "awaiting_quote",
    "quote_submitted",
    "quote_approved",
    "scheduled",
    "tenant_confirmed",
    "tenant_reschedule_requested",
    "in_progress",
    "awaiting_parts",
    "pending_follow_up",
    "resolved",
    "closed",
    "cancelled",
}


def _estado_label(value: Optional[str]) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_LABELS.get(value, value)


def _prioridad_label(value: Optional[str]) -> str:
    if not value:
        return "Sin prioridad"
    return PRIORIDAD_LABELS.get(value, value)


def _estado_cita_label(value: Optional[str]) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_CITA_LABELS.get(value, value)


def _estado_inquilino_label(value: Optional[str]) -> str:
    if not value:
        return "Sin estado"
    return ESTADO_INQUILINO_LABELS.get(value, value)


def _resultado_visita_label(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return VISIT_RESULT_LABELS.get(value, value)


def _validate_estado_incidencia(value: Optional[str]) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in ALLOWED_ESTADOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estado de incidencia no válido",
        )
    return normalized


def _get_owned_contrato(
    db: Session,
    contrato_id: str,
    current_user: models.User,
) -> models.Contrato:
    row = (
        db.query(models.Contrato)
        .options(
            joinedload(models.Contrato.patrimonio_rel),
            joinedload(models.Contrato.participantes).joinedload(models.ContratoParticipante.persona),
        )
        .filter(
            models.Contrato.id == contrato_id,
            models.Contrato.user_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contrato no encontrado",
        )
    return row


def _get_owned_incidencia(
    db: Session,
    incidencia_id: str,
    current_user: models.User,
) -> models.Incidencia:
    row = (
        db.query(models.Incidencia)
        .join(models.Contrato, models.Contrato.id == models.Incidencia.contrato_id)
        .filter(
            models.Incidencia.id == incidencia_id,
            models.Contrato.user_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incidencia no encontrada",
        )
    return row


def _get_owned_incidencia_with_context(
    db: Session,
    incidencia_id: str,
    current_user: models.User,
) -> models.Incidencia:
    row = (
        db.query(models.Incidencia)
        .options(
            joinedload(models.Incidencia.contrato),
            joinedload(models.Incidencia.patrimonio),
            joinedload(models.Incidencia.persona_reporta),
            joinedload(models.Incidencia.proveedor_actual),
            joinedload(models.Incidencia.gestor_actual),
            joinedload(models.Incidencia.supervisor_actual),
            joinedload(models.Incidencia.historial_estados).joinedload(
                models.HistorialEstadoIncidencia.persona_cambia
            ),
            joinedload(models.Incidencia.citas).joinedload(models.CitaIncidencia.proveedor),
            joinedload(models.Incidencia.citas).joinedload(models.CitaIncidencia.propuesta_por),
            joinedload(models.Incidencia.citas).joinedload(models.CitaIncidencia.confirmada_por),
            joinedload(models.Incidencia.presupuestos),
        )
        .join(models.Contrato, models.Contrato.id == models.Incidencia.contrato_id)
        .filter(
            models.Incidencia.id == incidencia_id,
            models.Contrato.user_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incidencia no encontrada",
        )
    return row


def _get_owned_proveedor(
    db: Session,
    proveedor_id: str,
    current_user: models.User,
) -> models.Proveedor:
    row = (
        db.query(models.Proveedor)
        .filter(models.Proveedor.id == proveedor_id)
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )

    allowed = (
        row.user_id == current_user.id
        or row.user_id is None
        or row.user_id == 2
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )
    return row


def _resolve_actor_persona_for_contrato(
    db: Session,
    contrato_id: str,
    current_user: models.User,
) -> models.Persona:
    rows = (
        db.query(models.Persona)
        .join(
            models.ContratoParticipante,
            models.ContratoParticipante.persona_id == models.Persona.id,
        )
        .filter(
            models.Persona.user_id == current_user.id,
            models.Persona.inactivatedon.is_(None),
            models.ContratoParticipante.contrato_id == contrato_id,
            models.ContratoParticipante.rol == "gestor",
            models.ContratoParticipante.inactivatedon.is_(None),
        )
        .order_by(models.Persona.createon.asc())
        .all()
    )

    if len(rows) == 1:
        return rows[0]

    if len(rows) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No se ha podido resolver una persona gestora activa del contrato "
                "para el usuario autenticado. Debes tener una persona con rol gestor "
                "activa en ese contrato."
            ),
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Hay más de una persona gestora activa del contrato asociada al usuario. "
            "No se puede decidir automáticamente cuál usar para trazabilidad."
        ),
    )


def _resolve_owner_persona_for_contrato(
    db: Session,
    contrato_id: str,
    current_user: models.User,
) -> models.Persona:
    rows = (
        db.query(models.Persona)
        .join(
            models.ContratoParticipante,
            models.ContratoParticipante.persona_id == models.Persona.id,
        )
        .filter(
            models.Persona.user_id == current_user.id,
            models.Persona.inactivatedon.is_(None),
            models.ContratoParticipante.contrato_id == contrato_id,
            models.ContratoParticipante.rol == "propietario",
            models.ContratoParticipante.inactivatedon.is_(None),
        )
        .order_by(models.Persona.createon.asc())
        .all()
    )

    if len(rows) == 1:
        return rows[0]

    if len(rows) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No se ha podido resolver una persona propietaria activa del contrato "
                "para el usuario autenticado."
            ),
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Hay más de una persona propietaria activa del contrato asociada al usuario. "
            "No se puede decidir automáticamente cuál usar para trazabilidad."
        ),
    )


def _resolve_tenant_persona_for_contrato(
    db: Session,
    contrato_id: str,
    current_user: models.User,
) -> models.Persona:
    rows = (
        db.query(models.Persona)
        .join(
            models.ContratoParticipante,
            models.ContratoParticipante.persona_id == models.Persona.id,
        )
        .filter(
            models.Persona.user_id == current_user.id,
            models.Persona.inactivatedon.is_(None),
            models.ContratoParticipante.contrato_id == contrato_id,
            models.ContratoParticipante.rol == "inquilino",
            models.ContratoParticipante.inactivatedon.is_(None),
        )
        .order_by(models.Persona.createon.asc())
        .all()
    )

    if len(rows) == 1:
        return rows[0]

    if len(rows) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No se ha podido resolver una persona inquilina activa del contrato "
                "para el usuario autenticado."
            ),
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Hay más de una persona inquilina activa del contrato asociada al usuario. "
            "No se puede decidir automáticamente cuál usar para trazabilidad."
        ),
    )


def _build_incidencia_resumen(incidencia: models.Incidencia) -> GestionIncidenciaResumen:
    patrimonio = getattr(incidencia, "patrimonio", None)

    return GestionIncidenciaResumen(
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
        referencia_vivienda=getattr(patrimonio, "referencia", None),
        direccion_completa=getattr(patrimonio, "direccion_completa", None),
    )


def _build_cita_resumen(
    cita: Optional[models.CitaIncidencia],
) -> Optional[GestionCitaIncidenciaResumen]:
    if not cita:
        return None

    proveedor = getattr(cita, "proveedor", None)

    return GestionCitaIncidenciaResumen(
        id=cita.id,
        proveedor_id=cita.proveedor_id,
        proveedor_nombre=proveedor.nombre if proveedor else None,
        fecha_inicio_programada=cita.fecha_inicio_programada,
        fecha_fin_programada=cita.fecha_fin_programada,
        estado_cita=cita.estado_cita,
        estado_cita_label=_estado_cita_label(cita.estado_cita),
        estado_inquilino=cita.estado_inquilino,
        estado_inquilino_label=_estado_inquilino_label(cita.estado_inquilino),
        resultado_visita=getattr(cita, "resultado_visita", None),
        resultado_visita_label=_resultado_visita_label(getattr(cita, "resultado_visita", None)),
    )


def _build_historial_item(
    item: models.HistorialEstadoIncidencia,
) -> GestionHistorialEstadoIncidenciaItem:
    persona = getattr(item, "persona_cambia", None)

    return GestionHistorialEstadoIncidenciaItem(
        id=item.id,
        estado_anterior=item.estado_anterior,
        estado_anterior_label=_estado_label(item.estado_anterior) if item.estado_anterior else None,
        estado_nuevo=item.estado_nuevo,
        estado_nuevo_label=_estado_label(item.estado_nuevo),
        persona_cambia_id=item.persona_cambia_id,
        persona_cambia_nombre=persona.nombre_completo if persona else None,
        rol_cambia=item.rol_cambia,
        nota=item.nota,
        fecha_creacion=item.fecha_creacion,
    )


def _build_cita_item(
    cita: models.CitaIncidencia,
) -> GestionCitaIncidenciaItem:
    proveedor = getattr(cita, "proveedor", None)
    propuesta_por = getattr(cita, "propuesta_por", None)
    confirmada_por = getattr(cita, "confirmada_por", None)

    return GestionCitaIncidenciaItem(
        id=cita.id,
        proveedor_id=cita.proveedor_id,
        proveedor_nombre=proveedor.nombre if proveedor else None,
        fecha_inicio_programada=cita.fecha_inicio_programada,
        fecha_fin_programada=cita.fecha_fin_programada,
        estado_cita=cita.estado_cita,
        estado_cita_label=_estado_cita_label(cita.estado_cita),
        estado_inquilino=cita.estado_inquilino,
        estado_inquilino_label=_estado_inquilino_label(cita.estado_inquilino),
        propuesta_por_persona_id=cita.propuesta_por_persona_id,
        propuesta_por_persona_nombre=propuesta_por.nombre_completo if propuesta_por else None,
        confirmada_por_persona_id=cita.confirmada_por_persona_id,
        confirmada_por_persona_nombre=confirmada_por.nombre_completo if confirmada_por else None,
        fecha_confirmacion=cita.fecha_confirmacion,
        motivo_reprogramacion=cita.motivo_reprogramacion,
        resultado_visita=getattr(cita, "resultado_visita", None),
        resultado_visita_label=_resultado_visita_label(getattr(cita, "resultado_visita", None)),
        created_at=cita.created_at,
        updated_at=cita.updated_at,
    )


def _build_quote_summary(
    presupuesto: models.PresupuestoIncidencia,
) -> GestionIncidentQuoteSummary:
    return GestionIncidentQuoteSummary(
        id=presupuesto.id,
        incidencia_id=presupuesto.incidencia_id,
        proveedor_id=presupuesto.proveedor_id,
        importe=float(presupuesto.importe),
        moneda=presupuesto.moneda,
        descripcion=presupuesto.descripcion,
        valido_hasta=presupuesto.valido_hasta,
        estado=presupuesto.estado,
        fecha_envio=presupuesto.fecha_envio,
        fecha_revision=presupuesto.fecha_revision,
        enviado_por_persona_id=presupuesto.enviado_por_persona_id,
        revisado_por_persona_id=presupuesto.revisado_por_persona_id,
        nota_aprobacion=presupuesto.nota_aprobacion,
        nota_rechazo=presupuesto.nota_rechazo,
    )


def _get_last_cita_by_incidencia(
    db: Session,
    incidencia_id: str,
) -> Optional[models.CitaIncidencia]:
    return (
        db.query(models.CitaIncidencia)
        .options(joinedload(models.CitaIncidencia.proveedor))
        .filter(models.CitaIncidencia.incidencia_id == incidencia_id)
        .order_by(models.CitaIncidencia.created_at.desc())
        .first()
    )


def _get_quote_by_id_and_incidencia(
    db: Session,
    incidencia_id: str,
    presupuesto_id: str,
) -> models.PresupuestoIncidencia:
    row = (
        db.query(models.PresupuestoIncidencia)
        .filter(
            models.PresupuestoIncidencia.id == presupuesto_id,
            models.PresupuestoIncidencia.incidencia_id == incidencia_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Presupuesto no encontrado",
        )
    return row


def _insert_nota_incidencia(
    db: Session,
    incidencia_id: str,
    autor_persona_id: Optional[str],
    autor_rol: Optional[str],
    tipo_nota: str,
    nota: str,
    visible_para_inquilino: bool = False,
) -> None:
    db.add(
        models.NotaIncidencia(
            id=generate_nota_incidencia_id(),
            incidencia_id=incidencia_id,
            autor_persona_id=autor_persona_id,
            autor_rol=autor_rol,
            tipo_nota=tipo_nota,
            nota=nota,
            visible_para_inquilino=visible_para_inquilino,
        )
    )


def _insert_historial_estado(
    db: Session,
    incidencia_id: str,
    estado_anterior: Optional[str],
    estado_nuevo: str,
    persona_cambia_id: Optional[str],
    rol_cambia: Optional[str],
    nota: str,
) -> None:
    db.add(
        models.HistorialEstadoIncidencia(
            id=generate_historial_estado_id(),
            incidencia_id=incidencia_id,
            estado_anterior=estado_anterior,
            estado_nuevo=estado_nuevo,
            persona_cambia_id=persona_cambia_id,
            rol_cambia=rol_cambia,
            nota=nota,
        )
    )


def _build_incidencia_detail_response(
    db: Session,
    incidencia: models.Incidencia,
) -> GestionIncidenciaDetailResponse:
    responsable_actual = None
    if incidencia.proveedor_actual_id:
        responsable_actual = GestionResponsableActual(
            tipo="proveedor",
            id=incidencia.proveedor_actual_id,
            nombre=incidencia.proveedor_actual.nombre if incidencia.proveedor_actual else None,
        )
    elif incidencia.gestor_actual_id:
        responsable_actual = GestionResponsableActual(
            tipo="gestor",
            id=incidencia.gestor_actual_id,
            nombre=incidencia.gestor_actual.nombre_completo if incidencia.gestor_actual else None,
        )
    elif incidencia.supervisor_actual_id:
        responsable_actual = GestionResponsableActual(
            tipo="supervisor",
            id=incidencia.supervisor_actual_id,
            nombre=incidencia.supervisor_actual.nombre_completo if incidencia.supervisor_actual else None,
        )

    ultima_cita = _get_last_cita_by_incidencia(db, incidencia.id)

    historial_sorted = sorted(
        list(incidencia.historial_estados or []),
        key=lambda x: x.fecha_creacion or datetime.min,
        reverse=True,
    )

    citas_sorted = sorted(
        list(incidencia.citas or []),
        key=lambda x: x.created_at or datetime.min,
        reverse=True,
    )

    presupuestos_sorted = sorted(
        list(getattr(incidencia, "presupuestos", []) or []),
        key=lambda x: x.fecha_envio or datetime.min,
        reverse=True,
    )

    patrimonio = getattr(incidencia, "patrimonio", None)

    return GestionIncidenciaDetailResponse(
        ok=True,
        id=incidencia.id,
        codigo=incidencia.codigo,
        contrato_id=incidencia.contrato_id,
        patrimonio_id=incidencia.patrimonio_id,
        referencia_vivienda=getattr(patrimonio, "referencia", None),
        direccion_completa=getattr(patrimonio, "direccion_completa", None),
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
        historial=[_build_historial_item(x) for x in historial_sorted],
        citas=[_build_cita_item(x) for x in citas_sorted],
        presupuestos=[_build_quote_summary(x) for x in presupuestos_sorted],
    )


def _close_active_provider_assignments(db: Session, incidencia_id: str) -> None:
    rows = (
        db.query(models.AsignacionIncidencia)
        .filter(
            models.AsignacionIncidencia.incidencia_id == incidencia_id,
            models.AsignacionIncidencia.tipo_asignacion == "proveedor",
            models.AsignacionIncidencia.estado == ASIGNACION_ESTADO_ACTIVE,
            models.AsignacionIncidencia.fecha_desasignacion.is_(None),
        )
        .all()
    )

    now = datetime.utcnow()
    for row in rows:
        row.estado = ASIGNACION_ESTADO_INACTIVE
        row.fecha_desasignacion = now


@router.get(
    "/incidencias/activas",
    response_model=GestionIncidenciaListResponse,
    summary="Listar incidencias activas visibles para el usuario",
)
def listar_incidencias_activas(
    contrato_id: Optional[str] = Query(
        None,
        description="Filtro opcional por contrato concreto del usuario.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    query = (
        db.query(
            models.Incidencia,
            models.Proveedor,
            models.Persona,
        )
        .options(joinedload(models.Incidencia.patrimonio))
        .join(models.Contrato, models.Contrato.id == models.Incidencia.contrato_id)
        .outerjoin(
            models.Proveedor,
            models.Proveedor.id == models.Incidencia.proveedor_actual_id,
        )
        .outerjoin(
            models.Persona,
            models.Persona.id == models.Incidencia.gestor_actual_id,
        )
        .filter(
            models.Contrato.user_id == current_user.id,
            models.Incidencia.estado.in_(list(ACTIVE_ESTADOS)),
        )
    )

    if contrato_id:
        _get_owned_contrato(db, contrato_id, current_user)
        query = query.filter(models.Incidencia.contrato_id == contrato_id)

    rows = query.order_by(models.Incidencia.fecha_creacion.desc()).all()

    items = []
    for incidencia, proveedor, gestor_actual in rows:
        patrimonio = getattr(incidencia, "patrimonio", None)

        items.append(
            GestionIncidenciaListItem(
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
                localidad=getattr(patrimonio, "localidad", None),
                contrato_id=incidencia.contrato_id,
                patrimonio_id=incidencia.patrimonio_id,
                referencia_vivienda=getattr(patrimonio, "referencia", None),
                direccion_completa=getattr(patrimonio, "direccion_completa", None),
            )
        )

    return GestionIncidenciaListResponse(ok=True, items=items)


@router.get(
    "/contratos/{contrato_id}/incidencias",
    response_model=GestionIncidenciaListResponse,
    summary="Listar incidencias de un contrato del usuario",
)
def listar_incidencias_por_contrato(
    contrato_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _get_owned_contrato(db, contrato_id, current_user)

    rows = (
        db.query(
            models.Incidencia,
            models.Proveedor,
            models.Persona,
        )
        .options(joinedload(models.Incidencia.patrimonio))
        .outerjoin(
            models.Proveedor,
            models.Proveedor.id == models.Incidencia.proveedor_actual_id,
        )
        .outerjoin(
            models.Persona,
            models.Persona.id == models.Incidencia.gestor_actual_id,
        )
        .filter(models.Incidencia.contrato_id == contrato_id)
        .order_by(models.Incidencia.fecha_creacion.desc())
        .all()
    )

    items = []
    for incidencia, proveedor, gestor_actual in rows:
        patrimonio = getattr(incidencia, "patrimonio", None)

        items.append(
            GestionIncidenciaListItem(
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
                localidad=getattr(patrimonio, "localidad", None),
                contrato_id=incidencia.contrato_id,
                patrimonio_id=incidencia.patrimonio_id,
                referencia_vivienda=getattr(patrimonio, "referencia", None),
                direccion_completa=getattr(patrimonio, "direccion_completa", None),
            )
        )

    return GestionIncidenciaListResponse(ok=True, items=items)


@router.get(
    "/incidencias/{incidencia_id}",
    response_model=GestionIncidenciaDetailResponse,
    summary="Obtener detalle de incidencia",
)
def get_incidencia(
    incidencia_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    return _build_incidencia_detail_response(db, incidencia)


@router.get(
    "/proveedores",
    response_model=GestionProveedorListResponse,
    summary="Listar proveedores operativos para incidencias",
)
def listar_proveedores(
    only_active: bool = Query(True, description="Filtrar solo proveedores activos."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    query = db.query(models.Proveedor).filter(
        models.Proveedor.rama_id == PROVEEDOR_RAMA_INCIDENCIAS,
    )

    if only_active:
        query = query.filter(models.Proveedor.activo.is_(True))

    query = query.filter(
        (models.Proveedor.user_id == current_user.id)
        | (models.Proveedor.user_id.is_(None))
        | (models.Proveedor.user_id == 2)
    )

    rows = query.order_by(models.Proveedor.nombre.asc()).all()

    items = [
        GestionProveedorListItem(
            id=row.id,
            nombre=row.nombre,
            telefono=row.telefono,
            email=row.email,
            localidad=row.localidad,
            activo=bool(row.activo),
        )
        for row in rows
    ]

    return GestionProveedorListResponse(ok=True, items=items)


@router.put(
    "/incidencias/{incidencia_id}",
    response_model=GestionIncidenciaUpdateResponse,
    summary="Actualizar campos editables de una incidencia",
)
def update_incidencia(
    incidencia_id: str,
    payload: GestionIncidenciaUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)

    estado_anterior = incidencia.estado
    changed_fields: list[str] = []

    if payload.titulo is not None:
        new_value = payload.titulo.strip() or None
        if incidencia.titulo != new_value:
            incidencia.titulo = new_value
            changed_fields.append("titulo")

    if payload.descripcion is not None:
        new_value = payload.descripcion.strip()
        if not new_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La descripción no puede quedar vacía",
            )
        if incidencia.descripcion != new_value:
            incidencia.descripcion = new_value
            changed_fields.append("descripcion")

    if payload.telefono_inquilino_snapshot is not None:
        new_value = payload.telefono_inquilino_snapshot.strip() or None
        if incidencia.telefono_inquilino_snapshot != new_value:
            incidencia.telefono_inquilino_snapshot = new_value
            changed_fields.append("telefono_inquilino_snapshot")

    if payload.notas_acceso is not None:
        new_value = payload.notas_acceso.strip() or None
        if incidencia.notas_acceso != new_value:
            incidencia.notas_acceso = new_value
            changed_fields.append("notas_acceso")

    if payload.estado is not None:
        new_estado = _validate_estado_incidencia(payload.estado)
        if incidencia.estado != new_estado:
            incidencia.estado = new_estado
            changed_fields.append("estado")

    if not changed_fields:
        return GestionIncidenciaUpdateResponse(
            ok=True,
            incidencia=_build_incidencia_detail_response(db, incidencia),
            mensaje="No se han detectado cambios en la incidencia",
        )

    try:
        historial = models.HistorialEstadoIncidencia(
            id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo=incidencia.estado,
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=payload.nota_operativa
            or f"Edición manual desde GAPPTO. Campos modificados: {', '.join(changed_fields)}",
        )
        db.add(historial)

        db.commit()
        db.refresh(incidencia)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al actualizar la incidencia: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionIncidenciaUpdateResponse(
        ok=True,
        incidencia=_build_incidencia_detail_response(db, incidencia),
        mensaje="Incidencia actualizada correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/assign-provider",
    response_model=GestionIncidenciaActionResponse,
    summary="Asignar proveedor a una incidencia",
)
def assign_provider(
    incidencia_id: str,
    payload: GestionIncidenciaAssignProviderRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    proveedor = _get_owned_proveedor(db, payload.proveedor_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)

    estado_anterior = incidencia.estado

    try:
        _close_active_provider_assignments(db, incidencia.id)

        asignacion = models.AsignacionIncidencia(
            id=generate_asignacion_incidencia_id(),
            incidencia_id=incidencia.id,
            proveedor_id=payload.proveedor_id,
            tipo_asignacion="proveedor",
            estado=ASIGNACION_ESTADO_ACTIVE,
            asignado_por_persona_id=actor_persona.id,
            nota=payload.nota,
        )
        db.add(asignacion)

        incidencia.gestor_actual_id = actor_persona.id
        incidencia.proveedor_actual_id = payload.proveedor_id
        incidencia.estado = "under_review"

        historial = models.HistorialEstadoIncidencia(
            id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="under_review",
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=payload.nota or f"Proveedor asignado desde GAPPTO: {proveedor.nombre}",
        )
        db.add(historial)

        db.commit()
        db.refresh(incidencia)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al asignar proveedor: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionIncidenciaActionResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Proveedor asignado correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/schedule-visit",
    response_model=GestionIncidenciaScheduleVisitResponse,
    summary="Programar visita para una incidencia",
)
def schedule_visit(
    incidencia_id: str,
    payload: GestionIncidenciaScheduleVisitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    proveedor = _get_owned_proveedor(db, payload.proveedor_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)

    if payload.fecha_fin_programada and payload.fecha_fin_programada < payload.fecha_inicio_programada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha fin no puede ser anterior a la fecha inicio",
        )

    estado_anterior = incidencia.estado

    try:
        incidencia.gestor_actual_id = actor_persona.id
        incidencia.proveedor_actual_id = payload.proveedor_id
        incidencia.estado = "scheduled"

        cita = models.CitaIncidencia(
            id=generate_cita_incidencia_id(),
            incidencia_id=incidencia.id,
            proveedor_id=payload.proveedor_id,
            fecha_inicio_programada=payload.fecha_inicio_programada,
            fecha_fin_programada=payload.fecha_fin_programada,
            estado_inquilino=CITA_INQUILINO_PENDING_CONFIRMATION,
            estado_cita=CITA_ESTADO_PROPOSED,
            propuesta_por_persona_id=actor_persona.id,
            confirmada_por_persona_id=None,
            fecha_confirmacion=None,
            motivo_reprogramacion=payload.motivo_reprogramacion,
        )
        db.add(cita)

        historial = models.HistorialEstadoIncidencia(
            id=generate_historial_estado_id(),
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="scheduled",
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=payload.nota or f"Visita programada desde GAPPTO con proveedor {proveedor.nombre}",
        )
        db.add(historial)

        db.commit()
        db.refresh(incidencia)
        db.refresh(cita)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al programar visita: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionIncidenciaScheduleVisitResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        cita=_build_cita_resumen(cita),
        mensaje="Visita programada correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/visit-results",
    response_model=GestionVisitResultResponse,
    summary="Registrar resultado de visita para una incidencia",
)
def register_visit_result(
    incidencia_id: str,
    payload: GestionVisitResultRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)

    if actor_persona.id != payload.gestor_persona_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona gestora indicada no corresponde con el usuario autenticado",
        )

    cita = (
        db.query(models.CitaIncidencia)
        .options(joinedload(models.CitaIncidencia.proveedor))
        .filter(
            models.CitaIncidencia.id == payload.cita_id,
            models.CitaIncidencia.incidencia_id == incidencia_id,
        )
        .first()
    )
    if not cita:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cita no encontrada para la incidencia",
        )

    if cita.estado_cita == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede registrar resultado sobre una cita cancelada",
        )

    estado_anterior = incidencia.estado

    if payload.resultado_visita == "resolved_on_visit":
        nuevo_estado = "pending_follow_up"
        nuevo_estado_cita = CITA_ESTADO_COMPLETED
    elif payload.resultado_visita == "requires_quote":
        nuevo_estado = "awaiting_quote"
        nuevo_estado_cita = CITA_ESTADO_COMPLETED
    elif payload.resultado_visita == "requires_new_visit":
        nuevo_estado = "pending_follow_up"
        nuevo_estado_cita = CITA_ESTADO_COMPLETED
    elif payload.resultado_visita == "no_show":
        nuevo_estado = "pending_follow_up"
        nuevo_estado_cita = CITA_ESTADO_MISSED
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resultado de visita no válido",
        )

    try:
        cita.estado_cita = nuevo_estado_cita
        cita.resultado_visita = payload.resultado_visita

        incidencia.estado = nuevo_estado
        incidencia.gestor_actual_id = actor_persona.id

        _insert_nota_incidencia(
            db=db,
            incidencia_id=incidencia.id,
            autor_persona_id=actor_persona.id,
            autor_rol="gestor",
            tipo_nota="resultado_visita",
            nota=payload.nota,
            visible_para_inquilino=payload.visible_para_inquilino,
        )

        _insert_historial_estado(
            db=db,
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo=nuevo_estado,
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=f"Resultado de visita registrado: {payload.resultado_visita}. {payload.nota}",
        )

        db.commit()
        db.refresh(incidencia)
        db.refresh(cita)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al registrar resultado de visita: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionVisitResultResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        cita=_build_cita_resumen(cita),
        mensaje="Resultado de visita registrado correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/quotes",
    response_model=GestionCreateIncidentQuoteResponse,
    summary="Crear presupuesto para una incidencia",
)
def create_incident_quote(
    incidencia_id: str,
    payload: GestionCreateIncidentQuoteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)
    _get_owned_proveedor(db, payload.proveedor_id, current_user)

    if actor_persona.id != payload.gestor_persona_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona gestora indicada no corresponde con el usuario autenticado",
        )

    if incidencia.estado != "awaiting_quote":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La incidencia no está en estado pendiente de presupuesto",
        )

    active_sent_quote = (
        db.query(models.PresupuestoIncidencia)
        .filter(
            models.PresupuestoIncidencia.incidencia_id == incidencia_id,
            models.PresupuestoIncidencia.estado == "sent",
        )
        .first()
    )
    if active_sent_quote:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un presupuesto enviado pendiente de decisión",
        )

    estado_anterior = incidencia.estado

    try:
        presupuesto = models.PresupuestoIncidencia(
            id=generate_presupuesto_incidencia_id(),
            incidencia_id=incidencia.id,
            proveedor_id=payload.proveedor_id,
            importe=payload.importe,
            moneda=payload.moneda,
            descripcion=payload.descripcion,
            valido_hasta=payload.valido_hasta,
            estado="sent",
            enviado_por_persona_id=actor_persona.id,
            fecha_envio=datetime.utcnow(),
            revisado_por_persona_id=None,
            fecha_revision=None,
            nota_aprobacion=None,
            nota_rechazo=None,
        )
        db.add(presupuesto)

        incidencia.estado = "quote_submitted"
        incidencia.gestor_actual_id = actor_persona.id
        incidencia.proveedor_actual_id = payload.proveedor_id

        _insert_nota_incidencia(
            db=db,
            incidencia_id=incidencia.id,
            autor_persona_id=actor_persona.id,
            autor_rol="gestor",
            tipo_nota="presupuesto_emitido",
            nota=payload.nota or f"Presupuesto emitido por importe {payload.importe} {payload.moneda}",
            visible_para_inquilino=False,
        )

        _insert_historial_estado(
            db=db,
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="quote_submitted",
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=payload.nota or "Presupuesto generado y enviado para aprobación",
        )

        db.commit()
        db.refresh(incidencia)
        db.refresh(presupuesto)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al crear presupuesto: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionCreateIncidentQuoteResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        presupuesto=_build_quote_summary(presupuesto),
        mensaje="Presupuesto creado correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/quotes/{presupuesto_id}/decision",
    response_model=GestionDecideIncidentQuoteResponse,
    summary="Aprobar o rechazar presupuesto de una incidencia",
)
def decide_incident_quote(
    incidencia_id: str,
    presupuesto_id: str,
    payload: GestionDecideIncidentQuoteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    owner_persona = _resolve_owner_persona_for_contrato(db, incidencia.contrato_id, current_user)

    if owner_persona.id != payload.propietario_persona_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona propietaria indicada no corresponde con el usuario autenticado",
        )

    presupuesto = _get_quote_by_id_and_incidencia(db, incidencia_id, presupuesto_id)

    if presupuesto.estado != "sent":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El presupuesto ya no está pendiente de decisión",
        )

    estado_anterior = incidencia.estado

    try:
        presupuesto.revisado_por_persona_id = owner_persona.id
        presupuesto.fecha_revision = datetime.utcnow()

        if payload.decision == "approved":
            presupuesto.estado = "approved"
            presupuesto.nota_aprobacion = payload.nota
            incidencia.estado = "quote_approved"
            nuevo_estado = "quote_approved"
            tipo_nota = "presupuesto_aprobado"
        else:
            presupuesto.estado = "rejected"
            presupuesto.nota_rechazo = payload.nota
            incidencia.estado = "awaiting_quote"
            nuevo_estado = "awaiting_quote"
            tipo_nota = "presupuesto_rechazado"

        _insert_nota_incidencia(
            db=db,
            incidencia_id=incidencia.id,
            autor_persona_id=owner_persona.id,
            autor_rol="propietario",
            tipo_nota=tipo_nota,
            nota=payload.nota,
            visible_para_inquilino=False,
        )

        _insert_historial_estado(
            db=db,
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo=nuevo_estado,
            persona_cambia_id=owner_persona.id,
            rol_cambia="inquilino" if False else "supervisor",
            nota=f"Decisión sobre presupuesto: {payload.decision}. {payload.nota}",
        )

        db.commit()
        db.refresh(incidencia)
        db.refresh(presupuesto)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al decidir presupuesto: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionDecideIncidentQuoteResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        presupuesto=_build_quote_summary(presupuesto),
        mensaje="Decisión de presupuesto registrada correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/tenant-confirmation",
    response_model=GestionTenantResolutionConfirmationResponse,
    summary="Confirmar resolución de incidencia por inquilino",
)
def confirm_tenant_resolution(
    incidencia_id: str,
    payload: GestionTenantResolutionConfirmationRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    tenant_persona = _resolve_tenant_persona_for_contrato(db, incidencia.contrato_id, current_user)

    if tenant_persona.id != payload.inquilino_persona_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona inquilina indicada no corresponde con el usuario autenticado",
        )

    if incidencia.estado != "pending_follow_up":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La incidencia no está pendiente de confirmación/seguimiento",
        )

    estado_anterior = incidencia.estado
    nuevo_estado = "resolved" if payload.confirmado else "pending_follow_up"

    try:
        incidencia.estado = nuevo_estado

        _insert_nota_incidencia(
            db=db,
            incidencia_id=incidencia.id,
            autor_persona_id=tenant_persona.id,
            autor_rol="inquilino",
            tipo_nota="confirmacion_inquilino",
            nota=payload.nota,
            visible_para_inquilino=True,
        )

        _insert_historial_estado(
            db=db,
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo=nuevo_estado,
            persona_cambia_id=tenant_persona.id,
            rol_cambia="inquilino",
            nota=f"Confirmación de inquilino: {'confirmado' if payload.confirmado else 'no confirmado'}. {payload.nota}",
        )

        db.commit()
        db.refresh(incidencia)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al confirmar resolución: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionTenantResolutionConfirmationResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Confirmación de resolución registrada correctamente",
    )


@router.post(
    "/incidencias/{incidencia_id}/close",
    response_model=GestionCloseIncidentResponse,
    summary="Cerrar formalmente una incidencia por gestor",
)
def close_incident(
    incidencia_id: str,
    payload: GestionCloseIncidentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)
    actor_persona = _resolve_actor_persona_for_contrato(db, incidencia.contrato_id, current_user)

    if actor_persona.id != payload.gestor_persona_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La persona gestora indicada no corresponde con el usuario autenticado",
        )

    if incidencia.estado != "resolved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede cerrar una incidencia que ya esté resuelta",
        )

    estado_anterior = incidencia.estado

    try:
        incidencia.estado = "closed"
        incidencia.fecha_cierre = datetime.utcnow()
        incidencia.gestor_actual_id = actor_persona.id

        _insert_nota_incidencia(
            db=db,
            incidencia_id=incidencia.id,
            autor_persona_id=actor_persona.id,
            autor_rol="gestor",
            tipo_nota="cierre_incidencia",
            nota=payload.nota,
            visible_para_inquilino=False,
        )

        _insert_historial_estado(
            db=db,
            incidencia_id=incidencia.id,
            estado_anterior=estado_anterior,
            estado_nuevo="closed",
            persona_cambia_id=actor_persona.id,
            rol_cambia="gestor",
            nota=payload.nota,
        )

        db.commit()
        db.refresh(incidencia)

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad al cerrar incidencia: {str(e.orig)}",
        )
    except Exception:
        db.rollback()
        raise

    incidencia = _get_owned_incidencia_with_context(db, incidencia_id, current_user)

    return GestionCloseIncidentResponse(
        ok=True,
        incidencia=_build_incidencia_resumen(incidencia),
        mensaje="Incidencia cerrada correctamente",
    )