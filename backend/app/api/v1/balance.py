# schemas/balance.py
from datetime import datetime
from decimal import Decimal
from typing import Literal, List
from pydantic import BaseModel

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
    
    # 👉 NUEVO KPI: ahorro del mes (gasto con segmento ahorro)
    ahorro_mes_total: float