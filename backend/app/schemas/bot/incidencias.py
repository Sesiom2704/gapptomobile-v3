"""
Ruta: backend/app/schemas/bot/incidencias.py
Versión: 1.5.1
Descripción:
Schemas Pydantic específicos para incidencias del BOT de alquileres.

Funcionalidades incluidas:
- Alta de incidencia desde canal conversacional
- Respuesta resumida de creación
- Detalle de incidencia para consulta por id o código
- Listado de incidencias por contrato
- Listado de incidencias activas para gestión operativa
- Toma en gestión de incidencia por gestor
- Listado de proveedores disponibles
- Asignación de proveedor a incidencia
- Programación de visita
- Respuesta del inquilino a cita activa
- Alta mínima de proveedor desde BOT
- Búsqueda de localidades de catálogo para alta de proveedor
- Resumen de cita asociado a una incidencia
- Labels legibles para BOT sobre estado y prioridad
- Estructuras preparadas para BOT_SERVICE
- Registro de resultado de visita post-intervención
- Creación de presupuesto asociado a incidencia
- Decisión de presupuesto por propietario
- Confirmación de resolución por inquilino
- Cierre formal de incidencia por gestor

Notas de diseño:
- Se usan los nombres reales de base de datos:
  persona_reporta_id, rol_reporta, contrato_id, patrimonio_id.
- El backend maestro valida negocio y persistencia.
- BOT_SERVICE solo consume estos contratos y presenta la información.
- Se reutilizan los estados reales existentes de incidencias y citas.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field


class BotIncidenciaCreateRequest(BaseModel):
    contrato_id: str = Field(..., description="ID del contrato asociado")
    patrimonio_id: str = Field(..., description="ID del patrimonio asociado")
    persona_reporta_id: str = Field(..., description="ID de la persona que reporta")
    rol_reporta: str = Field(..., description="Rol de la persona que reporta en el contrato")
    categoria: str = Field(..., description="Categoría funcional de la incidencia")
    titulo: Optional[str] = Field(None, description="Título corto de la incidencia")
    descripcion: str = Field(..., min_length=5, description="Descripción libre del problema")
    prioridad: str = Field(..., description="Prioridad declarada en lenguaje BOT")
    notas_acceso: Optional[str] = Field(None, description="Instrucciones para acceso a la vivienda")


class BotIncidenciaResumen(BaseModel):
    id: str
    codigo: str
    estado: str
    estado_label: str
    categoria: str
    titulo: Optional[str] = None
    prioridad: str
    prioridad_label: str
    fecha_creacion: datetime
    contrato_id: str
    patrimonio_id: Optional[str] = None


class BotIncidenciaCreateResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    mensaje: str


class BotResponsableActual(BaseModel):
    tipo: Optional[str] = None
    id: Optional[str] = None
    nombre: Optional[str] = None


class BotCitaIncidenciaResumen(BaseModel):
    id: str
    proveedor_id: Optional[str] = None
    proveedor_nombre: Optional[str] = None
    fecha_inicio_programada: datetime
    fecha_fin_programada: Optional[datetime] = None
    estado_cita: str
    estado_cita_label: str
    estado_inquilino: str
    estado_inquilino_label: str
    resultado_visita: Optional[str] = None
    resultado_visita_label: Optional[str] = None


class BotIncidentQuoteSummary(BaseModel):
    id: str
    incidencia_id: str
    proveedor_id: str
    importe: float
    moneda: str
    descripcion: Optional[str] = None
    valido_hasta: Optional[date] = None
    estado: str
    fecha_envio: datetime
    fecha_revision: Optional[datetime] = None
    enviado_por_persona_id: Optional[str] = None
    revisado_por_persona_id: Optional[str] = None
    nota_aprobacion: Optional[str] = None
    nota_rechazo: Optional[str] = None


class BotIncidenciaDetailResponse(BaseModel):
    ok: bool = True
    id: str
    codigo: str
    contrato_id: str
    patrimonio_id: Optional[str] = None
    persona_reporta_id: str
    rol_reporta: str
    categoria: str
    titulo: Optional[str] = None
    descripcion: str
    prioridad: str
    prioridad_label: str
    estado: str
    estado_label: str
    telefono_inquilino_snapshot: Optional[str] = None
    notas_acceso: Optional[str] = None
    fecha_creacion: datetime
    fecha_actualizacion: datetime
    fecha_cierre: Optional[datetime] = None
    responsable_actual: Optional[BotResponsableActual] = None
    ultima_cita: Optional[BotCitaIncidenciaResumen] = None
    presupuestos: List[BotIncidentQuoteSummary] = Field(default_factory=list)


class BotIncidenciaListItem(BaseModel):
    id: str
    codigo: str
    estado: str
    estado_label: str
    categoria: str
    titulo: Optional[str] = None
    prioridad: str
    prioridad_label: str
    fecha_creacion: datetime
    proveedor_actual_id: Optional[str] = None
    proveedor_actual_nombre: Optional[str] = None
    gestor_actual_id: Optional[str] = None
    gestor_actual_nombre: Optional[str] = None
    localidad: Optional[str] = None


class BotIncidenciaListResponse(BaseModel):
    ok: bool = True
    items: List[BotIncidenciaListItem]


class BotIncidenciaPendienteListResponse(BaseModel):
    ok: bool = True
    items: List[BotIncidenciaListItem] = Field(default_factory=list)


class BotIncidenciaTakeRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestor que toma la incidencia")
    nota: Optional[str] = Field(None, description="Nota opcional de toma en gestión")


class BotIncidenciaAssignProviderRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestor que asigna el proveedor")
    proveedor_id: str = Field(..., description="Proveedor asignado a la incidencia")
    nota: Optional[str] = Field(None, description="Nota opcional de asignación")


class BotIncidenciaScheduleVisitRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestor que programa la visita")
    proveedor_id: str = Field(..., description="Proveedor que realizará la visita")
    fecha_inicio_programada: datetime = Field(..., description="Fecha y hora de inicio de la visita")
    fecha_fin_programada: Optional[datetime] = Field(None, description="Fecha y hora de fin de la visita")
    motivo_reprogramacion: Optional[str] = Field(
        None,
        description="Motivo de reprogramación si sustituye una cita previa",
    )
    nota: Optional[str] = Field(None, description="Nota opcional sobre la visita programada")


class BotIncidenciaActionResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    mensaje: str


class BotIncidenciaScheduleVisitResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    cita: BotCitaIncidenciaResumen
    mensaje: str


class BotTenantActiveVisitResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    cita: BotCitaIncidenciaResumen
    mensaje: str


class BotTenantVisitResponseRequest(BaseModel):
    inquilino_persona_id: str = Field(..., description="Persona inquilina que responde a la cita")
    accion: Literal["confirm", "reject", "reschedule"] = Field(
        ...,
        description="Acción del inquilino sobre la cita activa",
    )
    fecha_inicio_programada: Optional[datetime] = Field(
        None,
        description="Nueva fecha/hora de inicio si se solicita reprogramación",
    )
    fecha_fin_programada: Optional[datetime] = Field(
        None,
        description="Nueva fecha/hora de fin si se solicita reprogramación",
    )
    motivo_reprogramacion: Optional[str] = Field(
        None,
        description="Motivo o comentario opcional de reprogramación",
    )
    nota: Optional[str] = Field(
        None,
        description="Nota funcional opcional para histórico/auditoría",
    )


class BotTenantVisitResponseResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    cita: BotCitaIncidenciaResumen
    mensaje: str


class BotProveedorListItem(BaseModel):
    id: str
    nombre: str
    telefono: Optional[str] = None
    email: Optional[str] = None
    localidad: Optional[str] = None
    activo: bool


class BotProveedorListResponse(BaseModel):
    ok: bool = True
    items: List[BotProveedorListItem] = Field(default_factory=list)


class BotLocalidadListItem(BaseModel):
    """
    Elemento de localidad disponible para selección desde BOT.
    """
    id: int
    nombre: str
    region_nombre: Optional[str] = None
    pais_nombre: Optional[str] = None

    def label(self) -> str:
        parts = [self.nombre]
        if self.region_nombre:
            parts.append(self.region_nombre)
        if self.pais_nombre:
            parts.append(self.pais_nombre)
        return " · ".join(parts)


class BotLocalidadListResponse(BaseModel):
    """
    Respuesta de búsqueda de localidades para catálogo BOT.
    """
    ok: bool = True
    items: List[BotLocalidadListItem] = Field(default_factory=list)


class BotProveedorCreateRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestora que crea el proveedor desde BOT")
    nombre: str = Field(..., min_length=1, description="Nombre del proveedor")
    localidad_id: int = Field(..., description="ID de localidad del catálogo")
    acepta_urgencias: bool = Field(..., description="Indica si acepta urgencias")
    cif: Optional[str] = Field(None, description="CIF opcional")
    telefono: Optional[str] = Field(None, description="Teléfono opcional")
    persona_contacto: Optional[str] = Field(None, description="Persona de contacto opcional")


class BotProveedorCreateResponse(BaseModel):
    ok: bool = True
    proveedor: BotProveedorListItem
    mensaje: str


class BotVisitResultRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestora que registra el resultado de visita")
    cita_id: str = Field(..., description="ID de la cita asociada a la incidencia")
    resultado_visita: Literal[
        "resolved_on_visit",
        "requires_quote",
        "requires_new_visit",
        "no_show",
    ] = Field(..., description="Resultado funcional de la visita")
    nota: str = Field(..., min_length=3, description="Nota técnica obligatoria del gestor")
    visible_para_inquilino: bool = Field(
        default=False,
        description="Indica si la nota asociada puede mostrarse al inquilino",
    )


class BotVisitResultResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    cita: BotCitaIncidenciaResumen
    mensaje: str


class BotCreateIncidentQuoteRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestora que crea el presupuesto")
    proveedor_id: str = Field(..., description="Proveedor al que corresponde el presupuesto")
    importe: float = Field(..., gt=0, description="Importe del presupuesto")
    moneda: str = Field(..., min_length=1, description="Moneda del presupuesto, por ejemplo EUR")
    descripcion: str = Field(..., min_length=3, description="Descripción de trabajos presupuestados")
    valido_hasta: Optional[date] = Field(None, description="Fecha límite de validez del presupuesto")
    nota: Optional[str] = Field(None, description="Nota opcional para histórico interno")


class BotCreateIncidentQuoteResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    presupuesto: BotIncidentQuoteSummary
    mensaje: str


class BotDecideIncidentQuoteRequest(BaseModel):
    propietario_persona_id: str = Field(..., description="Persona propietaria que decide el presupuesto")
    decision: Literal["approved", "rejected"] = Field(..., description="Decisión del propietario")
    nota: str = Field(..., min_length=1, description="Nota de aprobación o rechazo")


class BotDecideIncidentQuoteResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    presupuesto: BotIncidentQuoteSummary
    mensaje: str


class BotTenantResolutionConfirmationRequest(BaseModel):
    inquilino_persona_id: str = Field(..., description="Persona inquilina que confirma la resolución")
    confirmado: bool = Field(..., description="Indica si la incidencia quedó resuelta")
    nota: str = Field(..., min_length=1, description="Comentario obligatorio del inquilino")


class BotTenantResolutionConfirmationResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    mensaje: str


class BotCloseIncidentRequest(BaseModel):
    gestor_persona_id: str = Field(..., description="Persona gestora que formaliza el cierre")
    nota: str = Field(..., min_length=1, description="Nota obligatoria de cierre formal")


class BotCloseIncidentResponse(BaseModel):
    ok: bool = True
    incidencia: BotIncidenciaResumen
    mensaje: str


class BotMessageResponse(BaseModel):
    ok: bool
    mensaje: str