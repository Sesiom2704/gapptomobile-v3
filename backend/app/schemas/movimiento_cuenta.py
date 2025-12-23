# backend/app/schemas/movimiento_cuenta.py

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class MovimientoCuentaBase(BaseModel):
    fecha: date
    cuenta_origen_id: str
    cuenta_destino_id: str
    # Usamos Decimal para alinearnos con Numeric(12,2) de la BD
    importe: Optional[Decimal] = None
    comentarios: Optional[str] = None


class MovimientoCuentaCreate(MovimientoCuentaBase):
    # user_id lo sacamos del token, no del front
    pass


class MovimientoCuentaRead(MovimientoCuentaBase):
    id: str
    user_id: Optional[int] = None
    # Lo dejamos opcional por si en algún momento viene sin valor
    createdon: Optional[datetime] = None

    # Campos derivados opcionales
    cuenta_origen_nombre: Optional[str] = None
    cuenta_destino_nombre: Optional[str] = None

    saldo_origen_antes: Optional[Decimal] = None
    saldo_origen_despues: Optional[Decimal] = None
    saldo_destino_antes: Optional[Decimal] = None
    saldo_destino_despues: Optional[Decimal] = None

    class Config:
        from_attributes = True  # Pydantic v2


class MovimientoCuentaListItem(BaseModel):
    id: str
    fecha: date
    origen_nombre: str
    destino_nombre: str
    importe: Decimal
    comentarios: Optional[str] = None

    saldo_origen_antes: Optional[Decimal] = None
    saldo_origen_despues: Optional[Decimal] = None
    saldo_destino_antes: Optional[Decimal] = None
    saldo_destino_despues: Optional[Decimal] = None

    class Config:
        from_attributes = True


# 👇 Esquema específico para el endpoint de ajuste de liquidez

class AjusteLiquidezPayload(BaseModel):
    """
    Payload específico para el endpoint de ajuste de liquidez:
    POST /api/v1/movimientos-cuenta/ajuste-liquidez
    """
    fecha: date
    cuenta_id: str
    nuevo_saldo: Decimal
    comentarios: Optional[str] = None