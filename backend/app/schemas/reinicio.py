# backend/app/schemas/reinicio.py
"""
Schemas Pydantic para el dominio "reinicio".

Preview = datos calculados sin insertar.
Ejecución = aplica cambios / actualiza.

Compatibilidad Pydantic v2:
- Usar ConfigDict(from_attributes=True)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Reinicio mes
# ---------------------------------------------------------------------------

class ReinicioMesEligibilityResponse(BaseModel):
    """Indica si el usuario puede reiniciar mes (sin pendientes KPI)."""
    model_config = ConfigDict(from_attributes=True)

    gastos_pendientes: int
    ingresos_pendientes: int
    can_reiniciar: bool


class PresupuestoCotidianosTotalResponse(BaseModel):
    """Presupuesto total de COT (gastos activos + KPI)."""
    model_config = ConfigDict(from_attributes=True)

    total: float


class ReinicioMesPreviewResponse(BaseModel):
    """Preview del reinicio mensual (no inserta ni modifica)."""
    model_config = ConfigDict(from_attributes=True)

    ventana_1_5_ok: bool
    eligibility: ReinicioMesEligibilityResponse
    presupuesto_cotidianos_total: PresupuestoCotidianosTotalResponse


class ReinicioMesExecuteResponse(BaseModel):
    """Resultado de ejecutar reinicio mensual (modifica estados)."""
    model_config = ConfigDict(from_attributes=True)

    updated: Dict[str, Any]
    summary: Dict[str, Dict[str, int]]


# ---------------------------------------------------------------------------
# Reinicio gastos + ingresos (nuevo: preview + ejecutar)
# ---------------------------------------------------------------------------

class PromedioContenedorPreview(BaseModel):
    """
    Representa un contenedor PROM-3M y el valor que se aplicaría.
    """
    model_config = ConfigDict(from_attributes=True)

    contenedor_tipo_id: str
    subtipos_tipo_ids: List[str]
    valor_promedio: float
    n_gastos_afectados: int

    contenedor_nombre: Optional[str] = None
    importe_cuota_actual: Optional[float] = None
    dif_mes_pct: Optional[float] = None


class ReinicioGastosIngresosPreviewResponse(BaseModel):
    """
    Preview (dry-run) del reinicio de gastos + ingresos:
      1.1 cuántos gastos se reinician (cambios esperados)
      1.2 cuántos ingresos se reinician (cambios esperados)
      1.3 cuántas cuotas están en su última cuota
      1.4 promedios que se insertarían en sus contenedores
    """
    model_config = ConfigDict(from_attributes=True)

    gastos_a_reiniciar: int
    ingresos_a_reiniciar: int
    ultimas_cuotas: int
    promedios: List[PromedioContenedorPreview]


class ReinicioGastosIngresosExecuteResponse(BaseModel):
    """
    Resultado de ejecutar reinicio de gastos + ingresos.
    Incluye:
    - updated: contadores de cambios aplicados (mismo estilo que reinicio mes)
    - promedios_actualizados: cuántos gastos contenedor se actualizaron por PROM-3M
    """
    model_config = ConfigDict(from_attributes=True)

    updated: Dict[str, Any]
    promedios_actualizados: int


# ---------------------------------------------------------------------------
# Cierre mensual (preview what-if)
# ---------------------------------------------------------------------------

class CierrePreviewOut(BaseModel):
    """
    Preview "what-if": si cerráramos el mes indicado ahora mismo.
    NO inserta nada en DB.

    Lo usa:
      GET /api/v1/reinicio/cierre/preview
    """
    model_config = ConfigDict(from_attributes=True)

    anio: int
    mes: int
    as_of: str  # ISO datetime (UTC)

    ingresos_reales: float
    gastos_reales_total: float
    resultado_real: float

    ingresos_esperados: Optional[float] = None
    gastos_esperados_total: Optional[float] = None
    resultado_esperado: Optional[float] = None

    desv_resultado: Optional[float] = None
    desv_ingresos: Optional[float] = None
    desv_gastos_total: Optional[float] = None

    extras: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Cierre mensual (ejecutar / insertar)
# ---------------------------------------------------------------------------

class CierreExecuteResponse(BaseModel):
    """
    Respuesta al ejecutar el cierre:
    - devuelve id cabecera y rango calculado
    - devuelve cuántas filas de detalle se insertaron (4)
    """
    model_config = ConfigDict(from_attributes=True)

    cierre_id: str
    anio: int
    mes: int
    inserted_detalles: int
    range_start: str
    range_end: str
