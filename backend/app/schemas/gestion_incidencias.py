"""
Ruta: backend/app/schemas/gestion_incidencias.py
Versión: 1.3.0
Descripción:
Schemas Pydantic para la API GAPPTO de gestión de incidencias.

Funcionalidades incluidas:
- Listado resumido de incidencias.
- Detalle completo de incidencia.
- Listado de proveedores operativos.
- Respuesta estándar de acciones sobre incidencia.
- Payload de asignación de proveedor.
- Payload de programación de visita.
- Payload de actualización controlada de incidencia.
- Exposición de historial de cambios y listado de citas.
- NUEVO: exposición de referencia y dirección visible de vivienda/patrimonio.

Notas de diseño:
- Se reutiliza el modelo funcional ya existente del dominio incidencias.
- Se simplifica la capa de exposición para GAPPTO:
  - autenticación por usuario logueado
  - operación funcional sobre incidencias, proveedores y citas
- Los labels de estado/prioridad/cita se exponen ya resueltos para facilitar la UI móvil.
- referencia_vivienda y direccion_completa se exponen para evitar mostrar ids técnicos
  de patrimonio en la aplicación móvil.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class GestionResponsableActual(BaseModel):
    tipo: str
    id: str
    nombre: Optional[str] = None


class GestionCitaIncidenciaResumen(BaseModel):
    id: str
    proveedor_id: Optional[str] = None
    proveedor_nombre: Optional[str] = None
    fecha_inicio_programada: Optional[datetime] = None
    fecha_fin_programada: Optional[datetime] = None
    estado_cita: Optional[str] = None
    estado_cita_label: Optional[str] = None
    estado_inquilino: Optional[str] = None
    estado_inquilino_label: Optional[str] = None
    resultado_visita: Optional[str] = None
    resultado_visita_label: Optional[str] = None

class GestionHistorialEstadoIncidenciaItem(BaseModel):
    id: str
    estado_anterior: Optional[str] = None
    estado_anterior_label: Optional[str] = None
    estado_nuevo: str
    estado_nuevo_label: str
    persona_cambia_id: Optional[str] = None
    persona_cambia_nombre: Optional[str] = None
    rol_cambia: Optional[str] = None
    nota: Optional[str] = None
    fecha_creacion: Optional[datetime] = None


class GestionCitaIncidenciaItem(BaseModel):
    id: str
    proveedor_id: Optional[str] = None
    proveedor_nombre: Optional[str] = None
    fecha_inicio_programada: Optional[datetime] = None
    fecha_fin_programada: Optional[datetime] = None
    estado_cita: Optional[str] = None
    estado_cita_label: Optional[str] = None
    estado_inquilino: Optional[str] = None
    estado_inquilino_label: Optional[str] = None
    propuesta_por_persona_id: Optional[str] = None
    propuesta_por_persona_nombre: Optional[str] = None
    confirmada_por_persona_id: Optional[str] = None
    confirmada_por_persona_nombre: Optional[str] = None
    fecha_confirmacion: Optional[datetime] = None
    motivo_reprogramacion: Optional[str] = None
    resultado_visita: Optional[str] = None
    resultado_visita_label: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class GestionIncidenciaListItem(BaseModel):
    id: str
    codigo: str
    estado: str
    estado_label: str
    categoria: Optional[str] = None
    titulo: Optional[str] = None
    prioridad: Optional[str] = None
    prioridad_label: Optional[str] = None
    fecha_creacion: Optional[datetime] = None
    proveedor_actual_id: Optional[str] = None
    proveedor_actual_nombre: Optional[str] = None
    gestor_actual_id: Optional[str] = None
    gestor_actual_nombre: Optional[str] = None
    localidad: Optional[str] = None
    contrato_id: Optional[str] = None
    patrimonio_id: Optional[str] = None

    # NUEVO: datos visibles de vivienda
    referencia_vivienda: Optional[str] = None
    direccion_completa: Optional[str] = None


class GestionIncidenciaListResponse(BaseModel):
    ok: bool = True
    items: List[GestionIncidenciaListItem] = Field(default_factory=list)


class GestionIncidenciaDetailResponse(BaseModel):
    ok: bool = True

    id: str
    codigo: str

    contrato_id: Optional[str] = None
    patrimonio_id: Optional[str] = None

    # NUEVO: datos visibles de vivienda
    referencia_vivienda: Optional[str] = None
    direccion_completa: Optional[str] = None

    persona_reporta_id: Optional[str] = None
    rol_reporta: Optional[str] = None

    categoria: Optional[str] = None
    titulo: Optional[str] = None
    descripcion: Optional[str] = None

    prioridad: Optional[str] = None
    prioridad_label: Optional[str] = None

    estado: Optional[str] = None
    estado_label: Optional[str] = None

    telefono_inquilino_snapshot: Optional[str] = None
    notas_acceso: Optional[str] = None

    fecha_creacion: Optional[datetime] = None
    fecha_actualizacion: Optional[datetime] = None
    fecha_cierre: Optional[datetime] = None

    responsable_actual: Optional[GestionResponsableActual] = None
    ultima_cita: Optional[GestionCitaIncidenciaResumen] = None

    historial: List[GestionHistorialEstadoIncidenciaItem] = Field(default_factory=list)
    citas: List[GestionCitaIncidenciaItem] = Field(default_factory=list)


class GestionProveedorListItem(BaseModel):
    id: str
    nombre: str
    telefono: Optional[str] = None
    email: Optional[str] = None
    localidad: Optional[str] = None
    activo: bool


class GestionProveedorListResponse(BaseModel):
    ok: bool = True
    items: List[GestionProveedorListItem] = Field(default_factory=list)


class GestionIncidenciaResumen(BaseModel):
    id: str
    codigo: str
    estado: str
    estado_label: str
    categoria: Optional[str] = None
    titulo: Optional[str] = None
    prioridad: Optional[str] = None
    prioridad_label: Optional[str] = None
    fecha_creacion: Optional[datetime] = None
    contrato_id: Optional[str] = None
    patrimonio_id: Optional[str] = None


class GestionIncidenciaActionResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    mensaje: Optional[str] = None


class GestionIncidenciaAssignProviderRequest(BaseModel):
    proveedor_id: str
    nota: Optional[str] = None


class GestionIncidenciaScheduleVisitRequest(BaseModel):
    proveedor_id: str
    fecha_inicio_programada: datetime
    fecha_fin_programada: Optional[datetime] = None
    motivo_reprogramacion: Optional[str] = None
    nota: Optional[str] = None


class GestionIncidenciaScheduleVisitResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    cita: Optional[GestionCitaIncidenciaResumen] = None
    mensaje: Optional[str] = None


class GestionIncidenciaUpdateRequest(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    telefono_inquilino_snapshot: Optional[str] = None
    estado: Optional[str] = None
    notas_acceso: Optional[str] = None
    nota_operativa: Optional[str] = None


class GestionIncidenciaUpdateResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaDetailResponse
    mensaje: Optional[str] = None

class GestionIncidentQuoteSummary(BaseModel):
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


class GestionVisitResultRequest(BaseModel):
    gestor_persona_id: str
    cita_id: str
    resultado_visita: str
    nota: str
    visible_para_inquilino: bool = False


class GestionVisitResultResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    cita: Optional[GestionCitaIncidenciaResumen] = None
    mensaje: Optional[str] = None


class GestionCreateIncidentQuoteRequest(BaseModel):
    gestor_persona_id: str
    proveedor_id: str
    importe: float
    moneda: str
    descripcion: str
    valido_hasta: Optional[datetime] = None
    nota: Optional[str] = None


class GestionCreateIncidentQuoteResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    presupuesto: GestionIncidentQuoteSummary
    mensaje: Optional[str] = None


class GestionDecideIncidentQuoteRequest(BaseModel):
    propietario_persona_id: str
    decision: str
    nota: str


class GestionDecideIncidentQuoteResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    presupuesto: GestionIncidentQuoteSummary
    mensaje: Optional[str] = None


class GestionTenantResolutionConfirmationRequest(BaseModel):
    inquilino_persona_id: str
    confirmado: bool
    nota: str


class GestionTenantResolutionConfirmationResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    mensaje: Optional[str] = None


class GestionCloseIncidentRequest(BaseModel):
    gestor_persona_id: str
    nota: str


class GestionCloseIncidentResponse(BaseModel):
    ok: bool = True
    incidencia: GestionIncidenciaResumen
    mensaje: Optional[str] = None