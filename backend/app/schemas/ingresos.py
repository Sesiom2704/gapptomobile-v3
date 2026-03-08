# backend/app/schemas/ingresos.py

"""
Schemas Pydantic para INGRESOS en GapptoMobile v3.

Incluye:
- IngresoBase: campos básicos para crear/actualizar un ingreso.
- IngresoCreateSchema: usado al CREAR.
- IngresoUpdateSchema: usado al MODIFICAR (todos opcionales).
- IngresoSchema: lo que devuelve la API (lectura).
- IngresoListado: versión reducida legacy para listados rápidos.

Notas:
- En creación/actualización, fecha_inicio se maneja como str ("YYYY-MM-DD").
- En lectura, fecha_inicio se devuelve como date.
- importe se tipa como Money (Decimal alias) y se serializa como float.

Fix importante:
- En DB, user_id es INTEGER.
- En el schema de salida debe mantenerse como int.

Cambios v3 (omitidos):
- Se añaden campos de lectura:
    * omitido_este_mes
    * ultimo_omitido_on
    * omitido_count
- Se permite update parcial de omitido_este_mes.

Cambios v3 (alquiler):
- Se añade en lectura:
    * contrato_alquiler
  para exponer el vínculo entre un ingreso y el contrato que lo originó.
- NO se añade en create/update porque debe gestionarlo el backend.

Cambios v3 (ramas de ingreso):
- Se añade rama_id en create/update/read.
- Se añade rama_nombre en lectura para facilitar el render del front.
- La coherencia entre rama_id y tipo_id debe validarse en servicio/router.
"""

from __future__ import annotations

from typing import Optional
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

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
    - En creación/actualización, fecha_inicio se maneja como str.
    - En lectura, IngresoSchema usa date.
    - rama_id ya forma parte del flujo funcional:
        1) el usuario elige rama
        2) se cargan los tipos disponibles de esa rama
        3) se guarda rama_id + tipo_id
    """
    fecha_inicio: str
    rango_cobro: str
    periodicidad: str

    # NUEVO: rama de ingreso elegida por el usuario
    rama_id: str

    # Tipo de ingreso dentro de la rama seleccionada
    tipo_id: str

    referencia_vivienda_id: Optional[str] = None
    concepto: str
    importe: Money

    # Cuenta asociada donde entra el ingreso (puede ser None)
    cuenta_id: Optional[str] = Field(default=None)

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
    - Activo/cobrado/kpi se ajustan según la lógica de periodicidad.
    - contrato_alquiler NO se expone aquí: lo debe setear backend.
    - Aunque rama_id viene del cliente, el backend debe validar que:
        tipo_id pertenece realmente a rama_id.
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

    v3 (omitidos):
    - omitido_este_mes se permite para soportar:
        * Omitir mes  -> omitido_este_mes = True
        * Deshacer    -> omitido_este_mes = False

    v3 (ramas):
    - rama_id y tipo_id pueden actualizarse.
    - El backend debe validar que ambos sigan siendo coherentes.

    Nota:
    - contrato_alquiler NO se expone aquí: debe mantenerse controlado por backend.
    """
    fecha_inicio: Optional[str] = None
    rango_cobro: Optional[str] = None
    periodicidad: Optional[str] = None

    # NUEVO
    rama_id: Optional[str] = None
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

    # v3: omitidos
    omitido_este_mes: Optional[bool] = None

    @field_serializer("importe", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        """
        Serializa importe como float en JSON.
        """
        return float(v) if v is not None else None


class IngresoSchema(BaseModel):
    """
    Vista de LECTURA de un ingreso.

    - fecha_inicio se devuelve como date.
    - importe como float.
    - Incluye campos de tracking.
    - Incluye cuenta_id aunque venga por relación.
    - user_id debe ser int porque en DB es INTEGER.

    v3 (omitidos):
    - Se exponen:
        * omitido_este_mes
        * ultimo_omitido_on
        * omitido_count

    v3 (alquiler):
    - Se expone:
        * contrato_alquiler

    v3 (ramas):
    - Se expone:
        * rama_id
        * rama_nombre
    """
    id: str
    fecha_inicio: Optional[date] = None
    rango_cobro: Optional[str] = None
    periodicidad: Optional[str] = None

    # NUEVO
    rama_id: Optional[str] = None
    rama_nombre: Optional[str] = None

    tipo_id: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    concepto: Optional[str] = None
    importe: Optional[float] = None

    activo: Optional[bool] = True
    cobrado: Optional[bool] = False
    kpi: Optional[bool] = False
    ingresos_cobrados: Optional[int] = 0

    # v3: omitidos
    omitido_este_mes: Optional[bool] = None
    ultimo_omitido_on: Optional[datetime] = None
    omitido_count: Optional[int] = None

    # v3: alquiler
    contrato_alquiler: Optional[str] = None

    createon: Optional[datetime] = None
    modifiedon: Optional[datetime] = None
    inactivatedon: Optional[datetime] = None
    ultimo_ingreso_on: Optional[datetime] = None

    cuenta_id: Optional[str] = None

    user_id: Optional[int] = None
    user_nombre: Optional[str] = None

    # Útiles para el front si decides exponerlos desde el servicio/router
    tipo_nombre: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class IngresoListado(BaseModel):
    """
    Versión reducida para listados rápidos.

    Nota:
    - Es una estructura legacy.
    - Se amplía con rama_id para que siga siendo compatible
      con la nueva lógica de selector por rama.
    """
    id: str
    nombre: str
    importe: Optional[float] = None
    rango_pago: Optional[str] = None
    cuenta_id: Optional[str] = None
    rama_id: Optional[str] = None


__all__ = [
    "IngresoSchema",
    "IngresoCreateSchema",
    "IngresoUpdateSchema",
    "IngresoListado",
]