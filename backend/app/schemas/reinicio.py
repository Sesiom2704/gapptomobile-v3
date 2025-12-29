# backend/app/schemas/reinicio.py
"""
Schemas Pydantic para el dominio "reinicio".

Preview = datos calculados sin insertar.
Ejecución = aplica cambios / actualiza.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel


class ReinicioMesEligibilityResponse(BaseModel):
    gastos_pendientes: int
    ingresos_pendientes: int
    can_reiniciar: bool


class PresupuestoCotidianosTotalResponse(BaseModel):
    total: float


class ReinicioMesPreviewResponse(BaseModel):
    ventana_1_5_ok: bool
    eligibility: ReinicioMesEligibilityResponse
    presupuesto_cotidianos_total: PresupuestoCotidianosTotalResponse


class ReinicioMesExecuteResponse(BaseModel):
    updated: Dict[str, Any]
    summary: Dict[str, Dict[str, int]]


class CierrePreviewOut(BaseModel):
    """
    Preview "what-if": si cerráramos el mes M ahora mismo.
    No inserta nada en DB.
    """
    anio: int
    mes: int
    as_of: str  # ISO datetime

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
