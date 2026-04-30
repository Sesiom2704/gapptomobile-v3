"""
Ruta: backend/app/schemas/cuentas.py
Versión: 2.1.0
Descripción:
Schemas Pydantic para cuentas bancarias de GapptoMobile v3.

Responsabilidades:
- Definir contratos de lectura/escritura para cuentas bancarias.
- Mantener compatibilidad con el flujo actual de creación/edición.
- Añadir soporte para contadores reales de registros asociados.
- Añadir soporte para participación de cuenta.

Regla de participación:
- participacion_pct se guarda como porcentaje:
    100 = cuenta propia completa
    50  = cuenta compartida al 50%
- Esta participación solo afecta a métricas patrimoniales/liquidez.
- No modifica movimientos reales de pagar/cobrar.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CuentaBancariaBase(BaseModel):
    """
    Campos base de una cuenta bancaria.
    """
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(
        ...,
        description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).",
    )
    participacion_pct: float = Field(
        100.0,
        ge=0.01,
        le=100.0,
        description="Porcentaje de participación sobre la cuenta. 100=total, 50=mitad.",
    )


class CuentaBancariaCreate(CuentaBancariaBase):
    """
    Create SIN user_id.
    El backend asigna user_id según el usuario autenticado.
    """
    activo: Optional[bool] = Field(True, description="Si la cuenta está activa o no.")
    liquidez_inicial: Optional[float] = Field(0.0, description="Liquidez inicial de la cuenta.")


class CuentaBancariaUpdate(BaseModel):
    """
    Payload de actualización parcial de cuenta bancaria.
    """
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: Optional[float] = None
    liquidez_inicial: Optional[float] = None
    participacion_pct: Optional[float] = Field(
        None,
        ge=0.01,
        le=100.0,
        description="Porcentaje de participación sobre la cuenta.",
    )
    activo: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


class RelationCountItem(BaseModel):
    key: str
    label: str
    count: int


class CuentaBancariaRead(BaseModel):
    id: str
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: float = 0.0
    liquidez_inicial: float = 0.0
    participacion_pct: float = 100.0
    user_id: int
    activo: bool = True
    associated_count: int = Field(0, description="Número real de registros asociados.")
    relation_counts: list[RelationCountItem] = Field(
        default_factory=list,
        description="Detalle de tablas relacionadas con contador > 0.",
    )

    model_config = ConfigDict(from_attributes=True)