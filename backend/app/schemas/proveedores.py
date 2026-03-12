# backend/app/schemas/proveedores.py

"""
Ruta: backend/app/schemas/proveedores.py
Versión: 1.3.0
Descripción:
Schemas Pydantic para PROVEEDORES en GapptoMobile v3.

Objetivos:
- Unificar lectura/escritura de proveedores en backend.
- Exponer todos los campos relevantes del ORM Proveedor.
- Mantener compatibilidad con el flujo legacy de ubicación:
    * localidad/comunidad/pais (texto)
- Mantener compatibilidad con el flujo normalizado:
    * localidad_id
- Añadir soporte para:
    * cif
    * telefono
    * email
    * subsegmento
    * subsegmento_id
    * direccion
    * codigo_postal
    * persona_contacto
    * activo
    * observaciones
    * acepta_urgencias
    * ambito_servicio
    * created_at / updated_at
"""

from __future__ import annotations

from typing import Optional
from datetime import datetime

from pydantic import BaseModel, Field, ConfigDict

from .localidad import LocalidadWithContext


# -----------------------------------------------------------------------------
# Relaciones ligeras
# -----------------------------------------------------------------------------
class RamaProveedorRel(BaseModel):
    """
    Relación ligera a la rama del proveedor.
    """
    id: str
    nombre: str

    model_config = ConfigDict(from_attributes=True)


class SubsegmentoProveedorRel(BaseModel):
    """
    Relación ligera al subsegmento del proveedor.
    """
    id: str
    nombre: str
    rama_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# -----------------------------------------------------------------------------
# Base
# -----------------------------------------------------------------------------
class ProveedorBase(BaseModel):
    """
    Campos base de proveedor.

    Reglas:
    - nombre y rama_id siguen siendo obligatorios en creación.
    - localidad_id es opcional y, si se informa, el backend puede derivar
      localidad/comunidad/pais.
    - El resto de campos ampliados son opcionales.
    """
    nombre: str = Field(..., description="Nombre comercial del proveedor.")
    rama_id: str = Field(..., description="ID de la rama del proveedor.")

    # Ubicación normalizada
    localidad_id: Optional[int] = Field(
        None,
        description="FK a localidades.id.",
    )

    # Ubicación legacy texto
    localidad: Optional[str] = Field(None, description="Localidad texto.")
    comunidad: Optional[str] = Field(None, description="Comunidad/Región texto.")
    pais: Optional[str] = Field(None, description="País texto.")

    # Nuevos campos de proveedor
    cif: Optional[str] = Field(None, description="CIF del proveedor.")
    telefono: Optional[str] = Field(None, description="Teléfono del proveedor.")
    email: Optional[str] = Field(None, description="Email del proveedor.")

    subsegmento: Optional[str] = Field(
        None,
        description="Nombre libre de subsegmento (legacy/compat).",
    )
    subsegmento_id: Optional[str] = Field(
        None,
        description="ID del subsegmento del proveedor.",
    )

    direccion: Optional[str] = Field(None, description="Dirección postal.")
    codigo_postal: Optional[str] = Field(None, description="Código postal.")
    persona_contacto: Optional[str] = Field(None, description="Persona de contacto.")

    activo: Optional[bool] = Field(True, description="Indica si el proveedor está activo.")
    observaciones: Optional[str] = Field(None, description="Observaciones del proveedor.")
    acepta_urgencias: Optional[bool] = Field(
        False,
        description="Indica si el proveedor acepta servicios urgentes.",
    )
    ambito_servicio: Optional[str] = Field(
        None,
        description="Ámbito de servicio: local, provincial, nacional, etc.",
    )


# -----------------------------------------------------------------------------
# Create
# -----------------------------------------------------------------------------
class ProveedorCreate(ProveedorBase):
    """
    Payload para crear proveedor.

    Compatibilidad:
    - Se acepta `id` opcional, aunque el backend puede ignorarlo y generar uno propio.
    """
    id: Optional[str] = Field(
        None,
        description="ID opcional. El backend puede ignorarlo.",
    )


# -----------------------------------------------------------------------------
# Update
# -----------------------------------------------------------------------------
class ProveedorUpdate(BaseModel):
    """
    Payload de actualización parcial de proveedor.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre.")
    rama_id: Optional[str] = Field(None, description="Nueva rama.")

    localidad_id: Optional[int] = Field(None, description="Nueva localidad_id.")
    localidad: Optional[str] = Field(None, description="Nueva localidad texto.")
    comunidad: Optional[str] = Field(None, description="Nueva comunidad texto.")
    pais: Optional[str] = Field(None, description="Nuevo país texto.")

    cif: Optional[str] = Field(None, description="Nuevo CIF.")
    telefono: Optional[str] = Field(None, description="Nuevo teléfono.")
    email: Optional[str] = Field(None, description="Nuevo email.")

    subsegmento: Optional[str] = Field(None, description="Nuevo subsegmento texto.")
    subsegmento_id: Optional[str] = Field(None, description="Nuevo subsegmento_id.")

    direccion: Optional[str] = Field(None, description="Nueva dirección.")
    codigo_postal: Optional[str] = Field(None, description="Nuevo código postal.")
    persona_contacto: Optional[str] = Field(None, description="Nueva persona de contacto.")

    activo: Optional[bool] = Field(None, description="Nuevo estado activo.")
    observaciones: Optional[str] = Field(None, description="Nuevas observaciones.")
    acepta_urgencias: Optional[bool] = Field(None, description="Nuevo valor acepta_urgencias.")
    ambito_servicio: Optional[str] = Field(None, description="Nuevo ámbito de servicio.")


# -----------------------------------------------------------------------------
# Read
# -----------------------------------------------------------------------------
class ProveedorRead(BaseModel):
    """
    Representación de salida estable del proveedor.
    """
    id: str
    nombre: str
    rama_id: Optional[str] = None

    localidad_id: Optional[int] = None
    localidad: Optional[str] = None
    comunidad: Optional[str] = None
    pais: Optional[str] = None

    cif: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None

    subsegmento: Optional[str] = None
    subsegmento_id: Optional[str] = None

    direccion: Optional[str] = None
    codigo_postal: Optional[str] = None
    persona_contacto: Optional[str] = None

    activo: Optional[bool] = None
    observaciones: Optional[str] = None
    acepta_urgencias: Optional[bool] = None
    ambito_servicio: Optional[str] = None

    user_id: Optional[int] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    rama_rel: Optional[RamaProveedorRel] = None
    subsegmento_rel: Optional[SubsegmentoProveedorRel] = None
    localidad_rel: Optional[LocalidadWithContext] = None

    model_config = ConfigDict(from_attributes=True)


# Alias de compatibilidad
Proveedor = ProveedorRead