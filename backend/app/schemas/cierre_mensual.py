# schemas/cierre_mensual.py
from __future__ import annotations
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime


class CierreMensualOut(BaseModel):
    id: UUID
    anio: int
    mes: int
    fecha_cierre: datetime
    user_id: Optional[int] = None
    criterio: str
    version: int
    liquidez_total: float = 0

    ingresos_esperados: float
    ingresos_reales: float
    desv_ingresos: float

    gastos_gestionables_esperados: float
    gastos_gestionables_reales: float
    gastos_cotidianos_esperados: float
    gastos_cotidianos_reales: float
    gastos_esperados_total: float
    gastos_reales_total: float

    desv_gestionables: float
    desv_cotidianos: float
    desv_gastos_total: float

    resultado_esperado: float
    resultado_real: float
    desv_resultado: float

    n_recurrentes_ing: int
    n_recurrentes_gas: int
    n_unicos_ing: int
    n_unicos_gas: int
    n_cotidianos: int
    n_pendientes_al_cerrar: int

    class Config:
        from_attributes = True


class CierreMensualDetalleOut(BaseModel):
    id: UUID
    cierre_id: UUID
    anio: int
    mes: int
    segmento_id: str
    tipo_detalle: str

    esperado: float
    real: float
    desviacion: float
    cumplimiento_pct: Optional[float] = None
    n_items: int
    incluye_kpi: bool

    fecha_cierre: datetime
    user_id: Optional[int] = None
    segmento_nombre: Optional[str] = None

    class Config:
        from_attributes = True


class CierreMensualPatchIn(BaseModel):
    # Editables: ajusta a lo que quieras permitir
    criterio: Optional[str] = None
    liquidez_total: Optional[float] = None

    ingresos_esperados: Optional[float] = None
    ingresos_reales: Optional[float] = None

    gastos_esperados_total: Optional[float] = None
    gastos_reales_total: Optional[float] = None

    resultado_esperado: Optional[float] = None
    resultado_real: Optional[float] = None


class CierreMensualDetallePatchIn(BaseModel):
    esperado: Optional[float] = None
    real: Optional[float] = None
    desviacion: Optional[float] = None
    cumplimiento_pct: Optional[float] = None
    incluye_kpi: Optional[bool] = None


class CierreMensualKpisResponse(BaseModel):
    limit: int = Field(..., ge=1, le=60)
    count: int = Field(..., ge=0)
    cierres: List[CierreMensualOut]
    detalles: List[CierreMensualDetalleOut]

