# backend/app/schemas/cierre_mensual.py
"""
Schemas Pydantic para el dominio "cierre_mensual".

IMPORTANTE (2026-01):
- Se eliminan del contrato API:
    * n_pendientes_al_cerrar
    * version
  porque YA NO existen en la base de datos (y deben desaparecer también del modelo ORM).

Compatibilidad Pydantic v2:
- Usar ConfigDict(from_attributes=True)
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# =============================================================================
# Salidas (Out)
# =============================================================================

class CierreMensualOut(BaseModel):
    """
    Cabecera del cierre mensual.

    Nota:
    - NO incluye "version" ni "n_pendientes_al_cerrar" (eliminadas).
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    anio: int
    mes: int
    fecha_cierre: str  # FastAPI serializa datetime -> ISO string

    user_id: Optional[int] = None
    criterio: str

    liquidez_total: float

    ingresos_esperados: float
    ingresos_reales: float
    desv_ingresos: float

    gastos_gestionables_esperados: float
    gastos_gestionables_reales: float

    gastos_cotidianos_esperados: float
    gastos_cotidianos_reales: float

    gastos_esperados_total: float
    gastos_reales_total: float

    desv_gestionables: float
    desv_cotidianos: float
    desv_gastos_total: float

    resultado_esperado: float
    resultado_real: float
    desv_resultado: float

    n_recurrentes_ing: int
    n_recurrentes_gas: int
    n_unicos_ing: int
    n_unicos_gas: int
    n_cotidianos: int


class CierreMensualDetalleOut(BaseModel):
    """
    Detalle del cierre mensual por segmento y tipo de detalle.
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    cierre_id: UUID

    anio: int
    mes: int

    segmento_id: str
    tipo_detalle: str

    esperado: float
    real: float
    desviacion: float

    cumplimiento_pct: Optional[float] = None
    n_items: int
    incluye_kpi: bool

    fecha_cierre: str  # datetime -> ISO
    user_id: Optional[int] = None

    # Campo enriquecido desde router (no necesariamente persistido)
    segmento_nombre: Optional[str] = None


# =============================================================================
# Entradas (In) para PATCH
# =============================================================================

class CierreMensualPatchIn(BaseModel):
    """
    Patch parcial de cabecera.

    Nota:
    - No incluimos campos eliminados (version / n_pendientes_al_cerrar).
    - Incluimos sólo campos razonables de editar manualmente.
    """
    model_config = ConfigDict(from_attributes=True)

    criterio: Optional[str] = None
    liquidez_total: Optional[float] = None

    ingresos_esperados: Optional[float] = None
    ingresos_reales: Optional[float] = None

    gastos_gestionables_esperados: Optional[float] = None
    gastos_gestionables_reales: Optional[float] = None

    gastos_cotidianos_esperados: Optional[float] = None
    gastos_cotidianos_reales: Optional[float] = None

    # Contadores (si los quieres ajustar manualmente, los dejamos editables)
    n_recurrentes_ing: Optional[int] = None
    n_recurrentes_gas: Optional[int] = None
    n_unicos_ing: Optional[int] = None
    n_unicos_gas: Optional[int] = None
    n_cotidianos: Optional[int] = None


class CierreMensualDetallePatchIn(BaseModel):
    """
    Patch parcial de detalle.
    """
    model_config = ConfigDict(from_attributes=True)

    esperado: Optional[float] = None
    real: Optional[float] = None
    incluye_kpi: Optional[bool] = None
    n_items: Optional[int] = None


# =============================================================================
# Respuesta agregada KPIs (cierres + detalles)
# =============================================================================

class CierreMensualKpisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    limit: int
    count: int
    cierres: List[CierreMensualOut]
    detalles: List[CierreMensualDetalleOut]
