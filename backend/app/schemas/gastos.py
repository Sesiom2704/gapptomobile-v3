# backend/app/schemas/gastos.py

"""
Schemas Pydantic para GASTOS (gestionables) en GapptoMobile v3.

Este módulo está extraído de tu antiguo `schemas.py` de v2, manteniendo:
- Los mismos campos.
- Los mismos tipos.
- La misma forma de serializar dinero (Money -> float en JSON).

Cambios v3 (omitidos):
- Se añaden campos de lectura:
    * omitido_este_mes
    * ultimo_omitido_on
    * omitido_count
- Se permite update parcial de omitido_este_mes (para la opción "Omitir mes"/"Deshacer omisión").
  Nota: idealmente esto lo expones por endpoint/acción dedicada, pero no rompe nada dejarlo en Update.

FIX (2026-01) - importe_cuota:
- En la tabla/models existe `importe_cuota`, y en el router se usa en create/update.
- El schema GastoUpdate NO lo incluía, por lo que Pydantic descartaba el campo aunque el cliente lo enviase.
- Se añade `importe_cuota` en GastoBase y GastoUpdate (y sus serializers) para permitir:
    * editar presupuesto (importe_cuota) en COTIDIANOS sin tocar importe (restante)
"""

from __future__ import annotations

from typing import Optional
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel
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
    # IMPORTANT:
    # - `importe_cuota` existe en el modelo/tabla y se usa en router (create/update).
    # - En NO-COT suele ser igual a `importe`.
    # - En COT puede ser diferente (presupuesto vs restante).
    importe: Money
    importe_cuota: Money
    cuotas: int
    total: Money

    rango_pago: str
    activo: bool = True
    pagado: bool = False
    kpi: bool = False

    # Relación con otros gastos / patrimonio
    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    comentarios: Optional[str] = None

    @field_serializer("importe", "importe_cuota", "total", when_used="json")
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
    - El servidor se encarga de calcular/ajustar:
      * id
      * createon / modifiedon
      * cuotas_pagadas / cuotas_restantes
      * importe_pendiente
      * (y puede sobreescribir importe/importe_cuota/total según reglas de negocio)
    """
    inactivatedon: Optional[datetime] = None


class GastoUpdate(BaseModel):
    """
    Schema para MODIFICAR un gasto gestionable.

    Todos los campos son opcionales; solo se actualiza lo que venga informado.
    Los campos monetarios siguen usando Money (Decimal por debajo).

    v3 (omitidos):
    - omitido_este_mes se permite para soportar la opción:
        * Omitir mes  -> omitido_este_mes = True
        * Deshacer    -> omitido_este_mes = False
      La lógica de ultimo_omitido_on y omitido_count se recomienda gestionarla
      en backend (router/service), no desde el cliente.

    FIX (2026-01):
    - Se añade `importe_cuota` para permitir update parcial de este campo.
    """
    fecha: Optional[str] = None
    periodicidad: Optional[str] = None
    nombre: Optional[str] = None
    tienda: Optional[str] = None
    proveedor_id: Optional[str] = None
    tipo_id: Optional[str] = None
    segmento_id: Optional[str] = None
    cuenta_id: Optional[str] = None

    # Monetarios
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

    # -----------------------
    # v3: omitidos
    # -----------------------
    omitido_este_mes: Optional[bool] = None

    @field_serializer("importe", "importe_cuota", "total", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        """
        Serializador para importe/importe_cuota/total en respuestas de actualización.
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

    v3 (omitidos):
    - Se exponen:
        * omitido_este_mes
        * ultimo_omitido_on
        * omitido_count
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

    # ✅ Campos “resueltos” para UI
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

    # -----------------------
    # v3: omitidos
    # -----------------------
    omitido_este_mes: Optional[bool] = None
    ultimo_omitido_on: Optional[datetime] = None
    omitido_count: Optional[int] = None

    referencia_gasto: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None

    # texto de la rama (ej: "VIVIENDA", "OCIO", etc.)
    rama: Optional[str] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None  # NUEVO en v2/v3
    comentarios: Optional[str] = None

    # Indica a Pydantic que puede construir este schema a partir de un objeto ORM
    model_config = ConfigDict(from_attributes=True)


# Aliases para mantener compatibilidad con los nombres usados en los routers
GastoSchema = GastoRead
GastoCreateSchema = GastoCreate
GastoUpdateSchema = GastoUpdate
