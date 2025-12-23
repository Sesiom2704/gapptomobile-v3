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


class DayToDayAnalysisResponse(BaseModel):
    today: TodaySummary
    week: WeekSummary
    month: MonthSummary
    categorias_mes: List[CategoryMonth]
    category_kpis: Dict[str, CategoryKpi]
    proveedores_por_categoria: Dict[str, List[ProviderItem]]
    ultimos_7_dias: List[Last7DayItem]
    alertas: List[str]

    
