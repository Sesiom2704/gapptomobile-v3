"""
Ruta: backend/app/schemas/ramas.py
Versión: 2.1.0
Descripción:
Schemas Pydantic para las tablas auxiliares de ramas y subsegmentos
de GapptoMobile v3.

Incluye:
- TipoRamasIngreso
- TipoRamasGasto
- TipoRamasProveedores
- TipoSubsegmentoProveedor

Reglas:
- El nombre se normaliza en routers/services, no en el schema.
- Los IDs se generan en backend.
- Los schemas de update permiten modificación parcial.
- Se añade soporte para:
    * associated_count
    * relation_counts
"""

from __future__ import annotations

from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


# ============================================================
# RELACIONES GENÉRICAS
# ============================================================

class RelationCountItem(BaseModel):
    """
    Detalle de registros asociados por tabla/relación.
    """
    key: str = Field(..., description="Clave técnica de la relación.")
    label: str = Field(..., description="Etiqueta legible de la relación.")
    count: int = Field(0, description="Número de registros asociados en esa relación.")


# ============================================================
# RAMAS DE INGRESO
# ============================================================

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
    Payload de actualización parcial de rama de ingreso.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de ingreso.")


class TipoRamaIngresoRead(TipoRamaIngresoBase):
    """
    Respuesta de lectura de rama de ingreso.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados a la rama de ingreso.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# RAMAS DE GASTO
# ============================================================

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
    Payload de actualización parcial de rama de gasto.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de gasto.")


class TipoRamaGastoRead(TipoRamaGastoBase):
    """
    Respuesta de lectura de rama de gasto.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados a la rama de gasto.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# RAMAS DE PROVEEDORES
# ============================================================

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
    Payload de actualización parcial de rama de proveedor.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre de la rama de proveedor.")


class TipoRamaProveedorRead(TipoRamaProveedorBase):
    """
    Respuesta de lectura de rama de proveedor.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados a la rama de proveedor.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# SUBSEGMENTOS DE PROVEEDORES
# ============================================================

class TipoSubsegmentoProveedorBase(BaseModel):
    """
    Campos base de un subsegmento de proveedor.

    Ejemplos:
    - ELECTRODOMÉSTICOS
    - CERRAJERÍA
    - FONTANERÍA
    - LIMPIEZA
    """
    nombre: str = Field(..., description="Nombre del subsegmento de proveedor.")
    rama_id: Optional[str] = Field(
        None,
        description="ID de la rama de proveedor asociada. Puede ser NULL.",
    )


class TipoSubsegmentoProveedorCreate(TipoSubsegmentoProveedorBase):
    """
    Payload de creación de subsegmento de proveedor.
    """
    pass


class TipoSubsegmentoProveedorUpdate(BaseModel):
    """
    Payload de actualización parcial de subsegmento de proveedor.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre del subsegmento.")
    rama_id: Optional[str] = Field(
        None,
        description="Nueva rama de proveedor asociada. Puede ser NULL.",
    )


class TipoSubsegmentoProveedorRead(TipoSubsegmentoProveedorBase):
    """
    Respuesta de lectura de subsegmento de proveedor.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de proveedores/registros asociados al subsegmento.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)

class RelationCountItem(BaseModel):
    key: str
    label: str
    count: int

class TipoSubsegmentoProveedorRead(TipoSubsegmentoProveedorBase):
    id: str
    associated_count: int = Field(
        0,
        description="Número real de proveedores asociados al subsegmento.",
    )
    relation_counts: list[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle de tablas relacionadas con contador > 0.",
    )

    model_config = ConfigDict(from_attributes=True)


__all__ = [
    "RelationCountItem",
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