# backend/app/api/v1/extraordinarios_router.py
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.schemas.extraordinarios import (
    ExtraordinariosResponse,
    ExtraordinarioItem,
)
from backend.app.db.models import Gasto, Ingreso
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
    summary="Listado de gastos e ingresos extraordinarios + gastos omitidos por mes",
)
def get_extraordinarios_mes(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """
    Devuelve para el mes seleccionado:

    1) GASTOS extraordinarios (PAGO UNICO):
        - periodicidad = "PAGO UNICO"
        - pagado = true
        - kpi = false
        - activo = false
        - ultimo_pago_on dentro del mes

    2) INGRESOS extraordinarios (PAGO UNICO):
        - periodicidad = "PAGO UNICO"
        - cobrado = true
        - kpi = false
        - activo = false
        - ultimo_ingreso_on dentro del mes

    3) GASTOS omitidos:
        - omitido_este_mes = true
        - ultimo_omitido_on dentro del mes
        (según regla confirmada por ti)

    Balance:
      Ingresos + gastos omitidos - gastos extraordinarios
    """

    start_date, end_date = get_month_range(year, month)

    # ------------------------------------------------------------
    # 1) GASTOS EXTRAORDINARIOS (PAGO UNICO)
    # ------------------------------------------------------------
    gastos_query = (
        db.query(Gasto)
        .filter(
            Gasto.user_id == current_user.id,
            Gasto.periodicidad == "PAGO UNICO",
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
        if g.tipo_rel is not None:
            categoria_nombre = getattr(g.tipo_rel, "nombre", None)

        item = ExtraordinarioItem(
            id=g.id,
            nombre=g.nombre,
            categoria_nombre=categoria_nombre,
            tipo="GASTO",
            importe=float(g.importe or 0.0),
            pagado=g.pagado,
            cobrado=None,
            kpi=bool(g.kpi),
            activo=bool(g.activo),
            fecha_referencia=fecha_ref,

            # Extra para navegar a form
            periodicidad=g.periodicidad,
            tipo_id=g.tipo_id,
            segmento_id=g.segmento_id,
            proveedor_id=g.proveedor_id,
            cuenta_id=g.cuenta_id,
            referencia_vivienda_id=g.referencia_vivienda_id,
            fecha=g.fecha,
            rango_pago=g.rango_pago,
            comentarios=g.comentarios,
            importe_cuota=float(g.importe_cuota) if g.importe_cuota is not None else None,
            cuotas=int(g.cuotas) if g.cuotas is not None else None,
        )
        total_gastos += item.importe
        gastos_items.append(item)

    # ------------------------------------------------------------
    # 2) INGRESOS EXTRAORDINARIOS (PAGO UNICO)
    # ------------------------------------------------------------
    ingresos_query = (
        db.query(Ingreso)
        .filter(
            Ingreso.user_id == current_user.id,
            Ingreso.periodicidad == "PAGO UNICO",
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
        if i.tipo_rel is not None:
            categoria_nombre = getattr(i.tipo_rel, "nombre", None)

        item = ExtraordinarioItem(
            id=i.id,
            nombre=i.concepto,
            categoria_nombre=categoria_nombre,
            tipo="INGRESO",
            importe=float(i.importe or 0.0),
            pagado=None,
            cobrado=i.cobrado,
            kpi=bool(i.kpi),
            activo=bool(i.activo),
            fecha_referencia=fecha_ref,

            # Extra para navegar a form
            periodicidad=i.periodicidad,
            tipo_id=i.tipo_id,
            cuenta_id=i.cuenta_id,
            referencia_vivienda_id=i.referencia_vivienda_id,
            rango_cobro=i.rango_cobro,
            fecha_inicio=i.fecha_inicio,
        )
        total_ingresos += item.importe
        ingresos_items.append(item)

    # ------------------------------------------------------------
    # 3) GASTOS OMITIDOS DEL MES
    # Regla confirmada:
    #  - omitido_este_mes = true
    #  - ultimo_omitido_on dentro del mes seleccionado
    # ------------------------------------------------------------
    omitidos_query = (
        db.query(Gasto)
        .filter(
            Gasto.user_id == current_user.id,
            Gasto.omitido_este_mes.is_(True),
            Gasto.ultimo_omitido_on.isnot(None),
            Gasto.ultimo_omitido_on >= start_date,
            Gasto.ultimo_omitido_on < end_date,
        )
        .order_by(Gasto.ultimo_omitido_on.desc())
    )

    omitidos: List[Gasto] = omitidos_query.all()

    omitidos_items: List[ExtraordinarioItem] = []
    total_gastos_omitidos = 0.0

    for g in omitidos:
        fecha_ref = g.ultimo_omitido_on
        if not fecha_ref:
            continue

        categoria_nombre = None
        if g.tipo_rel is not None:
            categoria_nombre = getattr(g.tipo_rel, "nombre", None)

        item = ExtraordinarioItem(
            id=g.id,
            nombre=g.nombre,
            categoria_nombre=categoria_nombre,
            tipo="GASTO",
            importe=float(g.importe or 0.0),
            pagado=g.pagado,
            cobrado=None,
            kpi=bool(g.kpi),
            activo=bool(g.activo),
            fecha_referencia=fecha_ref,

            # Extra para navegar a form
            periodicidad=g.periodicidad,
            tipo_id=g.tipo_id,
            segmento_id=g.segmento_id,
            proveedor_id=g.proveedor_id,
            cuenta_id=g.cuenta_id,
            referencia_vivienda_id=g.referencia_vivienda_id,
            fecha=g.fecha,
            rango_pago=g.rango_pago,
            comentarios=g.comentarios,
            importe_cuota=float(g.importe_cuota) if g.importe_cuota is not None else None,
            cuotas=int(g.cuotas) if g.cuotas is not None else None,
        )
        total_gastos_omitidos += item.importe
        omitidos_items.append(item)

    # ------------------------------------------------------------
    # Balance solicitado:
    # Ingresos + gastos omitidos - gastos extraordinarios
    # ------------------------------------------------------------
    balance = float(total_ingresos + total_gastos_omitidos - total_gastos)

    response = ExtraordinariosResponse(
        year=year,
        month=month,
        total_gastos=float(total_gastos),
        total_ingresos=float(total_ingresos),
        total_gastos_omitidos=float(total_gastos_omitidos),
        balance=balance,
        gastos=gastos_items,
        ingresos=ingresos_items,
        gastos_omitidos=omitidos_items,
    )

    return response