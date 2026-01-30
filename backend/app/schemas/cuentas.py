# backend/app/schemas/cuentas.py

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CuentaBancariaBase(BaseModel):
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(..., description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).")


class CuentaBancariaCreate(CuentaBancariaBase):
    """
    Create SIN user_id.
    El backend asigna user_id según el usuario autenticado (token).
    """
    activo: Optional[bool] = Field(True, description="Si la cuenta está activa o no.")


class CuentaBancariaUpdate(BaseModel):
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: Optional[float] = None
    liquidez_inicial: Optional[float] = None
    activo: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


class CuentaBancariaRead(BaseModel):
    id: str
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: float = 0.0
    liquidez_inicial: float = 0.0
    user_id: int
    activo: bool = True

    model_config = ConfigDict(from_attributes=True)
