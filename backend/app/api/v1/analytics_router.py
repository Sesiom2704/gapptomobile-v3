# backend/app/api/v1/analytics_router.py
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
  Agregado multi-propiedad para mostrar en el panel principal.

Criterios:
- Multi-tenant: todo filtrado por user_id (require_user).
- “only_kpi_expenses”: en gastos, filtra por Gasto.kpi == True (según tu modelo).
- “basis”: base de valor para cap_rate / rendimiento_bruto:
    - total   -> PatrimonioCompra.total_inversion (fallback: max(valor_compra, valor_referencia))
    - compra  -> valor_compra
    - referencia -> valor_referencia
    - max -> max(valor_compra, valor_referencia, total_inversion)
- “annualize”: si year es el actual, extrapola a 12 meses usando meses_contados.

Notas de robustez:
- Manejo defensivo de nulls.
- Numeric/Decimal -> float para JSON.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user


router = APIRouter(prefix="/analytics", tags=["analytics"])


# =========================================================
# Helpers: casting defensivo
# =========================================================

def _f(x: object, default: float = 0.0) -> float:
    """
    Convierte Numeric/Decimal/None/str a float de forma defensiva.
    """
    if x is None:
        return default
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)  # str u otros
    except Exception:
        return default


# =========================================================
# Pydantic DTOs (respuesta)
# =========================================================

class ResumenOut(BaseModel):
    year: int
    ingresos_ytd: float
    gastos_ytd: float
    cashflow_ytd: float
    promedio_mensual: float
    meses_contados: int


class BreakdownRowOut(BaseModel):
    tipo: str
    periodicidad: str
    cuota: Optional[float] = None
    meses: int
    total: float


class BreakdownOut(BaseModel):
    year: int
    meses_contados: int
    rows: List[BreakdownRowOut]
    total_ytd: float


class KpisOut(BaseModel):
    year: int
    meses_contados: int

    # Base / agregados
    basis_used: str
    valor_base: float

    ingresos_anuales: float
    gastos_operativos_anuales: float
    noi: float

    cap_rate_pct: Optional[float] = None
    rendimiento_bruto_pct: Optional[float] = None

    cashflow_anual: float
    cashflow_mensual: float

    dscr: Optional[float] = None
    ocupacion_pct: Optional[float] = None

    info: Dict[str, str] = Field(default_factory=dict)


# NUEVO: Summary para Home (agregado multi-propiedad)
class PatrimonioSummaryOut(BaseModel):
    year: int

    propiedades_count: int
    valor_mercado_total: float

    noi_total: float

    # % (puede ser null si no hay datos suficientes)
    rentabilidad_bruta_media_pct: Optional[float] = None

    # Equity agregado (definición: valor_mercado_total - total_inversion_total)
    equity_total: float

    # Diagnóstico/explicación simple
    equity_basis: Optional[str] = None


# =========================================================
# Helpers genéricos de fechas y meses
# =========================================================

def _as_date(d: Optional[date | datetime]) -> Optional[date]:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date()
    return d


def _months_inclusive_between(start: date, end: date) -> int:
    """
    Meses inclusivos por calendario entre start y end.
    Ej:
      2025-01-01 a 2025-01-31 -> 1
      2025-01-15 a 2025-03-01 -> 3 (enero, febrero, marzo)
    """
    if start > end:
        return 0
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def _year_window(year: int) -> Tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def _meses_contados_para_year(year: int) -> int:
    """
    Para YTD/annualize:
    - Si year == año actual -> mes actual (1..12)
    - Si no -> 12
    """
    today = date.today()
    return today.month if today.year == year else 12


# =========================================================
# Helpers periodicidad -> ocurrencias
# =========================================================

def _norm_periodicidad(p: Optional[str]) -> str:
    return (p or "").strip().upper()


def _step_months_from_periodicidad(p: str) -> Optional[int]:
    """
    Devuelve cuántos meses por ocurrencia (step):
      MENSUAL -> 1
      BIMESTRAL -> 2
      TRIMESTRAL -> 3
      CUATRIMESTRAL -> 4
      SEMESTRAL -> 6
      ANUAL -> 12
      PAGO ÚNICO -> None (especial)
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

    # fallback: si no sabemos, asumimos mensual
    return 1


def _occurrences_in_range(start: date, end: date, periodicidad: str) -> int:
    """
    Calcula ocurrencias entre start-end, recortadas por año, según periodicidad.
    - PAGO ÚNICO -> 1 si cae dentro del rango.
    - Mensual -> meses inclusivos
    - Trimestral/sem... -> ceil(meses_inclusivos / step)
    """
    step = _step_months_from_periodicidad(periodicidad)
    meses = _months_inclusive_between(start, end)
    if meses <= 0:
        return 0

    # Pago único: 1 si existe en rango
    if step is None:
        return 1

    # ceil(meses / step)
    return (meses + step - 1) // step


# =========================================================
# Helpers: Ingresos (meses ocupación / cobros)
# =========================================================

def _ingreso_start(ing: models.Ingreso) -> Optional[date]:
    if getattr(ing, "fecha_inicio", None) is not None:
        return _as_date(ing.fecha_inicio)
    return _as_date(getattr(ing, "createon", None))


def _ingreso_inactivated_on(ing: models.Ingreso) -> Optional[date]:
    return _as_date(getattr(ing, "inactivatedon", None))


def _calc_meses_ingreso_en_year(ing: models.Ingreso, year: int) -> int:
    """
    - Si activo: tramo hasta 31/12 (recortado por inicio), con opción de cap por ingresos_cobrados.
    - Si inactivo: tramo hasta inactivatedon (si está en el año).
    - Cap total a 12.
    """
    jan1, dec31 = _year_window(year)
    start_any = _ingreso_start(ing)
    if start_any is None:
        return 0

    start = start_any if start_any.year >= year else jan1
    if start < jan1:
        start = jan1
    if start > dec31:
        return 0

    activo = bool(getattr(ing, "activo", True))
    inact = _ingreso_inactivated_on(ing)

    cobrados = getattr(ing, "ingresos_cobrados", None)
    try:
        cobrados_int = int(cobrados) if cobrados is not None else None
    except Exception:
        cobrados_int = None

    if activo:
        end = dec31
        meses_nominal = _months_inclusive_between(start, end)
        if cobrados_int is not None and cobrados_int >= 0:
            meses = min(meses_nominal, cobrados_int)
        else:
            meses = meses_nominal
    else:
        if inact is not None and inact < jan1:
            return 0
        end = inact if (inact is not None and inact <= dec31) else dec31
        meses = _months_inclusive_between(start, end)

    return max(0, min(12, meses))


# =========================================================
# Helpers: Gastos (ocurrencias en el año)
# =========================================================

def _gasto_start(g: models.Gasto) -> Optional[date]:
    if getattr(g, "fecha", None) is not None:
        return _as_date(g.fecha)
    return _as_date(getattr(g, "createon", None))


def _gasto_inactivated_on(g: models.Gasto) -> Optional[date]:
    return _as_date(getattr(g, "inactivatedon", None))


def _calc_ocurrencias_gasto_en_year(g: models.Gasto, year: int) -> int:
    """
    - Si activo: ocurrencias desde fecha hasta 31/12 (recortado al año).
    - Si inactivo: hasta inactivatedon si cae dentro del año.
    - Para gastos puntuales (PAGO ÚNICO), 1 si cae dentro del año.
    """
    jan1, dec31 = _year_window(year)
    start_any = _gasto_start(g)
    if start_any is None:
        return 0

    start = start_any if start_any.year >= year else jan1
    if start < jan1:
        start = jan1
    if start > dec31:
        return 0

    activo = bool(getattr(g, "activo", True))
    inact = _gasto_inactivated_on(g)

    if activo:
        end = dec31
    else:
        if inact is not None and inact < jan1:
            return 0
        end = inact if (inact is not None and inact <= dec31) else dec31

    return _occurrences_in_range(start, end, getattr(g, "periodicidad", "") or "")


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
    """
    basis: total | compra | referencia | max
    """
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
    # total: si hay total_inversion, usarlo; si no, max(vc, vr)
    return ti if ti > 0 else max(vc, vr)


# =========================================================
# ENDPOINTS EXISTENTES
# =========================================================

@router.get("/patrimonios/{patrimonio_id}/ingresos_breakdown", response_model=BreakdownOut)
def ingresos_breakdown(
    patrimonio_id: str,
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    meses_contados = _meses_contados_para_year(year)
    jan1, dec31 = _year_window(year)

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

        if _step_months_from_periodicidad(per_u) == 1:
            meses = _calc_meses_ingreso_en_year(ing, year)
        else:
            start = _ingreso_start(ing)
            if start is None:
                meses = 0
            else:
                start_r = start if start.year >= year else jan1
                if start_r < jan1:
                    start_r = jan1
                end_r = dec31
                if not bool(getattr(ing, "activo", True)):
                    inact = _ingreso_inactivated_on(ing)
                    if inact and inact < jan1:
                        meses = 0
                    else:
                        end_r = inact if (inact and inact <= dec31) else dec31
                occ = _occurrences_in_range(start_r, end_r, per_u)
                meses = occ

        total = float(cuota) * float(meses)

        tipo = (getattr(ing, "concepto", None) or "Ingreso").strip() if getattr(ing, "concepto", None) else "Ingreso"

        out_rows.append(
            BreakdownRowOut(
                tipo=tipo,
                periodicidad=per_u or "—",
                cuota=cuota,
                meses=int(meses),
                total=float(round(total, 2)),
            )
        )
        total_ytd += total

    return BreakdownOut(
        year=year,
        meses_contados=meses_contados,
        rows=out_rows,
        total_ytd=float(round(total_ytd, 2)),
    )


@router.get("/patrimonios/{patrimonio_id}/gastos_breakdown", response_model=BreakdownOut)
def gastos_breakdown(
    patrimonio_id: str,
    year: int = Query(...),
    only_kpi: bool = Query(False, alias="only_kpi_expenses"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    meses_contados = _meses_contados_para_year(year)

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
        occ = _calc_ocurrencias_gasto_en_year(g, year)

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
        meses_contados=meses_contados,
        rows=out_rows,
        total_ytd=float(round(total_ytd, 2)),
    )


@router.get("/patrimonios/{patrimonio_id}/resumen", response_model=ResumenOut)
def resumen_patrimonio(
    patrimonio_id: str,
    year: int = Query(...),
    only_kpi_expenses: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    meses_contados = _meses_contados_para_year(year)

    ing = ingresos_breakdown(patrimonio_id, year, db, current_user)
    gas = gastos_breakdown(patrimonio_id, year, only_kpi_expenses, db, current_user)

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
    basis: str = Query("total"),
    annualize: bool = Query(True),
    only_kpi_expenses: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Patrimonio no encontrado")

    meses_contados = _meses_contados_para_year(year)

    ing_bd = ingresos_breakdown(patrimonio_id, year, db, current_user)
    gas_bd = gastos_breakdown(patrimonio_id, year, only_kpi_expenses, db, current_user)

    ingresos_ytd = float(ing_bd.total_ytd or 0.0)
    gastos_ytd = float(gas_bd.total_ytd or 0.0)

    factor = 1.0
    if annualize:
        factor = 12.0 / float(meses_contados) if meses_contados > 0 else 1.0

    ingresos_anuales = ingresos_ytd * factor
    gastos_anuales = gastos_ytd * factor
    noi = ingresos_anuales - gastos_anuales

    max_meses = 0
    for r in ing_bd.rows:
        if _step_months_from_periodicidad(r.periodicidad) == 1:
            max_meses = max(max_meses, int(r.meses or 0))
    max_meses = min(12, max_meses)
    ocupacion_pct = (float(max_meses) / 12.0) * 100.0 if max_meses > 0 else 0.0

    compra = _get_compra(db, patrimonio_id)
    valor_base = _valor_base_from_compra(compra, basis)
    basis_used = (basis or "total").lower()

    cap_rate = (noi / valor_base) * 100.0 if valor_base > 0 else None
    rend_bruto = (ingresos_anuales / valor_base) * 100.0 if valor_base > 0 else None

    cashflow_anual = noi
    cashflow_mensual = cashflow_anual / 12.0

    info: Dict[str, str] = {
        "valor_base": "Base usada para ratios: total_inversion (default) o compra/referencia según 'basis'.",
        "ingresos_anuales": "Suma anualizada de ingresos (importe * meses/ocurrencias).",
        "gastos_operativos_anuales": "Suma anualizada de gastos operativos (cuota_base * ocurrencias).",
        "noi": "NOI = ingresos anuales − gastos operativos anuales.",
        "cap_rate_pct": "Cap rate = (NOI / valor_base) × 100.",
        "rendimiento_bruto_pct": "Rend. bruto = (ingresos anuales / valor_base) × 100.",
        "ocupacion_pct": "Ocupación aproximada = meses cobrados / 12 × 100 (basado en ingresos mensuales).",
        "meses_contados": "Si el año es el actual, meses_contados = mes actual. Si no, 12.",
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


# =========================================================
# NUEVO ENDPOINT: /patrimonio/summary (agregado para Home)
# =========================================================

@router.get("/patrimonio/summary", response_model=PatrimonioSummaryOut)
def patrimonio_summary(
    year: int = Query(..., description="Año de cálculo (ej. 2025)."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Agregado multi-propiedad para el HomeDashboard.

    Devuelve:
    - propiedades_count: nº de patrimonios activos del usuario
    - valor_mercado_total: suma de PatrimonioCompra.valor_mercado (si no existe, 0)
    - noi_total: suma de RendimientoPatrimonio.ingreso_neto para ese year
    - rentabilidad_bruta_media_pct: media simple de RendimientoPatrimonio.yield_bruto_pct (nullable)
    - equity_total: valor_mercado_total - total_inversion_total

    Notas:
    - Se filtra por user_id (multi-tenant).
    - Se consideran solo patrimonios activos.
    - Si falta compra o rendimiento en alguna propiedad, se asume 0 para agregados.
    """

    # 1) Patrimonios activos del usuario
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

    # 2) Compras (valor mercado / total inversión)
    compras = (
        db.query(models.PatrimonioCompra)
        .filter(models.PatrimonioCompra.patrimonio_id.in_(ids))
        .all()
    )

    valor_mercado_total = 0.0
    total_inversion_total = 0.0

    # Index por patrimonio_id para rapidez (por si lo necesitas luego)
    compra_by_id: Dict[str, models.PatrimonioCompra] = {}
    for c in compras:
        compra_by_id[str(c.patrimonio_id)] = c

        valor_mercado_total += _f(getattr(c, "valor_mercado", 0.0), 0.0)
        total_inversion_total += _f(getattr(c, "total_inversion", 0.0), 0.0)

    # 3) Rendimientos del año (NOI y yield bruto)
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
            # Si está a 0 por defecto pero realmente no aplica, igualmente cuenta.
            # Si prefieres ignorar ceros, cambia la condición.
            yield_sum += yv
            yield_count += 1

    rentab_media = (yield_sum / yield_count) if yield_count > 0 else None

    # 4) Equity agregado (definición simple)
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
