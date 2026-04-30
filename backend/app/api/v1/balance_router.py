# backend/app/api/v1/balance_router.py
"""
API v1 - BALANCE (visión caja / movimientos reales)

Este router expone endpoints orientados a "caja" (liquidez), es decir:
- Movimientos reales del mes: gastos pagados e ingresos cobrados.
- Balance por cuentas del mes: entradas/salidas reales por cuenta y KPI de liquidez.

Principios:
- Solo se consideran movimientos que impactan banco/caja:
    - Gasto: pagado=True y ultimo_pago_on dentro del mes.
    - Ingreso: cobrado=True y ultimo_ingreso_on dentro del mes.
    - Cotidianos: líneas en gastos_cotidianos pagado=True dentro del mes.

Regla de participación:
- La participación de cuentas NO modifica entradas, salidas ni saldo real.
- Solo se devuelve participacion_pct por cuenta para que Home pueda calcular liquidez ponderada.
- Ejemplo: cuenta con saldo real 1.000 € y participación 50% computará como 500 € en patrimonio/liquidez Home.

NUEVO:
- En /balance/mes-cuentas se añade participacion_pct en cada cuenta.
- En /balance/mes-cuentas se mantienen:
    - gastos_ahorro_total
    - ingresos_reintegro_ahorro_total
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db
from backend.app.schemas.balance import (
    BalanceMesResponse,
    MovimientoItem,
    MovimientosMesResponse,
    SaldoCuentaItem,
)

router = APIRouter(prefix="/balance", tags=["balance"])

AHO_SEGMENTO_ID = "AHO-12345"
REINTEGRO_AHORRO_TIPO_ID = "TING-2IB5N9"
COT_SEGMENTO_ID = "COT-12345"


def _get_month_range(year: Optional[int], month: Optional[int]) -> Tuple[date, date]:
    today = date.today()
    y = year or today.year
    m = month or today.month

    start = date(y, m, 1)
    if m == 12:
        end = date(y + 1, 1, 1)
    else:
        end = date(y, m + 1, 1)
    return start, end


def _to_decimal(x) -> Decimal:
    if x is None:
        return Decimal("0.00")
    try:
        return Decimal(str(x))
    except Exception:
        return Decimal("0.00")


def _gasto_importe_real(g: models.Gasto) -> Decimal:
    ic = getattr(g, "importe_cuota", None)
    if ic is not None:
        return _to_decimal(ic)
    return _to_decimal(getattr(g, "importe", None))


def _normalize_fecha(dt):
    try:
        if getattr(dt, "tzinfo", None) is not None:
            return dt.replace(tzinfo=None)
    except Exception:
        pass
    return dt


def _participacion_pct_cuenta(c: models.CuentaBancaria) -> float:
    """
    Devuelve la participación de cuenta en porcentaje.

    Compatibilidad:
    - Si la columna todavía no existe en alguna BD antigua, devuelve 100.
    """
    try:
        raw = getattr(c, "participacion_pct", 100.0)
        if raw is None:
            return 100.0
        val = float(raw)
        if val <= 0:
            return 100.0
        if val > 100:
            return 100.0
        return val
    except Exception:
        return 100.0


@router.get("/mes", response_model=MovimientosMesResponse)
def get_movimientos_mes(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Devuelve todos los movimientos reales del mes.

    Importante:
    - Aquí NO se aplica participación.
    - Son movimientos bancarios/caja reales.
    """
    start, end = _get_month_range(year, month)

    movimientos: list[MovimientoItem] = []

    gastos_pagados = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .all()
    )

    for g in gastos_pagados:
        cuenta_nombre = None
        try:
            if getattr(g, "cuenta_rel", None) is not None:
                cuenta_nombre = getattr(g.cuenta_rel, "anagrama", None) or getattr(
                    g.cuenta_rel, "referencia", None
                )
        except Exception:
            pass

        movimientos.append(
            MovimientoItem(
                id=g.id,
                fecha=g.ultimo_pago_on,
                cuenta_id=getattr(g, "cuenta_id", None),
                cuenta_nombre=cuenta_nombre or getattr(g, "cuenta_id", None),
                descripcion=getattr(g, "nombre", None) or "GASTO",
                tipo="GASTO_GESTIONABLE",
                es_ingreso=False,
                importe=_gasto_importe_real(g),
            )
        )

    gastos_cotidianos = (
        db.query(models.GastoCotidiano)
        .filter(
            models.GastoCotidiano.user_id == current_user.id,
            models.GastoCotidiano.pagado.is_(True),
            models.GastoCotidiano.fecha >= start,
            models.GastoCotidiano.fecha < end,
        )
        .all()
    )

    for gc in gastos_cotidianos:
        cuenta_nombre = None
        try:
            if getattr(gc, "cuenta", None) is not None:
                cuenta_nombre = getattr(gc.cuenta, "anagrama", None) or getattr(
                    gc.cuenta, "referencia", None
                )
        except Exception:
            pass

        proveedor_nombre = None
        try:
            if getattr(gc, "proveedor_rel", None) is not None:
                proveedor_nombre = getattr(gc.proveedor_rel, "nombre", None)
        except Exception:
            pass

        if not proveedor_nombre:
            proveedor_nombre = "GASTO COTIDIANO"

        movimientos.append(
            MovimientoItem(
                id=gc.id,
                fecha=gc.fecha,
                cuenta_id=getattr(gc, "cuenta_id", None),
                cuenta_nombre=cuenta_nombre or getattr(gc, "cuenta_id", None),
                descripcion=proveedor_nombre,
                tipo="GASTO_COTIDIANO",
                es_ingreso=False,
                importe=_to_decimal(getattr(gc, "importe", None)),
            )
        )

    ingresos_cobrados = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado.is_(True),
            models.Ingreso.ultimo_ingreso_on >= start,
            models.Ingreso.ultimo_ingreso_on < end,
        )
        .all()
    )

    for i in ingresos_cobrados:
        cuenta_nombre = None
        try:
            if getattr(i, "cuenta", None) is not None:
                cuenta_nombre = getattr(i.cuenta, "anagrama", None) or getattr(
                    i.cuenta, "referencia", None
                )
        except Exception:
            pass

        movimientos.append(
            MovimientoItem(
                id=i.id,
                fecha=i.ultimo_ingreso_on,
                cuenta_id=getattr(i, "cuenta_id", None),
                cuenta_nombre=cuenta_nombre or getattr(i, "cuenta_id", None),
                descripcion=getattr(i, "concepto", None) or "INGRESO",
                tipo="INGRESO",
                es_ingreso=True,
                importe=_to_decimal(getattr(i, "importe", None)),
            )
        )

    movimientos.sort(key=lambda m: _normalize_fecha(m.fecha), reverse=True)

    total_ingresos = sum((m.importe for m in movimientos if m.es_ingreso), Decimal("0.00"))
    total_gastos = sum((m.importe for m in movimientos if not m.es_ingreso), Decimal("0.00"))
    balance = total_ingresos - total_gastos

    year_final = year or (movimientos[0].fecha.year if movimientos else start.year)
    month_final = month or (movimientos[0].fecha.month if movimientos else start.month)

    return MovimientosMesResponse(
        year=year_final,
        month=month_final,
        total_ingresos=total_ingresos,
        total_gastos=total_gastos,
        balance=balance,
        movimientos=movimientos,
    )


@router.get("/mes-cuentas", response_model=BalanceMesResponse)
def get_balance_cuentas_mes(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Balance por cuentas para un mes.

    Importante:
    - inicio, entradas, salidas y fin son reales.
    - participacion_pct se informa para que el frontend calcule liquidez ponderada.
    """
    start, end = _get_month_range(year, month)

    cuentas: List[models.CuentaBancaria] = (
        db.query(models.CuentaBancaria)
        .filter(
            models.CuentaBancaria.user_id == current_user.id,
            models.CuentaBancaria.activo.is_(True),
        )
        .all()
    )

    if not cuentas:
        return BalanceMesResponse(
            year=start.year,
            month=start.month,
            saldos_cuentas=[],
            liquidez_actual_total=0.0,
            liquidez_inicio_mes_total=0.0,
            liquidez_prevista_total=0.0,
            ingresos_pendientes_total=0.0,
            gastos_pendientes_total=0.0,
            ahorro_mes_total=0.0,
            gastos_ahorro_total=0.0,
            ingresos_reintegro_ahorro_total=0.0,
        )

    cuenta_ids = [c.id for c in cuentas]

    ingresos_q = (
        db.query(
            models.Ingreso.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(models.Ingreso.importe), 0.0).label("total_entradas"),
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado.is_(True),
            models.Ingreso.cuenta_id.in_(cuenta_ids),
            models.Ingreso.ultimo_ingreso_on >= start,
            models.Ingreso.ultimo_ingreso_on < end,
        )
        .group_by(models.Ingreso.cuenta_id)
        .all()
    )
    entradas_por_cuenta = {row.cuenta_id: float(row.total_entradas or 0.0) for row in ingresos_q}

    gastos_mes_q = (
        db.query(
            models.Gasto.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0).label("total_salidas"),
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    salidas_gastos_por_cuenta = {row.cuenta_id: float(row.total_salidas or 0.0) for row in gastos_mes_q}

    gastos_cotidianos_mes_q = (
        db.query(
            models.GastoCotidiano.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(models.GastoCotidiano.importe), 0.0).label("total_salidas"),
        )
        .filter(
            models.GastoCotidiano.user_id == current_user.id,
            models.GastoCotidiano.pagado.is_(True),
            models.GastoCotidiano.cuenta_id.in_(cuenta_ids),
            models.GastoCotidiano.fecha >= start,
            models.GastoCotidiano.fecha < end,
        )
        .group_by(models.GastoCotidiano.cuenta_id)
        .all()
    )
    salidas_cotidianos_por_cuenta = {row.cuenta_id: float(row.total_salidas or 0.0) for row in gastos_cotidianos_mes_q}

    salidas_mes_por_cuenta: dict[str, float] = {}
    for cid in cuenta_ids:
        salidas_mes_por_cuenta[cid] = (
            salidas_gastos_por_cuenta.get(cid, 0.0)
            + salidas_cotidianos_por_cuenta.get(cid, 0.0)
        )

    ingresos_pendientes_q = (
        db.query(
            models.Ingreso.cuenta_id,
            func.coalesce(func.sum(models.Ingreso.importe), 0.0).label("importe"),
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo.is_(True),
            models.Ingreso.kpi.is_(True),
            models.Ingreso.cobrado.is_(False),
            models.Ingreso.cuenta_id.in_(cuenta_ids),
        )
        .group_by(models.Ingreso.cuenta_id)
        .all()
    )
    ingresos_pendientes_por_cuenta = {row.cuenta_id: float(row.importe or 0.0) for row in ingresos_pendientes_q}

    gastos_gestionables_pendientes_q = (
        db.query(
            models.Gasto.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(func.coalesce(models.Gasto.importe, 0.0)), 0.0).label("importe"),
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo.is_(True),
            models.Gasto.kpi.is_(True),
            models.Gasto.pagado.is_(False),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            func.coalesce(models.Gasto.segmento_id, "") != COT_SEGMENTO_ID,
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    gastos_pendientes_por_cuenta = {
        row.cuenta_id: float(row.importe or 0.0) for row in gastos_gestionables_pendientes_q
    }

    gastos_cotidianos_pendientes_q = (
        db.query(
            models.Gasto.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(func.coalesce(models.Gasto.importe, 0.0)), 0.0).label("importe"),
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo.is_(True),
            models.Gasto.kpi.is_(True),
            models.Gasto.pagado.is_(False),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            models.Gasto.segmento_id == COT_SEGMENTO_ID,
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    gastos_cotidianos_pendientes_por_cuenta = {
        row.cuenta_id: float(row.importe or 0.0) for row in gastos_cotidianos_pendientes_q
    }

    saldos_cuentas: list[SaldoCuentaItem] = []

    for c in cuentas:
        inicio = float(getattr(c, "liquidez_inicial", 0.0) or 0.0)
        entradas = entradas_por_cuenta.get(c.id, 0.0)
        salidas_totales = salidas_mes_por_cuenta.get(c.id, 0.0)
        saldo_actual = float(getattr(c, "liquidez", 0.0) or 0.0)

        ingresos_pend = ingresos_pendientes_por_cuenta.get(c.id, 0.0)
        gastos_pend = gastos_pendientes_por_cuenta.get(c.id, 0.0)
        gastos_cot_pend = gastos_cotidianos_pendientes_por_cuenta.get(c.id, 0.0)

        saldos_cuentas.append(
            SaldoCuentaItem(
                cuenta_id=c.id,
                anagrama=getattr(c, "anagrama", "") or "",
                inicio=round(inicio, 2),
                salidas=round(salidas_totales, 2),
                entradas=round(entradas, 2),
                fin=round(saldo_actual, 2),
                participacion_pct=_participacion_pct_cuenta(c),
                gastos_gestionables_pendientes=round(gastos_pend, 2),
                gastos_cotidianos_pendientes=round(gastos_cot_pend, 2),
                ingresos_pendientes=round(ingresos_pend, 2),
            )
        )

    liquidez_actual_total = sum(float(getattr(c, "liquidez", 0.0) or 0.0) for c in cuentas)
    liquidez_inicio_mes_total = sum(s.inicio for s in saldos_cuentas)

    ingresos_pendientes_total = sum(s.ingresos_pendientes for s in saldos_cuentas)
    gastos_pendientes_total = sum(
        (s.gastos_gestionables_pendientes + s.gastos_cotidianos_pendientes)
        for s in saldos_cuentas
    )
    liquidez_prevista_total = liquidez_actual_total - gastos_pendientes_total + ingresos_pendientes_total

    gastos_ahorro_q = (
        db.query(
            func.coalesce(
                func.sum(func.coalesce(models.Gasto.importe, 0.0)),
                0.0,
            ).label("total_gastos_ahorro")
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.segmento_id == AHO_SEGMENTO_ID,
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .first()
    )
    gastos_ahorro_total = (
        float(getattr(gastos_ahorro_q, "total_gastos_ahorro", 0.0) or 0.0)
        if gastos_ahorro_q
        else 0.0
    )

    ingresos_reintegro_ahorro_q = (
        db.query(
            func.coalesce(func.sum(models.Ingreso.importe), 0.0).label("total_ingresos_reintegro_ahorro")
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado.is_(True),
            models.Ingreso.tipo_id == REINTEGRO_AHORRO_TIPO_ID,
            models.Ingreso.ultimo_ingreso_on >= start,
            models.Ingreso.ultimo_ingreso_on < end,
        )
        .first()
    )
    ingresos_reintegro_ahorro_total = (
        float(getattr(ingresos_reintegro_ahorro_q, "total_ingresos_reintegro_ahorro", 0.0) or 0.0)
        if ingresos_reintegro_ahorro_q
        else 0.0
    )

    ahorro_mes_q = (
        db.query(func.coalesce(func.sum(models.Gasto.importe), 0.0).label("total_ahorro"))
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.segmento_id == AHO_SEGMENTO_ID,
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .first()
    )
    ahorro_mes_total = float(getattr(ahorro_mes_q, "total_ahorro", 0.0) or 0.0) if ahorro_mes_q else 0.0

    return BalanceMesResponse(
        year=start.year,
        month=start.month,
        saldos_cuentas=saldos_cuentas,
        liquidez_actual_total=float(round(liquidez_actual_total, 2)),
        liquidez_inicio_mes_total=float(round(liquidez_inicio_mes_total, 2)),
        liquidez_prevista_total=float(round(liquidez_prevista_total, 2)),
        ingresos_pendientes_total=float(round(ingresos_pendientes_total, 2)),
        gastos_pendientes_total=float(round(gastos_pendientes_total, 2)),
        ahorro_mes_total=float(round(ahorro_mes_total, 2)),
        gastos_ahorro_total=float(round(gastos_ahorro_total, 2)),
        ingresos_reintegro_ahorro_total=float(round(ingresos_reintegro_ahorro_total, 2)),
    )