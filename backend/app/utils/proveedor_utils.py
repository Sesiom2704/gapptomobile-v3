# backend/app/utils/proveedor_utils.py

"""
Utilidades relacionadas con PROVEEDORES.

Incluye:

- ensure_proveedor_in_rama / ensure_proveedor_es_banco:
    Validan que un proveedor exista y pertenezca a una rama concreta.

- get_rama_nombre_upper:
    Devuelve el nombre de la rama (tipo_ramas_proveedores.nombre) en MAYÚSCULAS.

- validate_proveedor_ubicacion_condicional:
    Aplica las reglas de obligatoriedad de LOCALIDAD/PAÍS/COMUNIDAD según
    el NOMBRE de la rama (RESTAURANTES, HOTELES, etc.).
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.db import models
from backend.app.core.constants import (
    RAMA_BANCOS_FINANCIERAS_ID,
    PROVEEDOR_RAMAS_UBICACION_OBLIGATORIA_NOMBRE,
    PROVEEDOR_RAMAS_COMUNIDAD_OBLIGATORIA_NOMBRE,
)
from backend.app.utils.text_utils import normalize_upper


# ============================================================
# Validación de rama genérica + bancos
# ============================================================

def ensure_proveedor_in_rama(
    db: Session,
    proveedor_id: str,
    rama_id: str,
    *,
    not_found_msg: str = "Proveedor no encontrado.",
    wrong_rama_msg: str | None = None,
) -> models.Proveedor:
    """
    Recupera un proveedor y verifica que pertenezca a la rama indicada.
    """
    prov = db.get(models.Proveedor, proveedor_id)
    if not prov:
        raise HTTPException(status_code=404, detail=not_found_msg)

    if prov.rama_id != rama_id:
        raise HTTPException(
            status_code=400,
            detail=wrong_rama_msg or "Proveedor no pertenece a la rama requerida.",
        )

    return prov


def ensure_proveedor_es_banco(db: Session, proveedor_id: str) -> models.Proveedor:
    """
    Asegura que el proveedor indicado existe y pertenece a la rama
    'Bancos y financieras'.
    """
    return ensure_proveedor_in_rama(
        db,
        proveedor_id,
        RAMA_BANCOS_FINANCIERAS_ID,
        wrong_rama_msg="Solo se permiten proveedores de la rama 'Bancos y Financieras'.",
    )


# ============================================================
# Reglas específicas de ubicación (REST./HOTELES)
# ============================================================

def get_rama_nombre_upper(db: Session, rama_id: Optional[str]) -> Optional[str]:
    """
    Devuelve el nombre de la rama en MAYÚSCULAS a partir de su ID.

    Si rama_id es None o no se encuentra, devuelve None.
    """
    if not rama_id:
        return None
    r = db.get(models.TipoRamasProveedores, rama_id)
    if not r or not r.nombre:
        return None
    return normalize_upper(r.nombre)


def validate_proveedor_ubicacion_condicional(
    db: Session,
    rama_id: Optional[str],
    localidad: Optional[str],
    pais: Optional[str],
    comunidad: Optional[str],
) -> None:
    """
    Reglas condicionales según la rama del proveedor (por NOMBRE):

    - Si la rama es RESTAURANTES u HOTELES:
        * LOCALIDAD y PAÍS son obligatorios (no pueden ser None).

    - Si la rama es RESTAURANTES u HOTELES:
        * COMUNIDAD también es obligatoria.

    NOTA:
    - Esta función NO normaliza los textos, solo comprueba si son None.
      Se espera que la normalización a MAYÚSCULAS se haya hecho antes
      con normalize_upper().
    """
    nombre = get_rama_nombre_upper(db, rama_id)

    if not nombre:
        # Si no hay nombre de rama, no aplicamos reglas adicionales
        return

    # LOCALIDAD / PAÍS obligatorios en RESTAURANTES / HOTELES
    if nombre in PROVEEDOR_RAMAS_UBICACION_OBLIGATORIA_NOMBRE:
        if not localidad:
            raise HTTPException(
                status_code=422,
                detail="La LOCALIDAD es obligatoria para proveedores de RESTAURANTES/HOTELES.",
            )
        if not pais:
            raise HTTPException(
                status_code=422,
                detail="El PAÍS es obligatorio para proveedores de RESTAURANTES/HOTELES.",
            )

    # COMUNIDAD obligatoria en RESTAURANTES y HOTELES
    if nombre in PROVEEDOR_RAMAS_COMUNIDAD_OBLIGATORIA_NOMBRE:
        if not comunidad:
            raise HTTPException(
                status_code=422,
                detail="La COMUNIDAD es obligatoria para proveedores de RESTAURANTES/HOTELES.",
            )
