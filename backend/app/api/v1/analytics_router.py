"""
backend/app/api/v1/analytics_router.py

API v1 - ANALYTICS (v3) para Patrimonios (Propiedades)

Este router aporta endpoints consumidos por:
- PropiedadesRankingScreen.tsx
  GET /api/v1/analytics/patrimonios/{id}/kpis?annualize=true&basis=total

- PropiedadDetalleScreen.tsx
  GET /api/v1/analytics/patrimonios/{id}/kpis?year=YYYY&basis=total&annualize=true
  GET /api/v1/analytics/patrimonios/{id}/resumen?year=YYYY
  GET /api/v1/analytics/patrimonios/{id}/gastos_breakdown?year=YYYY
  GET /api/v1/analytics/patrimonios/{id}/ingresos_breakdown?year=YYYY

- PropiedadKpisScreen.tsx
  GET /api/v1/analytics/patrimonios/{id}/kpis?year=YYYY&basis=...&annualize=true&only_kpi_expenses=false

Notas importantes:
- Este router está diseñado para ser "robusto" ante cambios de modelo:
  usa getattr(...) y checks para no romper si algún campo no existe.
- Si tu modelo/BD difiere (nombres de tabla/campos), ajusta SOLO las funciones
  _query_ingresos() y _query_gastos() y (si aplica) _get_compra_row().
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user


router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
)

Basis = Literal["total", "compra", "referencia", "max"]


# ============================================================================
# Pydantic Schemas (respuesta) - adaptados a lo que espera el front
# ============================================================================

class ResumenYTDOut(BaseModel):
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
    meses: int = 0
    total: float


class BreakdownOut(BaseModel):
    year: int
    meses_contados: int
    rows: List[BreakdownRowOut]
    total_ytd: float


class KpisOut(BaseModel):
    # Metadatos
    year: int
    meses_contados: int

    # €/m2 y ratios
    precio_m2: Optional[float] = None
    referencia_m2: Optional[float] = None
    renta_m2_anual: Optional[float] = None
    inversion_m2: Optional[float] = None
    rentab_m2_total_pct: Optional[float] = None

    # KPIs core (los que pintas en Ranking/Detalle)
    cap_rate_pct: Optional[float] = None
    rendimiento_bruto_pct: Optional[float] = None
    noi: Optional[float] = None

    # Otros (compat con tu pantalla)
    dscr: Optional[float] = None
    ocupacion_pct: Optional[float] = None

    # Extras que tu PropiedadKpisScreen usa
    basis_used: Optional[Basis] = None
    valor_base: Optional[float] = None
    ingresos_anuales: Optional[float] = None
    gastos_operativos_anuales: Optional[float] = None
    cashflow_anual: Optional[float] = None
    cashflow_mensual: Optional[float] = None
    payback_anios: Optional[float] = None
    deuda_anual: Optional[float] = None

    # Texto info por KPI (para modales)
    info: Dict[str, str] = Field(default_factory=dict)


# ============================================================================
# Helpers generales
# ============================================================================

def _as_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        v = float(x)
        if v != v:  # NaN
            return None
        return v
    except Exception:
        return None


def _safe_date(x: Any) -> Optional[date]:
    """
    Convierte a date de forma robusta:
    - date/datetime => date
    - string 'YYYY-MM-DD' => date
    - si no parsea => None
    """
    if x is None:
        return None
    if isinstance(x, date) and not isinstance(x, datetime):
        return x
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, str):
        try:
            return date.fromisoformat(x[:10])
        except Exception:
            return None
    return None


def _months_counted_in_year(dates: List[date], year: int) -> int:
    """
    Meses contados:
    - Si hay fechas: número de meses únicos con datos (1..12)
    - Si no: hasta mes actual si year == actual; sino 12 (conservador)
    """
    filtered = [d for d in dates if d and d.year == year]
    if filtered:
        return len({(d.year, d.month) for d in filtered})
    today = date.today()
    if year == today.year:
        return max(1, today.month)
    return 12


def _annualize(value_ytd: float, meses_contados: int, annualize: bool) -> float:
    """
    Si annualize=True:
      anual = ytd * (12 / meses_contados)
    Si annualize=False:
      anual = ytd (sin escalar)
    """
    if not annualize:
        return float(value_ytd)
    m = max(1, int(meses_contados))
    return float(value_ytd) * (12.0 / float(m))


# ============================================================================
# Acceso a datos (AJUSTA AQUÍ si tus modelos se llaman distinto)
# ============================================================================

def _assert_patrimonio_owner(db: Session, patrimonio_id: str, user_id: str) -> models.Patrimonio:
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or getattr(patr, "user_id", None) != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    return patr


def _get_compra_row(db: Session, patrimonio_id: str) -> Optional[Any]:
    """
    Recupera fila de compra si existe.

    En tu patrimonio_router usas:
      row = db.get(models.PatrimonioCompra, patrimonio_id)  # PK = patrimonio_id

    Lo replicamos aquí.
    """
    try:
        return db.get(models.PatrimonioCompra, patrimonio_id)
    except Exception:
        return None


def _query_ingresos(db: Session, patrimonio_id: str, year: int) -> List[Any]:
    """
    Recupera ingresos asociados a un patrimonio.

    Según tu front, Ingreso tiene:
      referencia_vivienda_id, importe, fecha_inicio o createon, periodicidad, activo, kpi, cobrado, etc.

    Ajusta el nombre del modelo si tu SQLAlchemy model se llama distinto.
    """
    if not hasattr(models, "Ingreso"):
        return []

    Ingreso = models.Ingreso  # type: ignore

    q = db.query(Ingreso)

    # vínculo a patrimonio: referencia_vivienda_id
    if hasattr(Ingreso, "referencia_vivienda_id"):
        q = q.filter(getattr(Ingreso, "referencia_vivienda_id") == patrimonio_id)
    elif hasattr(Ingreso, "patrimonio_id"):
        q = q.filter(getattr(Ingreso, "patrimonio_id") == patrimonio_id)
    else:
        return []

    # activo
    if hasattr(Ingreso, "activo"):
        q = q.filter(getattr(Ingreso, "activo") != False)  # noqa: E712

    rows = q.all()

    # filtrar por año en python para robustez (por si el campo fecha no existe en DB)
    out: List[Any] = []
    for r in rows:
        d = _safe_date(getattr(r, "fecha_inicio", None)) or _safe_date(getattr(r, "createon", None))
        if d and d.year == year:
            out.append(r)
    return out


def _query_gastos(db: Session, patrimonio_id: str, year: int) -> List[Any]:
    """
    Recupera gastos asociados a un patrimonio.

    Ajusta el nombre del modelo si tu SQLAlchemy model se llama distinto.
    """
    if not hasattr(models, "Gasto"):
        return []

    Gasto = models.Gasto  # type: ignore
    q = db.query(Gasto)

    if hasattr(Gasto, "referencia_vivienda_id"):
        q = q.filter(getattr(Gasto, "referencia_vivienda_id") == patrimonio_id)
    elif hasattr(Gasto, "patrimonio_id"):
        q = q.filter(getattr(Gasto, "patrimonio_id") == patrimonio_id)
    else:
        return []

    if hasattr(Gasto, "activo"):
        q = q.filter(getattr(Gasto, "activo") != False)  # noqa: E712

    rows = q.all()

    out: List[Any] = []
    for r in rows:
        d = _safe_date(getattr(r, "fecha", None)) or _safe_date(getattr(r, "fecha_inicio", None)) or _safe_date(getattr(r, "createon", None))
        if d and d.year == year:
            out.append(r)
    return out


# ============================================================================
# Cálculos (YTD, breakdown, KPI)
# ============================================================================

def _sum_importe(rows: List[Any]) -> float:
    total = 0.0
    for r in rows:
        total += float(_as_float(getattr(r, "importe", None)) or 0.0)
    return total


def _dates_from_rows(rows: List[Any]) -> List[date]:
    dates: List[date] = []
    for r in rows:
        d = (
            _safe_date(getattr(r, "fecha_inicio", None))
            or _safe_date(getattr(r, "fecha", None))
            or _safe_date(getattr(r, "createon", None))
        )
        if d:
            dates.append(d)
    return dates


def _group_breakdown(rows: List[Any]) -> List[BreakdownRowOut]:
    """
    Agrupa por (tipo, periodicidad). Si tu modelo tiene:
      - tipo_nombre o tipo_id
      - periodicidad
    El front espera:
      tipo (texto), periodicidad (texto), cuota, meses, total
    """
    buckets: Dict[str, Dict[str, Any]] = {}

    for r in rows:
        tipo = (
            (getattr(r, "tipo_nombre", None) or "").strip()
            or (getattr(r, "tipo_id", None) or "").strip()
            or (getattr(r, "tipo", None) or "").strip()
            or "Sin tipo"
        )
        periodicidad = (getattr(r, "periodicidad", None) or "").strip() or "—"
        key = f"{tipo}||{periodicidad}"

        imp = float(_as_float(getattr(r, "importe", None)) or 0.0)

        if key not in buckets:
            buckets[key] = {
                "tipo": tipo,
                "periodicidad": periodicidad,
                "count": 0,
                "total": 0.0,
            }

        buckets[key]["count"] += 1
        buckets[key]["total"] += imp

    out: List[BreakdownRowOut] = []
    for b in buckets.values():
        meses = int(b["count"])
        total = float(b["total"])
        cuota = (total / meses) if meses > 0 else None

        out.append(
            BreakdownRowOut(
                tipo=str(b["tipo"]),
                periodicidad=str(b["periodicidad"]),
                cuota=float(cuota) if cuota is not None else None,
                meses=meses,
                total=total,
            )
        )

    # Orden: mayor total primero
    out.sort(key=lambda x: x.total, reverse=True)
    return out


def _compute_base_value(
    compra_row: Optional[Any],
    basis: Basis,
) -> Optional[float]:
    """
    Valor base para ratios:
    - total: total_inversion si existe; si no, valor_compra
    - compra: valor_compra
    - referencia: valor_referencia si existe; si no, valor_compra
    - max: max(total_inversion, valor_compra, valor_referencia)
    """
    if compra_row is None:
        return None

    valor_compra = _as_float(getattr(compra_row, "valor_compra", None))
    valor_ref = _as_float(getattr(compra_row, "valor_referencia", None))
    total_inv = _as_float(getattr(compra_row, "total_inversion", None))

    if basis == "compra":
        return valor_compra
    if basis == "referencia":
        return valor_ref or valor_compra
    if basis == "total":
        return total_inv or valor_compra
    # max
    candidates = [v for v in [total_inv, valor_compra, valor_ref] if v is not None and v > 0]
    return max(candidates) if candidates else None


def _kpi_info_texts() -> Dict[str, str]:
    """
    Textos informativos para tu PropiedadKpisScreen (kpi._info[key]).
    Si quieres, puedes ampliar este mapping con más claves.
    """
    return {
        "valor_base": "Valor base usado como denominador (total inversión / compra / referencia / max).",
        "ingresos_anuales": "Ingresos anuales estimados. Si 'annualize' está activo, se escala desde YTD.",
        "gastos_operativos_anuales": "Gastos operativos anuales estimados. Si 'annualize' está activo, se escala desde YTD.",
        "noi": "NOI (Net Operating Income) = Ingresos anuales − Gastos operativos anuales.",
        "cap_rate_pct": "Cap rate = (NOI / Valor base) × 100.",
        "rendimiento_bruto_pct": "Rendimiento bruto = (Ingresos anuales / Valor base) × 100.",
        "ocupacion_pct": "Ocupación = (Meses con ingresos / Meses contados) × 100 (aprox.).",
        "dscr": "DSCR = NOI / Deuda anual (si existe deuda).",
        "payback_anios": "Payback = Valor base / Cash-flow anual (aprox.).",
    }


# ============================================================================
# Endpoints
# ============================================================================

@router.get(
    "/patrimonios/{patrimonio_id}/resumen",
    response_model=ResumenYTDOut,
    summary="Resumen YTD de una propiedad (ingresos, gastos, cashflow, promedio mensual)",
)
def resumen_patrimonio(
    patrimonio_id: str,
    year: int = Query(default_factory=lambda: date.today().year),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
) -> ResumenYTDOut:
    _assert_patrimonio_owner(db, patrimonio_id, current_user.id)

    ingresos = _query_ingresos(db, patrimonio_id, year)
    gastos = _query_gastos(db, patrimonio_id, year)

    ingresos_ytd = _sum_importe(ingresos)
    gastos_ytd = _sum_importe(gastos)
    cashflow_ytd = ingresos_ytd - gastos_ytd

    dates = _dates_from_rows(ingresos) + _dates_from_rows(gastos)
    meses_contados = _months_counted_in_year(dates, year)

    promedio_mensual = cashflow_ytd / float(max(1, meses_contados))

    return ResumenYTDOut(
        year=year,
        ingresos_ytd=float(ingresos_ytd),
        gastos_ytd=float(gastos_ytd),
        cashflow_ytd=float(cashflow_ytd),
        promedio_mensual=float(promedio_mensual),
        meses_contados=int(meses_contados),
    )


@router.get(
    "/patrimonios/{patrimonio_id}/gastos_breakdown",
    response_model=BreakdownOut,
    summary="Breakdown de gastos YTD por tipo/periodicidad",
)
def gastos_breakdown(
    patrimonio_id: str,
    year: int = Query(default_factory=lambda: date.today().year),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
) -> BreakdownOut:
    _assert_patrimonio_owner(db, patrimonio_id, current_user.id)

    gastos = _query_gastos(db, patrimonio_id, year)
    rows = _group_breakdown(gastos)
    total_ytd = _sum_importe(gastos)

    dates = _dates_from_rows(gastos)
    meses_contados = _months_counted_in_year(dates, year)

    return BreakdownOut(
        year=year,
        meses_contados=int(meses_contados),
        rows=rows,
        total_ytd=float(total_ytd),
    )


@router.get(
    "/patrimonios/{patrimonio_id}/ingresos_breakdown",
    response_model=BreakdownOut,
    summary="Breakdown de ingresos YTD por tipo/periodicidad",
)
def ingresos_breakdown(
    patrimonio_id: str,
    year: int = Query(default_factory=lambda: date.today().year),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
) -> BreakdownOut:
    _assert_patrimonio_owner(db, patrimonio_id, current_user.id)

    ingresos = _query_ingresos(db, patrimonio_id, year)
    rows = _group_breakdown(ingresos)
    total_ytd = _sum_importe(ingresos)

    dates = _dates_from_rows(ingresos)
    meses_contados = _months_counted_in_year(dates, year)

    return BreakdownOut(
        year=year,
        meses_contados=int(meses_contados),
        rows=rows,
        total_ytd=float(total_ytd),
    )


@router.get(
    "/patrimonios/{patrimonio_id}/kpis",
    response_model=KpisOut,
    summary="KPIs de una propiedad (cap rate, rendimiento bruto, noi, etc.)",
)
def kpis_patrimonio(
    patrimonio_id: str,
    year: int = Query(default_factory=lambda: date.today().year),
    basis: Basis = Query("total", description="total|compra|referencia|max"),
    annualize: bool = Query(True, description="Si true, escala YTD a anual con meses_contados"),
    only_kpi_expenses: bool = Query(False, description="Si true, filtra gastos donde kpi=True (si existe campo)"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
) -> KpisOut:
    patr = _assert_patrimonio_owner(db, patrimonio_id, current_user.id)

    # Datos base: ingresos/gastos del año
    ingresos_rows = _query_ingresos(db, patrimonio_id, year)
    gastos_rows = _query_gastos(db, patrimonio_id, year)

    # Filtro opcional: solo gastos KPI (si el modelo tiene el campo)
    if only_kpi_expenses and gastos_rows:
        filtered = []
        for g in gastos_rows:
            if hasattr(g, "kpi"):
                if bool(getattr(g, "kpi", False)):
                    filtered.append(g)
            else:
                # Si no existe campo kpi, no filtramos (robusto)
                filtered.append(g)
        gastos_rows = filtered

    ingresos_ytd = _sum_importe(ingresos_rows)
    gastos_ytd = _sum_importe(gastos_rows)

    # Meses contados: por datos reales (si no hay, fallback)
    dates = _dates_from_rows(ingresos_rows) + _dates_from_rows(gastos_rows)
    meses_contados = _months_counted_in_year(dates, year)

    # Escalado anual
    ingresos_anuales = _annualize(ingresos_ytd, meses_contados, annualize)
    gastos_anuales = _annualize(gastos_ytd, meses_contados, annualize)
    noi = ingresos_anuales - gastos_anuales

    # Compra / base value para ratios
    compra_row = _get_compra_row(db, patrimonio_id)
    valor_base = _compute_base_value(compra_row, basis)

    cap_rate_pct: Optional[float] = None
    rend_bruto_pct: Optional[float] = None

    if valor_base and valor_base > 0:
        cap_rate_pct = (noi / valor_base) * 100.0
        rend_bruto_pct = (ingresos_anuales / valor_base) * 100.0

    # Ocupación (aprox): meses con ingresos / meses contados
    meses_con_ingreso = len({(d.year, d.month) for d in _dates_from_rows(ingresos_rows) if d.year == year})
    ocupacion_pct: Optional[float] = None
    if meses_contados > 0:
        ocupacion_pct = (float(meses_con_ingreso) / float(meses_contados)) * 100.0

    # €/m2 y métricas por m2
    sup_util = _as_float(getattr(patr, "superficie_m2", None))  # tu front llama "Útil (m²)"
    valor_compra = _as_float(getattr(compra_row, "valor_compra", None)) if compra_row else None
    valor_ref = _as_float(getattr(compra_row, "valor_referencia", None)) if compra_row else None
    total_inv = _as_float(getattr(compra_row, "total_inversion", None)) if compra_row else None

    precio_m2 = (valor_compra / sup_util) if (valor_compra and sup_util and sup_util > 0) else None
    referencia_m2 = (valor_ref / sup_util) if (valor_ref and sup_util and sup_util > 0) else None
    inversion_m2 = (total_inv / sup_util) if (total_inv and sup_util and sup_util > 0) else None
    renta_m2_anual = (ingresos_anuales / sup_util) if (sup_util and sup_util > 0) else None

    rentab_m2_total_pct: Optional[float] = None
    if renta_m2_anual is not None and inversion_m2 is not None and inversion_m2 > 0:
        rentab_m2_total_pct = (renta_m2_anual / inversion_m2) * 100.0

    # Cashflow: por ahora aproximamos cashflow = NOI (hasta integrar deuda/hipoteca)
    cashflow_anual = noi
    cashflow_mensual = cashflow_anual / 12.0

    # Payback: valor_base / cashflow_anual (si cashflow positivo)
    payback_anios: Optional[float] = None
    if valor_base and cashflow_anual and cashflow_anual > 0:
        payback_anios = valor_base / cashflow_anual

    # Deuda/DSCR: placeholder robusto (si tu backend tiene préstamos, aquí lo integrarías)
    deuda_anual = None
    dscr = None

    info = _kpi_info_texts()

    return KpisOut(
        year=year,
        meses_contados=int(meses_contados),

        precio_m2=float(precio_m2) if precio_m2 is not None else None,
        referencia_m2=float(referencia_m2) if referencia_m2 is not None else None,
        renta_m2_anual=float(renta_m2_anual) if renta_m2_anual is not None else None,
        inversion_m2=float(inversion_m2) if inversion_m2 is not None else None,
        rentab_m2_total_pct=float(rentab_m2_total_pct) if rentab_m2_total_pct is not None else None,

        cap_rate_pct=float(cap_rate_pct) if cap_rate_pct is not None else None,
        rendimiento_bruto_pct=float(rend_bruto_pct) if rend_bruto_pct is not None else None,
        noi=float(noi) if noi is not None else None,

        dscr=dscr,
        ocupacion_pct=float(ocupacion_pct) if ocupacion_pct is not None else None,

        basis_used=basis,
        valor_base=float(valor_base) if valor_base is not None else None,
        ingresos_anuales=float(ingresos_anuales),
        gastos_operativos_anuales=float(gastos_anuales),
        cashflow_anual=float(cashflow_anual),
        cashflow_mensual=float(cashflow_mensual),
        payback_anios=float(payback_anios) if payback_anios is not None else None,
        deuda_anual=deuda_anual,

        info=info,
    )
