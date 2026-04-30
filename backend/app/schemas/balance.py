# schemas/balance.py
"""
Schemas (Pydantic) para Balance (visión caja / movimientos reales).

Objetivo:
- Mantener compatibilidad hacia atrás (clientes antiguos).
- Permitir ampliar el endpoint /balance/mes-cuentas con nuevos campos sin romper.

NUEVO:
- participacion_pct en SaldoCuentaItem para calcular liquidez ponderada en Home.
- gastos_ahorro_total: suma de gastos pagados del segmento AHO (AHO-12345) en el mes.
- ingresos_reintegro_ahorro_total: suma de ingresos cobrados tipo REINTEGRO AHORRO.
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

    # Participación de la cuenta para métricas patrimoniales.
    # Ejemplo: 100 = cuenta propia completa, 50 = cuenta compartida al 50%.
    participacion_pct: float = 100.0

    gastos_gestionables_pendientes: float
    gastos_cotidianos_pendientes: float
    ingresos_pendientes: float


class BalanceMesResponse(BaseModel):
    year: int
    month: int
    saldos_cuentas: List[SaldoCuentaItem]

    liquidez_actual_total: float
    liquidez_inicio_mes_total: float
    liquidez_prevista_total: float
    ingresos_pendientes_total: float
    gastos_pendientes_total: float

    ahorro_mes_total: float

    gastos_ahorro_total: float = Field(
        0.0,
        description="Total gastos del segmento AHO pagados en el mes.",
    )
    ingresos_reintegro_ahorro_total: float = Field(
        0.0,
        description="Total ingresos REINTEGRO AHORRO cobrados en el mes.",
    )