# backend/app/schemas/gastos.py

"""
Schemas Pydantic para GASTOS (gestionables) en GapptoMobile v3.

Este módulo está extraído de tu antiguo `schemas.py` de v2, manteniendo:
- Los mismos campos.
- Los mismos tipos.
- La misma forma de serializar dinero (Money -> float en JSON).

Solo se ha cambiado:
- La ruta de import del tipo Money (backend.app.db.custom_types).
- La organización (ahora separado en este fichero en lugar de un schemas.py gigante).
"""

from __future__ import annotations

from typing import Optional
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field
from pydantic import ConfigDict  # para model_config = ConfigDict(from_attributes=True)

# Compatibilidad Pydantic v1/v2 para field_serializer:
try:
    # Pydantic v2
    from pydantic import field_serializer
except Exception:  # pragma: no cover
    # Fallback para Pydantic v1 (decorador "inocuo")
    def field_serializer(*args, **kwargs):
        def _wrap(fn):
            return fn
        return _wrap

# Tipo Money usado en tus modelos (Decimal con validación)
from backend.app.db.custom_types import Money


# ============================================================
# GASTOS (gestionables)
# ============================================================

class GastoBase(BaseModel):
    """
    Datos base de un gasto gestionable.

    NOTA:
    - En CREATE/UPDATE la fecha se maneja como str (dd/mm/aaaa o similar).
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

    # Campos monetarios con tipo Money (Decimal por debajo)
    importe: Money
    cuotas: int
    total: Money

    rango_pago: str
    activo: bool = True
    pagado: bool = False
    kpi: bool = False

    # Relación con otros gastos / patrimonio
    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None

    @field_serializer("importe", "total", when_used="json")
    def _ser_money_base(cls, v: Decimal | None):
        """
        Cuando se devuelve como JSON:
        - Convierte Money (Decimal) a float.
        - Si es None, devuelve None.
        """
        return float(v) if v is not None else None


class GastoCreate(GastoBase):
    """
    Schema para CREAR un gasto gestionable.

    - inactivatedon es opcional y normalmente se deja a NULL.
    - El servidor se encarga de calcular:
      * id
      * createon / modifiedon
      * cuotas_pagadas / cuotas_restantes
      * importe_cuota / importe_pendiente
    """
    inactivatedon: Optional[datetime] = None


class GastoUpdate(BaseModel):
    """
    Schema para MODIFICAR un gasto gestionable.

    Todos los campos son opcionales; solo se actualiza lo que venga informado.
    Los campos monetarios siguen usando Money (Decimal por debajo).
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
    cuotas: Optional[int] = None
    total: Optional[Money] = None
    rango_pago: Optional[str] = None
    activo: Optional[bool] = None
    pagado: Optional[bool] = None
    kpi: Optional[bool] = None
    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    cuotas_pagadas: Optional[int] = None
    inactivatedon: Optional[datetime] = None

    @field_serializer("importe", "total", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        """
        Serializador para importe/total en respuestas de actualización.
        """
        return float(v) if v is not None else None


class GastoRead(BaseModel):
    """
    Vista de LECTURA de un gasto gestionable (lo que devuelven los endpoints).

    Diferencias respecto a GastoBase:
    - fecha es date (no str).
    - importe / importe_cuota / total / importe_pendiente son float.
    - Incluye campos de tracking: createon, modifiedon, inactivatedon.
    - Incluye rama (texto) resuelta a nivel de modelo/BD.
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

    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None

    # texto de la rama (ej: "VIVIENDA", "OCIO", etc.)
    rama: Optional[str] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None  # NUEVO en v2/v3

    # Indica a Pydantic que puede construir este schema a partir de un objeto ORM
    model_config = ConfigDict(from_attributes=True)


# Aliases para mantener compatibilidad con los nombres usados en los routers
GastoSchema = GastoRead
GastoCreateSchema = GastoCreate
GastoUpdateSchema = GastoUpdate
