"""
backend/app/schemas/analytics.py

Responsabilidad:
- Contener los Pydantic schemas (DTOs) de la capa API relacionados con analytics.
- Separar “modelos de respuesta” de la lógica del router para:
  - Mejor mantenibilidad
  - Reutilización entre routers
  - Evitar routers demasiado largos

Importante:
- Estos schemas se usan en analytics_router.py como response_model.
- No contienen lógica, sólo estructura y tipado.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


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
    """
    KPIs por patrimonio según selector de periodo.

    Nota:
    - V3: el front (PropiedadKpisScreen.tsx) espera varios campos adicionales.
    - Mantengo compatibilidad con lo ya existente y amplío para cubrir KPIs visibles.
    """

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

    # -------------------------
    # KPIs adicionales (Pantalla Propiedad KPIs)
    # -------------------------
    payback_anios: Optional[float] = None

    # €/m² y derivados
    precio_m2: Optional[float] = None           # €/m² compra
    referencia_m2: Optional[float] = None       # €/m² referencia (si se usa)
    renta_m2_anual: Optional[float] = None      # €/m²/año (renta)
    inversion_m2: Optional[float] = None        # €/m² inversión total
    rentab_m2_total_pct: Optional[float] = None # % rentab (bruta) sobre inversión total

    # Deuda / cobertura
    deuda_anual: float = 0.0
    dscr: Optional[float] = None

    # Ocupación
    ocupacion_pct: Optional[float] = None

    # NUEVO: KPI solicitado para sustituir “€/m² (ref.)”
    rendimiento_neto_pct: Optional[float] = None

    # Diccionario de explicaciones “human friendly”
    info: Dict[str, str] = Field(default_factory=dict)


class PatrimonioSummaryOut(BaseModel):
    """
    Summary para Home (agregado multi-propiedad)
    """
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
