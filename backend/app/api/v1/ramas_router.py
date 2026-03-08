# backend/app/api/v1/ramas_router.py

"""
API v1 - RAMAS
- TipoRamasIngreso
- TipoRamasGasto
- TipoRamasProveedores

Mantiene:
- Endpoints y patrón CRUD por tipo de rama.
- Reglas:
    * NOMBRE siempre en MAYÚSCULAS (strip + upper).
    * No se permiten duplicados por NOMBRE al crear.
    * 404 si la rama no existe al actualizar/borrar.

Mejoras v3:
- Uso de schemas separados (ramas.py).
- IDs generados en backend.
- Normalización de texto centralizada con normalize_upper().
- Se añade soporte completo para ramas de ingresos.

Nota funcional:
- Las ramas de ingresos se usarán en UI como primer selector:
    1) el usuario elige una rama
    2) después se muestran los tipos de ingreso asociados a esa rama
"""

from __future__ import annotations

from typing import List, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.ramas import (
    TipoRamaIngresoCreate,
    TipoRamaIngresoUpdate,
    TipoRamaIngresoRead,
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
    generate_tipo_rama_ingreso_id,
)

router = APIRouter(
    prefix="/ramas",
    tags=["ramas"],
)


# ============================================================
# Helpers
# ============================================================

def _to_dict(model: Any, *, exclude_unset: bool = False) -> dict:
    """
    Compatibilidad Pydantic v1/v2.
    """
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def _ensure_unique_nombre_on_create(db: Session, orm_model: Any, nombre_up: str, detail: str) -> None:
    """
    Valida que no exista ya una rama con el mismo nombre al crear.
    """
    exists = db.query(orm_model).filter(orm_model.nombre == nombre_up).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


def _ensure_unique_nombre_on_update(
    db: Session,
    orm_model: Any,
    *,
    current_id: str,
    nombre_up: str,
    detail: str,
) -> None:
    """
    Valida que al renombrar no se duplique el nombre con otro registro distinto.
    """
    exists = (
        db.query(orm_model)
        .filter(
            orm_model.nombre == nombre_up,
            orm_model.id != current_id,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


# ============================================================
# RAMAS DE INGRESOS
# ============================================================

@router.get(
    "/ingresos",
    response_model=List[TipoRamaIngresoRead],
    summary="Listar ramas de ingresos",
)
def list_ramas_ingreso(
    db: Session = Depends(get_db),
):
    """
    Devuelve todas las ramas de ingreso ordenadas por nombre.

    Estas ramas alimentan el primer nivel de selección del formulario de ingresos.
    """
    return (
        db.query(models.TipoRamasIngreso)
        .order_by(models.TipoRamasIngreso.nombre.asc())
        .all()
    )


@router.post(
    "/ingresos",
    response_model=TipoRamaIngresoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una rama de ingreso",
)
def create_rama_ingreso(
    rama_in: TipoRamaIngresoCreate,
    db: Session = Depends(get_db),
):
    """
    Crea una nueva rama de ingreso.

    Reglas:
    - NOMBRE se guarda en MAYÚSCULAS.
    - No se puede repetir NOMBRE.
    - El ID no lo envía el cliente.

    Nota:
    - Para ingresos iniciales ya tienes IDs funcionales cargados por SQL.
    - Aquí generamos un ID simple y coherente para altas nuevas.
    """
    nombre_up = normalize_upper(rama_in.nombre) or ""

    _ensure_unique_nombre_on_create(
        db,
        models.TipoRamasIngreso,
        nombre_up,
        "Ya existe esa rama de ingreso.",
    )

    # Prefijo coherente con el nuevo dominio.
    # Se mantiene estilo parecido al resto, aunque el formato histórico
    # de los datos semilla sea diferente.
    new_id = generate_tipo_rama_ingreso_id(db)

    obj = models.TipoRamasIngreso(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/ingresos/{rama_id}",
    response_model=TipoRamaIngresoRead,
    summary="Actualizar una rama de ingreso",
)
def update_rama_ingreso(
    rama_id: str,
    rama_in: TipoRamaIngresoUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza una rama de ingreso.

    Reglas:
    - Si no existe -> 404.
    - Si se envía nombre, se normaliza a MAYÚSCULAS.
    - No se permite renombrar a un nombre ya existente.
    """
    obj = db.get(models.TipoRamasIngreso, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama ingreso no encontrada.",
        )

    data = _to_dict(rama_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

        _ensure_unique_nombre_on_update(
            db,
            models.TipoRamasIngreso,
            current_id=rama_id,
            nombre_up=data["nombre"],
            detail="Ya existe otra rama de ingreso con ese nombre.",
        )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/ingresos/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de ingreso",
)
def delete_rama_ingreso(
    rama_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina una rama de ingreso.

    Reglas:
    - Si no existe -> 404.
    - Si hay tipos de ingreso o ingresos asociados, la BD puede impedir el borrado.
    """
    obj = db.get(models.TipoRamasIngreso, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama ingreso no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None


# ============================================================
# RAMAS DE PROVEEDORES
# ============================================================

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

    _ensure_unique_nombre_on_create(
        db,
        models.TipoRamasProveedores,
        nombre_up,
        "Ya existe esa rama de proveedor.",
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

    Reglas:
    - Si no existe -> 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - No se permite duplicar el nombre con otra rama.
    """
    obj = db.get(models.TipoRamasProveedores, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama proveedor no encontrada.",
        )

    data = _to_dict(rama_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

        _ensure_unique_nombre_on_update(
            db,
            models.TipoRamasProveedores,
            current_id=rama_id,
            nombre_up=data["nombre"],
            detail="Ya existe otra rama de proveedor con ese nombre.",
        )

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

    Reglas:
    - Si no existe -> 404.
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


# ============================================================
# RAMAS DE GASTOS
# ============================================================

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

    _ensure_unique_nombre_on_create(
        db,
        models.TipoRamasGasto,
        nombre_up,
        "Ya existe esa rama de gasto.",
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

    Reglas:
    - Si no existe -> 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - No se permite duplicar el nombre con otra rama.
    """
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama gasto no encontrada.",
        )

    data = _to_dict(rama_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

        _ensure_unique_nombre_on_update(
            db,
            models.TipoRamasGasto,
            current_id=rama_id,
            nombre_up=data["nombre"],
            detail="Ya existe otra rama de gasto con ese nombre.",
        )

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

    Reglas:
    - Si no existe -> 404.
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