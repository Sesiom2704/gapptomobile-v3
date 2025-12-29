# backend/app/api/v1/extraordinarios_router.py
from datetime import datetime, date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.schemas.extraordinarios import (
    ExtraordinariosResponse,
    ExtraordinarioItem,
)
from backend.app.db.models import Gasto, Ingreso

# Ajusta estos imports a tu estructura real
from backend.app.db.session import get_db
from backend.app.api.v1.auth_router import require_user


router = APIRouter()


def get_month_range(year: int, month: int) -> tuple[datetime, datetime]:
    """
    Devuelve (inicio, fin) del mes:
    - inicio: primer día a las 00:00
    - fin: primer día del mes siguiente a las 00:00 (rango [inicio, fin))
    """
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end


@router.get(
    "/extraordinarios",
    response_model=ExtraordinariosResponse,
    summary="Listado de gastos e ingresos extraordinarios por mes",
)
def get_extraordinarios_mes(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Devuelve los gastos e ingresos extraordinarios de un mes:

    - GASTOS extraordinarios:
        * pagado = true
        * kpi = false
        * activo = false
        * ultimo_pago_on dentro del mes
    - INGRESOS extraordinarios:
        * cobrado = true
        * kpi = false
        * activo = false
        * ultimo_ingreso_on dentro del mes
    """

    start_date, end_date = get_month_range(year, month)

    # --- GASTOS EXTRAORDINARIOS ---
    gastos_query = (
        db.query(Gasto)
        .filter(
            Gasto.user_id == current_user.id,
            Gasto.periodicidad == "PAGO UNICO",  # <-- AÑADIDO
            Gasto.pagado.is_(True),
            Gasto.kpi.is_(False),
            Gasto.activo.is_(False),
            Gasto.ultimo_pago_on.isnot(None),
            Gasto.ultimo_pago_on >= start_date,
            Gasto.ultimo_pago_on < end_date,
        )
        .order_by(Gasto.ultimo_pago_on.desc())
    )

    gastos: List[Gasto] = gastos_query.all()

    gastos_items: List[ExtraordinarioItem] = []
    total_gastos = 0.0

    for g in gastos:
        fecha_ref = g.ultimo_pago_on
        if not fecha_ref:
            continue

        categoria_nombre = None
        # Ajusta el nombre del campo en TipoGasto (habitualmente .nombre)
        if g.tipo_rel is not None:
            categoria_nombre = getattr(g.tipo_rel, "nombre", None)

        item = ExtraordinarioItem(
            id=g.id,
            nombre=g.nombre,
            categoria_nombre=categoria_nombre,
            tipo="GASTO",
            importe=g.importe or 0.0,
            pagado=g.pagado,
            cobrado=None,
            kpi=g.kpi,
            activo=g.activo,
            fecha_referencia=fecha_ref,
        )
        total_gastos += item.importe
        gastos_items.append(item)

    # --- INGRESOS EXTRAORDINARIOS ---
    ingresos_query = (
        db.query(Ingreso)
        .filter(
            Ingreso.user_id == current_user.id,
            Ingreso.periodicidad == "PAGO UNICO",  # <-- AÑADIDO
            Ingreso.cobrado.is_(True),
            Ingreso.kpi.is_(False),
            Ingreso.activo.is_(False),
            Ingreso.ultimo_ingreso_on.isnot(None),
            Ingreso.ultimo_ingreso_on >= start_date,
            Ingreso.ultimo_ingreso_on < end_date,
        )
        .order_by(Ingreso.ultimo_ingreso_on.desc())
    )
    ingresos: List[Ingreso] = ingresos_query.all()

    ingresos_items: List[ExtraordinarioItem] = []
    total_ingresos = 0.0

    for i in ingresos:
        fecha_ref = i.ultimo_ingreso_on
        if not fecha_ref:
            continue

        categoria_nombre = None
        # Ajusta el nombre del campo en TipoIngreso (habitualmente .nombre)
        if i.tipo_rel is not None:
            categoria_nombre = getattr(i.tipo_rel, "nombre", None)

        item = ExtraordinarioItem(
            id=i.id,
            nombre=i.concepto,
            categoria_nombre=categoria_nombre,
            tipo="INGRESO",
            importe=i.importe or 0.0,
            pagado=None,
            cobrado=i.cobrado,
            kpi=i.kpi,
            activo=i.activo,
            fecha_referencia=fecha_ref,
        )
        total_ingresos += item.importe
        ingresos_items.append(item)

    balance = total_ingresos - total_gastos

    response = ExtraordinariosResponse(
        year=year,
        month=month,
        total_gastos=total_gastos,
        total_ingresos=total_ingresos,
        balance=balance,
        gastos=gastos_items,
        ingresos=ingresos_items,
    )

    return response
