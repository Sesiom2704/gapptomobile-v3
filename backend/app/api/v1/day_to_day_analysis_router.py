# backend/app/api/v1/day_to_day_analysis_router.py

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing_extensions import Literal

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.day_to_day_analysis import (
    DayToDayAnalysisResponse,
    TodaySummary,
    WeekSummary,
    MonthSummary,
    CategoryMonth,
    CategoryKpi,
    ProviderItem,
    Last7DayItem,
)

router = APIRouter(
    prefix="/analytics",   # se completa con /api/v1 en main.py
    tags=["analytics"],
)

# ---------------------------------------------------------------------------
# Mapeo de tipos de gasto cotidiano a categorías de análisis
# ---------------------------------------------------------------------------

TIPO_TO_CATEGORY: dict[str, str] = {
    # 1. SUPERMERCADOS
    # Contenedor (gastos): COM-TIPOGASTO-311A33BD
    "COM-TIPOGASTO-311A33BD": "SUPERMERCADOS",

    # 2. SUMINISTROS
    # Contenedor (gastos): ELE-TIPOGASTO-47CC77E5
    "ELE-TIPOGASTO-47CC77E5": "SUMINISTROS",

    # 3. VEHICULOS
    # Cotidianos:
    "TIP-GASOLINA-SW1ZQO": "VEHICULOS",          # GASOLINA
    "MAV-TIPOGASTO-BVC356": "VEHICULOS",         # MANTENIMIENTO VEHÍCULO
    "PEA-TIPOGASTO-7HDY89": "VEHICULOS",         # PEAJES

    # 4. ROPA
    "ROP-TIPOGASTO-S227BB": "ROPA",

    # 5. RESTAURACION
    "RES-TIPOGASTO-26ROES": "RESTURACION",

    # 6. OCIO (viajes, actividades, etc.)
    "TRA-TIPOGASTO-RB133Z": "OCIO",              # TRANSPORTE
    "HOS-TIPOGASTO-357FDG": "OCIO",              # HOSPEDAJE
    "ACT-TIPOGASTO-2X9H1Q": "OCIO",              # ACTIVIDADES
}


def classify_category(tipo_id: Optional[str]) -> str:
    """
    Dado un tipo_id de GastoCotidiano, devuelve la categoría de análisis.

    Si no está en el diccionario, devolverá 'OTROS'.
    """
    if not tipo_id:
        return "OTROS"
    return TIPO_TO_CATEGORY.get(tipo_id, "OTROS")


# ---------------------------------------------------------------------------
# Utilidades de fechas
# ---------------------------------------------------------------------------

def parse_base_date(fecha_str: Optional[str]) -> date:
    """
    Si el parámetro 'fecha' viene informado (YYYY-MM-DD),
    lo usamos como fecha base. Si no, usamos hoy.
    """
    if not fecha_str:
        return date.today()
    try:
        return datetime.strptime(fecha_str, "%Y-%m-%d").date()
    except ValueError:
        # Si el formato es incorrecto, hacemos fallback a hoy
        return date.today()


def month_range(base: date) -> tuple[date, date]:
    """
    Devuelve (inicio_mes, inicio_mes_siguiente) para usar en filtros >= y <.
    """
    start = base.replace(day=1)
    if base.month == 12:
        next_month = date(base.year + 1, 1, 1)
    else:
        next_month = date(base.year, base.month + 1, 1)
    return start, next_month


def prev_month_range(base: date) -> tuple[date, date]:
    """
    Devuelve (inicio_mes_anterior, inicio_mes) para el mes anterior.
    """
    if base.month == 1:
        start_prev = date(base.year - 1, 12, 1)
    else:
        start_prev = date(base.year, base.month - 1, 1)
    start_curr, _ = month_range(base)
    return start_prev, start_curr


def week_range(base: date) -> tuple[date, date]:
    """
    Devuelve (inicio_semana, fin_semana_inclusive) asumiendo semana que empieza en lunes.
    """
    # weekday(): lunes=0 ... domingo=6
    start = base - timedelta(days=base.weekday())
    end = start + timedelta(days=6)
    return start, end


def format_spanish_date(d: date) -> str:
    """
    Devuelve una fecha tipo 'Viernes, 6 de diciembre'.
    """
    dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    meses = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ]
    dia_semana = dias[d.weekday()]
    mes = meses[d.month - 1]
    return f"{dia_semana}, {d.day} de {mes}"


# ---------------------------------------------------------------------------
# Helpers de filtros
# ---------------------------------------------------------------------------

def apply_pago_filter(query, GastoCotidiano, pago_mode: str):
    """
    Aplica filtro de quién paga el gasto cotidiano:

    - YO    -> pagado = True
    - OTRO  -> pagado = False
    - TODOS -> sin filtro
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
    Aplica filtro por categoría o por tipo:

    - Si viene tipo_id, filtramos por ese tipo concreto.
    - Si viene categoria, filtramos por todos los tipo_id que pertenecen a esa categoría.
    - Si no viene nada, no filtramos por categoría.
    """
    if tipo_id:
        return query.filter(GastoCotidiano.tipo_id == tipo_id)

    if categoria:
        # Normalizamos categoría a mayúsculas para comparar
        categoria_upper = categoria.upper()
        tipo_ids = [
            tid for tid, cat in TIPO_TO_CATEGORY.items()
            if cat.upper() == categoria_upper
        ]
        if tipo_ids:
            return query.filter(GastoCotidiano.tipo_id.in_(tipo_ids))

    return query


# ---------------------------------------------------------------------------
# Helpers de agregación
# ---------------------------------------------------------------------------

def _aggregate_by_category(
    db: Session,
    start_date: date,
    end_date_exclusive: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
) -> Dict[str, Dict[str, float]]:
    """
    Agrega GastoCotidiano por categoría de análisis (SUPERMERCADOS, SUMINISTROS, etc.)
    usando el mapa TIPO_TO_CATEGORY y respetando filtros de pago y categoría.

    Devuelve un dict:
    {
        "SUPERMERCADOS": {"total": 145.3, "tickets": 8},
        "VEHICULOS": {"total": 68.4, "tickets": 3},
        ...
    }
    """

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

    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.tipo_id).all()

    result: Dict[str, Dict[str, float]] = {}

    for r in rows:
        categoria_key = classify_category(r.tipo_id)
        current = result.setdefault(
            categoria_key,
            {"total": 0.0, "tickets": 0.0},
        )
        current["total"] += float(r.total or 0)
        current["tickets"] += float(r.tickets or 0)

    return result


def _aggregate_providers_by_category(
    db: Session,
    start_date: date,
    end_date_exclusive: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
) -> Dict[str, List[ProviderItem]]:
    """
    Agrega GastoCotidiano por proveedor y categoría de análisis (SUPERMERCADOS, etc.)
    usando el mapa TIPO_TO_CATEGORY y respetando filtros de pago y categoría.

    Devuelve:
    {
      "SUPERMERCADOS": [ProviderItem(...), ...],
      "VEHICULOS": [...],
      ...
    }
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
        .join(Proveedor, GastoCotidiano.proveedor_id == Proveedor.id)
        .filter(GastoCotidiano.fecha >= start_date)
        .filter(GastoCotidiano.fecha < end_date_exclusive)
    )

    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.tipo_id, Proveedor.nombre).all()

    result: Dict[str, List[ProviderItem]] = {}

    for r in rows:
        categoria_key = classify_category(r.tipo_id)
        provider_item = ProviderItem(
            nombre=(r.proveedor or "").upper(),
            importe=float(r.total or 0),
            num_compras=int(r.tickets or 0),
            tendencia="FLAT",  # más adelante calcularemos tendencia real
        )
        result.setdefault(categoria_key, []).append(provider_item)

    # Ordenamos proveedores de cada categoría por importe desc.
    for cat, lista in result.items():
        lista.sort(key=lambda x: x.importe, reverse=True)

    return result


def _aggregate_last_7_days(
    db: Session,
    base_date: date,
    pago: str,
    categoria: Optional[str],
    tipo_id: Optional[str],
) -> List[Last7DayItem]:
    """
    Calcula el gasto diario de los últimos 7 días (incluyendo base_date)
    respetando filtros de pago y categoría/tipo.
    """
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

    base_query = apply_pago_filter(base_query, GastoCotidiano, pago)
    base_query = apply_categoria_filters(base_query, GastoCotidiano, categoria, tipo_id)

    rows = base_query.group_by(GastoCotidiano.fecha).all()

    # Pasamos a dict {fecha: total}
    totals_by_date = {r.fecha: float(r.total or 0) for r in rows}

    # Orden cronológico de 7 días
    result: List[Last7DayItem] = []

    # Mapeo día semana a letra
    weekday_labels = ["L", "M", "X", "J", "V", "S", "D"]

    for i in range(6, -1, -1):
        d = base_date - timedelta(days=i)
        importe = totals_by_date.get(d, 0.0)
        weekday_idx = d.weekday()  # 0=lunes ... 6=domingo
        label = weekday_labels[weekday_idx]

        result.append(
            Last7DayItem(
                label=label,
                fecha=d.isoformat(),
                importe=importe,
            )
        )

    return result


# ---------------------------------------------------------------------------
# Endpoint principal
# ---------------------------------------------------------------------------

@router.get("/day-to-day", response_model=DayToDayAnalysisResponse)
def get_day_to_day_analysis(
    fecha: str | None = Query(
        default=None,
        description="Fecha base YYYY-MM-DD. Por defecto, hoy.",
    ),
    pago: Literal["YO", "OTRO", "TODOS"] = Query(
        "YO",
        description="YO=pagado True, OTRO=pagado False, TODOS=sin filtro",
    ),
    categoria: Optional[str] = Query(
        default=None,
        description="Categoría de análisis (SUPERMERCADOS, VEHICULOS, ...). Opcional.",
    ),
    tipo_id: Optional[str] = Query(
        default=None,
        description="Tipo concreto de gasto cotidiano (subgasto / tipo_id). Opcional.",
    ),
    db: Session = Depends(get_db),
):
    """
    Devuelve el análisis 'día a día' de los gastos cotidianos.

    Parámetros:
    - fecha: fecha base (YYYY-MM-DD). Se usa para calcular día, semana y mes.
    - pago:
        * 'YO'    -> solo gastos cotidianos donde pagado = True (los pagas tú).
        * 'OTRO'  -> solo gastos donde pagado = False (los paga otra persona).
        * 'TODOS' -> mezcla ambos.
    - categoria: categoría de análisis (SUPERMERCADOS, SUMINISTROS, VEHICULOS, ROPA, RESTURACION, OCIO, OTROS).
    - tipo_id: tipo concreto de gasto (por ejemplo TIP-GASOLINA-SW1ZQO). Si se informa,
      tiene prioridad sobre 'categoria' en los filtros.
    """
    base_date = parse_base_date(fecha)

    # Rangos de fecha
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
    today_query = apply_pago_filter(today_query, GastoCotidiano, pago)
    today_query = apply_categoria_filters(today_query, GastoCotidiano, categoria, tipo_id)
    today_row = today_query.one()

    total_hoy = float(today_row.total or 0)
    movimientos_hoy = int(today_row.movs or 0)
    ticket_medio_hoy = total_hoy / movimientos_hoy if movimientos_hoy > 0 else 0.0

    # Ayer (para diff vs ayer)
    ayer = base_date - timedelta(days=1)
    yesterday_query = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha == ayer)
    )
    yesterday_query = apply_pago_filter(yesterday_query, GastoCotidiano, pago)
    yesterday_query = apply_categoria_filters(
        yesterday_query, GastoCotidiano, categoria, tipo_id
    )
    yesterday_row = yesterday_query.one()
    total_ayer = float(yesterday_row.total or 0)

    diff_vs_ayer_val = total_hoy - total_ayer
    signo = "+" if diff_vs_ayer_val >= 0 else "-"
    diff_vs_ayer_label = f"{signo} {abs(diff_vs_ayer_val):.2f} € vs ayer"

    # Mensaje de tendencia hoy (muy simple de momento)
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
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha >= week_start)
        .filter(GastoCotidiano.fecha <= week_end)
    )
    week_query = apply_pago_filter(week_query, GastoCotidiano, pago)
    week_query = apply_categoria_filters(week_query, GastoCotidiano, categoria, tipo_id)
    week_total_row = week_query.one()
    total_semana = float(week_total_row.total or 0)

    # Días consumidos de la semana (hasta base_date)
    dias_consumidos = (base_date - week_start).days + 1
    dias_consumidos = max(1, min(dias_consumidos, 7))

    gasto_medio_diario_semana = total_semana / dias_consumidos if dias_consumidos > 0 else 0.0
    proyeccion_fin_semana = gasto_medio_diario_semana * 7

    # -----------------------------------------------------------------------
    # Mes en curso
    # -----------------------------------------------------------------------
    month_query = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha >= month_start)
        .filter(GastoCotidiano.fecha < month_next)
    )
    month_query = apply_pago_filter(month_query, GastoCotidiano, pago)
    month_query = apply_categoria_filters(month_query, GastoCotidiano, categoria, tipo_id)
    month_total_row = month_query.one()
    gastado_mes = float(month_total_row.total or 0)

    # Mes anterior
    prev_month_query = (
        db.query(
            func.coalesce(func.sum(GastoCotidiano.importe), 0).label("total"),
        )
        .filter(GastoCotidiano.fecha >= prev_month_start)
        .filter(GastoCotidiano.fecha < prev_month_next)
    )
    prev_month_query = apply_pago_filter(prev_month_query, GastoCotidiano, pago)
    prev_month_query = apply_categoria_filters(
        prev_month_query, GastoCotidiano, categoria, tipo_id
    )
    prev_month_total_row = prev_month_query.one()
    gastado_mes_anterior = float(prev_month_total_row.total or 0)

    # Presupuesto mensual "estimado":
    # - Si hay histórico del mes anterior, usamos 1.1 * gasto mes anterior.
    # - Si no hay, usamos 1.3 * gasto actual (o 0 si no hay nada).
    if gastado_mes_anterior > 0:
        presupuesto_mes = gastado_mes_anterior * 1.1
    elif gastado_mes > 0:
        presupuesto_mes = gastado_mes * 1.3
    else:
        presupuesto_mes = 0.0

    # Límite semanal aproximado: 1/4 del presupuesto
    limite_semana = presupuesto_mes / 4 if presupuesto_mes > 0 else gastado_mes or 0

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
    # Distribución por categoría (mes actual) + KPIs vs mes anterior
    # -----------------------------------------------------------------------
    # Mes actual
    cat_curr = _aggregate_by_category(db, month_start, month_next, pago, categoria, tipo_id)
    # Mes anterior
    cat_prev = _aggregate_by_category(
        db, prev_month_start, prev_month_next, pago, categoria, tipo_id
    )

    categorias_mes: List[CategoryMonth] = []
    category_kpis: Dict[str, CategoryKpi] = {}

    total_mes_para_pct = gastado_mes if gastado_mes > 0 else 1.0

    for key, data_curr in cat_curr.items():
        total_cat = data_curr["total"]
        tickets_cat = int(data_curr["tickets"])

        pct_sobre_total = (total_cat / total_mes_para_pct) * 100.0

        # Datos mes anterior para esta categoría
        prev_data = cat_prev.get(key, {"total": 0.0, "tickets": 0.0})
        total_prev = prev_data["total"]
        tickets_prev = prev_data["tickets"]

        # Variaciones %
        if total_prev > 0:
            var_importe_pct = ((total_cat - total_prev) / total_prev) * 100.0
        else:
            var_importe_pct = 100.0 if total_cat > 0 else 0.0

        if tickets_prev > 0:
            var_tickets_pct = ((tickets_cat - tickets_prev) / tickets_prev) * 100.0
        else:
            var_tickets_pct = 100.0 if tickets_cat > 0 else 0.0

        categorias_mes.append(
            CategoryMonth(
                key=key,
                label=key,   # mostramos el nombre de la categoría tal cual (SUPERMERCADOS, OCIO, etc.)
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

    # Ordenamos categorías por importe desc.
    categorias_mes.sort(key=lambda c: c.importe, reverse=True)

    # -----------------------------------------------------------------------
    # Proveedores destacados por categoría (mes actual)
    # -----------------------------------------------------------------------
    proveedores_por_categoria = _aggregate_providers_by_category(
        db, month_start, month_next, pago, categoria, tipo_id
    )

    # -----------------------------------------------------------------------
    # Últimos 7 días
    # -----------------------------------------------------------------------
    ultimos_7_dias = _aggregate_last_7_days(db, base_date, pago, categoria, tipo_id)

    # -----------------------------------------------------------------------
    # Alertas sencillas
    # -----------------------------------------------------------------------
    alertas: List[str] = []

    pct_mes_usado = (
        (gastado_mes / presupuesto_mes) * 100.0 if presupuesto_mes > 0 else 0.0
    )

    if presupuesto_mes > 0:
        alertas.append(
            f"Has consumido el {pct_mes_usado:.1f}% del presupuesto mensual estimado de gastos cotidianos."
        )

    # Alertas por concentración en categorías
    for cat in categorias_mes:
        if cat.porcentaje >= 40:
            alertas.append(
                f"{cat.label} concentra el {cat.porcentaje:.1f}% de tu gasto mensual."
            )

    if not alertas:
        alertas.append("No hay alertas destacadas este mes en tus gastos cotidianos.")

    # -----------------------------------------------------------------------
    # Construir respuesta
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
    )
