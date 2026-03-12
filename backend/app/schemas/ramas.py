# backend/app/schemas/ramas.py

"""
Ruta: backend/app/schemas/ramas.py
Versión: 1.2.0
Descripción:
Schemas Pydantic para los catálogos de RAMAS y SUBSEGMENTOS de GapptoMobile v3.

Incluye:
- TipoRamasIngreso
- TipoRamasGasto
- TipoRamasProveedores
- TipoSubsegmentoProveedor

Objetivos:
- Mantener consistencia entre catálogos auxiliares del dominio.
- Permitir que el backend exponga payloads homogéneos.
- Preparar el nuevo catálogo auxiliar de subsegmentos de proveedores.
- Mantener compatibilidad con Pydantic v2 y construcción desde ORM.

Reglas:
- El nombre se normaliza en router/service, no en schema.
- Los IDs se generan en backend.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# RAMAS DE INGRESO
# ============================================================================

class TipoRamaIngresoBase(BaseModel):
    """
    Campos base de una rama de ingreso.
    """
    nombre: str = Field(..., description="Nombre de la rama de ingreso.")


class TipoRamaIngresoCreate(TipoRamaIngresoBase):
    """
    Payload de creación de rama de ingreso.
    """
    pass


class TipoRamaIngresoUpdate(BaseModel):
    """
    Payload de actualización de rama de ingreso.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de ingreso.")


class TipoRamaIngresoRead(TipoRamaIngresoBase):
    """
    Schema de salida para rama de ingreso.
    """
    id: str

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# RAMAS DE GASTO
# ============================================================================

class TipoRamaGastoBase(BaseModel):
    """
    Campos base de una rama de gasto.
    """
    nombre: str = Field(..., description="Nombre de la rama de gasto.")


class TipoRamaGastoCreate(TipoRamaGastoBase):
    """
    Payload de creación de rama de gasto.
    """
    pass


class TipoRamaGastoUpdate(BaseModel):
    """
    Payload de actualización de rama de gasto.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de gasto.")


class TipoRamaGastoRead(TipoRamaGastoBase):
    """
    Schema de salida para rama de gasto.
    """
    id: str

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# RAMAS DE PROVEEDOR
# ============================================================================

class TipoRamaProveedorBase(BaseModel):
    """
    Campos base de una rama de proveedor.
    """
    nombre: str = Field(..., description="Nombre de la rama de proveedor.")


class TipoRamaProveedorCreate(TipoRamaProveedorBase):
    """
    Payload de creación de rama de proveedor.
    """
    pass


class TipoRamaProveedorUpdate(BaseModel):
    """
    Payload de actualización de rama de proveedor.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de proveedor.")


class TipoRamaProveedorRead(TipoRamaProveedorBase):
    """
    Schema de salida para rama de proveedor.
    """
    id: str

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# SUBSEGMENTOS DE PROVEEDOR
# ============================================================================

class TipoSubsegmentoProveedorBase(BaseModel):
    """
    Campos base de un subsegmento de proveedor.

    Nota:
    - rama_id es opcional para permitir subsegmentos genéricos,
      aunque la UI normalmente trabajará asociados a una rama.
    """
    nombre: str = Field(..., description="Nombre del subsegmento de proveedor.")
    rama_id: Optional[str] = Field(
        None,
        description="ID de la rama de proveedor a la que pertenece el subsegmento.",
    )


class TipoSubsegmentoProveedorCreate(TipoSubsegmentoProveedorBase):
    """
    Payload de creación de subsegmento de proveedor.
    """
    pass


class TipoSubsegmentoProveedorUpdate(BaseModel):
    """
    Payload de actualización de subsegmento de proveedor.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre del subsegmento.")
    rama_id: Optional[str] = Field(
        None,
        description="Nueva rama_id del subsegmento de proveedor.",
    )


class TipoSubsegmentoProveedorRead(TipoSubsegmentoProveedorBase):
    """
    Schema de salida para subsegmento de proveedor.
    """
    id: str

    model_config = ConfigDict(from_attributes=True)


__all__ = [
    "TipoRamaIngresoBase",
    "TipoRamaIngresoCreate",
    "TipoRamaIngresoUpdate",
    "TipoRamaIngresoRead",
    "TipoRamaGastoBase",
    "TipoRamaGastoCreate",
    "TipoRamaGastoUpdate",
    "TipoRamaGastoRead",
    "TipoRamaProveedorBase",
    "TipoRamaProveedorCreate",
    "TipoRamaProveedorUpdate",
    "TipoRamaProveedorRead",
    "TipoSubsegmentoProveedorBase",
    "TipoSubsegmentoProveedorCreate",
    "TipoSubsegmentoProveedorUpdate",
    "TipoSubsegmentoProveedorRead",
]