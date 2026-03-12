"""
Archivo: backend/app/api/v1/bot/incidencias.py
Versión: 1.1.0

Descripción:
Router de incidencias del BOT de alquileres.

Funcionalidades incluidas:
- Alta de incidencia
- Consulta de incidencia por id
- Consulta de incidencia por código
- Listado de incidencias por contrato
- Listado de incidencias activas para gestión operativa
- Toma en gestión de incidencia por gestor
- Listado de proveedores activos
- Asignación de proveedor a incidencia
- Programación de visita para incidencia

Notas de diseño:
- Este router expone la API BOT-ready de la Fase 4.1 y 4.3A.
- La lógica de negocio vive en incidencias_service.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.bot.incidencias import (
    BotIncidenciaActionResponse,
    BotIncidenciaAssignProviderRequest,
    BotIncidenciaCreateRequest,
    BotIncidenciaCreateResponse,
    BotIncidenciaDetailResponse,
    BotIncidenciaListResponse,
    BotIncidenciaPendienteListResponse,
    BotIncidenciaScheduleVisitRequest,
    BotIncidenciaScheduleVisitResponse,
    BotIncidenciaTakeRequest,
    BotProveedorListResponse,
)
from backend.app.services.bot.incidencias_service import (
    assign_provider_bot,
    create_incidencia_bot,
    get_incidencia_detail_by_codigo,
    get_incidencia_detail_by_id,
    list_active_incidencias_for_bot,
    list_incidencias_by_contrato,
    list_proveedores_bot,
    schedule_visit_bot,
    take_incidencia_bot,
)

router = APIRouter(tags=["BOT Incidencias"])


@router.post(
    "/incidencias",
    response_model=BotIncidenciaCreateResponse,
    summary="Crear incidencia desde BOT",
)
def create_incidencia(
    payload: BotIncidenciaCreateRequest,
    db: Session = Depends(get_db),
):
    return create_incidencia_bot(db=db, payload=payload)


@router.get(
    "/incidencias/activas",
    response_model=BotIncidenciaPendienteListResponse,
    summary="Listar incidencias activas visibles para el gestor",
)
def get_active_incidencias(
    gestor_persona_id: str = Query(..., description="ID de la persona gestora"),
    db: Session = Depends(get_db),
):
    return list_active_incidencias_for_bot(
        db=db,
        gestor_persona_id=gestor_persona_id,
    )


@router.get(
    "/incidencias/{incidencia_id}",
    response_model=BotIncidenciaDetailResponse,
    summary="Consultar incidencia por id",
)
def get_incidencia_by_id(
    incidencia_id: str,
    db: Session = Depends(get_db),
):
    return get_incidencia_detail_by_id(db=db, incidencia_id=incidencia_id)


@router.get(
    "/incidencias/codigo/{codigo}",
    response_model=BotIncidenciaDetailResponse,
    summary="Consultar incidencia por código",
)
def get_incidencia_by_codigo(
    codigo: str,
    db: Session = Depends(get_db),
):
    return get_incidencia_detail_by_codigo(db=db, codigo=codigo)


@router.get(
    "/contratos/{contrato_id}/incidencias",
    response_model=BotIncidenciaListResponse,
    summary="Listar incidencias por contrato",
)
def get_incidencias_by_contrato(
    contrato_id: str,
    db: Session = Depends(get_db),
):
    return list_incidencias_by_contrato(db=db, contrato_id=contrato_id)


@router.post(
    "/incidencias/{incidencia_id}/take",
    response_model=BotIncidenciaActionResponse,
    summary="Tomar incidencia en gestión por gestor",
)
def take_incidencia(
    incidencia_id: str,
    payload: BotIncidenciaTakeRequest,
    db: Session = Depends(get_db),
):
    return take_incidencia_bot(
        db=db,
        incidencia_id=incidencia_id,
        payload=payload,
    )


@router.get(
    "/proveedores",
    response_model=BotProveedorListResponse,
    summary="Listar proveedores activos para incidencias",
)
def get_proveedores(
    db: Session = Depends(get_db),
):
    return list_proveedores_bot(db=db)


@router.post(
    "/incidencias/{incidencia_id}/assign-provider",
    response_model=BotIncidenciaActionResponse,
    summary="Asignar proveedor a una incidencia",
)
def assign_provider(
    incidencia_id: str,
    payload: BotIncidenciaAssignProviderRequest,
    db: Session = Depends(get_db),
):
    return assign_provider_bot(
        db=db,
        incidencia_id=incidencia_id,
        payload=payload,
    )


@router.post(
    "/incidencias/{incidencia_id}/schedule-visit",
    response_model=BotIncidenciaScheduleVisitResponse,
    summary="Programar visita para una incidencia",
)
def schedule_visit(
    incidencia_id: str,
    payload: BotIncidenciaScheduleVisitRequest,
    db: Session = Depends(get_db),
):
    return schedule_visit_bot(
        db=db,
        incidencia_id=incidencia_id,
        payload=payload,
    )