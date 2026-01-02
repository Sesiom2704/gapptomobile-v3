# backend/app/schemas/reinicio.py
"""
Schemas Pydantic para el dominio "reinicio".

Preview = datos calculados sin insertar.
Ejecución = aplica cambios / actualiza.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel

from datetime import datetime

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


class CierreMensualOut(BaseModel):
    id: str
    anio: int
    mes: int
    fecha_cierre: datetime
    user_id: Optional[int] = None
    criterio: str

    liquidez_total: float

    ingresos_esperados: float
    ingresos_reales: float
    desv_ingresos: float

    gastos_gestionables_esperados: float
    gastos_gestionables_reales: float
    gastos_cotidianos_esperados: float
    gastos_cotidianos_reales: float
    gastos_esperados_total: float
    gastos_reales_total: float

    resultado_esperado: float
    resultado_real: float
    desv_resultado: float

    desv_gestionables: float
    desv_cotidianos: float
    desv_gastos_total: float

    n_recurrentes_ing: int
    n_recurrentes_gas: int
    n_unicos_ing: int
    n_unicos_gas: int
    n_cotidianos: int

    # ✅ Compatibilidad (ya NO existen en DB; no deben ser required)
    version: Optional[int] = None
    n_pendientes_al_cerrar: Optional[int] = None

    class Config:
        from_attributes = True  # Pydantic v2 (en v1 sería orm_mode = True)
