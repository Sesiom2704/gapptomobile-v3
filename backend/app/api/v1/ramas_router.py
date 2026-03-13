"""
Ruta: backend/app/api/v1/ramas_router.py
Versión: 2.1.0
Descripción:
API v1 - RAMAS
- TipoRamasIngreso
- TipoRamasGasto
- TipoRamasProveedores

Responsabilidades:
- CRUD de ramas auxiliares.
- Normalización de nombres a MAYÚSCULAS.
- Validación de duplicados en create/update.
- Exposición de contadores reales de registros asociados.

Cambios de esta versión:
- Se añade `associated_count` y `relation_counts` en:
    * ramas de ingreso
    * ramas de gasto
    * ramas de proveedores
- `relation_counts` solo incluye relaciones con count > 0.
"""

from __future__ import annotations

from typing import List, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

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
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def _ensure_unique_nombre_on_create(db: Session, orm_model: Any, nombre_up: str, detail: str) -> None:
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


def _build_count_map(query_rows: list[tuple[str, int]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for fk_id, qty in query_rows:
        key = str(fk_id or "").strip()
        if not key:
            continue
        out[key] = int(qty or 0)
    return out


def _sum_maps(*maps: Dict[str, int]) -> Dict[str, int]:
    merged: Dict[str, int] = {}
    for mp in maps:
        for key, value in mp.items():
            merged[key] = merged.get(key, 0) + int(value or 0)
    return merged


def _make_relation_counts(defs: list[tuple[str, str, Dict[str, int]]], entity_id: str) -> list[dict]:
    rows: list[dict] = []
    for key, label, mp in defs:
        count = int(mp.get(entity_id, 0))
        if count > 0:
            rows.append({
                "key": key,
                "label": label,
                "count": count,
            })
    return rows


def _serialize_rama_ingreso(
    obj: models.TipoRamasIngreso,
    associated_count: int,
    relation_counts: list[dict] | None = None,
) -> dict:
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "associated_count": int(associated_count or 0),
        "relation_counts": relation_counts or [],
    }


def _serialize_rama_gasto(
    obj: models.TipoRamasGasto,
    associated_count: int,
    relation_counts: list[dict] | None = None,
) -> dict:
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "associated_count": int(associated_count or 0),
        "relation_counts": relation_counts or [],
    }


def _serialize_rama_proveedor(
    obj: models.TipoRamasProveedores,
    associated_count: int,
    relation_counts: list[dict] | None = None,
) -> dict:
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "associated_count": int(associated_count or 0),
        "relation_counts": relation_counts or [],
    }


# ============================================================
# Count maps por dominio
# ============================================================

def _get_ramas_ingreso_relation_maps(db: Session) -> dict[str, Dict[str, int]]:
    tipos_rows = (
        db.query(models.TipoIngreso.rama_id, func.count(models.TipoIngreso.id))
        .filter(models.TipoIngreso.rama_id.isnot(None))
        .group_by(models.TipoIngreso.rama_id)
        .all()
    )

    ingresos_rows = (
        db.query(models.Ingreso.rama_id, func.count(models.Ingreso.id))
        .filter(models.Ingreso.rama_id.isnot(None))
        .group_by(models.Ingreso.rama_id)
        .all()
    )

    return {
        "tipos_ingreso": _build_count_map(tipos_rows),
        "ingresos": _build_count_map(ingresos_rows),
    }


def _get_ramas_gasto_relation_maps(db: Session) -> dict[str, Dict[str, int]]:
    tipos_rows = (
        db.query(models.TipoGasto.rama_id, func.count(models.TipoGasto.id))
        .filter(models.TipoGasto.rama_id.isnot(None))
        .group_by(models.TipoGasto.rama_id)
        .all()
    )

    gastos_rows = (
        db.query(models.TipoGasto.rama_id, func.count(models.Gasto.id))
        .join(models.Gasto, models.Gasto.tipo_id == models.TipoGasto.id)
        .filter(models.TipoGasto.rama_id.isnot(None))
        .group_by(models.TipoGasto.rama_id)
        .all()
    )

    cotidianos_rows = (
        db.query(models.TipoGasto.rama_id, func.count(models.GastoCotidiano.id))
        .join(models.GastoCotidiano, models.GastoCotidiano.tipo_id == models.TipoGasto.id)
        .filter(models.TipoGasto.rama_id.isnot(None))
        .group_by(models.TipoGasto.rama_id)
        .all()
    )

    inversiones_rows = (
        db.query(models.TipoGasto.rama_id, func.count(models.Inversion.id))
        .join(models.Inversion, models.Inversion.tipo_gasto_id == models.TipoGasto.id)
        .filter(models.TipoGasto.rama_id.isnot(None))
        .group_by(models.TipoGasto.rama_id)
        .all()
    )

    return {
        "tipos_gasto": _build_count_map(tipos_rows),
        "gastos": _build_count_map(gastos_rows),
        "gastos_cotidianos": _build_count_map(cotidianos_rows),
        "inversiones": _build_count_map(inversiones_rows),
    }


def _get_ramas_proveedor_relation_maps(db: Session) -> dict[str, Dict[str, int]]:
    proveedores_rows = (
        db.query(models.Proveedor.rama_id, func.count(models.Proveedor.id))
        .filter(models.Proveedor.rama_id.isnot(None))
        .group_by(models.Proveedor.rama_id)
        .all()
    )

    subsegmentos_rows = (
        db.query(models.TipoSubsegmentoProveedor.rama_id, func.count(models.TipoSubsegmentoProveedor.id))
        .filter(models.TipoSubsegmentoProveedor.rama_id.isnot(None))
        .group_by(models.TipoSubsegmentoProveedor.rama_id)
        .all()
    )

    cuentas_rows = (
        db.query(models.Proveedor.rama_id, func.count(models.CuentaBancaria.id))
        .join(models.CuentaBancaria, models.CuentaBancaria.banco_id == models.Proveedor.id)
        .filter(models.Proveedor.rama_id.isnot(None))
        .group_by(models.Proveedor.rama_id)
        .all()
    )

    return {
        "proveedores": _build_count_map(proveedores_rows),
        "subsegmentos": _build_count_map(subsegmentos_rows),
        "cuentas_bancarias": _build_count_map(cuentas_rows),
    }


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
    items = (
        db.query(models.TipoRamasIngreso)
        .order_by(models.TipoRamasIngreso.nombre.asc())
        .all()
    )

    relation_maps = _get_ramas_ingreso_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())

    relation_defs = [
        ("tipos_ingreso", "Tipos de ingreso", relation_maps["tipos_ingreso"]),
        ("ingresos", "Ingresos", relation_maps["ingresos"]),
    ]

    return [
        _serialize_rama_ingreso(
            item,
            total_map.get(item.id, 0),
            _make_relation_counts(relation_defs, item.id),
        )
        for item in items
    ]


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
    nombre_up = normalize_upper(rama_in.nombre) or ""

    _ensure_unique_nombre_on_create(
        db,
        models.TipoRamasIngreso,
        nombre_up,
        "Ya existe esa rama de ingreso.",
    )

    new_id = generate_tipo_rama_ingreso_id(db)

    obj = models.TipoRamasIngreso(
        id=new_id,
        nombre=nombre_up,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_rama_ingreso(obj, 0, [])


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

    relation_maps = _get_ramas_ingreso_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())
    relation_defs = [
        ("tipos_ingreso", "Tipos de ingreso", relation_maps["tipos_ingreso"]),
        ("ingresos", "Ingresos", relation_maps["ingresos"]),
    ]

    return _serialize_rama_ingreso(
        obj,
        total_map.get(obj.id, 0),
        _make_relation_counts(relation_defs, obj.id),
    )


@router.delete(
    "/ingresos/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de ingreso",
)
def delete_rama_ingreso(
    rama_id: str,
    db: Session = Depends(get_db),
):
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
    items = (
        db.query(models.TipoRamasProveedores)
        .order_by(models.TipoRamasProveedores.nombre.asc())
        .all()
    )

    relation_maps = _get_ramas_proveedor_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())

    relation_defs = [
        ("proveedores", "Proveedores", relation_maps["proveedores"]),
        ("subsegmentos", "Subsegmentos de proveedor", relation_maps["subsegmentos"]),
        ("cuentas_bancarias", "Cuentas bancarias", relation_maps["cuentas_bancarias"]),
    ]

    return [
        _serialize_rama_proveedor(
            item,
            total_map.get(item.id, 0),
            _make_relation_counts(relation_defs, item.id),
        )
        for item in items
    ]


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
    return _serialize_rama_proveedor(obj, 0, [])


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

    relation_maps = _get_ramas_proveedor_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())
    relation_defs = [
        ("proveedores", "Proveedores", relation_maps["proveedores"]),
        ("subsegmentos", "Subsegmentos de proveedor", relation_maps["subsegmentos"]),
        ("cuentas_bancarias", "Cuentas bancarias", relation_maps["cuentas_bancarias"]),
    ]

    return _serialize_rama_proveedor(
        obj,
        total_map.get(obj.id, 0),
        _make_relation_counts(relation_defs, obj.id),
    )


@router.delete(
    "/proveedores/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de proveedor",
)
def delete_rama_proveedor(
    rama_id: str,
    db: Session = Depends(get_db),
):
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
    items = (
        db.query(models.TipoRamasGasto)
        .order_by(models.TipoRamasGasto.nombre.asc())
        .all()
    )

    relation_maps = _get_ramas_gasto_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())

    relation_defs = [
        ("tipos_gasto", "Tipos de gasto", relation_maps["tipos_gasto"]),
        ("gastos", "Gastos", relation_maps["gastos"]),
        ("gastos_cotidianos", "Gastos cotidianos", relation_maps["gastos_cotidianos"]),
        ("inversiones", "Inversiones", relation_maps["inversiones"]),
    ]

    return [
        _serialize_rama_gasto(
            item,
            total_map.get(item.id, 0),
            _make_relation_counts(relation_defs, item.id),
        )
        for item in items
    ]


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
    return _serialize_rama_gasto(obj, 0, [])


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

    relation_maps = _get_ramas_gasto_relation_maps(db)
    total_map = _sum_maps(*relation_maps.values())
    relation_defs = [
        ("tipos_gasto", "Tipos de gasto", relation_maps["tipos_gasto"]),
        ("gastos", "Gastos", relation_maps["gastos"]),
        ("gastos_cotidianos", "Gastos cotidianos", relation_maps["gastos_cotidianos"]),
        ("inversiones", "Inversiones", relation_maps["inversiones"]),
    ]

    return _serialize_rama_gasto(
        obj,
        total_map.get(obj.id, 0),
        _make_relation_counts(relation_defs, obj.id),
    )


@router.delete(
    "/gastos/{rama_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una rama de gasto",
)
def delete_rama_gasto(
    rama_id: str,
    db: Session = Depends(get_db),
):
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rama gasto no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None