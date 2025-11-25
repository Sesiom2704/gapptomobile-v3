# backend/app/api/v1/tipos_router.py

"""
API v1 - TIPOS (TipoGasto, TipoIngreso, TipoSegmentoGasto)

Basado en la lógica de la v2 (backend/routers/tipos.py), manteniendo:

- NOMBRE siempre en MAYÚSCULAS.
- Unicidad por NOMBRE en creación.
- CRUD simple para cada entidad.

Además:
- IDs generados en backend (TGAS-/TING-/TSEG-).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.tipos import (
    TipoGastoCreate,
    TipoGastoUpdate,
    TipoGastoRead,
    TipoIngresoCreate,
    TipoIngresoUpdate,
    TipoIngresoRead,
    TipoSegmentoGastoCreate,
    TipoSegmentoGastoUpdate,
    TipoSegmentoGastoRead,
)
from backend.app.utils.text_utils import normalize_upper
from backend.app.utils.id_utils import (
    generate_tipo_gasto_id,
    generate_tipo_ingreso_id,
    generate_tipo_segmento_gasto_id,
)

router = APIRouter(
    prefix="/tipos",
    tags=["tipos"],
)

# ==========================
# CRUD TipoGasto
# ==========================

@router.get(
    "/gastos",
    response_model=List[TipoGastoRead],
    summary="Listar tipos de gasto",
)
def list_tipos_gasto(
    segmento_id: Optional[str] = Query(
        None,
        description="Si se indica, filtra por segmento_id.",
    ),
    db: Session = Depends(get_db),
):
    """
    Lista de tipos de gasto.

    - Si se pasa `segmento_id`, filtra por ese segmento.
    - Devuelve todos los tipos de gasto que cumplen la condición.
    """
    q = db.query(models.TipoGasto)
    if segmento_id:
        q = q.filter(models.TipoGasto.segmento_id == segmento_id)
    return q.all()


@router.post(
    "/gastos",
    response_model=TipoGastoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un tipo de gasto",
)
def create_tipo_gasto(
    tipo_in: TipoGastoCreate,
    db: Session = Depends(get_db),
):
    """
    Crea un nuevo TipoGasto.

    Reglas:
    - NOMBRE se guarda en MAYÚSCULAS.
    - No se permite duplicar NOMBRE (unicidad por nombre).
    - El ID se genera en el backend con formato TGAS-XXXXXX.
    """
    nombre_up = normalize_upper(tipo_in.nombre) or ""
    exists = (
        db.query(models.TipoGasto)
        .filter(models.TipoGasto.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe ese tipo de gasto.",
        )

    new_id = generate_tipo_gasto_id(db)

    obj = models.TipoGasto(
        id=new_id,
        nombre=nombre_up,
        rama_id=tipo_in.rama_id,
        segmento_id=tipo_in.segmento_id,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/gastos/{tipo_id}",
    response_model=TipoGastoRead,
    summary="Actualizar un tipo de gasto",
)
def update_tipo_gasto(
    tipo_id: str,
    tipo_in: TipoGastoUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza un TipoGasto existente.

    - Si no existe → 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - Se actualizan solo los campos enviados.
    """
    obj = db.get(models.TipoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo gasto no encontrado.",
        )

    data = tipo_in.model_dump(exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/gastos/{tipo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un tipo de gasto",
)
def delete_tipo_gasto(
    tipo_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina un TipoGasto por ID.

    - Si no existe → 404.
    - Si está referenciado por gastos, la BD puede impedir el borrado.
    """
    obj = db.get(models.TipoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo gasto no encontrado.",
        )

    db.delete(obj)
    db.commit()
    return None


# ==========================
# CRUD TipoIngreso
# ==========================

@router.get(
    "/ingresos",
    response_model=List[TipoIngresoRead],
    summary="Listar tipos de ingreso",
)
def list_tipos_ingreso(
    db: Session = Depends(get_db),
):
    """
    Devuelve la lista completa de tipos de ingreso.
    """
    return db.query(models.TipoIngreso).all()


@router.post(
    "/ingresos",
    response_model=TipoIngresoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un tipo de ingreso",
)
def create_tipo_ingreso(
    tipo_in: TipoIngresoCreate,
    db: Session = Depends(get_db),
):
    """
    Crea un nuevo TipoIngreso.

    Reglas:
    - NOMBRE en MAYÚSCULAS.
    - Unicidad por NOMBRE.
    - ID generado en backend (TING-XXXXXX).
    """
    nombre_up = normalize_upper(tipo_in.nombre) or ""
    exists = (
        db.query(models.TipoIngreso)
        .filter(models.TipoIngreso.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe ese tipo de ingreso.",
        )

    new_id = generate_tipo_ingreso_id(db)

    obj = models.TipoIngreso(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/ingresos/{tipo_id}",
    response_model=TipoIngresoRead,
    summary="Actualizar un tipo de ingreso",
)
def update_tipo_ingreso(
    tipo_id: str,
    tipo_in: TipoIngresoUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza un tipo de ingreso existente.

    - Si no existe → 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    """
    obj = db.get(models.TipoIngreso, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo ingreso no encontrado.",
        )

    data = tipo_in.model_dump(exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/ingresos/{tipo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un tipo de ingreso",
)
def delete_tipo_ingreso(
    tipo_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina un TipoIngreso por ID.

    - Si no existe → 404.
    """
    obj = db.get(models.TipoIngreso, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo ingreso no encontrado.",
        )

    db.delete(obj)
    db.commit()
    return None


# ==========================
# CRUD TipoSegmentoGasto
# ==========================

@router.get(
    "/segmentos",
    response_model=List[TipoSegmentoGastoRead],
    summary="Listar segmentos de gasto",
)
def list_tipos_segmento(
    db: Session = Depends(get_db),
):
    """
    Devuelve la lista completa de segmentos de gasto.
    """
    return db.query(models.TipoSegmentoGasto).all()


@router.post(
    "/segmentos",
    response_model=TipoSegmentoGastoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un segmento de gasto",
)
def create_tipo_segmento(
    tipo_in: TipoSegmentoGastoCreate,
    db: Session = Depends(get_db),
):
    """
    Crea un nuevo segmento de gasto.

    Reglas:
    - NOMBRE en MAYÚSCULAS.
    - Unicidad por NOMBRE.
    - ID generado en backend (TSEG-XXXXXX).
    """
    nombre_up = normalize_upper(tipo_in.nombre) or ""
    exists = (
        db.query(models.TipoSegmentoGasto)
        .filter(models.TipoSegmentoGasto.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe ese segmento de gasto.",
        )

    new_id = generate_tipo_segmento_gasto_id(db)

    obj = models.TipoSegmentoGasto(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put(
    "/segmentos/{tipo_id}",
    response_model=TipoSegmentoGastoRead,
    summary="Actualizar un segmento de gasto",
)
def update_tipo_segmento(
    tipo_id: str,
    tipo_in: TipoSegmentoGastoUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza un segmento de gasto existente.

    - Si no existe → 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    """
    obj = db.get(models.TipoSegmentoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Segmento no encontrado.",
        )

    data = tipo_in.model_dump(exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/segmentos/{tipo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un segmento de gasto",
)
def delete_tipo_segmento(
    tipo_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina un segmento de gasto por ID.

    - Si no existe → 404.
    """
    obj = db.get(models.TipoSegmentoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Segmento no encontrado.",
        )

    db.delete(obj)
    db.commit()
    return None
