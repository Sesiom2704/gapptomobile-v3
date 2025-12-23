"""
Schemas Pydantic v2 para gestión de usuarios en GapptoMobile v3.

Reglas de negocio principales:
- El email debe ser único.
- El nombre completo (`full_name`) se guardará en MAYÚSCULAS en la BD.
- El campo `role` se espera que sea uno de: "user", "admin".
- La contraseña se guarda tal cual se recibe (sin hash de momento),
  pero este punto se puede mejorar en el futuro.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, ConfigDict


class UserBase(BaseModel):
    email: EmailStr = Field(
        ...,
        description="Correo electrónico del usuario. Debe ser único.",
        example="usuario@correo.com",
    )
    full_name: str = Field(
        ...,
        description="Nombre completo del usuario. Se guardará en MAYÚSCULAS en BD.",
        example="NOMBRE APELLIDO",
    )
    role: str = Field(
        default="user",
        description="Rol del usuario dentro de la aplicación.",
        examples=["user", "admin"],
    )


class UserCreate(BaseModel):
    """
    Datos necesarios para crear un usuario.

    Notas:
    - `email` debe ser único.
    - `password` se guarda tal cual (sin hash de momento).
    - `full_name` se normalizará a MAYÚSCULAS en el servidor.
    - `role` por defecto es 'user' si no se especifica.
    """

    email: EmailStr = Field(
        ...,
        description="Correo electrónico del usuario. Debe ser único.",
        example="usuario@correo.com",
    )
    password: str = Field(
        ...,
        min_length=6,
        description="Contraseña del usuario (mínimo 6 caracteres).",
    )
    full_name: str = Field(
        ...,
        description="Nombre completo del usuario. Se guardará en MAYÚSCULAS.",
        example="Nombre Apellido",
    )
    role: Optional[str] = Field(
        default="user",
        description="Rol del usuario. Por defecto 'user'.",
        examples=["user", "admin"],
    )


class UserUpdate(BaseModel):
    """
    Datos permitidos para actualizar un usuario existente.

    Todos los campos son opcionales:
    - Si vienen como None o no se incluyen, no se modifican.
    """

    email: Optional[EmailStr] = Field(
        default=None,
        description="Nuevo email. Debe seguir siendo único si se cambia.",
    )
    password: Optional[str] = Field(
        default=None,
        min_length=6,
        description="Nueva contraseña, si se desea cambiar.",
    )
    full_name: Optional[str] = Field(
        default=None,
        description="Nuevo nombre completo. Se guardará en MAYÚSCULAS.",
    )
    is_active: Optional[bool] = Field(
        default=None,
        description="Permite activar/desactivar el usuario.",
    )
    role: Optional[str] = Field(
        default=None,
        description="Nuevo rol del usuario.",
        examples=["user", "admin"],
    )


class UserRead(BaseModel):
    """
    Esquema de lectura de usuarios (respuesta de la API).
    """

    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    created_at: datetime
    role: str

    model_config = ConfigDict(from_attributes=True)
