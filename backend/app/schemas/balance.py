# schemas/balance.py
"""
Schemas (Pydantic) para Balance (visión caja / movimientos reales).

Objetivo:
- Mantener compatibilidad hacia atrás (clientes antiguos).
- Permitir ampliar el endpoint /balance/mes-cuentas con nuevos campos sin romper.

NUEVO:
- gastos_ahorro_total: suma de gastos pagados del segmento AHO (AHO-12345) en el mes.
- ingresos_reintegro_ahorro_total: suma de ingresos cobrados tipo REINTEGRO AHORRO (tipo_id=TING-2IB5N9) en el mes.
  Estos campos permiten calcular en frontend:
      Ahorrado neto = gastos_ahorro_total - ingresos_reintegro_ahorro_total
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal, List
from pydantic import BaseModel, Field

MovementKind = Literal["GASTO_GESTIONABLE", "GASTO_COTIDIANO", "INGRESO"]


class MovimientoItem(BaseModel):
    id: str
    fecha: datetime
    cuenta_id: str | None = None
    cuenta_nombre: str | None = None
    descripcion: str
    tipo: MovementKind
    es_ingreso: bool
    importe: Decimal

    class Config:
        from_attributes = True


class MovimientosMesResponse(BaseModel):
    year: int
    month: int
    total_ingresos: Decimal
    total_gastos: Decimal
    balance: Decimal
    movimientos: List[MovimientoItem]


class SaldoCuentaItem(BaseModel):
    cuenta_id: str
    anagrama: str
    inicio: float
    salidas: float
    entradas: float
    fin: float
    
    participacion_pct: float = Field(
    100.0,
    description="Porcentaje de participación del usuario sobre la cuenta bancaria. 100 = cuenta completa, 50 = media cuenta.",
)

    # nuevos campos para el modal de liquidez
    gastos_gestionables_pendientes: float
    gastos_cotidianos_pendientes: float
    ingresos_pendientes: float


class BalanceMesResponse(BaseModel):
    year: int
    month: int
    saldos_cuentas: List[SaldoCuentaItem]

    # KPIs globales de liquidez y pendientes
    liquidez_actual_total: float
    liquidez_inicio_mes_total: float
    liquidez_prevista_total: float
    ingresos_pendientes_total: float
    gastos_pendientes_total: float
    
    ahorro_mes_total: float

    # ✅ NUEVO (para cálculo Ahorrado neto en frontend)
    # Defaults para compatibilidad (si por cualquier razón no se calculan, no rompen).
    gastos_ahorro_total: float = Field(0.0, description="Total gastos del segmento AHO pagados en el mes.")
    ingresos_reintegro_ahorro_total: float = Field(
        0.0,
        description="Total ingresos REINTEGRO AHORRO cobrados en el mes (tipo_id=TING-2IB5N9).",
    )
