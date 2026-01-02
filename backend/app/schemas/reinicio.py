# backend/app/schemas/reinicio.py
"""
Schemas Pydantic para el dominio "reinicio".

Preview = datos calculados sin insertar.
Ejecución = aplica cambios / actualiza.

Compatibilidad Pydantic v2:
- Usar ConfigDict(from_attributes=True)
"""

from __future__ import annotations

from typing import Any, Dict, Optional
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
