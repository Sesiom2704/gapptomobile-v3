# backend/app/schemas/ingresos.py

"""
Schemas Pydantic para INGRESOS en GapptoMobile v3.

- IngresoBase: campos básicos para crear/actualizar un ingreso.
- IngresoCreateSchema: usado al CREAR.
- IngresoUpdateSchema: usado al MODIFICAR (todos opcionales).
- IngresoSchema (IngresoRead): lo que devuelve la API (lectura).

Notas:
- En creación/actualización, fecha_inicio se maneja como str ("YYYY-MM-DD").
- En lectura, fecha_inicio se devuelve como date.
- importe se tipa como Money (Decimal alias) y se serializa como float.
- FIX IMPORTANTE:
    * En DB, user_id es INTEGER.
    * En el schema de salida antes estaba como str -> provocaba ResponseValidationError al listar.
"""

from __future__ import annotations

from typing import Optional  # , Union
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, ConfigDict

# Compatibilidad Pydantic v1/v2 para field_serializer
try:
    from pydantic import field_serializer
except Exception:  # pragma: no cover
    def field_serializer(*args, **kwargs):
        def _wrap(fn):
            return fn
        return _wrap

from backend.app.db.custom_types import Money


class IngresoBase(BaseModel):
    """
    Datos básicos de un ingreso.

    IMPORTANTE:
    - En creación/actualización, fecha_inicio se maneja como str (ej: "2025-11-01").
    - En lectura, IngresoSchema usará date para fecha_inicio.
    """
    fecha_inicio: str
    rango_cobro: str
    periodicidad: str
    tipo_id: str
    referencia_vivienda_id: Optional[str] = None
    concepto: str
    importe: Money

    # Cuenta asociada donde entra el ingreso (puede ser None)
    cuenta_id: Optional[str] = Field(default=None)

    # Permite crear desde objetos ORM (SQLAlchemy)
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("importe", when_used="json")
    def _ser_money(cls, v: Decimal | None):
        """
        Serializa Money (Decimal) como float en JSON.
        """
        return float(v) if v is not None else None


class IngresoCreateSchema(IngresoBase):
    """
    Schema para CREAR un ingreso.

    - El ID puede venir informado o generarse en el backend.
    - Activo/cobrado/kpi se ajustan según la lógica de periodicidad en el router.
    """
    id: Optional[str] = None
    activo: Optional[bool] = True
    cobrado: Optional[bool] = False
    kpi: Optional[bool] = True
    ingresos_cobrados: Optional[int] = 0
    inactivatedon: Optional[datetime] = None


class IngresoUpdateSchema(BaseModel):
    """
    Schema para MODIFICAR un ingreso.

    Todos los campos son opcionales, para permitir updates parciales.
    """
    fecha_inicio: Optional[str] = None
    rango_cobro: Optional[str] = None
    periodicidad: Optional[str] = None
    tipo_id: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    concepto: Optional[str] = None
    importe: Optional[Money] = None
    cuenta_id: Optional[str] = None

    activo: Optional[bool] = None
    cobrado: Optional[bool] = None
    kpi: Optional[bool] = None
    ingresos_cobrados: Optional[int] = None
    inactivatedon: Optional[datetime] = None

    @field_serializer("importe", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        """
        Serializa importe como float en JSON.
        """
        return float(v) if v is not None else None


class IngresoSchema(BaseModel):
    """
    Vista de LECTURA de un ingreso (lo que devuelven los endpoints).

    - fecha_inicio se devuelve como date.
    - importe como float.
    - Incluye campos de tracking: createon, modifiedon, inactivatedon, ultimo_ingreso_on.
    - Incluye cuenta_id aunque venga por relación.
    - FIX: user_id debe ser int porque en DB es INTEGER.
    """
    id: str
    fecha_inicio: Optional[date] = None
    rango_cobro: Optional[str] = None
    periodicidad: Optional[str] = None
    tipo_id: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    concepto: Optional[str] = None
    importe: Optional[float] = None

    activo: Optional[bool] = True
    cobrado: Optional[bool] = False
    kpi: Optional[bool] = False
    ingresos_cobrados: Optional[int] = 0

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None
    ultimo_ingreso_on: Optional[datetime] = None

    cuenta_id: Optional[str] = None

    # ✅ FIX AQUÍ:
    # Antes: Optional[str] -> rompía al listar porque el router devuelve int.
    user_id: Optional[int] = None

    # Si quisieras compatibilidad extra (por si en algún sitio devuelves "2" como string):
    # user_id: Optional[Union[int, str]] = None

    user_nombre: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class IngresoListado(BaseModel):
    """
    Versión reducida para listados rápidos (si la necesitas en otras pantallas).
    Nota: esta estructura es legacy; no se usa en tu router actual.
    """
    id: str
    nombre: str
    importe: Optional[float] = None
    rango_pago: Optional[str] = None
    cuenta_id: Optional[str] = None


__all__ = [
    "IngresoSchema",
    "IngresoCreateSchema",
    "IngresoUpdateSchema",
    "IngresoListado",
]
