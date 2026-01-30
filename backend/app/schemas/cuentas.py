# backend/app/schemas/cuentas.py

"""
Schemas Pydantic para CUENTAS BANCARIAS.

Objetivo:
- Separar claramente qué se envía al crear, actualizar y leer una cuenta.

Notas de negocio:
- El ID de la cuenta se genera en el backend (prefijo 'CTA-').
- El ANAGRAMA se calcula automáticamente a partir del nombre del banco y la referencia.
  Regla unificada con el front: "REFERENCIA - NOMBRE DEL BANCO".
- La liquidez y liquidez_inicial, si no se especifica, quedan en 0.0 (por defecto BD).
- user_id es obligatorio según el modelo (nullable=False).
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CuentaBancariaBase(BaseModel):
    """
    Campos mínimos para identificar una cuenta bancaria.

    - banco_id: ID del proveedor que representa el banco / financiera.
    - referencia: texto que te ayuda a identificar la cuenta
      (ejemplo: 'NÓMINA', 'GASTOS', 'CRÉDITO', etc.).
    """
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(..., description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).")


class CuentaBancariaCreate(CuentaBancariaBase):
    """
    Datos necesarios para crear una cuenta bancaria.

    Reglas:
    - El ID se genera en el backend.
    - El ANAGRAMA se calcula automáticamente con el nombre del banco y la referencia.
    - La liquidez y liquidez_inicial se dejan en 0.0 (por defecto de la BD).
    - user_id es obligatorio.
    """
    user_id: int = Field(..., description="Propietario de la cuenta (users.id).")
    activo: Optional[bool] = Field(True, description="Si la cuenta está activa o no.")


class CuentaBancariaUpdate(BaseModel):
    """
    Datos que se pueden actualizar en una cuenta bancaria.

    Todos los campos son opcionales: solo se modifican los que
    estén presentes en la petición.

    - banco_id: cambiar el banco asociado (debe ser rama 'Bancos y financieras').
    - referencia: cambiar la referencia textual.
    - anagrama: si se envía, se respeta tal cual y NO se recalcula.
    - liquidez: permite ajustar manualmente la liquidez almacenada.
    - liquidez_inicial: permite ajustar la liquidez inicial (si tu lógica lo permite).
    - activo: activar/desactivar la cuenta.
    """
    banco_id: Optional[str] = Field(None, description="Nuevo banco_id (proveedor).")
    referencia: Optional[str] = Field(None, description="Nueva referencia.")
    anagrama: Optional[str] = Field(None, description="Anagrama manual. Si se envía, no se recalcula.")
    liquidez: Optional[float] = Field(None, description="Liquidez actual almacenada.")
    liquidez_inicial: Optional[float] = Field(None, description="Liquidez inicial almacenada.")
    activo: Optional[bool] = Field(None, description="Estado activo/inactivo.")

    model_config = ConfigDict(from_attributes=True)


class CuentaBancariaRead(BaseModel):
    """
    Representación completa de una cuenta bancaria al leerla desde la API.
    """
    id: str
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: float = 0.0
    liquidez_inicial: float = 0.0
    user_id: int
    activo: bool = True

    model_config = ConfigDict(from_attributes=True)
