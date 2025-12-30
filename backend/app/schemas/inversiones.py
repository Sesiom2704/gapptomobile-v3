from __future__ import annotations

from datetime import date, datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


# ----------------------------
# Auxiliares para UI
# ----------------------------

class ProveedorMiniOut(BaseModel):
    id: str
    nombre: str
    model_config = ConfigDict(from_attributes=True)


class TipoGastoMiniOut(BaseModel):
    id: str
    nombre: str
    rama_id: Optional[str] = None
    segmento_id: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ----------------------------
# Inversion (core)
# ----------------------------

class InversionBase(BaseModel):
    tipo_gasto_id: str = Field(..., description="Tipo de inversión (usa tipo_gasto.id: JV, NPL, etc.)")

    proveedor_id: Optional[str] = Field(None, description="Proveedor asociado (broker/servicer/partner), proveedores.id")
    dealer_id: Optional[str] = Field(None, description="Dealer/contraparte principal (seller/sponsor), proveedores.id")

    nombre: str = Field(..., description="Nombre de la inversión")
    descripcion: Optional[str] = Field(None, description="Descripción libre")

    estado: Optional[str] = Field("ACTIVA", description="ACTIVA | CERRADA | DESCARTADA")
    fase: Optional[str] = Field(None, description="Reservado para futuro")

    fecha_creacion: Optional[date] = Field(None, description="Fecha alta (si no se envía, backend asigna)")
    fecha_inicio: Optional[date] = None
    fecha_objetivo_salida: Optional[date] = None
    fecha_cierre_real: Optional[date] = None

    moneda: Optional[str] = Field("EUR", description="Moneda ISO3")

    aporte_estimado: Optional[float] = None
    aporte_final: Optional[float] = None
    retorno_esperado_total: Optional[float] = None
    retorno_final_total: Optional[float] = None

    roi_esperado_pct: Optional[float] = None
    moic_esperado: Optional[float] = None
    irr_esperada_pct: Optional[float] = None
    plazo_esperado_meses: Optional[int] = None

    roi_final_pct: Optional[float] = None
    moic_final: Optional[float] = None
    irr_final_pct: Optional[float] = None
    plazo_final_meses: Optional[int] = None

    notas: Optional[str] = None


class InversionCreate(InversionBase):
    """
    Payload de creación.

    - id lo genera el backend: INV-<uuid corto>
    - user_id lo asigna el backend (usuario autenticado)
    """
    pass


class InversionUpdate(BaseModel):
    """
    Payload de actualización: todo opcional.
    """
    tipo_gasto_id: Optional[str] = None
    proveedor_id: Optional[str] = None
    dealer_id: Optional[str] = None

    nombre: Optional[str] = None
    descripcion: Optional[str] = None

    estado: Optional[str] = None
    fase: Optional[str] = None

    fecha_creacion: Optional[date] = None
    fecha_inicio: Optional[date] = None
    fecha_objetivo_salida: Optional[date] = None
    fecha_cierre_real: Optional[date] = None

    moneda: Optional[str] = None

    aporte_estimado: Optional[float] = None
    aporte_final: Optional[float] = None
    retorno_esperado_total: Optional[float] = None
    retorno_final_total: Optional[float] = None

    roi_esperado_pct: Optional[float] = None
    moic_esperado: Optional[float] = None
    irr_esperada_pct: Optional[float] = None
    plazo_esperado_meses: Optional[int] = None

    roi_final_pct: Optional[float] = None
    moic_final: Optional[float] = None
    irr_final_pct: Optional[float] = None
    plazo_final_meses: Optional[int] = None

    notas: Optional[str] = None


class InversionOut(InversionBase):
    id: str
    user_id: int

    tipo_gasto: Optional[TipoGastoMiniOut] = None
    proveedor: Optional[ProveedorMiniOut] = None
    dealer: Optional[ProveedorMiniOut] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ----------------------------
# Métricas (detalle flexible)
# ----------------------------

class InversionMetricaIn(BaseModel):
    escenario: Optional[str] = Field(None, description="BASE | PESIMISTA | OPTIMISTA (opcional)")
    clave: str = Field(..., description="Identificador de la métrica (ej: npl_pct_secured, jv_gdv, irr_base...)")
    valor_num: Optional[float] = Field(None, description="Valor numérico (si aplica)")
    valor_texto: Optional[str] = Field(None, description="Valor texto (distribuciones/resúmenes)")
    unidad: Optional[str] = Field(None, description="%, EUR, meses, x ...")
    origen: Optional[str] = Field(None, description="MANUAL | MODELO | TAPE")


class InversionMetricaOut(InversionMetricaIn):
    id: int
    inversion_id: str
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ----------------------------
# KPIs calculados (sin caja real)
# ----------------------------

class KpiBlock(BaseModel):
    aporte: Optional[float] = None
    retorno_total: Optional[float] = None
    plazo_meses: Optional[int] = None

    roi_pct: Optional[float] = None
    moic: Optional[float] = None
    irr_pct_aprox: Optional[float] = None

    # Para que UI sepa qué falta
    puede_calcular_moic: bool = False
    puede_calcular_roi: bool = False
    puede_calcular_irr: bool = False


class InversionKpisOut(BaseModel):
    inversion_id: str
    esperado: KpiBlock
    final: KpiBlock
