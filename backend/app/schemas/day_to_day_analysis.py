# backend/app/schemas/day_to_day_analysis.py

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from typing_extensions import Literal


# =============================================================================
# Día a día (DayToDayAnalysis)
# =============================================================================

Tendencia = Literal["UP", "DOWN", "FLAT"]


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
    """
    Mes en curso (cotidianos)

    - presupuesto_mes: presupuesto marcado (tabla `gastos`, importe_cuota, segmento cotidianos)
    - gastado_mes: semántico según filtro pago (YO/OTRO/TODOS)
    - total_mes/pagado_mes/invitado_mes: split REAL del mes (independiente de pago)
    """
    presupuesto_mes: float
    gastado_mes: float

    # ✅ Split mensual real (útil para UI / insights)
    total_mes: float = 0.0
    pagado_mes: float = 0.0
    invitado_mes: float = 0.0


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
    """
    Proveedor agregado.

    ✅ `tipo_id` es opcional:
    - Permite al frontend desglosar por componentes dentro de un contenedor.
      Ejemplo: OCIO → Transporte / Hospedaje / Actividades.
    """
    nombre: str
    importe: float
    num_compras: int
    tendencia: Tendencia
    tipo_id: Optional[str] = None


class Last7DayItem(BaseModel):
    label: str
    fecha: str
    importe: float


# =============================================================================
# Insights estructurados
# =============================================================================

InsightSeverity = Literal["info", "warning", "critical"]


class InsightItem(BaseModel):
    id: str
    title: str
    message: str
    severity: InsightSeverity
    meta: Optional[Dict[str, Any]] = None


# =============================================================================
# Series para gráficas
# =============================================================================

class DailySeriesItem(BaseModel):
    fecha: str  # YYYY-MM-DD
    dia: int  # 1..31
    importe: float


class MonthlySeriesItem(BaseModel):
    year: int
    month: int  # 1..12
    label: str  # "YYYY-MM"
    importe: float
    tickets: int


class EvolutionKpis(BaseModel):
    variacion_mes_pct: float
    variacion_mes_abs: float

    media_3m: float
    media_6m: float
    media_12m: float

    tendencia: Tendencia
    tendencia_detalle: str

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

    insights: Optional[List[InsightItem]] = None

    serie_diaria_mes: Optional[List[DailySeriesItem]] = None
    serie_mensual: Optional[List[MonthlySeriesItem]] = None
    kpis_evolucion: Optional[EvolutionKpis] = None
