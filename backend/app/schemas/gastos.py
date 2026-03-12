"""
Ruta: backend/app/schemas/gastos.py
Versión: 1.7.0
Descripción:
Schemas Pydantic para gastos gestionables.
Expone los campos necesarios para create/update/read en GapptoMobile v3,
incluyendo tracking, omisión mensual y metadatos de auditoría.
"""

from __future__ import annotations

from typing import Optional
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel
from pydantic import ConfigDict

try:
    from pydantic import field_serializer
except Exception:  # pragma: no cover
    def field_serializer(*args, **kwargs):
        def _wrap(fn):
            return fn
        return _wrap

from backend.app.db.custom_types import Money


class GastoBase(BaseModel):
    """
    Datos base de un gasto gestionable.

    NOTA:
    - En CREATE/UPDATE la fecha se maneja como str.
    - En lectura (GastoRead) se devolverá como date.
    """

    fecha: str
    periodicidad: str
    nombre: str
    tienda: Optional[str] = None
    proveedor_id: str
    tipo_id: str
    segmento_id: str
    cuenta_id: str

    importe: Money
    importe_cuota: Money
    cuotas: int
    total: Money

    rango_pago: str
    activo: bool = True
    pagado: bool = False
    kpi: bool = False

    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    comentarios: Optional[str] = None

    @field_serializer("importe", "importe_cuota", "total", when_used="json")
    def _ser_money_base(cls, v: Decimal | None):
        return float(v) if v is not None else None


class GastoCreate(GastoBase):
    """
    Schema para CREAR un gasto gestionable.
    """

    inactivatedon: Optional[datetime] = None


class GastoUpdate(BaseModel):
    """
    Schema para MODIFICAR un gasto gestionable.
    Todos los campos son opcionales; solo se actualiza lo que venga informado.
    """

    fecha: Optional[str] = None
    periodicidad: Optional[str] = None
    nombre: Optional[str] = None
    tienda: Optional[str] = None
    proveedor_id: Optional[str] = None
    tipo_id: Optional[str] = None
    segmento_id: Optional[str] = None
    cuenta_id: Optional[str] = None

    importe: Optional[Money] = None
    importe_cuota: Optional[Money] = None
    total: Optional[Money] = None

    cuotas: Optional[int] = None
    rango_pago: Optional[str] = None
    activo: Optional[bool] = None
    pagado: Optional[bool] = None
    kpi: Optional[bool] = None

    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None

    cuotas_pagadas: Optional[int] = None
    inactivatedon: Optional[datetime] = None
    comentarios: Optional[str] = None

    omitido_este_mes: Optional[bool] = None

    @field_serializer("importe", "importe_cuota", "total", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        return float(v) if v is not None else None


class GastoRead(BaseModel):
    """
    Vista de lectura de un gasto gestionable.
    """

    id: str
    fecha: Optional[date] = None
    periodicidad: Optional[str] = None
    nombre: Optional[str] = None
    tienda: Optional[str] = None
    proveedor_id: Optional[str] = None
    tipo_id: Optional[str] = None
    segmento_id: Optional[str] = None
    cuenta_id: Optional[str] = None

    proveedor_nombre: Optional[str] = None
    tipo_nombre: Optional[str] = None
    segmento_nombre: Optional[str] = None
    cuenta_anagrama: Optional[str] = None
    user_nombre: Optional[str] = None

    importe: Optional[float] = None
    importe_cuota: Optional[float] = None
    cuotas: Optional[int] = None
    total: Optional[float] = None
    cuotas_pagadas: Optional[int] = None
    cuotas_restantes: Optional[int] = None
    importe_pendiente: Optional[float] = None

    rango_pago: Optional[str] = None
    activo: Optional[bool] = None
    pagado: Optional[bool] = None
    kpi: Optional[bool] = None

    omitido_este_mes: Optional[bool] = None
    ultimo_omitido_on: Optional[datetime] = None
    omitido_count: Optional[int] = None

    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    rama: Optional[str] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None
    ultimo_pago_on: Optional[datetime] = None
    comentarios: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


GastoSchema = GastoRead
GastoCreateSchema = GastoCreate
GastoUpdateSchema = GastoUpdate