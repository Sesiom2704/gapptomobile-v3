# backend/app/schemas/proveedor.py

from typing import Optional
from pydantic import BaseModel, ConfigDict
from .localidad import LocalidadWithContext


class ProveedorBase(BaseModel):
    nombre: str
    rama_id: str  # ✅ OBLIGATORIO (backend)


class ProveedorCreate(ProveedorBase):
    """
    Datos de entrada para crear proveedor.

    Flujo v3 típico:
    - nombre, rama_id, localidad_id (opcional)

    Flujo legacy (si hiciera falta):
    - localidad / comunidad / pais como texto (opcionales).
    """
    localidad_id: Optional[int] = None

    # Campos legacy (compatibilidad v2.0)
    localidad: Optional[str] = None
    comunidad: Optional[str] = None
    pais: Optional[str] = None


class ProveedorUpdate(BaseModel):
    """
    Datos opcionales para actualizar un proveedor.
    """
    nombre: Optional[str] = None
    rama_id: Optional[str] = None
    localidad_id: Optional[int] = None

    localidad: Optional[str] = None
    comunidad: Optional[str] = None
    pais: Optional[str] = None


class ProveedorInDBBase(BaseModel):
    """
    Representación base almacenada en BBDD.
    Incluye campo id (string) y multiusuario.
    """
    id: str
    nombre: str
    rama_id: str  # ✅ siempre presente

    localidad_id: Optional[int] = None

    # Campos texto (legacy)
    localidad: Optional[str] = None
    comunidad: Optional[str] = None
    pais: Optional[str] = None

    user_id: int

    model_config = ConfigDict(from_attributes=True)


class Proveedor(ProveedorInDBBase):
    """
    Salida principal:
    - campos legacy (localidad, comunidad, pais)
    - más info normalizada en localidad_rel.
    """
    localidad_rel: Optional[LocalidadWithContext] = None
