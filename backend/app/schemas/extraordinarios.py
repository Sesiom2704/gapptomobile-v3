# backend/app/schemas/extraordinarios.py
from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel


class ExtraordinarioItem(BaseModel):
    id: str
    nombre: str
    categoria_nombre: Optional[str] = None  # p.ej. tipo_rel.nombre
    tipo: Literal["GASTO", "INGRESO"]
    importe: float

    pagado: Optional[bool] = None
    cobrado: Optional[bool] = None
    kpi: bool
    activo: bool

    # Fecha de referencia para el filtro: ultimo_pago_on / ultimo_ingreso_on
    fecha_referencia: datetime

    class Config:
        orm_mode = True


class ExtraordinariosResponse(BaseModel):
    year: int
    month: int  # 1-12

    total_gastos: float
    total_ingresos: float
    balance: float

    gastos: List[ExtraordinarioItem]
    ingresos: List[ExtraordinarioItem]

    class Config:
        orm_mode = True
