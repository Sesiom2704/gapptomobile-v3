# backend/app/api/v1/day_to_day_analysis_router.py

from __future__ import annotations

"""
Day-to-day analysis (GappoMobile V3)

Qué devuelve:
- KPIs de Hoy / Semana / Mes (gastos cotidianos)
- Distribución por categoría, proveedores, tendencias 7 días
- Series diaria (mes) y mensual (últimos N meses)
- Alertas legacy + insights estructurados

CAMBIO (tu petición):
- Presupuesto mensual = "presupuesto marcado" (tabla `gastos`, columna `importe_cuota`,
  filtrado por `segmento_id = 'COT-12345'` y `user_id`).
- Consumo mensual para el indicador (month.gastado_mes) usa el split del mes:
    * YO    -> pagado_mes   (pagado=True)   ✅ en tu ejemplo: 901.51
    * OTRO  -> invitado_mes (pagado=False)
    * TODOS -> total_mes    (sin filtro pagado)

Importante:
- No se pierde funcionalidad: el filtro `pago` sigue aplicando a Hoy/Semana/Categorías/Proveedores/Series/Tendencias.
- El split mensual (total/pagado/invitado) sigue siendo independiente del `pago` (como ya tenías).

✅ AÑADIDO AHORA:
- En proveedores_por_categoria, cada ProviderItem incluye `tipo_id` (opcional) para que el frontend
  pueda desglosar el ranking por componentes (p.ej. OCIO → Transporte/Hospedaje/Actividades).
"""

from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy import extract, func
from sqlalchemy.orm import Session
from typing_extensions import Literal

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db
from backend.app.schemas.day_to_day_analysis import (
    CategoryKpi,
    CategoryMonth,
    DailySeriesItem,
    DayToDayAnalysisResponse,
    EvolutionKpis,
    InsightItem,
    Last7DayItem,
    MonthSummary,
    MonthlySeriesItem,
    ProviderItem,
    TodaySummary,
    WeekSummary,
)

router = APIRouter(
    prefix="/analytics",  # se completa con /api/v1 en main.py
    tags=["analytics"],
)

# =============================================================================
# Constantes de negocio
# =============================================================================

# Segmento "Cotidianos" en la tabla `gastos` (presupuesto marcado)
COTIDIANOS_SEGMENTO_ID = "COT-12345"

# Para el insight de contribución en supermercados (depende del tipo_id)
SUPERMERCADOS_TIPO_ID = "COM-TIPOGASTO-311A33BD"

# =============================================================================
# Helpers: tipado defensivo
# =============================================================================


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
    """Convierte valores a float de forma defensiva (None/Decimal/str/etc.)."""
    try:
        v = float(x)  # type: ignore[arg-type]
        return v if v == v else default  # NaN -> default
    except Exception:
        return default


# =============================================================================
# Mapeo de tipos de gasto cotidiano a categorías de análisis
# =============================================================================

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


# =============================================================================
# Utilidades de fechas
# =============================================================================

def parse_base_date(fecha_str: Optional[str]) -> date:
    if not fecha_str:
        return date.today()
    try:
        return datetime.strptime(fecha_str, "%Y-%m-%d").date()
    except ValueError:
        return date.today()


def month_range(base: date) -> tuple[date, date]:
    """[start, next_month)"""
    start = base.replace(day=1)
    if base.month == 12:
        next_month = date(base.year + 1, 1, 1)
    else:
        next_month = date(base.year, base.month + 1, 1)
    return start, next_month


def prev_month_range(base: date) -> tuple[date, date]:
    """Mes anterior: [start_prev, start_curr)"""
    if base.month == 1:
        start_prev = date(base.year - 1, 12, 1)
    else:
        start_prev = date(base.year, base.month - 1, 1)
    start_curr, _ = month_range(base)
    return start_prev, start_curr


def week_range(base: date) -> tuple[date, date]:
    """Semana ISO: lunes..domingo (inclusive)."""
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
    """Devuelve month_start tras desplazar N meses."""
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, 1)


# =============================================================================
# Helpers de filtros
# =============================================================================

def apply_pago_filter(query, GastoCotidiano, pago_mode: str):
    """
    Filtro existente (se mantiene):
    - YO     => pagado=True
    - OTRO   => pagado=False
    - TODOS  => sin filtro
    """
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
    """
    Filtro por:
    - tipo_id (prioritario)
    - categoria (mapea a lista de tipo_ids)
    """
    if tipo_id:
        return query.filter(GastoCotidiano.tipo_id == tipo_id)

    if categoria:
        categoria_upper = categoria.upper()
        tipo_ids = [tid for tid, cat in TIPO_TO_CATEGORY.items() if cat.upper() == categoria_upper]
        if tipo_ids:
            return query.filter(GastoCotidiano.tipo_id.in_(tipo_ids))

    return query


def apply_user_filter(query, GastoCotidiano, user_id: int):
    """Multi-tenant: restringe por user_id (siempre int)."""
    return query.filter(GastoCotidiano.user_id == user_id)


# =============================================================================
# Presupuesto marcado (tabla `gastos`)
# =============================================================================

def _presupuesto_marcado_cotidianos(
    db: Session,
    user_id: int,
    categoria: Optional[str],
    tipo_id: Optional[str],
) -> float:
    """
    Presupuesto marcado de cotidianos (tabla `gastos`, importe_cuota),
    aplicando el mismo contexto del endpoint:
      - si tipo_id -> presupuesto de ese tipo
      - si categoria -> suma de tipos de esa categoria (TIPO_TO_CATEGORY)
      - si ninguno -> total
    """
    Gasto = models.Gasto

    q = (
        db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0).label("budget"))
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.segmento_id == COTIDIANOS_SEGMENTO_ID)
    )

    # Prioridad: tipo_id
    if tipo_id:
        q = q.filter(Gasto.tipo_id == tipo_id)
    elif categoria:
        cat_u = categoria.upper()
        tipo_ids = [tid for tid, cat in TIPO_TO_CATEGORY.items() if cat.upper() == cat_u]
        if tipo_ids:
            q = q.filter(Gasto.tipo_id.in_(tipo_ids))

    row = q.one()
    return _f(getattr(row, "budget", 0.0), 0.0)


# =============================================================================
# Agregación mensual split (total/pagado/invitado) SIN depender del parámetro pago
# =============================================================================

def _month_totals_split(
    db: Session,
    month_start: date,
    month_next: date,
    categoria: Optional[str],
    tipo_id: Optional[str],
    user_id: int,
) -> tuple[float, float, float]:
    """
    Devuelve (total_mes, pagado_mes, invitado_mes) SIN depender de 'pago'.

    - total_mes: suma importe sin filtrar por pagado
    - pagado_mes: suma importe pagado=True
    - invitado_mes: suma importe pagado=False
    """
    GastoCotidiano = models.GastoCotidiano

    q = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.coalesce(func.sum(GastoCotidiano.importe).filter(GastoCotidiano.pagado.is_(True)), 0).label("paid"),
            func.coalesce(func.sum(GastoCotidiano.importe).filter(GastoCotidiano.pagado.is_(False)), 0).label("guest"),
        )
        .filter(GastoCotidiano.fecha >= month_start)
        .filter(GastoCotidiano.fecha < month_next)
    )

    q = apply_user_filter(q, GastoCotidiano, user_id)
    q = apply_categoria_filters(q, GastoCotidiano, categoria, tipo_id)

    row = q.one()
    total_mes = _f(getattr(row, "total", 0.0), 0.0)
    pagado_mes = _f(getattr(row, "paid", 0.0), 0.0)
    invitado_mes = _f(getattr(row, "guest", 0.0), 0.0)

    return total_mes, pagado_mes, invitado_mes


def _supermercados_split_global(
    db: Session,
    month_start: date,
    month_next: date,
    user_id: int,
) -> tuple[float, float]:
    """
    Split de supermercados para insight:
      supermercados_pagado / supermercados_total

    Se calcula a nivel global del mes (no depende de categoria/tipo_id),
    porque la regla es específica del contenedor supermercados.
    """
    GastoCotidiano = models.GastoCotidiano

    q = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
            func.coalesce(func.sum(GastoCotidiano.importe).filter(GastoCotidiano.pagado.is_(True)), 0).label("paid"),
        )
        .filter(GastoCotidiano.fecha >= month_start)
        .filter(GastoCotidiano.fecha < month_next)
        .filter(GastoCotidiano.tipo_id == SUPERMERCADOS_TIPO_ID)
    )

    q = apply_user_filter(q, GastoCotidiano, user_id)

    row = q.one()
    total = _f(getattr(row, "total", 0.0), 0.0)
    paid = _f(getattr(row, "paid", 0.0), 0.0)
    return total, paid


# =============================================================================
# Agregaciones existentes (categorías, proveedores, 7 días)
# =============================================================================

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

    Defensivo:
    - proveedor puede ser NULL o no existir -> outerjoin
    - nombre normalizado a 'SIN PROVEEDOR'

    ✅ Importante:
    - Se incluye `tipo_id` en cada ProviderItem para permitir ranking por componentes en frontend.
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
            tipo_id=(getattr(r, "tipo_id", None) or None),  # ✅ NUEVO (para componentes)
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


# =============================================================================
# Series para gráficas
# =============================================================================

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
        tendencia=trend,
        tendencia_detalle=detail,
        max_mes_label=(labels[max_idx] if max_idx is not None else None),
        max_mes_importe=(float(round(values[max_idx], 2)) if max_idx is not None else None),
        min_mes_label=(labels[min_idx] if min_idx is not None else None),
        min_mes_importe=(float(round(values[min_idx], 2)) if min_idx is not None else None),
    )


# =============================================================================
# Insights estructurados
# =============================================================================

def _build_insights(
    *,
    presupuesto_mes: float,
    gastado_mes: float,
    categorias_mes: List[CategoryMonth],
    kpis_evolucion: EvolutionKpis,
    week_total: float,
    week_limit: float,
    week_projection: float,
    # splits reales
    month_total: float,
    month_paid: float,
    month_guest: float,
    supermercados_total: float,
    supermercados_paid: float,
) -> List[InsightItem]:
    """
    Genera insights estructurados.

    Mantiene lógica existente + añade reglas:
      1) Invitaciones >= 30% del total mensual -> "gorras"
      2) Supermercados: pagado/total < 75% -> "no contribuyes"
    """
    insights: List[InsightItem] = []

    # Presupuesto mensual (marcado)
    pct_mes_usado = (gastado_mes / presupuesto_mes) * 100.0 if presupuesto_mes > 0 else 0.0
    if presupuesto_mes > 0:
        severity: Literal["info", "warning", "critical"] = "info"
        if pct_mes_usado >= 95:
            severity = "critical"
        elif pct_mes_usado >= 75:
            severity = "warning"

        insights.append(
            InsightItem(
                id="BUDGET_MONTH_USAGE",
                title="Presupuesto mensual",
                message=f"Has consumido el {pct_mes_usado:.1f}% del presupuesto mensual marcado de gastos cotidianos.",
                severity=severity,
                meta={
                    "pct": round(pct_mes_usado, 1),
                    "budget": round(presupuesto_mes, 2),
                    "spent": round(gastado_mes, 2),
                },
            )
        )

    # Concentración por categoría
    for cat in categorias_mes:
        if cat.porcentaje >= 40:
            severity: Literal["info", "warning", "critical"] = "info"
            if cat.porcentaje >= 60:
                severity = "critical"
            elif cat.porcentaje >= 50:
                severity = "warning"

            insights.append(
                InsightItem(
                    id=f"CATEGORY_CONCENTRATION_{cat.key}",
                    title="Concentración por categoría",
                    message=f"{cat.label} concentra el {cat.porcentaje:.1f}% de tu gasto mensual.",
                    severity=severity,
                    meta={
                        "category_key": cat.key,
                        "pct": round(cat.porcentaje, 1),
                        "amount": round(cat.importe, 2),
                    },
                )
            )

    # Evolución vs mes anterior (basado en serie mensual)
    if kpis_evolucion.variacion_mes_abs > 0:
        insights.append(
            InsightItem(
                id="MONTH_VS_PREV_UP",
                title="Evolución mensual",
                message=f"Este mes vas +{kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.",
                severity="warning",
                meta={
                    "delta_abs": round(kpis_evolucion.variacion_mes_abs, 2),
                    "delta_pct": round(kpis_evolucion.variacion_mes_pct, 2),
                },
            )
        )
    elif kpis_evolucion.variacion_mes_abs < 0:
        insights.append(
            InsightItem(
                id="MONTH_VS_PREV_DOWN",
                title="Evolución mensual",
                message=f"Este mes vas {kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.",
                severity="info",
                meta={
                    "delta_abs": round(kpis_evolucion.variacion_mes_abs, 2),
                    "delta_pct": round(kpis_evolucion.variacion_mes_pct, 2),
                },
            )
        )

    # Semana: proyección vs límite
    if week_limit > 0:
        if week_projection > week_limit * 1.15:
            insights.append(
                InsightItem(
                    id="WEEK_PROJECTION_OVER_LIMIT_STRONG",
                    title="Ritmo semanal",
                    message="La proyección de fin de semana supera claramente el límite semanal.",
                    severity="critical",
                    meta={
                        "week_total": round(week_total, 2),
                        "week_limit": round(week_limit, 2),
                        "week_projection": round(week_projection, 2),
                    },
                )
            )
        elif week_projection > week_limit:
            insights.append(
                InsightItem(
                    id="WEEK_PROJECTION_OVER_LIMIT",
                    title="Ritmo semanal",
                    message="La proyección de fin de semana supera el límite semanal.",
                    severity="warning",
                    meta={
                        "week_total": round(week_total, 2),
                        "week_limit": round(week_limit, 2),
                        "week_projection": round(week_projection, 2),
                    },
                )
            )

    # Regla 1: invitaciones >= 30% del total mensual (split real)
    if month_total > 0:
        guest_pct = (month_guest / month_total) * 100.0
        if guest_pct >= 30.0:
            insights.append(
                InsightItem(
                    id="GUEST_30_PLUS",
                    title="Invitaciones",
                    message="Las invitaciones representan una parte alta del gasto total. Te estás convirtiendo en un gorras.",
                    severity="warning",
                    meta={
                        "guest_pct": round(guest_pct, 1),
                        "guest": round(month_guest, 2),
                        "total": round(month_total, 2),
                        "paid": round(month_paid, 2),
                    },
                )
            )

    # Regla 2: supermercados pagado/total < 75%
    if supermercados_total > 0:
        ratio = supermercados_paid / supermercados_total
        if ratio < 0.75:
            insights.append(
                InsightItem(
                    id="SUPERMARKET_LOW_CONTRIBUTION",
                    title="Supermercados",
                    message="No estás contribuyendo lo suficiente.",
                    severity="warning",
                    meta={
                        "paid_pct": round(ratio * 100.0, 1),
                        "paid": round(supermercados_paid, 2),
                        "total": round(supermercados_total, 2),
                        "threshold_pct": 75.0,
                    },
                )
            )

    if not insights:
        insights.append(
            InsightItem(
                id="NO_INSIGHTS",
                title="Sin alertas destacadas",
                message="No se han detectado patrones destacados este mes en tus gastos cotidianos.",
                severity="info",
            )
        )

    return insights


# =============================================================================
# Endpoint principal
# =============================================================================

@router.get("/day-to-day", response_model=DayToDayAnalysisResponse)
def get_day_to_day_analysis(
    fecha: str | None = Query(default=None, description="Fecha base YYYY-MM-DD. Por defecto, hoy."),
    pago: Literal["YO", "OTRO", "TODOS"] = Query(
        "YO",
        description="YO=pagado True, OTRO=pagado False, TODOS=sin filtro"
    ),
    categoria: Optional[str] = Query(
        default=None,
        description="Categoría de análisis (SUPERMERCADOS, VEHICULOS, ...). Opcional."
    ),
    tipo_id: Optional[str] = Query(
        default=None,
        description="Tipo concreto de gasto cotidiano (tipo_id). Opcional; si se informa, tiene prioridad sobre categoria."
    ),
    months_back: int = Query(
        default=12,
        ge=2,
        le=36,
        description="Ventana de meses para serie mensual (incluye el mes actual).",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve el análisis 'día a día' de los gastos cotidianos.

    Cambios clave (presupuesto marcado):
    - month.presupuesto_mes se obtiene de `gastos.importe_cuota` para segmento COT-12345.
    - month.gastado_mes se decide desde el split real del mes:
        YO    -> pagado_mes (pagado=True)
        OTRO  -> invitado_mes
        TODOS -> total_mes
    """
    base_date = parse_base_date(fecha)

    # CRÍTICO: user_id como int (evita INTEGER = VARCHAR)
    user_id = _safe_user_id_int(current_user)

    month_start, month_next = month_range(base_date)
    prev_month_start, prev_month_next = prev_month_range(base_date)
    week_start, week_end = week_range(base_date)

    GastoCotidiano = models.GastoCotidiano

    # -------------------------------------------------------------------------
    # HOY
    # -------------------------------------------------------------------------
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

    # AYER
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

    # -------------------------------------------------------------------------
    # SEMANA ACTUAL (respeta filtro 'pago')
    # -------------------------------------------------------------------------
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

    # -------------------------------------------------------------------------
    # MES EN CURSO
    # 1) Split REAL del mes (independiente de 'pago')
    # 2) Gastado_mes (semántica) se decide con 'pago' usando el split
    # 3) Presupuesto_mes = marcado (tabla gastos)
    # -------------------------------------------------------------------------
    total_mes_real, pagado_mes_real, invitado_mes_real = _month_totals_split(
        db=db,
        month_start=month_start,
        month_next=month_next,
        categoria=categoria,
        tipo_id=tipo_id,
        user_id=user_id,
    )

    if pago == "YO":
        gastado_mes = pagado_mes_real
    elif pago == "OTRO":
        gastado_mes = invitado_mes_real
    else:
        gastado_mes = total_mes_real

    presupuesto_mes = _presupuesto_marcado_cotidianos(db, user_id, categoria, tipo_id)

    # Límite semanal: derivado del presupuesto marcado (si existe)
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
        # split mensual real
        total_mes=total_mes_real,
        pagado_mes=pagado_mes_real,
        invitado_mes=invitado_mes_real,
    )

    # -------------------------------------------------------------------------
    # DISTRIBUCIÓN POR CATEGORÍA + KPIs vs mes anterior (respeta filtro 'pago')
    # -------------------------------------------------------------------------
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
        tickets_prev = float(prev_data["tickets"])

        var_importe_pct = (
            ((total_cat - total_prev) / total_prev) * 100.0
            if total_prev > 0
            else (100.0 if total_cat > 0 else 0.0)
        )
        var_tickets_pct = (
            ((tickets_cat - tickets_prev) / tickets_prev) * 100.0
            if tickets_prev > 0
            else (100.0 if tickets_cat > 0 else 0.0)
        )

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

    # -------------------------------------------------------------------------
    # PROVEEDORES POR CATEGORÍA (respeta filtro 'pago')
    # -------------------------------------------------------------------------
    proveedores_por_categoria = _aggregate_providers_by_category(
        db, month_start, month_next, pago, categoria, tipo_id, user_id
    )

    # -------------------------------------------------------------------------
    # ÚLTIMOS 7 DÍAS (respeta filtro 'pago')
    # -------------------------------------------------------------------------
    ultimos_7_dias = _aggregate_last_7_days(db, base_date, pago, categoria, tipo_id, user_id)

    # -------------------------------------------------------------------------
    # SERIES + KPIs EVOLUCIÓN (respeta filtro 'pago')
    # -------------------------------------------------------------------------
    serie_diaria_mes = _daily_series_for_month(db, month_start, month_next, pago, categoria, tipo_id, user_id)
    serie_mensual = _monthly_series_last_n(db, base_date, months_back, pago, categoria, tipo_id, user_id)
    kpis_evolucion = _compute_evolution_kpis(serie_mensual)

    # -------------------------------------------------------------------------
    # ALERTAS (compatibilidad) + INSIGHTS estructurados
    # -------------------------------------------------------------------------
    alertas: List[str] = []

    pct_mes_usado = (gastado_mes / presupuesto_mes) * 100.0 if presupuesto_mes > 0 else 0.0
    if presupuesto_mes > 0:
        alertas.append(
            f"Has consumido el {pct_mes_usado:.1f}% del presupuesto mensual marcado de gastos cotidianos."
        )

    for cat in categorias_mes:
        if cat.porcentaje >= 40:
            alertas.append(f"{cat.label} concentra el {cat.porcentaje:.1f}% de tu gasto mensual.")

    if kpis_evolucion.variacion_mes_abs > 0:
        alertas.append(f"Este mes vas +{kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.")
    elif kpis_evolucion.variacion_mes_abs < 0:
        alertas.append(f"Este mes vas {kpis_evolucion.variacion_mes_abs:.2f} € vs el mes anterior.")

    if not alertas:
        alertas.append("No hay alertas destacadas este mes en tus gastos cotidianos.")

    supermercados_total, supermercados_paid = _supermercados_split_global(
        db=db,
        month_start=month_start,
        month_next=month_next,
        user_id=user_id,
    )

    insights = _build_insights(
        presupuesto_mes=presupuesto_mes,
        gastado_mes=gastado_mes,
        categorias_mes=categorias_mes,
        kpis_evolucion=kpis_evolucion,
        week_total=total_semana,
        week_limit=limite_semana,
        week_projection=proyeccion_fin_semana,
        month_total=total_mes_real,
        month_paid=pagado_mes_real,
        month_guest=invitado_mes_real,
        supermercados_total=supermercados_total,
        supermercados_paid=supermercados_paid,
    )

    return DayToDayAnalysisResponse(
        today=today_summary,
        week=week_summary,
        month=month_summary,
        categorias_mes=categorias_mes,
        category_kpis=category_kpis,
        proveedores_por_categoria=proveedores_por_categoria,
        ultimos_7_dias=ultimos_7_dias,
        alertas=alertas,
        insights=insights,
        serie_diaria_mes=serie_diaria_mes,
        serie_mensual=serie_mensual,
        kpis_evolucion=kpis_evolucion,
    )
