"""
Ruta: backend/app/schemas/tipos.py
Versión: 2.1.0
Descripción:
Schemas Pydantic para los TIPOS de GapptoMobile v3.

Incluye:
- TipoGasto
- TipoIngreso
- TipoSegmentoGasto

Reglas generales:
- El nombre se normaliza en routers/services.
- Los IDs se generan en backend.
- Se añade soporte para contadores reales de relaciones:
    * associated_count
    * relation_counts

Objetivo funcional:
- Permitir que backend exponga, junto a cada auxiliar:
    * el número real total de registros asociados
    * el detalle por tabla relacionada
- `relation_counts` solo incluirá relaciones con count > 0
  si el router ya las filtra.
"""

from __future__ import annotations

from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


# ==========================
# Relación genérica
# ==========================

class RelationCountItem(BaseModel):
    """
    Detalle de registros asociados por tabla/relación.
    """
    key: str = Field(..., description="Clave técnica de la relación.")
    label: str = Field(..., description="Etiqueta legible de la relación.")
    count: int = Field(0, description="Número de registros asociados en esa relación.")


# ==========================
# TipoGasto
# ==========================

class TipoGastoBase(BaseModel):
    """
    Campos base de un tipo de gasto.

    - nombre: nombre del tipo de gasto
      (ej.: HIPOTECA, LUZ, INTERNET...).
    - rama_id: FK a TipoRamasGasto (rama de gasto).
    - segmento_id: FK a TipoSegmentoGasto (segmento al que pertenece).
    """
    nombre: str = Field(..., description="Nombre del tipo de gasto.")
    rama_id: str = Field(..., description="ID de la rama de gasto.")
    segmento_id: str = Field(..., description="ID del segmento de gasto.")


class TipoGastoCreate(TipoGastoBase):
    """
    Payload de creación de TipoGasto.
    El ID se genera en el backend.
    """
    pass


class TipoGastoUpdate(BaseModel):
    """
    Payload de actualización de TipoGasto.

    Todos los campos son opcionales;
    solo se modifican los que se envían.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre del tipo de gasto.")
    rama_id: Optional[str] = Field(None, description="Nueva rama del tipo de gasto.")
    segmento_id: Optional[str] = Field(None, description="Nuevo segmento del tipo de gasto.")


class TipoGastoRead(TipoGastoBase):
    """
    Schema de salida para TipoGasto.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados al tipo de gasto.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


# ==========================
# TipoIngreso
# ==========================

class TipoIngresoBase(BaseModel):
    """
    Campos base de un tipo de ingreso.

    - nombre: nombre del tipo de ingreso
      (ej.: NÓMINA, DESEMPLEO, VIVIENDAS, BIZUM...).
    - rama_id: FK a TipoRamasIngreso.

    Nota funcional:
    - Cada tipo de ingreso pertenece obligatoriamente a una rama.
    - Esto permite que la app primero muestre ramas y luego
      filtre los tipos de ingreso por rama.
    """
    nombre: str = Field(..., description="Nombre del tipo de ingreso.")
    rama_id: str = Field(..., description="ID de la rama de ingreso.")


class TipoIngresoCreate(TipoIngresoBase):
    """
    Payload de creación de TipoIngreso.
    El ID se genera en el backend.
    """
    pass


class TipoIngresoUpdate(BaseModel):
    """
    Payload de actualización de TipoIngreso.

    Se permite actualizar:
    - nombre
    - rama_id
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre del tipo de ingreso.")
    rama_id: Optional[str] = Field(None, description="Nueva rama del tipo de ingreso.")


class TipoIngresoRead(TipoIngresoBase):
    """
    Schema de salida para TipoIngreso.

    Incluye rama_id para que el frontend pueda saber
    a qué rama pertenece cada tipo.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados al tipo de ingreso.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


# ==========================
# TipoSegmentoGasto
# ==========================

class TipoSegmentoGastoBase(BaseModel):
    """
    Campos base de un segmento de gasto.

    - nombre: nombre del segmento
      (ej.: FIJO, COTIDIANO, AHORRO...).
    """
    nombre: str = Field(..., description="Nombre del segmento de gasto.")


class TipoSegmentoGastoCreate(TipoSegmentoGastoBase):
    """
    Payload de creación de TipoSegmentoGasto.
    El ID se genera en el backend.
    """
    pass


class TipoSegmentoGastoUpdate(BaseModel):
    """
    Payload de actualización de TipoSegmentoGasto.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre del segmento de gasto.")


class TipoSegmentoGastoRead(TipoSegmentoGastoBase):
    """
    Schema de salida para TipoSegmentoGasto.
    """
    id: str
    associated_count: int = Field(
        0,
        description="Número real total de registros asociados al segmento de gasto.",
    )
    relation_counts: List[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle por tabla relacionada.",
    )

    model_config = ConfigDict(from_attributes=True)


__all__ = [
    "RelationCountItem",
    "TipoGastoBase",
    "TipoGastoCreate",
    "TipoGastoUpdate",
    "TipoGastoRead",
    "TipoIngresoBase",
    "TipoIngresoCreate",
    "TipoIngresoUpdate",
    "TipoIngresoRead",
    "TipoSegmentoGastoBase",
    "TipoSegmentoGastoCreate",
    "TipoSegmentoGastoUpdate",
    "TipoSegmentoGastoRead",
]