from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Literal

from pydantic import BaseModel, Field, ConfigDict


# ============================
# Pydantic: PRESTAMO
# ============================

class PrestamoBase(BaseModel):
    """
    Campos básicos de un préstamo.
    Los enumerados (periodicidad, tipo_interes) limitan a valores válidos.
    """
    nombre: str
    proveedor_id: str
    referencia_vivienda_id: str | None = None
    cuenta_id: str

    periodicidad: Literal["MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"]
    plazo_meses: int = Field(..., gt=0)
    fecha_inicio: date

    importe_principal: Decimal = Field(..., max_digits=14, decimal_places=2)
    tipo_interes: Literal["FIJO", "VARIABLE", "MIXTO"]
    tin_pct: Decimal = Field(..., max_digits=6, decimal_places=3)
    tae_pct: Decimal | None = Field(None, max_digits=6, decimal_places=3)
    indice: str | None = None
    diferencial_pct: Decimal | None = Field(None, max_digits=6, decimal_places=3)

    comision_apertura: Decimal = Field(Decimal("0"), max_digits=14, decimal_places=2)
    otros_gastos_iniciales: Decimal = Field(Decimal("0"), max_digits=14, decimal_places=2)

    rango_pago: str | None = None
    activo: bool = True


class PrestamoCreate(PrestamoBase):
    """
    Para creación:
    - El servidor genera id, cuotas_totales, fecha_vencimiento
      y los campos de capital/intereses pendientes.
    """
    pass


class PrestamoUpdate(BaseModel):
    """
    Campos opcionales para actualizar un préstamo ya existente.
    Solo se modifican los que se envíen con valor distinto de None.
    """
    nombre: str | None = None
    proveedor_id: str | None = None
    referencia_vivienda_id: str | None = None
    cuenta_id: str | None = None

    fecha_inicio: date | None = None
    periodicidad: Literal["MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"] | None = None
    plazo_meses: int | None = Field(None, gt=0)

    importe_principal: Decimal | None = Field(None, max_digits=14, decimal_places=2)
    tipo_interes: Literal["FIJO", "VARIABLE", "MIXTO"] | None = None
    tin_pct: Decimal | None = Field(None, max_digits=6, decimal_places=3)
    tae_pct: Decimal | None = Field(None, max_digits=6, decimal_places=3)
    indice: str | None = None
    diferencial_pct: Decimal | None = Field(None, max_digits=6, decimal_places=3)

    comision_apertura: Decimal | None = Field(None, max_digits=14, decimal_places=2)
    otros_gastos_iniciales: Decimal | None = Field(None, max_digits=14, decimal_places=2)

    rango_pago: str | None = None
    activo: bool | None = None
    estado: Literal["ACTIVO", "CANCELADO", "INACTIVO"] | None = None


class PrestamoOut(BaseModel):
    """
    Representación completa del préstamo al devolverlo por API.
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    nombre: str
    proveedor_id: str
    referencia_vivienda_id: str | None
    cuenta_id: str

    fecha_inicio: date
    periodicidad: str
    plazo_meses: int

    importe_principal: Decimal
    tipo_interes: str
    tin_pct: Decimal
    tae_pct: Decimal | None
    indice: str | None
    diferencial_pct: Decimal | None

    comision_apertura: Decimal
    otros_gastos_iniciales: Decimal

    estado: str
    cuotas_totales: int
    cuotas_pagadas: int
    fecha_vencimiento: date

    rango_pago: str | None
    activo: bool

    capital_pendiente: Optional[Decimal] = None
    intereses_pendientes: Optional[Decimal] = None

    createon: datetime
    modifiedon: datetime
    inactivatedon: datetime | None
    referencia_gasto: str | None


# ============================
# Pydantic: PRESTAMO_CUOTA
# ============================

class PrestamoCuotaOut(BaseModel):
    """
    Línea del plan de cuotas de un préstamo.
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    prestamo_id: str
    num_cuota: int
    fecha_vencimiento: date

    importe_cuota: Decimal
    capital: Decimal
    interes: Decimal
    seguros: Decimal
    comisiones: Decimal
    saldo_posterior: Decimal

    pagada: bool
    fecha_pago: date | None
    gasto_id: str | None

    createon: datetime
    modifiedon: datetime


# ============================
# Pydantic: Amortización (body)
# ============================

class AmortizacionIn(BaseModel):
    """
    Petición de amortización de capital:
      - cantidad: solo capital
      - cancelacion_pct: comisión sobre la cantidad (opcional)
      - cuenta_id: permite usar otra cuenta distinta a la del préstamo
    """
    cantidad: float = Field(..., gt=0, description="Importe a amortizar (solo capital)")
    cancelacion_pct: float | None = Field(0, ge=0, description="% de comisión sobre la cantidad")
    cuenta_id: str | None = Field(None, description="Cuenta desde la que se carga el pago")
