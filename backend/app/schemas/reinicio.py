# backend/app/schemas/reinicio.py
"""
Schemas Pydantic para el dominio "reinicio".

Preview = datos calculados sin insertar.
Ejecución = aplica cambios / inserta / actualiza.
"""

from typing import Any, Dict
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
