"""
Archivo: backend/app/schemas/gestion_alquiler.py
Versión: 3.2.0

Descripción:
Schemas Pydantic para el módulo de gestión de alquileres.

Funcionalidades incluidas:
- Personas
- Contratos
- Participantes
- Nuevas opciones dinámicas de objeto de alquiler por patrimonio
- Soporte al nuevo campo contratos.objeto_alquiler

Notas de diseño:
- objeto_alquiler se guarda como código técnico estable.
- El frontend mostrará etiquetas legibles.
- El backend valida qué opciones son válidas para cada patrimonio.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


# ==========================
# PERSONAS
# ==========================

class PersonaBase(BaseModel):
    nombre_completo: Optional[str] = Field(None, description="Nombre completo de la persona.")
    dni: Optional[str] = Field(None, description="DNI/NIF/NIE.")
    telefono: Optional[str] = Field(None, description="Teléfono principal.")
    email: Optional[str] = Field(None, description="Correo electrónico.")
    fecha_nacimiento: Optional[date] = Field(None, description="Fecha de nacimiento.")
    observaciones: Optional[str] = Field(None, description="Notas internas.")


class PersonaCreate(PersonaBase):
    nombre_completo: str = Field(..., description="Nombre completo obligatorio para crear.")


class PersonaUpdate(BaseModel):
    nombre_completo: Optional[str] = None
    dni: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    observaciones: Optional[str] = None
    inactivatedon: Optional[datetime] = None


class PersonaSchema(PersonaBase):
    id: str
    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PersonaPickerOut(BaseModel):
    id: str
    nombre_completo: str
    dni: Optional[str] = None
    telefono: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ==========================
# PARTICIPANTES
# ==========================

class ContratoParticipanteBase(BaseModel):
    persona_id: Optional[str] = Field(None, description="ID de la persona ya existente.")
    rol: Optional[str] = Field(None, description="inquilino | avalista | gestor")
    es_principal: Optional[bool] = Field(False, description="Principal del contrato.")
    observaciones: Optional[str] = Field(None, description="Notas internas de la relación.")


class ContratoParticipanteCreate(ContratoParticipanteBase):
    persona_id: str
    rol: str


class ContratoParticipanteUpdate(BaseModel):
    rol: Optional[str] = None
    es_principal: Optional[bool] = None
    observaciones: Optional[str] = None
    inactivatedon: Optional[datetime] = None


class ContratoParticipanteSchema(BaseModel):
    id: str
    contrato_id: str
    persona_id: str

    rol: str
    es_principal: bool = False
    observaciones: Optional[str] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None

    nombre_completo: Optional[str] = None
    dni: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ParticipantesResumenOut(BaseModel):
    inquilino_principal: Optional[str] = None
    inquilinos: List[str] = Field(default_factory=list)
    avalistas: List[str] = Field(default_factory=list)
    gestor: Optional[str] = None


# ==========================
# CONTRATOS
# ==========================

class ContratoObjetoOpcionOut(BaseModel):
    code: str
    label: str
    enabled: bool = True
    disabled_reason: Optional[str] = None


class ContratoObjetoOpcionesOut(BaseModel):
    patrimonio_id: str
    opciones: List[ContratoObjetoOpcionOut] = Field(default_factory=list)


class ContratoBase(BaseModel):
    patrimonio_id: Optional[str] = Field(None, description="ID de la vivienda asociada.")
    objeto_alquiler: Optional[str] = Field(
        None,
        description="Código técnico del objeto alquilado."
    )
    fecha_inicio: Optional[date] = Field(None, description="Fecha de inicio del contrato.")
    fecha_fin: Optional[date] = Field(None, description="Fecha de fin del contrato.")
    renta_mensual: Optional[float] = Field(None, description="Renta mensual.")
    fianza: Optional[float] = Field(None, description="Fianza.")
    estado: Optional[str] = Field(None, description="activo | pendiente | finalizado | cancelado")
    incremento_ipc: Optional[bool] = Field(False, description="Indica si el contrato contempla actualización por IPC.")
    incluye_luz: Optional[bool] = Field(False, description="Si la luz está incluida.")
    incluye_agua: Optional[bool] = Field(False, description="Si el agua está incluida.")
    incluye_internet: Optional[bool] = Field(False, description="Si internet está incluido.")
    observaciones: Optional[str] = Field(None, description="Notas internas del contrato.")


class ContratoCreate(ContratoBase):
    patrimonio_id: str
    objeto_alquiler: str
    fecha_inicio: date
    estado: Optional[str] = "activo"
    incremento_ipc: Optional[bool] = False


class ContratoUpdate(BaseModel):
    objeto_alquiler: Optional[str] = None
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    renta_mensual: Optional[float] = None
    fianza: Optional[float] = None
    estado: Optional[str] = None
    incremento_ipc: Optional[bool] = None
    incluye_luz: Optional[bool] = None
    incluye_agua: Optional[bool] = None
    incluye_internet: Optional[bool] = None
    observaciones: Optional[str] = None
    inactivatedon: Optional[datetime] = None


class ContratoSchema(ContratoBase):
    id: str
    user_id: Optional[int] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None

    referencia_vivienda: Optional[str] = None
    direccion_completa: Optional[str] = None

    objeto_alquiler_label: Optional[str] = None
    participantes_resumen: Optional[ParticipantesResumenOut] = None

    model_config = ConfigDict(from_attributes=True)


class ContratoResumenActivoOut(BaseModel):
    contrato_id: str
    estado: str
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    renta_mensual: Optional[float] = None
    fianza: Optional[float] = None
    incremento_ipc: Optional[bool] = False
    objeto_alquiler: Optional[str] = None
    objeto_alquiler_label: Optional[str] = None
    participantes_resumen: Optional[ParticipantesResumenOut] = None


__all__ = [
    "PersonaBase",
    "PersonaCreate",
    "PersonaUpdate",
    "PersonaSchema",
    "PersonaPickerOut",
    "ContratoParticipanteBase",
    "ContratoParticipanteCreate",
    "ContratoParticipanteUpdate",
    "ContratoParticipanteSchema",
    "ParticipantesResumenOut",
    "ContratoObjetoOpcionOut",
    "ContratoObjetoOpcionesOut",
    "ContratoBase",
    "ContratoCreate",
    "ContratoUpdate",
    "ContratoSchema",
    "ContratoResumenActivoOut",
]