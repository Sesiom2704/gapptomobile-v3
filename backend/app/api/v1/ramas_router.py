# backend/app/api/v1/ramas_router.py

"""
API v1 - RAMAS (TipoRamasGasto, TipoRamasProveedores)

Basado en backend/routers/ramas.py de la v2, manteniendo:

- Endpoints y rutas:
    /ramas/proveedores
    /ramas/gastos
    /ramas/proveedores/{rama_id}
    /ramas/gastos/{rama_id}

- Reglas:
    * NOMBRE siempre en MAYÚSCULAS (strip + upper).
    * No se permiten duplicados por NOMBRE al crear.
    * 404 si la rama no existe al actualizar/borrar.

Mejoras v3:
- Uso de schemas separados (ramas.py).
- IDs generados en backend (TRAG-/TRPR-).
- Normalización de texto centralizada con normalize_upper().
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.ramas import (
    TipoRamaGastoCreate,
    TipoRamaGastoUpdate,
    TipoRamaGastoRead,
    TipoRamaProveedorCreate,
    TipoRamaProveedorUpdate,
    TipoRamaProveedorRead,
)
from backend.app.utils.text_utils import normalize_upper
from backend.app.utils.id_utils import (
    generate_tipo_rama_gasto_id,
    generate_tipo_rama_proveedor_id,
)

router = APIRouter(
    prefix="/ramas",
    tags=["ramas"],
)

# ==========================
# RAMAS DE PROVEEDORES
# ==========================

@router.get(
    "/proveedores",
    response_model=List[TipoRamaProveedorRead],
    summary="Listar ramas de proveedores",
)
def list_ramas_proveedores(
    db: Session = Depends(get_db),
):
    """
    Devuelve todas las ramas de proveedores ordenadas por nombre.
    """
    return (
        db.query(models.TipoRamasProveedores)
        .order_by(models.TipoRamasProveedores.nombre.asc())
        .all()
    )


@router.post(
    "/proveedores",
    response_model=TipoRamaProveedorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una rama de proveedor",
)
def create_rama_proveedor(
    rama_in: TipoRamaProveedorCreate,
    db: Session = Depends(get_db),
):
    """
    Crea una nueva rama de proveedor.

    Reglas:
    - NOMBRE se guarda en MAYÚSCULAS.
    - No se puede repetir NOMBRE.
    - El ID se genera en backend (TRPR-XXXXXX).
    """
    nombre_up = normalize_upper(rama_in.nombre) or ""
    exists = (
        db.query(models.TipoRamasProveedores)
        .filter(models.TipoRamasProveedores.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe esa rama de proveedor.",
        )

    new_id = generate_tipo_rama_proveedor_id(db)

    obj = models.TipoRamasProveedores(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/proveedores/{rama_id}",
    response_model=TipoRamaProveedorRead,
    summary="Actualizar una rama de proveedor",
)
def update_rama_proveedor(
    rama_id: str,
    rama_in: TipoRamaProveedorUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza una rama de proveedor.

    - Si no existe → 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    """
    obj = db.get(models.TipoRamasProveedores, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama proveedor no encontrada.",
        )

    data = rama_in.model_dump(exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/proveedores/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de proveedor",
)
def delete_rama_proveedor(
    rama_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina una rama de proveedor.

    - Si no existe → 404.
    - Si hay proveedores asociados, la BD puede impedir el borrado.
    """
    obj = db.get(models.TipoRamasProveedores, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama proveedor no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None


# ==========================
# RAMAS DE GASTOS
# ==========================

@router.get(
    "/gastos",
    response_model=List[TipoRamaGastoRead],
    summary="Listar ramas de gastos",
)
def list_ramas_gasto(
    db: Session = Depends(get_db),
):
    """
    Devuelve todas las ramas de gasto ordenadas por nombre.
    """
    return (
        db.query(models.TipoRamasGasto)
        .order_by(models.TipoRamasGasto.nombre.asc())
        .all()
    )


@router.post(
    "/gastos",
    response_model=TipoRamaGastoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una rama de gasto",
)
def create_rama_gasto(
    rama_in: TipoRamaGastoCreate,
    db: Session = Depends(get_db),
):
    """
    Crea una nueva rama de gasto.

    Reglas:
    - NOMBRE en MAYÚSCULAS.
    - No se puede repetir NOMBRE.
    - ID generado en backend (TRAG-XXXXXX).
    """
    nombre_up = normalize_upper(rama_in.nombre) or ""
    exists = (
        db.query(models.TipoRamasGasto)
        .filter(models.TipoRamasGasto.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe esa rama de gasto.",
        )

    new_id = generate_tipo_rama_gasto_id(db)

    obj = models.TipoRamasGasto(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/gastos/{rama_id}",
    response_model=TipoRamaGastoRead,
    summary="Actualizar una rama de gasto",
)
def update_rama_gasto(
    rama_id: str,
    rama_in: TipoRamaGastoUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza una rama de gasto.

    - Si no existe → 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    """
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama gasto no encontrada.",
        )

    data = rama_in.model_dump(exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/gastos/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de gasto",
)
def delete_rama_gasto(
    rama_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina una rama de gasto.

    - Si no existe → 404.
    - Si hay tipos de gasto asociados, la BD puede impedir el borrado.
    """
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama gasto no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None
