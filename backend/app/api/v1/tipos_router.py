"""
Ruta: backend/app/api/v1/tipos_router.py
Versión: 2.1.0
Descripción:
API v1 - TIPOS
- TipoGasto
- TipoIngreso
- TipoSegmentoGasto

Responsabilidades:
- CRUD de tipos auxiliares.
- Normalización de nombres a MAYÚSCULAS.
- Validación de duplicados en create/update.
- Exposición de contadores reales de registros asociados.
- Exposición de detalle por tabla relacionada (`relation_counts`).

Cambios de esta versión:
- Se añade `associated_count` y `relation_counts` en listados y responses de:
    * TipoGasto
    * TipoIngreso
    * TipoSegmentoGasto
- `relation_counts` solo incluye tablas con count > 0.
- Los contadores se calculan desde relaciones reales del dominio:
    * TipoGasto: gastos + gastos_cotidianos + inversiones
    * TipoIngreso: ingresos
    * TipoSegmentoGasto: gastos
"""

from __future__ import annotations

from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

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


def _ensure_unique_nombre_on_create(
    db: Session,
    orm_model: Any,
    nombre_up: str,
    detail: str,
) -> None:
    """
    Valida que no exista ya otro registro con el mismo nombre.
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


def _get_rama_ingreso_or_404(db: Session, rama_id: str) -> models.TipoRamasIngreso:
    """
    Comprueba que la rama de ingreso exista.
    """
    obj = (
        db.query(models.TipoRamasIngreso)
        .filter(models.TipoRamasIngreso.id == rama_id)
        .first()
    )
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama de ingreso no encontrada.",
        )
    return obj


def _build_count_map(query_rows: list[tuple[str, int]]) -> Dict[str, int]:
    """
    Convierte filas agregadas SQL [(fk_id, count), ...] a dict.
    """
    out: Dict[str, int] = {}
    for fk_id, qty in query_rows:
        key = str(fk_id or "").strip()
        if not key:
            continue
        out[key] = int(qty or 0)
    return out


def _merge_count_maps(*maps: Dict[str, int]) -> Dict[str, int]:
    """
    Suma múltiples mapas de contadores por la misma clave.
    """
    merged: Dict[str, int] = {}

    for mp in maps:
        for key, value in mp.items():
            merged[key] = merged.get(key, 0) + int(value or 0)

    return merged


def _build_relation_counts(items: list[tuple[str, str, int]]) -> list[dict]:
    """
    Construye relation_counts filtrando counts en 0.
    """
    out: list[dict] = []
    for key, label, count in items:
        qty = int(count or 0)
        if qty <= 0:
            continue
        out.append(
            {
                "key": key,
                "label": label,
                "count": qty,
            }
        )
    return out


def _serialize_tipo_gasto(
    item: models.TipoGasto,
    *,
    gastos_count: int = 0,
    cotidianos_count: int = 0,
    inversiones_count: int = 0,
) -> dict:
    relation_counts = _build_relation_counts(
        [
            ("gastos", "Gastos", gastos_count),
            ("gastos_cotidianos", "Gastos cotidianos", cotidianos_count),
            ("inversiones", "Inversiones", inversiones_count),
        ]
    )

    associated_count = sum(x["count"] for x in relation_counts)

    return {
        "id": item.id,
        "nombre": item.nombre,
        "rama_id": item.rama_id,
        "segmento_id": item.segmento_id,
        "associated_count": associated_count,
        "relation_counts": relation_counts,
    }


def _serialize_tipo_ingreso(
    item: models.TipoIngreso,
    *,
    ingresos_count: int = 0,
) -> dict:
    relation_counts = _build_relation_counts(
        [
            ("ingresos", "Ingresos", ingresos_count),
        ]
    )

    associated_count = sum(x["count"] for x in relation_counts)

    return {
        "id": item.id,
        "nombre": item.nombre,
        "rama_id": item.rama_id,
        "associated_count": associated_count,
        "relation_counts": relation_counts,
    }


def _serialize_tipo_segmento(
    item: models.TipoSegmentoGasto,
    *,
    gastos_count: int = 0,
) -> dict:
    relation_counts = _build_relation_counts(
        [
            ("gastos", "Gastos", gastos_count),
        ]
    )

    associated_count = sum(x["count"] for x in relation_counts)

    return {
        "id": item.id,
        "nombre": item.nombre,
        "associated_count": associated_count,
        "relation_counts": relation_counts,
    }


def _get_tipo_gasto_relation_maps(db: Session) -> Dict[str, Dict[str, int]]:
    """
    Cuenta referencias reales por tipo de gasto:
    - gastos
    - gastos_cotidianos
    - inversiones
    """
    gastos_rows = (
        db.query(models.Gasto.tipo_id, func.count(models.Gasto.id))
        .filter(models.Gasto.tipo_id.isnot(None))
        .group_by(models.Gasto.tipo_id)
        .all()
    )

    cotidianos_rows = (
        db.query(models.GastoCotidiano.tipo_id, func.count(models.GastoCotidiano.id))
        .filter(models.GastoCotidiano.tipo_id.isnot(None))
        .group_by(models.GastoCotidiano.tipo_id)
        .all()
    )

    inversiones_rows = (
        db.query(models.Inversion.tipo_gasto_id, func.count(models.Inversion.id))
        .filter(models.Inversion.tipo_gasto_id.isnot(None))
        .group_by(models.Inversion.tipo_gasto_id)
        .all()
    )

    return {
        "gastos": _build_count_map(gastos_rows),
        "gastos_cotidianos": _build_count_map(cotidianos_rows),
        "inversiones": _build_count_map(inversiones_rows),
    }


def _get_tipo_ingreso_relation_maps(db: Session) -> Dict[str, Dict[str, int]]:
    """
    Cuenta referencias reales por tipo de ingreso:
    - ingresos
    """
    rows = (
        db.query(models.Ingreso.tipo_id, func.count(models.Ingreso.id))
        .filter(models.Ingreso.tipo_id.isnot(None))
        .group_by(models.Ingreso.tipo_id)
        .all()
    )

    return {
        "ingresos": _build_count_map(rows),
    }


def _get_segmento_gasto_relation_maps(db: Session) -> Dict[str, Dict[str, int]]:
    """
    Cuenta referencias reales por segmento de gasto:
    - gastos
    """
    rows = (
        db.query(models.Gasto.segmento_id, func.count(models.Gasto.id))
        .filter(models.Gasto.segmento_id.isnot(None))
        .group_by(models.Gasto.segmento_id)
        .all()
    )

    return {
        "gastos": _build_count_map(rows),
    }


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
    rama_id: Optional[str] = Query(
        None,
        description="Si se indica, filtra por rama_id.",
    ),
    db: Session = Depends(get_db),
):
    """
    Lista tipos de gasto.

    Filtros opcionales:
    - segmento_id
    - rama_id

    Incluye:
    - associated_count
    - relation_counts
    """
    q = db.query(models.TipoGasto)

    if segmento_id:
        q = q.filter(models.TipoGasto.segmento_id == normalize_upper(segmento_id))

    if rama_id:
        q = q.filter(models.TipoGasto.rama_id == normalize_upper(rama_id))

    items = q.order_by(models.TipoGasto.nombre.asc()).all()
    relation_maps = _get_tipo_gasto_relation_maps(db)

    return [
        _serialize_tipo_gasto(
            item,
            gastos_count=relation_maps["gastos"].get(item.id, 0),
            cotidianos_count=relation_maps["gastos_cotidianos"].get(item.id, 0),
            inversiones_count=relation_maps["inversiones"].get(item.id, 0),
        )
        for item in items
    ]


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
    - No se permite duplicar NOMBRE.
    - El ID se genera en backend con formato TGAS-XXXXXX.
    """
    nombre_up = normalize_upper(tipo_in.nombre) or ""

    _ensure_unique_nombre_on_create(
        db,
        models.TipoGasto,
        nombre_up,
        "Ya existe ese tipo de gasto.",
    )

    new_id = generate_tipo_gasto_id(db)

    obj = models.TipoGasto(
        id=new_id,
        nombre=nombre_up,
        rama_id=normalize_upper(tipo_in.rama_id) if getattr(tipo_in, "rama_id", None) else None,
        segmento_id=normalize_upper(tipo_in.segmento_id) if getattr(tipo_in, "segmento_id", None) else None,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_tipo_gasto(obj)


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

    Reglas:
    - Si no existe -> 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - Se actualizan solo los campos enviados.
    - No se permite renombrar a un nombre ya existente.
    """
    obj = db.get(models.TipoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo gasto no encontrado.",
        )

    data = _to_dict(tipo_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])
        _ensure_unique_nombre_on_update(
            db,
            models.TipoGasto,
            current_id=tipo_id,
            nombre_up=data["nombre"],
            detail="Ya existe otro tipo de gasto con ese nombre.",
        )

    if "rama_id" in data and data["rama_id"] is not None:
        data["rama_id"] = normalize_upper(data["rama_id"])

    if "segmento_id" in data and data["segmento_id"] is not None:
        data["segmento_id"] = normalize_upper(data["segmento_id"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)

    relation_maps = _get_tipo_gasto_relation_maps(db)
    return _serialize_tipo_gasto(
        obj,
        gastos_count=relation_maps["gastos"].get(obj.id, 0),
        cotidianos_count=relation_maps["gastos_cotidianos"].get(obj.id, 0),
        inversiones_count=relation_maps["inversiones"].get(obj.id, 0),
    )


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

    - Si no existe -> 404.
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
    rama_id: Optional[str] = Query(
        None,
        description="Si se indica, filtra por rama_id.",
    ),
    db: Session = Depends(get_db),
):
    """
    Devuelve la lista de tipos de ingreso.

    Comportamiento:
    - Si se informa rama_id, devuelve solo los tipos asociados a esa rama.

    Incluye:
    - associated_count
    - relation_counts
    """
    q = db.query(models.TipoIngreso)

    if rama_id:
        rama_id = normalize_upper(rama_id)
        q = q.filter(models.TipoIngreso.rama_id == rama_id)

    items = q.order_by(models.TipoIngreso.nombre.asc()).all()
    relation_maps = _get_tipo_ingreso_relation_maps(db)

    return [
        _serialize_tipo_ingreso(
            item,
            ingresos_count=relation_maps["ingresos"].get(item.id, 0),
        )
        for item in items
    ]


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
    - rama_id es obligatoria funcionalmente.
    - La rama debe existir.
    - ID generado en backend (TING-XXXXXX).
    """
    nombre_up = normalize_upper(tipo_in.nombre) or ""
    rama_id_up = normalize_upper(getattr(tipo_in, "rama_id", None))

    if not rama_id_up:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="rama_id es obligatorio para crear un tipo de ingreso.",
        )

    _get_rama_ingreso_or_404(db, rama_id_up)

    _ensure_unique_nombre_on_create(
        db,
        models.TipoIngreso,
        nombre_up,
        "Ya existe ese tipo de ingreso.",
    )

    new_id = generate_tipo_ingreso_id(db)

    obj = models.TipoIngreso(
        id=new_id,
        nombre=nombre_up,
        rama_id=rama_id_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_tipo_ingreso(obj)


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

    Reglas:
    - Si no existe -> 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - Si se envía rama_id, la rama debe existir.
    - No se permite renombrar a un nombre ya existente.
    """
    obj = db.get(models.TipoIngreso, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo ingreso no encontrado.",
        )

    data = _to_dict(tipo_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])
        _ensure_unique_nombre_on_update(
            db,
            models.TipoIngreso,
            current_id=tipo_id,
            nombre_up=data["nombre"],
            detail="Ya existe otro tipo de ingreso con ese nombre.",
        )

    if "rama_id" in data and data["rama_id"] is not None:
        data["rama_id"] = normalize_upper(data["rama_id"])
        _get_rama_ingreso_or_404(db, data["rama_id"])

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)

    relation_maps = _get_tipo_ingreso_relation_maps(db)
    return _serialize_tipo_ingreso(
        obj,
        ingresos_count=relation_maps["ingresos"].get(obj.id, 0),
    )


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

    - Si no existe -> 404.
    - Si está referenciado por ingresos, la BD puede impedir el borrado.
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

    Incluye:
    - associated_count
    - relation_counts
    """
    items = (
        db.query(models.TipoSegmentoGasto)
        .order_by(models.TipoSegmentoGasto.nombre.asc())
        .all()
    )
    relation_maps = _get_segmento_gasto_relation_maps(db)

    return [
        _serialize_tipo_segmento(
            item,
            gastos_count=relation_maps["gastos"].get(item.id, 0),
        )
        for item in items
    ]


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

    _ensure_unique_nombre_on_create(
        db,
        models.TipoSegmentoGasto,
        nombre_up,
        "Ya existe ese segmento de gasto.",
    )

    new_id = generate_tipo_segmento_gasto_id(db)

    obj = models.TipoSegmentoGasto(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_tipo_segmento(obj)


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

    Reglas:
    - Si no existe -> 404.
    - NOMBRE se normaliza a MAYÚSCULAS si se envía.
    - No se permite renombrar a un nombre ya existente.
    """
    obj = db.get(models.TipoSegmentoGasto, tipo_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Segmento no encontrado.",
        )

    data = _to_dict(tipo_in, exclude_unset=True)

    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])
        _ensure_unique_nombre_on_update(
            db,
            models.TipoSegmentoGasto,
            current_id=tipo_id,
            nombre_up=data["nombre"],
            detail="Ya existe otro segmento de gasto con ese nombre.",
        )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)

    relation_maps = _get_segmento_gasto_relation_maps(db)
    return _serialize_tipo_segmento(
        obj,
        gastos_count=relation_maps["gastos"].get(obj.id, 0),
    )


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

    - Si no existe -> 404.
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