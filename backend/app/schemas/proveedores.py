"""
Schemas Pydantic para PROVEEDORES en GapptoMobile v3.

La idea es separar claramente:
- ProveedorBase: campos de negocio comunes (nombre, rama, ubicación).
- ProveedorCreate: payload de entrada al crear un proveedor.
- ProveedorUpdate: payload parcial para actualizar un proveedor.
- ProveedorRead: forma en la que devolvemos el proveedor al cliente.

NOTA: La validación "LOCALIDAD/PAÍS/COMUNIDAD obligatorios según rama"
se hace en el router (reglas de negocio), no aquí.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, ConfigDict


class ProveedorBase(BaseModel):
    """
    Campos base de un proveedor.

    - nombre: nombre comercial del proveedor (supermercado, banco, hotel, etc.).
    - rama_id: ID de la rama de proveedor (tabla tipo_ramas_proveedores).
    - localidad: ciudad/población donde opera principalmente.
    - pais: país del proveedor.
    - comunidad: comunidad autónoma (para RESTAURANTES es obligatoria).
    """

    nombre: str = Field(
        ...,
        description="Nombre comercial del proveedor (por ejemplo, 'MERCADONA', 'BBVA').",
    )
    rama_id: str = Field(
        ...,
        description="ID de la rama de proveedor (FK a tipo_ramas_proveedores.id).",
    )

    localidad: Optional[str] = Field(
        None,
        description="Localidad o ciudad principal del proveedor (opcional según rama).",
    )
    pais: Optional[str] = Field(
        None,
        description="País del proveedor (opcional según rama).",
    )
    comunidad: Optional[str] = Field(
        None,
        description="Comunidad autónoma (obligatoria SOLO para restaurantes).",
    )


class ProveedorCreate(ProveedorBase):
    """
    Payload de creación de proveedor.

    - id: se puede enviar desde el cliente (por compatibilidad).
      Si quisieras, más adelante podríamos pasar a generarlo
      totalmente en servidor.

    El resto de campos heredan de ProveedorBase.
    """

    id: Optional[str] = Field(
        None,
        description=(
            "ID del proveedor. Si no se envía, el backend puede generar uno "
            "automáticamente."
        ),
    )


class ProveedorUpdate(BaseModel):
    """
    Payload de actualización de proveedor (PATCH/PUT parcial).

    Todos los campos son opcionales; sólo se actualizan los que se envían.
    La lógica de negocio (normalización a MAYÚSCULAS, validación de rama/ubicación)
    se aplica en el router.
    """

    nombre: Optional[str] = Field(
        None,
        description="Nuevo nombre del proveedor (si se quiere cambiar).",
    )
    rama_id: Optional[str] = Field(
        None,
        description="Nueva rama del proveedor (si se quiere cambiar).",
    )
    localidad: Optional[str] = Field(
        None,
        description="Nueva localidad (si se quiere cambiar).",
    )
    pais: Optional[str] = Field(
        None,
        description="Nuevo país (si se quiere cambiar).",
    )
    comunidad: Optional[str] = Field(
        None,
        description="Nueva comunidad autónoma (si se quiere cambiar).",
    )


class ProveedorRead(ProveedorBase):
    """
    Representación de salida de un proveedor.

    Incluye el ID, además de los campos base.

    model_config.from_attributes = True permite crear el schema a partir de
    instancias SQLAlchemy (models.Proveedor).
    """

    id: str

    model_config = ConfigDict(from_attributes=True)
