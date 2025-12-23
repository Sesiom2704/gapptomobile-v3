# backend/app/schemas/region.py

from typing import Optional

from pydantic import BaseModel, ConfigDict

from .pais import Pais


class RegionBase(BaseModel):
    nombre: str
    pais_id: int


class RegionCreate(RegionBase):
    """Crear región."""
    pass


class RegionUpdate(BaseModel):
    """Actualizar región."""
    nombre: Optional[str] = None
    pais_id: Optional[int] = None


class RegionInDBBase(RegionBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class Region(RegionInDBBase):
    """Salida simple de región, incluyendo el país."""
    pais: Optional[Pais] = None
