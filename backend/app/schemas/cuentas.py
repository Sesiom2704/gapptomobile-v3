# backend/app/schemas/cuentas.py

"""
Schemas Pydantic para CUENTAS BANCARIAS.

Objetivo:
- Separar claramente qué se envía al crear, actualizar y leer una cuenta.
- Documentar el comportamiento para poder hacer un manual funcional.

Notas de negocio:
- El ID de la cuenta se genera en el backend (prefijo 'CTA-').
- El ANAGRAMA se calcula automáticamente a partir del nombre del banco
  y la referencia, salvo que el usuario lo envíe explícitamente en un
  update.
- La liquidez inicial, si no se especifica, queda en 0.0 (por defecto BD).
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, ConfigDict


class CuentaBancariaBase(BaseModel):
    """
    Campos mínimos para identificar una cuenta bancaria.

    - banco_id: ID del proveedor que representa el banco / financiera.
    - referencia: texto que te ayuda a identificar la cuenta
      (ejemplo: 'NÓMINA BBVA', 'CUENTA AHORRO', etc.).
    """
    banco_id: str
    referencia: str


class CuentaBancariaCreate(CuentaBancariaBase):
    """
    Datos necesarios para crear una cuenta bancaria.

    Reglas:
    - El ID se genera en el backend.
    - El ANAGRAMA se calcula automáticamente con el nombre del banco
      y la referencia.
    - La liquidez inicial se deja en 0.0 (por defecto de la BD).
    """
    # Si en el futuro quisieras permitir indicar liquidez inicial,
    # podríamos añadir aquí un campo opcional, ej.:
    # liquidez_inicial: float | None = None
    pass


class CuentaBancariaUpdate(BaseModel):
    """
    Datos que se pueden actualizar en una cuenta bancaria.

    Todos los campos son opcionales: solo se modifican los que
    estén presentes en la petición.

    - banco_id: cambiar el banco asociado (debe ser rama 'Bancos y financieras').
    - referencia: cambiar la referencia textual.
    - anagrama: si se envía, se respeta tal cual y NO se recalcula.
    - liquidez: permite ajustar manualmente la liquidez almacenada.
    """
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class CuentaBancariaRead(BaseModel):
    """
    Representación completa de una cuenta bancaria al leerla desde la API.
    """
    id: str
    banco_id: Optional[str] = None
    referencia: Optional[str] = None
    anagrama: Optional[str] = None
    liquidez: Optional[float] = 0.0

    model_config = ConfigDict(from_attributes=True)
