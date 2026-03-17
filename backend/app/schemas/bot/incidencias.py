"""
Ruta: backend/app/schemas/bot/incidencias.py
Versión: 1.4.0
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

Notas de diseño:
- Se usan los nombres reales de base de datos:
  persona_reporta_id, rol_reporta, contrato_id, patrimonio_id.
- El backend maestro valida negocio y persistencia.
- BOT_SERVICE solo consume estos contratos y presenta la información.
"""

from __future__ import annotations

from datetime import datetime
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

class BotLocalidadListItem(BaseModel):
    id: int
    nombre: str
    region_nombre: Optional[str] = None
    pais_nombre: Optional[str] = None


class BotLocalidadListResponse(BaseModel):
    ok: bool = True
    items: List[BotLocalidadListItem] = Field(default_factory=list)

class BotMessageResponse(BaseModel):
    ok: bool
    mensaje: str