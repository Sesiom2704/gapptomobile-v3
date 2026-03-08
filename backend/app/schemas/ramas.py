# backend/app/schemas/ramas.py

"""
Schemas Pydantic para las RAMAS de GapptoMobile v3.

Incluye:
- TipoRamasIngreso
- TipoRamasGasto
- TipoRamasProveedores

Reglas:
- El nombre SIEMPRE se tratará en MAYÚSCULAS en la lógica del router/service.
- Los IDs se generan en el backend, no los envía el cliente.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ==========================
# TipoRamasIngreso
# ==========================

class TipoRamaIngresoBase(BaseModel):
    """
    Campos base de una rama de ingreso.

    Ejemplos:
    - LABORAL
    - FINANCIACION
    - VIVIENDAS
    - SUMINISTRO
    - OTROS
    """
    nombre: str = Field(..., description="Nombre de la rama de ingreso.")


class TipoRamaIngresoCreate(TipoRamaIngresoBase):
    """
    Payload de creación de rama de ingreso.
    El ID se genera en el backend.
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


# ==========================
# TipoRamasGasto
# ==========================

class TipoRamaGastoBase(BaseModel):
    """
    Campos base de una rama de gasto.

    Ejemplos:
    - SUMINISTROS
    - FINANCIACIONES
    - SEGUROS
    """
    nombre: str = Field(..., description="Nombre de la rama de gasto.")


class TipoRamaGastoCreate(TipoRamaGastoBase):
    """
    Payload de creación de rama de gasto.
    El ID se genera en el backend.
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


# ==========================
# TipoRamasProveedores
# ==========================

class TipoRamaProveedorBase(BaseModel):
    """
    Campos base de una rama de proveedor.

    Ejemplos:
    - SUPERMERCADOS Y RESTAURANTES
    - BANCOS Y FINANCIERAS
    - SUMINISTROS
    """
    nombre: str = Field(..., description="Nombre de la rama de proveedor.")


class TipoRamaProveedorCreate(TipoRamaProveedorBase):
    """
    Payload de creación de rama de proveedor.
    El ID se genera en el backend.
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
]