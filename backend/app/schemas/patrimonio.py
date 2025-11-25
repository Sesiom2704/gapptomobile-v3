# backend/app/schemas/patrimonio.py

"""
Schemas Pydantic para el módulo de PATRIMONIO en GapptoMobile v3.

Incluye:
- PatrimonioCreate / PatrimonioUpdate / PatrimonioSchema
- PatrimonioPickerOut (para selects)
- PatrimonioCompraIn / PatrimonioCompraOut (bloque de compra)

Reglas generales:
- La lógica del router se encargará de:
    * Poner campos de texto en MAYÚSCULAS (salvo notas/observaciones).
    * Componer la dirección completa.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


# ==========================
# PATRIMONIO (viviendas)
# ==========================

class PatrimonioBase(BaseModel):
    """
    Campos base de una propiedad de patrimonio (vivienda, local, etc.).
    """
    calle: Optional[str] = Field(None, description="Nombre de la calle.")
    numero: Optional[str] = Field(None, description="Número de la vivienda.")
    escalera: Optional[str] = Field(None, description="Escalera.")
    piso: Optional[str] = Field(None, description="Piso.")
    puerta: Optional[str] = Field(None, description="Puerta.")
    localidad: Optional[str] = Field(None, description="Localidad / ciudad.")
    referencia: Optional[str] = Field(
        None,
        description="Referencia corta de la vivienda. Si no se envía, se genera automáticamente.",
    )
    tipo_inmueble: Optional[str] = Field(
        None,
        description="Tipo de inmueble (VIVIENDA, LOCAL, GARAJE...). Por defecto VIVIENDA.",
    )
    fecha_adquisicion: Optional[date] = Field(
        None,
        description="Fecha de adquisición de la vivienda.",
    )
    disponible: Optional[bool] = Field(
        None,
        description="Si la vivienda está disponible (solo si la columna existe en la BD).",
    )
    superficie_m2: Optional[float] = Field(
        None,
        description="Superficie útil en m2.",
    )
    superficie_construida: Optional[float] = Field(
        None,
        description="Superficie construida en m2.",
    )
    participacion_pct: Optional[float] = Field(
        None,
        description="Porcentaje de participación sobre el inmueble.",
    )
    habitaciones: Optional[int] = Field(
        None,
        description="Número de habitaciones.",
    )
    banos: Optional[int] = Field(
        None,
        description="Número de baños.",
    )
    garaje: Optional[bool] = Field(
        None,
        description="Indica si tiene plaza de garaje.",
    )
    trastero: Optional[bool] = Field(
        None,
        description="Indica si tiene trastero.",
    )


class PatrimonioCreate(PatrimonioBase):
    """
    Payload de creación de patrimonio.

    El ID se genera siempre en el backend.
    """
    pass


class PatrimonioUpdate(BaseModel):
    """
    Payload de actualización de patrimonio.

    Todos los campos son opcionales; solo se actualizan los enviados.
    """
    calle: Optional[str] = None
    numero: Optional[str] = None
    escalera: Optional[str] = None
    piso: Optional[str] = None
    puerta: Optional[str] = None
    localidad: Optional[str] = None
    referencia: Optional[str] = None
    tipo_inmueble: Optional[str] = None
    fecha_adquisicion: Optional[date] = None
    activo: Optional[bool] = None
    disponible: Optional[bool] = None
    superficie_m2: Optional[float] = None
    superficie_construida: Optional[float] = None
    participacion_pct: Optional[float] = None
    habitaciones: Optional[int] = None
    banos: Optional[int] = None
    garaje: Optional[bool] = None
    trastero: Optional[bool] = None


class PatrimonioSchema(PatrimonioBase):
    """
    Representación completa de una vivienda (para listados y detalle).
    """
    id: str
    direccion_completa: Optional[str] = Field(
        None,
        description="Dirección completa generada en el backend.",
    )
    activo: bool = Field(True, description="Indica si el patrimonio está activo.")

    model_config = ConfigDict(from_attributes=True)


class PatrimonioPickerOut(BaseModel):
    """
    Versión reducida para selects de la app (picker de viviendas).
    """
    id: str
    referencia: str
    direccion_completa: str

    model_config = ConfigDict(from_attributes=True)


# ==========================
# COMPRA de PATRIMONIO
# ==========================

class PatrimonioCompraIn(BaseModel):
    """
    Payload de entrada para registrar/actualizar los datos de compra.

    - valor_compra: importe de compra.
    - valor_referencia: valor de referencia fiscal (si existe).
    - impuestos_pct: porcentaje de impuestos (ITP/IVA).
    - notaria, agencia, reforma_adecuamiento: costes adicionales.
    - notas: texto libre (NO se fuerza a mayúsculas).
    """
    valor_compra: float
    valor_referencia: Optional[float] = None
    impuestos_pct: Optional[float] = None
    notaria: Optional[float] = None
    agencia: Optional[float] = None
    reforma_adecuamiento: Optional[float] = None
    notas: Optional[str] = None


class PatrimonioCompraOut(PatrimonioCompraIn):
    """
    Representación de salida de la compra, con cálculos:

    - impuestos_eur: importe de impuestos calculado.
    - total_inversion: suma de todos los conceptos.
    - created_at / updated_at: trazabilidad.
    - activo: si existe la columna en la BD.
    """
    patrimonio_id: str
    impuestos_eur: Optional[float] = None
    total_inversion: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    activo: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)
