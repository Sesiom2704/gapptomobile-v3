# backend/app/schemas/proveedores.py
"""
Schemas Pydantic para PROVEEDORES (GapptoMobile v3)

Objetivo de unificación:
- Evitar duplicidad de esquemas (proveedor.py vs proveedores.py).
- Garantizar que ProveedorCreate/Update tengan SIEMPRE:
    - localidad_id (opcional) para flujo normalizado
    - localidad/comunidad/pais (opcionales) para compatibilidad legacy
- Mantener compatibilidad hacia atrás:
    - Permitir que el cliente envíe "id" (opcional) en Create si existía antes.
      El backend puede ignorarlo y generar ID propio (como ya haces).
- Definir un ProveedorRead estable para la app móvil:
    - Incluye campos legacy y normalizados (localidad_rel) si el backend los expone.
    - Incluye rama_rel opcional, porque tu UI la usa en edición.

Nota:
- La validación "obligatorio según rama" (localidad/pais/comunidad) se mantiene en el router,
  porque es una regla de negocio (no un simple constraint de esquema).
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, ConfigDict

from .localidad import LocalidadWithContext


# -----------------------------------------------------------------------------
# Subschemas de relaciones (opcionales)
# -----------------------------------------------------------------------------
class RamaProveedorRel(BaseModel):
    """
    Relación ligera a la rama del proveedor.
    Tu UI (AuxEntityFormScreen) usa:
      editingProveedor.rama_rel?.nombre
    """
    id: str
    nombre: str

    model_config = ConfigDict(from_attributes=True)


# -----------------------------------------------------------------------------
# Base: campos comunes de negocio (sin obligar a localidad_id)
# -----------------------------------------------------------------------------
class ProveedorBase(BaseModel):
    """
    Campos base de proveedor.

    - nombre: nombre comercial (normalizado en router a MAYÚSCULAS).
    - rama_id: FK a tipo_ramas_proveedores.id (obligatorio en creación).
    - localidad_id: referencia normalizada (opcional).
    - localidad/comunidad/pais: textos legacy (compatibilidad v2).
    """
    nombre: str = Field(..., description="Nombre comercial del proveedor.")
    rama_id: str = Field(..., description="ID de la rama del proveedor (FK).")

    # Normalizado por FK (opcional)
    localidad_id: Optional[int] = Field(
        None,
        description="FK a localidades.id (opcional). Si se informa, el backend puede derivar textos.",
    )

    # Legacy por texto (opcionales según rama, se valida en router)
    localidad: Optional[str] = Field(None, description="Localidad (texto legacy).")
    comunidad: Optional[str] = Field(None, description="Comunidad/Región (texto legacy).")
    pais: Optional[str] = Field(None, description="País (texto legacy).")


# -----------------------------------------------------------------------------
# Create: permite 'id' opcional por compatibilidad, y mantiene localidad_id
# -----------------------------------------------------------------------------
class ProveedorCreate(ProveedorBase):
    """
    Payload para crear proveedor.

    Compatibilidad:
    - Algunos clientes antiguos podían enviar `id`. Lo aceptamos como opcional.
      Tu backend actual genera el ID; puedes ignorar este campo en el router.
    """
    id: Optional[str] = Field(
        None,
        description="ID opcional. El backend puede ignorarlo y generar PROV-XXXXXX.",
    )


# -----------------------------------------------------------------------------
# Update: todos opcionales (PUT/PATCH parcial)
# -----------------------------------------------------------------------------
class ProveedorUpdate(BaseModel):
    """
    Payload de actualización (parcial): sólo se aplican campos presentes.
    La normalización a MAYÚSCULAS y la validación por rama se hacen en router.
    """
    nombre: Optional[str] = Field(None, description="Nuevo nombre (si se cambia).")
    rama_id: Optional[str] = Field(None, description="Nueva rama_id (si se cambia).")

    localidad_id: Optional[int] = Field(
        None,
        description="Nueva FK a localidades.id (si se cambia).",
    )

    localidad: Optional[str] = Field(None, description="Nueva localidad texto (legacy).")
    comunidad: Optional[str] = Field(None, description="Nueva comunidad texto (legacy).")
    pais: Optional[str] = Field(None, description="Nuevo país texto (legacy).")


# -----------------------------------------------------------------------------
# Read: forma estable de respuesta
# -----------------------------------------------------------------------------
class ProveedorRead(BaseModel):
    """
    Representación de salida del proveedor.

    Incluye:
    - id (string PROV-XXXXXX)
    - campos principales
    - user_id (multiusuario) si lo quieres exponer (tu UI no lo necesita, pero no rompe)
    - relaciones opcionales:
        - rama_rel
        - localidad_rel (con region+pais dentro) si el backend la devuelve
    """
    id: str
    nombre: str
    rama_id: str

    localidad_id: Optional[int] = None
    localidad: Optional[str] = None
    comunidad: Optional[str] = None
    pais: Optional[str] = None

    user_id: Optional[int] = None

    rama_rel: Optional[RamaProveedorRel] = None
    localidad_rel: Optional[LocalidadWithContext] = None

    model_config = ConfigDict(from_attributes=True)


# Alias de compatibilidad para imports antiguos (si alguien importaba "Proveedor")
Proveedor = ProveedorRead
