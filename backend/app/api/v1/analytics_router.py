"""
API v1 - ANALYTICS (KPIs, resúmenes y breakdowns por patrimonio)

Objetivo:
- Exponer endpoints para el front mobile (GapptoMobile v3) en:
    /api/v1/analytics/patrimonios/{patrimonio_id}/resumen
    /api/v1/analytics/patrimonios/{patrimonio_id}/gastos_breakdown
    /api/v1/analytics/patrimonios/{patrimonio_id}/ingresos_breakdown
    /api/v1/analytics/patrimonios/{patrimonio_id}/kpis

NUEVO (para Home):
- /api/v1/analytics/patrimonio/summary?year=YYYY

CAMBIO CLAVE (v3):
- Se añade selector de periodo por query params:
    mode = "LAST_12" | "ALL_TIME" | "YEAR"   (default: "YEAR")
    as_of = YYYY-MM-DD (opcional, default date.today())

- Los cálculos de ingresos/gastos recurrentes se corrigen para reflejar el modelo real:
    * Gastos: ultimo_pago_on + cuotas_pagadas
    * Ingresos: ultimo_ingreso_on + ingresos_cobrados
  Es decir: se cuenta lo efectivamente pagado/cobrado, y se intersecta con el rango.

POR QUÉ:
- Antes se infería “meses/ocurrencias” con fecha_inicio/fecha y fin de año.
- Eso provoca errores como: Resumen 2026 (enero) mostrando 12 meses.
- Con este cambio, Resumen 2026 (enero) mostrará 1 mes si el último cobro/pago es enero.

Notas:
- Normalización de periodicidad tolerante a:
    - PAGO_UNICO / PAGO UNICO
    - mayúsculas/minúsculas
  (se aplica reemplazando '_' por ' ' y uppercasing).
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db

from backend.app.schemas.analytics import (
    BreakdownOut,
    BreakdownRowOut,
    KpisOut,
    PatrimonioSummaryOut,
    ResumenOut,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# =========================================================
# Helpers: casting defensivo
# =========================================================

def _f(x: object, default: float = 0.0) -> float:
    """Convierte Numeric/Decimal/None/str a float de forma defensiva."""
    if x is None:
        return default
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except Exception:
        return default


# =========================================================
# Helpers genéricos de fechas y meses
# =========================================================

def _as_date(d: Optional[date | datetime]) -> Optional[date]:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date()
    return d


def _year_window(year: int) -> Tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def _norm_periodicidad(p: Optional[str]) -> str:
    # ✅ v3: tolera PAGO_UNICO
    return (p or "").strip().upper().replace("_", " ")


def _step_months_from_periodicidad(p: str) -> Optional[int]:
    """
    Devuelve cuántos meses por ocurrencia (step):
      MENSUAL -> 1
      BIMESTRAL -> 2
      TRIMESTRAL -> 3
      CUATRIMESTRAL -> 4
      SEMESTRAL -> 6
      ANUAL -> 12
      PAGO UNICO -> None (especial)
    """
    pu = _norm_periodicidad(p)

    # pago único
    if "PAGO" in pu and ("UNICO" in pu or "ÚNICO" in pu):
        return None

    if "MENSUAL" in pu:
        return 1
    if "BIMEST" in pu:
        return 2
    if "TRIMEST" in pu:
        return 3
    if "CUATRIM" in pu:
        return 4
    if "SEMEST" in pu:
        return 6
    if "ANUAL" in pu or "AÑO" in pu:
        return 12

    # fallback: si viene raro, lo tratamos como mensual
    return 1


# =========================================================
# Helpers de rango por "period selector" (mode)
# =========================================================

def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _month_index(d: date) -> int:
    # índice monótono por mes (sirve para comparar / intervalos)
    return d.year * 12 + (d.month - 1)


def _add_months(d: date, delta: int) -> date:
    y = d.year + (d.month - 1 + delta) // 12
    m = (d.month - 1 + delta) % 12 + 1
    return date(y, m, 1)


def _months_inclusive_between_months(start_month: date, end_month: date) -> int:
    """Número de meses inclusivos entre dos 'month_start'."""
    if start_month > end_month:
        return 0
    return (end_month.year - start_month.year) * 12 + (end_month.month - start_month.month) + 1


def _ceil_div(a: int, b: int) -> int:
    """ceil(a/b) para enteros con b>0."""
    return -((-a) // b)


def _range_window(
    *,
    mode: str,
    year: int,
    as_of: date,
    adquisicion: Optional[date],
) -> Tuple[date, date, int]:
    """
    Devuelve:
      - range_start_month (primer día de mes)
      - range_end_month   (primer día de mes)
      - meses_contados    (denominador para promedios / YTD)

    MODOS:
    - LAST_12: últimos 12 meses exactos, incluyendo mes actual (as_of)
    - ALL_TIME: desde adquisición (si existe) hasta mes as_of
    - YEAR: enero..diciembre del year; si year==as_of.year: YTD hasta mes as_of
    """
    mode_u = (mode or "YEAR").strip().upper()
    as_of_m = _month_start(as_of)

    if mode_u == "LAST_12":
        start = _add_months(as_of_m, -11)
        end = as_of_m
        return start, end, 12

    if mode_u == "ALL_TIME":
        if adquisicion is None:
            # fallback defensivo: si falta adquisición, volvemos a LAST_12
            start = _add_months(as_of_m, -11)
            end = as_of_m
            return start, end, 12
        start = _month_start(adquisicion)
        end = as_of_m
        meses = _months_inclusive_between_months(start, end)
        return start, end, max(1, meses)

    # YEAR
    start = date(year, 1, 1)
    start_m = _month_start(start)

    end_m = _month_start(date(year, 12, 1))

    # si es el año actual: YTD hasta as_of.month
    if as_of.year == year:
        end_m = min(end_m, as_of_m)

    meses = _months_inclusive_between_months(start_m, end_m)
    return start_m, end_m, max(1, meses)


def _occurrences_paid_in_range(
    *,
    last_on: Optional[date],
    count: int,
    periodicidad: str,
    range_start_month: date,
    range_end_month: date,
) -> int:
    """
    Cuenta ocurrencias pagadas/cobradas dentro del rango, usando el modelo real:
      - last_on: mes del último pago/cobro (ultimo_pago_on / ultimo_ingreso_on)
      - count: total de cuotas/cobros acumulados (cuotas_pagadas / ingresos_cobrados)
      - periodicidad: MENSUAL/BIMESTRAL/...
      - range_start_month / range_end_month: límites del rango (month_start)

    Idea:
      La "serie pagada" es: last, last-step, last-2*step, ... (count elementos).
      Contamos cuántos elementos caen dentro del rango.
    """
    try:
        c = int(count)
    except Exception:
        return 0
    if c <= 0:
        return 0
    if last_on is None:
        return 0

    per_u = _norm_periodicidad(periodicidad or "")
    step = _step_months_from_periodicidad(per_u)

    last_m = _month_start(last_on)

    li = _month_index(last_m)
    si = _month_index(range_start_month)
    ei = _month_index(range_end_month)

    # PAGO ÚNICO: 1 si el último pago/cobro cae dentro del rango (por mes)
    if step is None:
        return 1 if (si <= li <= ei) else 0

    # Serie: li - k*step, para k=0..c-1
    # Queremos li - k*step ∈ [si, ei]
    # => li - ei <= k*step <= li - si
    k_low = _ceil_div(li - ei, step)      # mínimo k
    k_high = (li - si) // step            # máximo k (floor)

    # clamp al rango disponible de la serie [0, c-1]
    k1 = max(0, k_low)
    k2 = min(c - 1, k_high)

    if k2 < k1:
        return 0
    return (k2 - k1 + 1)


# =========================================================
# Helpers: cuota base
# =========================================================

def _gasto_cuota_base(g: models.Gasto) -> float:
    ic = getattr(g, "importe_cuota", None)
    imp = getattr(g, "importe", None)
    if ic is not None:
        return _f(ic, 0.0)
    return _f(imp, 0.0)


def _ingreso_cuota_base(ing: models.Ingreso) -> float:
    return _f(getattr(ing, "importe", 0.0), 0.0)


# =========================================================
# Helpers: valor base para KPIs
# =========================================================

def _get_compra(db: Session, patrimonio_id: str) -> Optional[models.PatrimonioCompra]:
    return (
        db.query(models.PatrimonioCompra)
        .filter(models.PatrimonioCompra.patrimonio_id == patrimonio_id)
        .first()
    )


def _valor_base_from_compra(compra: Optional[models.PatrimonioCompra], basis: str) -> float:
    """basis: total | compra | referencia | max"""
    if compra is None:
        return 0.0

    vc = _f(getattr(compra, "valor_compra", 0.0), 0.0)
    vr = _f(getattr(compra, "valor_referencia", 0.0), 0.0)
    ti = _f(getattr(compra, "total_inversion", 0.0), 0.0)

    b = (basis or "total").lower()

    if b == "compra":
        return vc
    if b == "referencia":
        return vr
    if b == "max":
        return max(vc, vr, ti)

    return ti if ti > 0 else max(vc, vr)


# =========================================================
# ENDPOINTS
# =========================================================

@router.get("/patrimonios/{patrimonio_id}/ingresos_breakdown", response_model=BreakdownOut)
def ingresos_breakdown(
    patrimonio_id: str,
    year: int = Query(...),
    mode: str = Query("YEAR", description="LAST_12 | ALL_TIME | YEAR"),
    as_of: Optional[date] = Query(None, description="Fecha de referencia YYYY-MM-DD (default hoy)"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    as_of_date = as_of or date.today()
    adq = _as_date(getattr(patr, "fecha_adquisicion", None))

    range_start_m, range_end_m, meses_contados = _range_window(
        mode=mode,
        year=year,
        as_of=as_of_date,
        adquisicion=adq,
    )

    q = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.referencia_vivienda_id == patrimonio_id,
            models.Ingreso.kpi == True,
        )
    )
    rows = q.all()

    out_rows: List[BreakdownRowOut] = []
    total_ytd = 0.0

    for ing in rows:
        per = getattr(ing, "periodicidad", "") or ""
        per_u = _norm_periodicidad(per)

        cuota = _ingreso_cuota_base(ing)

        last_on = _as_date(getattr(ing, "ultimo_ingreso_on", None))
        count = getattr(ing, "ingresos_cobrados", 0) or 0

        occ = _occurrences_paid_in_range(
            last_on=last_on,
            count=int(count),
            periodicidad=per_u,
            range_start_month=range_start_m,
            range_end_month=range_end_m,
        )

        total = float(cuota) * float(occ)
        tipo = (getattr(ing, "concepto", None) or "Ingreso").strip() if getattr(ing, "concepto", None) else "Ingreso"

        out_rows.append(
            BreakdownRowOut(
                tipo=tipo,
                periodicidad=per_u or "—",
                cuota=cuota,
                meses=int(occ),
                total=float(round(total, 2)),
            )
        )
        total_ytd += total

    return BreakdownOut(
        year=year,
        meses_contados=int(meses_contados),
        rows=out_rows,
        total_ytd=float(round(total_ytd, 2)),
    )


@router.get("/patrimonios/{patrimonio_id}/gastos_breakdown", response_model=BreakdownOut)
def gastos_breakdown(
    patrimonio_id: str,
    year: int = Query(...),
    mode: str = Query("YEAR", description="LAST_12 | ALL_TIME | YEAR"),
    as_of: Optional[date] = Query(None, description="Fecha de referencia YYYY-MM-DD (default hoy)"),
    only_kpi: bool = Query(False, alias="only_kpi_expenses"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    as_of_date = as_of or date.today()
    adq = _as_date(getattr(patr, "fecha_adquisicion", None))

    range_start_m, range_end_m, meses_contados = _range_window(
        mode=mode,
        year=year,
        as_of=as_of_date,
        adquisicion=adq,
    )

    q = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.referencia_vivienda_id == patrimonio_id,
        )
    )
    if only_kpi:
        q = q.filter(models.Gasto.kpi == True)

    rows = q.all()

    out_rows: List[BreakdownRowOut] = []
    total_ytd = 0.0

    for g in rows:
        per = getattr(g, "periodicidad", "") or ""
        per_u = _norm_periodicidad(per)

        cuota = _gasto_cuota_base(g)

        last_on = _as_date(getattr(g, "ultimo_pago_on", None))
        count = getattr(g, "cuotas_pagadas", 0) or 0

        occ = _occurrences_paid_in_range(
            last_on=last_on,
            count=int(count),
            periodicidad=per_u,
            range_start_month=range_start_m,
            range_end_month=range_end_m,
        )

        total = float(cuota) * float(occ)
        tipo = (getattr(g, "nombre", None) or getattr(g, "rama", None) or "Gasto").strip()

        out_rows.append(
            BreakdownRowOut(
                tipo=tipo,
                periodicidad=per_u or "—",
                cuota=cuota,
                meses=int(occ),
                total=float(round(total, 2)),
            )
        )
        total_ytd += total

    return BreakdownOut(
        year=year,
        meses_contados=int(meses_contados),
        rows=out_rows,
        total_ytd=float(round(total_ytd, 2)),
    )


@router.get("/patrimonios/{patrimonio_id}/resumen", response_model=ResumenOut)
def resumen_patrimonio(
    patrimonio_id: str,
    year: int = Query(...),
    mode: str = Query("YEAR", description="LAST_12 | ALL_TIME | YEAR"),
    as_of: Optional[date] = Query(None, description="Fecha de referencia YYYY-MM-DD (default hoy)"),
    only_kpi_expenses: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    ing = ingresos_breakdown(patrimonio_id, year, mode, as_of, db, current_user)
    gas = gastos_breakdown(patrimonio_id, year, mode, as_of, only_kpi_expenses, db, current_user)

    meses_contados = int(ing.meses_contados or 1)

    ingresos_ytd = float(ing.total_ytd or 0.0)
    gastos_ytd = float(gas.total_ytd or 0.0)

    cashflow = ingresos_ytd - gastos_ytd
    promedio = cashflow / meses_contados if meses_contados > 0 else cashflow

    return ResumenOut(
        year=year,
        ingresos_ytd=float(round(ingresos_ytd, 2)),
        gastos_ytd=float(round(gastos_ytd, 2)),
        cashflow_ytd=float(round(cashflow, 2)),
        promedio_mensual=float(round(promedio, 2)),
        meses_contados=int(meses_contados),
    )


@router.get("/patrimonios/{patrimonio_id}/kpis", response_model=KpisOut)
def kpis_patrimonio(
    patrimonio_id: str,
    year: int = Query(...),
    mode: str = Query("YEAR", description="LAST_12 | ALL_TIME | YEAR"),
    as_of: Optional[date] = Query(None, description="Fecha de referencia YYYY-MM-DD (default hoy)"),
    basis: str = Query("total"),
    annualize: bool = Query(True),
    only_kpi_expenses: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    # Reutilizamos breakdowns (ya incluyen meses_contados del modo)
    ing_bd = ingresos_breakdown(patrimonio_id, year, mode, as_of, db, current_user)
    gas_bd = gastos_breakdown(patrimonio_id, year, mode, as_of, only_kpi_expenses, db, current_user)

    meses_contados = int(ing_bd.meses_contados or 1)

    ingresos_ytd = float(ing_bd.total_ytd or 0.0)
    gastos_ytd = float(gas_bd.total_ytd or 0.0)

    # Annualize:
    # - Si annualize=True, escalamos a "equivalente anual" en base a meses_contados del modo.
    # - Si annualize=False, dejamos el rango tal cual.
    factor = 1.0
    if annualize:
        factor = 12.0 / float(meses_contados) if meses_contados > 0 else 1.0

    ingresos_anuales = ingresos_ytd * factor
    gastos_anuales = gastos_ytd * factor
    noi = ingresos_anuales - gastos_anuales

    # Ocupación:
    # aproximación por ingresos mensuales => max meses (mensual) / meses_contados (del rango)
    max_occ = 0
    for r in ing_bd.rows:
        step = _step_months_from_periodicidad(r.periodicidad)
        if step == 1:
            max_occ = max(max_occ, int(r.meses or 0))

    den = float(max(1, meses_contados))
    ocupacion_pct = (float(max_occ) / den) * 100.0 if max_occ > 0 else 0.0

    compra = _get_compra(db, patrimonio_id)
    valor_base = _valor_base_from_compra(compra, basis)
    basis_used = (basis or "total").lower()

    cap_rate = (noi / valor_base) * 100.0 if valor_base > 0 else None
    rend_bruto = (ingresos_anuales / valor_base) * 100.0 if valor_base > 0 else None

    cashflow_anual = noi
    cashflow_mensual = cashflow_anual / 12.0

    info: Dict[str, str] = {
        "mode": "Selector de periodo: LAST_12 (últimos 12 meses), ALL_TIME (desde adquisición), YEAR (año calendario / YTD).",
        "meses_contados": "Meses del rango (denominador para promedios y annualize).",
        "valor_base": "Base usada para ratios: total_inversion (default) o compra/referencia según 'basis'.",
        "annualize": "Si annualize=True, escala a equivalente anual: 12/meses_contados.",
        "noi": "NOI = ingresos anuales − gastos operativos anuales.",
        "cap_rate_pct": "Cap rate = (NOI / valor_base) × 100.",
        "rendimiento_bruto_pct": "Rend. bruto = (ingresos anuales / valor_base) × 100.",
        "ocupacion_pct": "Ocupación aproximada = meses cobrados (mensual) / meses_contados × 100.",
        "data_model": "Ingresos/gastos se calculan por ultimo_* + *_cobrados/pagadas (efectivo), no por fecha_inicio->fin_año.",
    }

    return KpisOut(
        year=year,
        meses_contados=int(meses_contados),

        basis_used=basis_used,
        valor_base=float(round(valor_base, 2)),

        ingresos_anuales=float(round(ingresos_anuales, 2)),
        gastos_operativos_anuales=float(round(gastos_anuales, 2)),
        noi=float(round(noi, 2)),

        cap_rate_pct=(float(round(cap_rate, 2)) if cap_rate is not None else None),
        rendimiento_bruto_pct=(float(round(rend_bruto, 2)) if rend_bruto is not None else None),

        cashflow_anual=float(round(cashflow_anual, 2)),
        cashflow_mensual=float(round(cashflow_mensual, 2)),

        dscr=None,
        ocupacion_pct=float(round(ocupacion_pct, 1)),

        info=info,
    )


@router.get("/patrimonio/summary", response_model=PatrimonioSummaryOut)
def patrimonio_summary(
    year: int = Query(..., description="Año de cálculo (ej. 2025)."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Agregado multi-propiedad para el HomeDashboard.

    Nota:
    - Se mantiene el comportamiento original (usa RendimientoPatrimonio ya persistido).
    - No se toca para no romper Home.
    """
    patrimonios = (
        db.query(models.Patrimonio)
        .filter(
            models.Patrimonio.user_id == current_user.id,
            models.Patrimonio.activo == True,
        )
        .all()
    )

    if not patrimonios:
        return PatrimonioSummaryOut(
            year=year,
            propiedades_count=0,
            valor_mercado_total=0.0,
            noi_total=0.0,
            rentabilidad_bruta_media_pct=None,
            equity_total=0.0,
            equity_basis="equity = sum(valor_mercado) - sum(total_inversion)",
        )

    ids = [p.id for p in patrimonios]

    compras = (
        db.query(models.PatrimonioCompra)
        .filter(models.PatrimonioCompra.patrimonio_id.in_(ids))
        .all()
    )

    valor_mercado_total = 0.0
    total_inversion_total = 0.0

    for c in compras:
        valor_mercado_total += _f(getattr(c, "valor_mercado", 0.0), 0.0)
        total_inversion_total += _f(getattr(c, "total_inversion", 0.0), 0.0)

    rends = (
        db.query(models.RendimientoPatrimonio)
        .filter(
            models.RendimientoPatrimonio.patrimonio_id.in_(ids),
            models.RendimientoPatrimonio.year == year,
        )
        .all()
    )

    noi_total = 0.0
    yield_sum = 0.0
    yield_count = 0

    for r in rends:
        noi_total += _f(getattr(r, "ingreso_neto", 0.0), 0.0)

        y = getattr(r, "yield_bruto_pct", None)
        if y is not None:
            yv = _f(y, 0.0)
            yield_sum += yv
            yield_count += 1

    rentab_media = (yield_sum / yield_count) if yield_count > 0 else None
    equity_total = valor_mercado_total - total_inversion_total

    return PatrimonioSummaryOut(
        year=year,
        propiedades_count=len(ids),
        valor_mercado_total=float(round(valor_mercado_total, 2)),
        noi_total=float(round(noi_total, 2)),
        rentabilidad_bruta_media_pct=(float(round(rentab_media, 2)) if rentab_media is not None else None),
        equity_total=float(round(equity_total, 2)),
        equity_basis="equity = sum(valor_mercado) - sum(total_inversion)",
    )
