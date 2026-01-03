# backend/app/schemas/day_to_day_analysis.py

from typing import Dict, List, Optional
from pydantic import BaseModel
from typing_extensions import Literal  # para tipos 'UP' | 'DOWN' | 'FLAT'


class TodaySummary(BaseModel):
    fecha_label: str
    total_hoy: float
    num_movimientos: int
    ticket_medio: float
    diff_vs_ayer: str
    tendencia: str


class WeekSummary(BaseModel):
    total_semana: float
    limite_semana: float
    proyeccion_fin_semana: float
    dias_restantes: int


class MonthSummary(BaseModel):
    presupuesto_mes: float
    gastado_mes: float


class CategoryMonth(BaseModel):
    key: str
    label: str
    importe: float
    porcentaje: float


class CategoryKpi(BaseModel):
    tickets: int
    ticket_medio: float
    variacion_importe_pct: float
    variacion_tickets_pct: float
    peso_sobre_total_gasto: float


class ProviderItem(BaseModel):
    nombre: str
    importe: float
    num_compras: int
    tendencia: Literal["UP", "DOWN", "FLAT"]


class Last7DayItem(BaseModel):
    label: str
    fecha: Optional[str] = None
    importe: float


# -------------------------------------------------------------------
# NUEVO: series para gráficas
# -------------------------------------------------------------------

class DailySeriesItem(BaseModel):
    """
    Serie diaria del mes: un punto por día (rellenando con 0 si no hay gasto).
    """
    fecha: str              # YYYY-MM-DD
    dia: int                # 1..31
    importe: float


class MonthlySeriesItem(BaseModel):
    """
    Serie mensual: un punto por mes (rellenando con 0 si no hay gasto).
    """
    year: int
    month: int              # 1..12
    label: str              # ej. "2026-01"
    importe: float
    tickets: int


class EvolutionKpis(BaseModel):
    """
    KPIs de evolución para interpretar las gráficas.
    """
    # Mes actual vs mes anterior
    variacion_mes_pct: float
    variacion_mes_abs: float

    # Medias (meses)
    media_3m: float
    media_6m: float
    media_12m: float

    # Tendencia (simple)
    tendencia: Literal["UP", "DOWN", "FLAT"]
    tendencia_detalle: str

    # Pico / mínimo en la ventana
    max_mes_label: Optional[str] = None
    max_mes_importe: Optional[float] = None
    min_mes_label: Optional[str] = None
    min_mes_importe: Optional[float] = None


class DayToDayAnalysisResponse(BaseModel):
    today: TodaySummary
    week: WeekSummary
    month: MonthSummary
    categorias_mes: List[CategoryMonth]
    category_kpis: Dict[str, CategoryKpi]
    proveedores_por_categoria: Dict[str, List[ProviderItem]]
    ultimos_7_dias: List[Last7DayItem]
    alertas: List[str]

    # -------------------------------------------------------------------
    # NUEVO (no rompe a clientes existentes):
    # -------------------------------------------------------------------
    serie_diaria_mes: Optional[List[DailySeriesItem]] = None
    serie_mensual: Optional[List[MonthlySeriesItem]] = None
    kpis_evolucion: Optional[EvolutionKpis] = None
