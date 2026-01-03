# backend/app/api/v1/day_to_day_analysis_router.py

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, extract
from sqlalchemy.orm import Session
from typing_extensions import Literal

from backend.app.db.session import get_db
from backend.app.db import models

# ✅ Auth multi-tenant
from backend.app.api.v1.auth_router import require_user

from backend.app.schemas.day_to_day_analysis import (
    DayToDayAnalysisResponse,
    TodaySummary,
    WeekSummary,
    MonthSummary,
    CategoryMonth,
    CategoryKpi,
    ProviderItem,
    Last7DayItem,
    # NUEVO
    DailySeriesItem,
    MonthlySeriesItem,
    EvolutionKpis,
)

router = APIRouter(
    prefix="/analytics",   # se completa con /api/v1 en main.py
    tags=["analytics"],
)

# ---------------------------------------------------------------------------
# Helpers: tipado defensivo
# ---------------------------------------------------------------------------

def _safe_user_id_int(user: models.User) -> int:
    """
    Normaliza current_user.id a int.

    Motivo:
    - En Postgres, gastos_cotidianos.user_id es INTEGER.
    - current_user.id a veces viene como string ("2").
    - Comparar INTEGER = VARCHAR rompe (UndefinedFunction).
    """
    raw = getattr(user, "id", None)
    try:
        return int(raw)  # "2" -> 2
    except Exception:
        # Fallback extremo: evita 500 y asegura que no “mezclas” datos de otros usuarios.
        return -1


def _f(x: object, default: float = 0.0) -> float:
    try:
        v = float(x)  # type: ignore[arg-type]
        return v if v == v else default
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Mapeo de tipos de gasto cotidiano a categorías de análisis
# ---------------------------------------------------------------------------

TIPO_TO_CATEGORY: dict[str, str] = {
    "COM-TIPOGASTO-311A33BD": "SUPERMERCADOS",
    "ELE-TIPOGASTO-47CC77E5": "SUMINISTROS",

    "TIP-GASOLINA-SW1ZQO": "VEHICULOS",
    "MAV-TIPOGASTO-BVC356": "VEHICULOS",
    "PEA-TIPOGASTO-7HDY89": "VEHICULOS",

    "ROP-TIPOGASTO-S227BB": "ROPA",

    "RES-TIPOGASTO-26ROES": "RESTAURACION",

    "TRA-TIPOGASTO-RB133Z": "OCIO",
    "HOS-TIPOGASTO-357FDG": "OCIO",
    "ACT-TIPOGASTO-2X9H1Q": "OCIO",
}


def classify_category(tipo_id: Optional[str]) -> str:
    if not tipo_id:
        return "OTROS"
    return TIPO_TO_CATEGORY.get(tipo_id, "OTROS")


# ---------------------------------------------------------------------------
# Utilidades de fechas
# ---------------------------------------------------------------------------

def parse_base_date(fecha_str: Optional[str]) -> date:
    if not fecha_str:
        return date.today()
    try:
        return datetime.strptime(fecha_str, "%Y-%m-%d").date()
    except ValueError:
        return date.today()


def month_range(base: date) -> tuple[date, date]:
    start = base.replace(day=1)
    if base.month == 12:
        next_month = date(base.year + 1, 1, 1)
    else:
        next_month = date(base.year, base.month + 1, 1)
    return start, next_month


def prev_month_range(base: date) -> tuple[date, date]:
    if base.month == 1:
        start_prev = date(base.year - 1, 12, 1)
    else:
        start_prev = date(base.year, base.month - 1, 1)
    start_curr, _ = month_range(base)
    return start_prev, start_curr


def week_range(base: date) -> tuple[date, date]:
    start = base - timedelta(days=base.weekday())
    end = start + timedelta(days=6)
    return start, end


def format_spanish_date(d: date) -> str:
    dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    meses = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ]
    return f"{dias[d.weekday()]}, {d.day} de {meses[d.month - 1]}"


def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, 1)


# ---------------------------------------------------------------------------
# Helpers de filtros
# ---------------------------------------------------------------------------

def apply_pago_filter(query, GastoCotidiano, pago_mode: str):
    if pago_mode == "YO":
        return query.filter(GastoCotidiano.pagado.is_(True))
    if pago_mode == "OTRO":
        return query.filter(GastoCotidiano.pagado.is_(False))
    return query


def apply_categoria_filters(
    query,
    GastoCotidiano,
    categoria: Optional[str],
    tipo_id: Optional[str],
):
    if tipo_id:
        return query.filter(GastoCotidiano.tipo_id == tipo_id)

    if categoria:
        categoria_upper = categoria.upper()
        tipo_ids = [tid for tid, cat in TIPO_TO_CATEGORY.items() if cat.upper() == categoria_upper]
        if tipo_ids:
            return query.filter(GastoCotidiano.tipo_id.in_(tipo_ids))

    return query


def apply_user_filter(query, GastoCotidiano, user_id: int):
    """
    Multi-tenant: restringe por user_id.

    IMPORTANTE:
    - En tu BD user_id es INTEGER.
    - Siempre filtramos con int para evitar INTEGER = VARCHAR.
    """
    return query.filter(GastoCotidiano.user_id == user_id)


# ---------------------------------------------------------------------------
# Helpers de agregación existentes
# ---------------------------------------------------------------------------

def _aggregate_by_category(
    db: Session,
    start_date: date,
    end_date_exclusive: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> Dict[str, Dict[str, float]]:
    GastoCotidiano = models.GastoCotidiano

    base_query = (
        db.query(
            GastoCotidiano.tipo_id,
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.count(GastoCotidiano.id).label("tickets"),
        )
        .filter(GastoCotidiano.fecha >= start_date)
        .filter(GastoCotidiano.fecha < end_date_exclusive)
    )

    base_query = apply_user_filter(base_query, GastoCotidiano, user_id)
    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.tipo_id).all()

    result: Dict[str, Dict[str, float]] = {}
    for r in rows:
        categoria_key = classify_category(r.tipo_id)
        current = result.setdefault(categoria_key, {"total": 0.0, "tickets": 0.0})
        current["total"] += _f(getattr(r, "total", 0), 0.0)
        current["tickets"] += _f(getattr(r, "tickets", 0), 0.0)

    return result


def _aggregate_providers_by_category(
    db: Session,
    start_date: date,
    end_date_exclusive: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> Dict[str, List[ProviderItem]]:
    """
    Agrega GastoCotidiano por proveedor y categoría.

    Nota defensiva:
    - Si proveedor_id puede ser NULL o el proveedor no existe, usamos outerjoin para no romper.
    - Nombre proveedor se normaliza a 'SIN PROVEEDOR' si no hay.
    """
    GastoCotidiano = models.GastoCotidiano
    Proveedor = models.Proveedor

    base_query = (
        db.query(
            GastoCotidiano.tipo_id,
            Proveedor.nombre.label("proveedor"),
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.count(GastoCotidiano.id).label("tickets"),
        )
        .outerjoin(Proveedor, GastoCotidiano.proveedor_id == Proveedor.id)
        .filter(GastoCotidiano.fecha >= start_date)
        .filter(GastoCotidiano.fecha < end_date_exclusive)
    )

    base_query = apply_user_filter(base_query, GastoCotidiano, user_id)
    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.tipo_id, Proveedor.nombre).all()

    result: Dict[str, List[ProviderItem]] = {}
    for r in rows:
        categoria_key = classify_category(r.tipo_id)
        nombre = (getattr(r, "proveedor", None) or "SIN PROVEEDOR").upper()

        provider_item = ProviderItem(
            nombre=nombre,
            importe=_f(getattr(r, "total", 0), 0.0),
            num_compras=int(getattr(r, "tickets", 0) or 0),
            tendencia="FLAT",  # TODO: tendencia real si comparas con mes anterior por proveedor
        )
        result.setdefault(categoria_key, []).append(provider_item)

    for _, lista in result.items():
        lista.sort(key=lambda x: x.importe, reverse=True)

    return result


def _aggregate_last_7_days(
    db: Session,
    base_date: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> List[Last7DayItem]:
    GastoCotidiano = models.GastoCotidiano

    start = base_date - timedelta(days=6)
    end = base_date + timedelta(days=1)

    base_query = (
        db.query(
            GastoCotidiano.fecha.label("fecha"),
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha >= start)
        .filter(GastoCotidiano.fecha < end)
    )

    base_query = apply_user_filter(base_query, GastoCotidiano, user_id)
    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.fecha).all()
    totals_by_date: Dict[date, float] = {r.fecha: _f(r.total, 0.0) for r in rows}

    weekday_labels = ["L", "M", "X", "J", "V", "S", "D"]
    out: List[Last7DayItem] = []

    for i in range(6, -1, -1):
        d = base_date - timedelta(days=i)
        out.append(
            Last7DayItem(
                label=weekday_labels[d.weekday()],
                fecha=d.isoformat(),
                importe=totals_by_date.get(d, 0.0),
            )
        )

    return out


# ---------------------------------------------------------------------------
# NUEVO: series para gráficas
# ---------------------------------------------------------------------------

def _daily_series_for_month(
    db: Session,
    month_start: date,
    month_next: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> List[DailySeriesItem]:
    GastoCotidiano = models.GastoCotidiano

    q = (
        db.query(
            GastoCotidiano.fecha.label("fecha"),
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha >= month_start)
        .filter(GastoCotidiano.fecha < month_next)
    )

    q = apply_user_filter(q, GastoCotidiano, user_id)
    q = apply_pago_filter(q, GastoCotidiano, pago)
    q = apply_categoria_filters(q, GastoCotidiano, categoria, tipo_id)

    rows = q.group_by(GastoCotidiano.fecha).all()
    totals_by_date: Dict[date, float] = {r.fecha: _f(r.total, 0.0) for r in rows}

    out: List[DailySeriesItem] = []
    d = month_start
    while d < month_next:
        out.append(
            DailySeriesItem(
                fecha=d.isoformat(),
                dia=d.day,
                importe=totals_by_date.get(d, 0.0),
            )
        )
        d += timedelta(days=1)

    return out


def _monthly_series_last_n(
    db: Session,
    base_date: date,
    months_back: int,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> List[MonthlySeriesItem]:
    GastoCotidiano = models.GastoCotidiano

    base_month_start, base_month_next = month_range(base_date)
    window_start = add_months(base_month_start, -(months_back - 1))
    window_end = base_month_next

    q = (
        db.query(
            extract("year", GastoCotidiano.fecha).label("y"),
            extract("month", GastoCotidiano.fecha).label("m"),
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.count(GastoCotidiano.id).label("tickets"),
        )
        .filter(GastoCotidiano.fecha >= window_start)
        .filter(GastoCotidiano.fecha < window_end)
    )

    q = apply_user_filter(q, GastoCotidiano, user_id)
    q = apply_pago_filter(q, GastoCotidiano, pago)
    q = apply_categoria_filters(q, GastoCotidiano, categoria, tipo_id)

    rows = q.group_by("y", "m").all()

    by_ym: Dict[Tuple[int, int], Tuple[float, int]] = {}
    for r in rows:
        y = int(r.y)
        m = int(r.m)
        by_ym[(y, m)] = (_f(r.total, 0.0), int(r.tickets or 0))

    out: List[MonthlySeriesItem] = []
    cur = window_start
    for _ in range(months_back):
        y, m = cur.year, cur.month
        total, tickets = by_ym.get((y, m), (0.0, 0))
        out.append(
            MonthlySeriesItem(
                year=y,
                month=m,
                label=f"{y:04d}-{m:02d}",
                importe=total,
                tickets=tickets,
            )
        )
        cur = add_months(cur, 1)

    return out


def _compute_evolution_kpis(serie_mensual: List[MonthlySeriesItem]) -> EvolutionKpis:
    values = [float(x.importe or 0.0) for x in serie_mensual]
    labels = [x.label for x in serie_mensual]

    def mean_last(n: int) -> float:
        if not values:
            return 0.0
        chunk = values[-n:] if len(values) >= n else values
        return (sum(chunk) / float(len(chunk))) if chunk else 0.0

    curr = values[-1] if values else 0.0
    prev = values[-2] if len(values) >= 2 else 0.0

    var_abs = curr - prev
    var_pct = (var_abs / prev) * 100.0 if prev > 0 else (100.0 if curr > 0 else 0.0)

    m3 = mean_last(3)
    m6 = mean_last(6)
    m12 = mean_last(12)

    if m3 > m6 and var_abs >= 0:
        trend = "UP"
        detail = "La media 3m supera la 6m y el mes actual no cae vs el anterior."
    elif m3 < m6 and var_abs <= 0:
        trend = "DOWN"
        detail = "La media 3m está por debajo de la 6m y el mes actual cae vs el anterior."
    else:
        trend = "FLAT"
        detail = "No se aprecia una tendencia consistente combinando medias 3/6m y variación mensual."

    max_idx = max(range(len(values)), key=lambda i: values[i]) if values else None
    min_idx = min(range(len(values)), key=lambda i: values[i]) if values else None

    return EvolutionKpis(
        variacion_mes_pct=float(round(var_pct, 2)),
        variacion_mes_abs=float(round(var_abs, 2)),
        media_3m=float(round(m3, 2)),
        media_6m=float(round(m6, 2)),
        media_12m=float(round(m12, 2)),
        tendencia=trend,  # Literal en schema
        tendencia_detalle=detail,
        max_mes_label=(labels[max_idx] if max_idx is not None else None),
        max_mes_importe=(float(round(values[max_idx], 2)) if max_idx is not None else None),
        min_mes_label=(labels[min_idx] if min_idx is not None else None),
        min_mes_importe=(float(round(values[min_idx], 2)) if min_idx is not None else None),
    )


# ---------------------------------------------------------------------------
# Endpoint principal
# ---------------------------------------------------------------------------

@router.get("/day-to-day", response_model=DayToDayAnalysisResponse)
def get_day_to_day_analysis(
    fecha: str | None = Query(default=None, description="Fecha base YYYY-MM-DD. Por defecto, hoy."),
    pago: Literal["YO", "OTRO", "TODOS"] = Query("YO", description="YO=pagado True, OTRO=pagado False, TODOS=sin filtro"),
    categoria: Optional[str] = Query(default=None, description="Categoría de análisis (SUPERMERCADOS, VEHICULOS, ...). Opcional."),
    tipo_id: Optional[str] = Query(default=None, description="Tipo concreto de gasto cotidiano (tipo_id). Opcional; si se informa, tiene prioridad sobre categoria."),
    months_back: int = Query(default=12, ge=2, le=36, description="Ventana de meses para serie mensual (incluye el mes actual)."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve el análisis 'día a día' de los gastos cotidianos.

    NUEVO (sin romper):
    - serie_diaria_mes: puntos diarios del mes (relleno con 0)
    - serie_mensual: evolución últimos N meses (relleno con 0)
    - kpis_evolucion: KPIs para interpretar la evolución
    """
    base_date = parse_base_date(fecha)

    # ✅ CRÍTICO: user_id como int (evita INTEGER = VARCHAR)
    user_id = _safe_user_id_int(current_user)

    month_start, month_next = month_range(base_date)
    prev_month_start, prev_month_next = prev_month_range(base_date)
    week_start, week_end = week_range(base_date)

    GastoCotidiano = models.GastoCotidiano

    # -----------------------------------------------------------------------
    # Hoy
    # -----------------------------------------------------------------------
    today_query = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.count(GastoCotidiano.id).label("movs"),
        )
        .filter(GastoCotidiano.fecha == base_date)
    )
    today_query = apply_user_filter(today_query, GastoCotidiano, user_id)
    today_query = apply_pago_filter(today_query, GastoCotidiano, pago)
    today_query = apply_categoria_filters(today_query, GastoCotidiano, categoria, tipo_id)
    today_row = today_query.one()

    total_hoy = _f(today_row.total, 0.0)
    movimientos_hoy = int(today_row.movs or 0)
    ticket_medio_hoy = total_hoy / movimientos_hoy if movimientos_hoy > 0 else 0.0

    # Ayer
    ayer = base_date - timedelta(days=1)
    yesterday_query = (
        db.query(func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"))
        .filter(GastoCotidiano.fecha == ayer)
    )
    yesterday_query = apply_user_filter(yesterday_query, GastoCotidiano, user_id)
    yesterday_query = apply_pago_filter(yesterday_query, GastoCotidiano, pago)
    yesterday_query = apply_categoria_filters(yesterday_query, GastoCotidiano, categoria, tipo_id)
    yesterday_row = yesterday_query.one()
    total_ayer = _f(yesterday_row.total, 0.0)

    diff_vs_ayer_val = total_hoy - total_ayer
    signo = "+" if diff_vs_ayer_val >= 0 else "-"
    diff_vs_ayer_label = f"{signo} {abs(diff_vs_ayer_val):.2f} € vs ayer"

    if total_hoy == 0:
        tendencia_texto = "Hoy no has tenido gastos cotidianos."
    elif diff_vs_ayer_val > 0:
        tendencia_texto = "Has gastado más que ayer, revisa si todo era necesario."
    else:
        tendencia_texto = "Has gastado menos que ayer, ¡buen trabajo!"

    today_summary = TodaySummary(
        fecha_label=format_spanish_date(base_date),
        total_hoy=total_hoy,
        num_movimientos=movimientos_hoy,
        ticket_medio=ticket_medio_hoy,
        diff_vs_ayer=diff_vs_ayer_label,
        tendencia=tendencia_texto,
    )

    # -----------------------------------------------------------------------
    # Semana actual
    # -----------------------------------------------------------------------
    week_query = (
        db.query(func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"))
        .filter(GastoCotidiano.fecha >= week_start)
        .filter(GastoCotidiano.fecha <= week_end)
    )
    week_query = apply_user_filter(week_query, GastoCotidiano, user_id)
    week_query = apply_pago_filter(week_query, GastoCotidiano, pago)
    week_query = apply_categoria_filters(week_query, GastoCotidiano, categoria, tipo_id)
    week_total_row = week_query.one()
    total_semana = _f(week_total_row.total, 0.0)

    dias_consumidos = (base_date - week_start).days + 1
    dias_consumidos = max(1, min(dias_consumidos, 7))

    gasto_medio_diario_semana = total_semana / dias_consumidos if dias_consumidos > 0 else 0.0
    proyeccion_fin_semana = gasto_medio_diario_semana * 7

    # -----------------------------------------------------------------------
    # Mes en curso
    # -----------------------------------------------------------------------
    month_query = (
        db.query(func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"))
        .filter(GastoCotidiano.fecha >= month_start)
        .filter(GastoCotidiano.fecha < month_next)
    )
    month_query = apply_user_filter(month_query, GastoCotidiano, user_id)
    month_query = apply_pago_filter(month_query, GastoCotidiano, pago)
    month_query = apply_categoria_filters(month_query, GastoCotidiano, categoria, tipo_id)
    month_total_row = month_query.one()
    gastado_mes = _f(month_total_row.total, 0.0)

    prev_month_query = (
        db.query(func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"))
        .filter(GastoCotidiano.fecha >= prev_month_start)
        .filter(GastoCotidiano.fecha < prev_month_next)
    )
    prev_month_query = apply_user_filter(prev_month_query, GastoCotidiano, user_id)
    prev_month_query = apply_pago_filter(prev_month_query, GastoCotidiano, pago)
    prev_month_query = apply_categoria_filters(prev_month_query, GastoCotidiano, categoria, tipo_id)
    prev_month_total_row = prev_month_query.one()
    gastado_mes_anterior = _f(prev_month_total_row.total, 0.0)

    if gastado_mes_anterior > 0:
        presupuesto_mes = gastado_mes_anterior * 1.1
    elif gastado_mes > 0:
        presupuesto_mes = gastado_mes * 1.3
    else:
        presupuesto_mes = 0.0

    limite_semana = presupuesto_mes / 4 if presupuesto_mes > 0 else (gastado_mes or 0.0)

    week_summary = WeekSummary(
        total_semana=total_semana,
        limite_semana=limite_semana,
        proyeccion_fin_semana=proyeccion_fin_semana,
        dias_restantes=max(0, (week_end - base_date).days),
    )

    month_summary = MonthSummary(
        presupuesto_mes=presupuesto_mes,
        gastado_mes=gastado_mes,
    )

    # -----------------------------------------------------------------------
    # Distribución por categoría + KPIs vs mes anterior
    # -----------------------------------------------------------------------
    cat_curr = _aggregate_by_category(db, month_start, month_next, pago, categoria, tipo_id, user_id)
    cat_prev = _aggregate_by_category(db, prev_month_start, prev_month_next, pago, categoria, tipo_id, user_id)

    categorias_mes: List[CategoryMonth] = []
    category_kpis: Dict[str, CategoryKpi] = {}

    total_mes_para_pct = gastado_mes if gastado_mes > 0 else 1.0

    for key, data_curr in cat_curr.items():
        total_cat = float(data_curr["total"])
        tickets_cat = int(data_curr["tickets"])

        pct_sobre_total = (total_cat / total_mes_para_pct) * 100.0

        prev_data = cat_prev.get(key, {"total": 0.0, "tickets": 0.0})
        total_prev = float(prev_data["total"])
        tickets_prev = float(prev_data["tickets"])  # puede ser float en dict agregación

        var_importe_pct = ((total_cat - total_prev) / total_prev) * 100.0 if total_prev > 0 else (100.0 if total_cat > 0 else 0.0)
        var_tickets_pct = ((tickets_cat - tickets_prev) / tickets_prev) * 100.0 if tickets_prev > 0 else (100.0 if tickets_cat > 0 else 0.0)

        categorias_mes.append(
            CategoryMonth(
                key=key,
                label=key,
                importe=total_cat,
                porcentaje=pct_sobre_total,
            )
        )

        ticket_medio_cat = total_cat / tickets_cat if tickets_cat > 0 else 0.0

        category_kpis[key] = CategoryKpi(
            tickets=tickets_cat,
            ticket_medio=ticket_medio_cat,
            variacion_importe_pct=var_importe_pct,
            variacion_tickets_pct=var_tickets_pct,
            peso_sobre_total_gasto=pct_sobre_total,
        )

    categorias_mes.sort(key=lambda c: c.importe, reverse=True)

    # -----------------------------------------------------------------------
    # Proveedores por categoría
    # -----------------------------------------------------------------------
    proveedores_por_categoria = _aggregate_providers_by_category(
        db, month_start, month_next, pago, categoria, tipo_id, user_id
    )

    # -----------------------------------------------------------------------
    # Últimos 7 días
    # -----------------------------------------------------------------------
    ultimos_7_dias = _aggregate_last_7_days(db, base_date, pago, categoria, tipo_id, user_id)

    # -----------------------------------------------------------------------
    # NUEVO: series para gráficas + KPIs evolución
    # -----------------------------------------------------------------------
    serie_diaria_mes = _daily_series_for_month(db, month_start, month_next, pago, categoria, tipo_id, user_id)
    serie_mensual = _monthly_series_last_n(db, base_date, months_back, pago, categoria, tipo_id, user_id)
    kpis_evolucion = _compute_evolution_kpis(serie_mensual)

    # -----------------------------------------------------------------------
    # Alertas
    # -----------------------------------------------------------------------
    alertas: List[str] = []

    pct_mes_usado = (gastado_mes / presupuesto_mes) * 100.0 if presupuesto_mes > 0 else 0.0
    if presupuesto_mes > 0:
        alertas.append(f"Has consumido el {pct_mes_usado:.1f}% del presupuesto mensual estimado de gastos cotidianos.")

    for cat in categorias_mes:
        if cat.porcentaje >= 40:
            alertas.append(f"{cat.label} concentra el {cat.porcentaje:.1f}% de tu gasto mensual.")

    if kpis_evolucion.variacion_mes_abs > 0:
        alertas.append(f"Este mes vas +{kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.")
    elif kpis_evolucion.variacion_mes_abs < 0:
        alertas.append(f"Este mes vas {kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.")

    if not alertas:
        alertas.append("No hay alertas destacadas este mes en tus gastos cotidianos.")

    # -----------------------------------------------------------------------
    # Respuesta
    # -----------------------------------------------------------------------
    return DayToDayAnalysisResponse(
        today=today_summary,
        week=week_summary,
        month=month_summary,
        categorias_mes=categorias_mes,
        category_kpis=category_kpis,
        proveedores_por_categoria=proveedores_por_categoria,
        ultimos_7_dias=ultimos_7_dias,
        alertas=alertas,

        # nuevos campos
        serie_diaria_mes=serie_diaria_mes,
        serie_mensual=serie_mensual,
        kpis_evolucion=kpis_evolucion,
    )
