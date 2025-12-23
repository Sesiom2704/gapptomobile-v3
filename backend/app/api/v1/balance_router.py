from datetime import datetime, date
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.balance import (
    MovimientosMesResponse,
    MovimientoItem,
    BalanceMesResponse,
    SaldoCuentaItem,
)
from backend.app.api.v1.auth_router import require_user

router = APIRouter(
    prefix="/balance",
    tags=["balance"],
)


def _get_month_range(year: int | None, month: int | None) -> tuple[date, date]:
    """Devuelve (start, end) para el mes completo [start, end)."""
    today = date.today()
    year = year or today.year
    month = month or today.month

    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)

    return start, end


# -------------------------------------------------------------------
# 1) MOVIMIENTOS DEL MES -> /api/v1/balance/mes
# -------------------------------------------------------------------
@router.get("/mes", response_model=MovimientosMesResponse)
def get_movimientos_mes(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Devuelve todos los movimientos (gastos pagados e ingresos cobrados)
    del mes indicado (o del mes actual si no se indica).
    """
    start, end = _get_month_range(year, month)

    movimientos: list[MovimientoItem] = []

    # 1) GASTOS GESTIONABLES pagados en el mes
    gastos_gestionables = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .all()
    )

    for g in gastos_gestionables:
        cuenta_nombre = None
        try:
            if getattr(g, "cuenta", None) is not None:
                cuenta_nombre = getattr(g.cuenta, "anagrama", None) or getattr(
                    g.cuenta, "referencia", None
                )
        except Exception:
            pass

        movimientos.append(
            MovimientoItem(
                id=g.id,
                fecha=g.ultimo_pago_on,
                cuenta_id=g.cuenta_id,
                cuenta_nombre=cuenta_nombre or g.cuenta_id,
                descripcion=g.nombre,
                tipo="GASTO_GESTIONABLE",
                es_ingreso=False,
                importe=Decimal(str(g.importe)),
            )
        )

    # 2) GASTOS COTIDIANOS pagados en el mes
    gastos_cotidianos = (
        db.query(models.GastoCotidiano)
        .filter(
            models.GastoCotidiano.user_id == current_user.id,
            models.GastoCotidiano.pagado == True,  # noqa: E712
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
            if getattr(gc, "proveedor", None) is not None:
                posible = getattr(gc.proveedor, "nombre", None)
                if posible:
                    proveedor_nombre = posible
        except Exception:
            pass

        if not proveedor_nombre and hasattr(gc, "proveedor_id") and gc.proveedor_id:
            try:
                prov = (
                    db.query(models.Proveedor)
                    .filter(models.Proveedor.id == gc.proveedor_id)
                    .first()
                )
                if prov and getattr(prov, "nombre", None):
                    proveedor_nombre = prov.nombre
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
                importe=Decimal(str(gc.importe)),
            )
        )

    # 3) INGRESOS cobrados en el mes
    ingresos = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado.is_(True),
            models.Ingreso.ultimo_ingreso_on >= start,
            models.Ingreso.ultimo_ingreso_on < end,
        )
        .all()
    )

    for i in ingresos:
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
                cuenta_id=i.cuenta_id,
                cuenta_nombre=cuenta_nombre or i.cuenta_id,
                descripcion=i.concepto,
                tipo="INGRESO",
                es_ingreso=True,
                importe=Decimal(str(i.importe)),
            )
        )

    # Ordenar de más reciente a más antiguo
    def _normalize_fecha(dt):
        try:
            if getattr(dt, "tzinfo", None) is not None:
                return dt.replace(tzinfo=None)
        except Exception:
            pass
        return dt

    movimientos.sort(key=lambda m: _normalize_fecha(m.fecha), reverse=True)

    total_ingresos = sum(
        (m.importe for m in movimientos if m.es_ingreso), Decimal("0.00")
    )
    total_gastos = sum(
        (m.importe for m in movimientos if not m.es_ingreso), Decimal("0.00")
    )
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


# -------------------------------------------------------------------
# 2) SALDO POR CUENTAS DEL MES -> /api/v1/balance/mes-cuentas
# -------------------------------------------------------------------
@router.get("/mes-cuentas", response_model=BalanceMesResponse)
def get_balance_cuentas_mes(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Balance por cuentas para un mes (visión de caja):

    - Solo cuentas activas del usuario.
    - Inicio  = cuentas_bancarias.liquidez_inicial
    - Entradas = ingresos.importe cobrados en el mes (ultimo_ingreso_on dentro del mes)
    - Salidas = gastos gestionables (no segmento COTIDIANO) pagados en el mes
                + gastos cotidianos (tabla gastos_cotidianos) pagados en el mes
    - Fin = saldo actual real de la cuenta (cuentas_bancarias.liquidez)

    Además, se calculan pendientes por cuenta (ingresos, gestionables, cotidianos)
    para las tarjetas de liquidez y pendientes.
    """
    start, end = _get_month_range(year, month)

    # 1) Cuentas activas del usuario
    cuentas: List[models.CuentaBancaria] = (
        db.query(models.CuentaBancaria)
        .filter(
            models.CuentaBancaria.user_id == current_user.id,
            models.CuentaBancaria.Activo.is_(True),
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
        )

    cuenta_ids = [c.id for c in cuentas]

    # 2) ENTRADAS DEL MES (ingresos cobrados)
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
    entradas_por_cuenta = {
        row.cuenta_id: float(row.total_entradas or 0.0) for row in ingresos_q
    }

    # 3) SALIDAS DEL MES - GASTOS GESTIONABLES (NO COTIDIANOS) - tabla gastos
    gastos_gestionables_mes_q = (
        db.query(
            models.Gasto.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0).label("total_salidas"),
        )
        .join(models.TipoGasto, models.TipoGasto.id == models.Gasto.tipo_id)
        .join(
            models.TipoSegmentoGasto,
            models.TipoSegmentoGasto.id == models.TipoGasto.segmento_id,
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo.is_(True),
            models.Gasto.kpi.is_(True),
            models.Gasto.pagado.is_(True),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
            # Excluimos segmento COTIDIANO
            models.TipoSegmentoGasto.nombre != "COTIDIANO",
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    salidas_gestionables_mes_por_cuenta = {
        row.cuenta_id: float(row.total_salidas or 0.0)
        for row in gastos_gestionables_mes_q
    }

    # 4) SALIDAS DEL MES - GASTOS COTIDIANOS (tabla gastos_cotidianos)
    gastos_cotidianos_mes_q = (
        db.query(
            models.GastoCotidiano.cuenta_id.label("cuenta_id"),
            func.coalesce(func.sum(models.GastoCotidiano.importe), 0.0).label(
                "total_salidas"
            ),
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
    salidas_cotidianos_mes_por_cuenta = {
        row.cuenta_id: float(row.total_salidas or 0.0)
        for row in gastos_cotidianos_mes_q
    }

    # SALIDAS TOTALES DEL MES POR CUENTA
    salidas_mes_por_cuenta: dict[str, float] = {}
    for cid in cuenta_ids:
        sal_gest = salidas_gestionables_mes_por_cuenta.get(cid, 0.0)
        sal_cot = salidas_cotidianos_mes_por_cuenta.get(cid, 0.0)
        salidas_mes_por_cuenta[cid] = sal_gest + sal_cot

    # 5) PENDIENTES POR CUENTA (ingresos, gestionables, cotidianos)

    # Ingresos pendientes
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
    ingresos_pendientes_por_cuenta = {
        row.cuenta_id: float(row.importe or 0.0) for row in ingresos_pendientes_q
    }

    # Gestionables pendientes (NO COTIDIANOS) -> tabla gastos
    gastos_gestionables_pendientes_q = (
        db.query(
            models.Gasto.cuenta_id,
            func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0).label("importe"),
        )
        .join(models.TipoGasto, models.TipoGasto.id == models.Gasto.tipo_id)
        .join(
            models.TipoSegmentoGasto,
            models.TipoSegmentoGasto.id == models.TipoGasto.segmento_id,
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo.is_(True),
            models.Gasto.kpi.is_(True),
            models.Gasto.pagado.is_(False),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            models.TipoSegmentoGasto.nombre != "COTIDIANO",
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    gastos_gestionables_pendientes_por_cuenta = {
        row.cuenta_id: float(row.importe or 0.0)
        for row in gastos_gestionables_pendientes_q
    }

    # Cotidianos pendientes -> tabla gastos (segmento COTIDIANO)
    gastos_cotidianos_pendientes_q = (
        db.query(
            models.Gasto.cuenta_id,
            func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0).label("importe"),
        )
        .join(models.TipoGasto, models.TipoGasto.id == models.Gasto.tipo_id)
        .join(
            models.TipoSegmentoGasto,
            models.TipoSegmentoGasto.id == models.TipoGasto.segmento_id,
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo.is_(True),
            models.Gasto.kpi.is_(True),
            models.Gasto.pagado.is_(False),
            models.Gasto.cuenta_id.in_(cuenta_ids),
            models.TipoSegmentoGasto.nombre == "COTIDIANO",
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )
    gastos_cotidianos_pendientes_por_cuenta = {
        row.cuenta_id: float(row.importe or 0.0)
        for row in gastos_cotidianos_pendientes_q
    }

    # 6) Construcción de objetos SaldoCuentaItem
    saldos_cuentas: list[SaldoCuentaItem] = []

    for c in cuentas:
        # Inicio: liquidez_inicial (tal y como definiste para el mes)
        inicio = float(c.liquidez_inicial or 0.0)

        # Salidas del mes (ya agregadas)
        salidas_totales = salidas_mes_por_cuenta.get(c.id, 0.0)

        # Entradas del mes
        entradas = entradas_por_cuenta.get(c.id, 0.0)

        # Saldo REAL actual de la cuenta (lo que ves en la app y lo que actualizan los movimientos entre cuentas)
        saldo_actual = float(c.liquidez or 0.0)

        gastos_gest_pend = gastos_gestionables_pendientes_por_cuenta.get(c.id, 0.0)
        gastos_cot_pend = gastos_cotidianos_pendientes_por_cuenta.get(c.id, 0.0)
        ingresos_pend = ingresos_pendientes_por_cuenta.get(c.id, 0.0)

        saldos_cuentas.append(
            SaldoCuentaItem(
                cuenta_id=c.id,
                anagrama=c.anagrama or "",
                inicio=round(inicio, 2),
                salidas=round(salidas_totales, 2),
                entradas=round(entradas, 2),
                # Fin = saldo real actual
                fin=round(saldo_actual, 2),
                gastos_gestionables_pendientes=round(gastos_gest_pend, 2),
                gastos_cotidianos_pendientes=round(gastos_cot_pend, 2),
                ingresos_pendientes=round(ingresos_pend, 2),
            )
        )

    # 7) KPIs globales
    # Liquidez actual real: suma de cuentas_bancarias.liquidez de todas las cuentas activas del usuario
    liquidez_actual_total = sum(float(c.liquidez or 0.0) for c in cuentas)

    # Inicio de mes: suma de liquidez_inicial
    liquidez_inicio_mes_total = sum(s.inicio for s in saldos_cuentas)

    ingresos_pendientes_total = sum(s.ingresos_pendientes for s in saldos_cuentas)
    gastos_pendientes_total = sum(
        s.gastos_gestionables_pendientes + s.gastos_cotidianos_pendientes
        for s in saldos_cuentas
    )
    liquidez_prevista_total = (
        liquidez_actual_total - gastos_pendientes_total + ingresos_pendientes_total
    )

    # 👉 8) KPI de ahorro del mes
    # Suma de gastos.importe donde segmento_id = "AHO-12345",
    # pagado = true y ultimo_pago_on dentro del mes.
    ahorro_mes_q = (
        db.query(
            func.coalesce(func.sum(models.Gasto.importe), 0.0).label("total_ahorro")
        )
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado.is_(True),
            models.Gasto.segmento_id == "AHO-12345",
            models.Gasto.ultimo_pago_on >= start,
            models.Gasto.ultimo_pago_on < end,
        )
        .first()
    )

    ahorro_mes_total = (
        float(ahorro_mes_q.total_ahorro or 0.0) if ahorro_mes_q else 0.0
    )

    return BalanceMesResponse(
        year=start.year,
        month=start.month,
        saldos_cuentas=saldos_cuentas,
        liquidez_actual_total=liquidez_actual_total,
        liquidez_inicio_mes_total=liquidez_inicio_mes_total,
        liquidez_prevista_total=liquidez_prevista_total,
        ingresos_pendientes_total=ingresos_pendientes_total,
        gastos_pendientes_total=gastos_pendientes_total,
        ahorro_mes_total=ahorro_mes_total,
    )
