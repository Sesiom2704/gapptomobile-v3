# backend/app/schemas/localidad.py

from typing import Optional

from pydantic import BaseModel, ConfigDict

from .region import Region


class LocalidadBase(BaseModel):
    nombre: str
    region_id: int


class LocalidadCreate(LocalidadBase):
    """Crear localidad."""
    pass


class LocalidadUpdate(BaseModel):
    """Actualizar localidad."""
    nombre: Optional[str] = None
    region_id: Optional[int] = None


class LocalidadInDBBase(LocalidadBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class Localidad(LocalidadInDBBase):
    """
    Localidad con su región (para usos sencillos).
    """
    region: Optional[Region] = None


class LocalidadWithContext(LocalidadInDBBase):
    """
    Variante pensada para el selector en el móvil:
    - localidad
    - región (comunidad) con su país dentro (region.pais)
    """
    region: Region
