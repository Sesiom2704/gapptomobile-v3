# backend/app/schemas/tipo_ramas_proveedores.py

from typing import Optional
from pydantic import BaseModel, ConfigDict


class TipoRamaProveedorBase(BaseModel):
    nombre: str


class TipoRamaProveedorInDBBase(TipoRamaProveedorBase):
    id: str
    descripcion: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TipoRamaProveedor(TipoRamaProveedorInDBBase):
    """Salida simple de rama de proveedor."""
    pass
