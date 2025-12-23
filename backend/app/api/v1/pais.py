# backend/app/schemas/pais.py
from typing import Optional

from pydantic import BaseModel, ConfigDict


class PaisBase(BaseModel):
    nombre: str
    codigo_iso: Optional[str] = None


class PaisCreate(PaisBase):
    """Datos necesarios para crear un país."""
    pass


class PaisUpdate(BaseModel):
    """Datos opcionales para actualizar un país."""
    nombre: Optional[str] = None
    codigo_iso: Optional[str] = None


class PaisInDBBase(PaisBase):
    id: int

    # Pydantic v2: equivalente a orm_mode = True
    model_config = ConfigDict(from_attributes=True)


class Pais(PaisInDBBase):
    """Salida simple de país (p.ej. en combos)."""
    pass
