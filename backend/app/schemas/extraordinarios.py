# backend/app/schemas/extraordinarios.py
from datetime import datetime, date
from typing import List, Optional, Literal

from pydantic import BaseModel


class ExtraordinarioItem(BaseModel):
    id: str
    nombre: str
    categoria_nombre: Optional[str] = None  # p.ej. tipo_rel.nombre
    tipo: Literal["GASTO", "INGRESO"]
    importe: float

    # Estado
    pagado: Optional[bool] = None
    cobrado: Optional[bool] = None
    kpi: bool
    activo: bool

    # Fecha de referencia para el filtro/listado:
    # - gastos extraordinarios: ultimo_pago_on
    # - ingresos extraordinarios: ultimo_ingreso_on
    # - omitidos: ultimo_omitido_on
    fecha_referencia: datetime

    # ==========================
    # Campos extra para navegar a forms
    # (opcionales para no romper nada)
    # ==========================
    periodicidad: Optional[str] = None

    # Gasto (gestionable)
    tipo_id: Optional[str] = None
    segmento_id: Optional[str] = None
    proveedor_id: Optional[str] = None
    cuenta_id: Optional[str] = None
    referencia_vivienda_id: Optional[str] = None
    fecha: Optional[date] = None
    rango_pago: Optional[str] = None
    comentarios: Optional[str] = None
    importe_cuota: Optional[float] = None
    cuotas: Optional[int] = None

    # Ingreso
    rango_cobro: Optional[str] = None
    fecha_inicio: Optional[date] = None

    class Config:
        orm_mode = True


class ExtraordinariosResponse(BaseModel):
    year: int
    month: int  # 1-12

    # Extraordinarios “clásicos” (PAGO UNICO + inactivos + pagado/cobrado)
    total_gastos: float
    total_ingresos: float

    # NUEVO: omitidos del mes (gastos)
    total_gastos_omitidos: float

    # Balance solicitado:
    # Ingresos + gastos omitidos - gastos extraordinarios
    balance: float

    gastos: List[ExtraordinarioItem]
    ingresos: List[ExtraordinarioItem]

    # NUEVO: listado de omitidos
    gastos_omitidos: List[ExtraordinarioItem]

    class Config:
        orm_mode = True