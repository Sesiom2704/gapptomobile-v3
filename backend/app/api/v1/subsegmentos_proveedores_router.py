"""
Ruta: backend/app/api/v1/subsegmentos_proveedores_router.py
Versión: 2.0.0
Descripción:
Router CRUD para la tabla auxiliar `tipo_subsegmentos_proveedores`.

Objetivos:
- Gestionar el catálogo de subsegmentos de proveedores.
- Permitir relación opcional con `tipo_ramas_proveedores`.
- Impedir borrado si existen proveedores asociados.
- Mantener estilo homogéneo con el resto de auxiliares:
    * nombre normalizado a MAYÚSCULAS
    * ids generados en backend
    * validación de unicidad por (nombre, rama_id)
    * schemas Pydantic explícitos
- Exponer contador real de proveedores asociados.
"""

from __future__ import annotations

from typing import List, Optional, Dict
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.ramas import (
    TipoSubsegmentoProveedorCreate,
    TipoSubsegmentoProveedorRead,
    TipoSubsegmentoProveedorUpdate,
)
from backend.app.utils.text_utils import normalize_upper


router = APIRouter(
    prefix="/subsegmentos/proveedores",
    tags=["subsegmentos_proveedores"],
)


# ============================================================
# Helpers
# ============================================================

def _generate_subsegmento_proveedor_id() -> str:
    """
    Genera un ID técnico para subsegmento de proveedor.
    """
    return "TSPR-" + uuid4().hex[:10].upper()


def _get_model_cls():
    """
    Obtiene el modelo ORM de forma robusta.
    """
    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El modelo TipoSubsegmentoProveedor no está disponible en models.py",
        )
    return model_cls


def _validate_rama_if_present(db: Session, rama_id: Optional[str]) -> Optional[str]:
    """
    Valida que la rama exista si viene informada.
    Devuelve rama_id normalizada a str o None.
    """
    rama_id_final = (rama_id or "").strip() or None

    if rama_id_final:
        rama_exists = db.get(models.TipoRamasProveedores, rama_id_final)
        if not rama_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La rama de proveedor indicada no existe.",
            )

    return rama_id_final


def _ensure_unique_nombre(
    db: Session,
    model_cls,
    *,
    nombre: str,
    rama_id: Optional[str],
    exclude_id: Optional[str] = None,
) -> None:
    """
    Valida unicidad razonable de subsegmento:
    - mismo nombre
    - misma rama_id (incluyendo NULL)
    """
    qry = db.query(model_cls).filter(model_cls.nombre == nombre)

    if exclude_id:
        qry = qry.filter(model_cls.id != exclude_id)

    if rama_id:
        qry = qry.filter(model_cls.rama_id == rama_id)
    else:
        qry = qry.filter(model_cls.rama_id.is_(None))

    exists = qry.first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un subsegmento de proveedor con ese nombre para esa rama.",
        )


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


def _get_subsegmento_count_map(db: Session) -> Dict[str, int]:
    """
    Cuenta el número real de proveedores asociados a cada subsegmento.
    """
    rows = (
        db.query(models.Proveedor.subsegmento_id, func.count(models.Proveedor.id))
        .filter(models.Proveedor.subsegmento_id.isnot(None))
        .group_by(models.Proveedor.subsegmento_id)
        .all()
    )
    return _build_count_map(rows)


def _serialize_subsegmento(obj, associated_count: int) -> dict:
    """
    Serializa un subsegmento con contador asociado.
    """
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "rama_id": obj.rama_id,
        "associated_count": int(associated_count or 0),
    }


# ============================================================
# GET
# ============================================================

@router.get(
    "",
    response_model=List[TipoSubsegmentoProveedorRead],
    summary="Listar subsegmentos de proveedores",
)
def list_subsegmentos_proveedores(
    rama_id: Optional[str] = Query(None, description="Filtrar por rama_id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista los subsegmentos de proveedores.

    Notas:
    - Es catálogo global, no multiusuario.
    - Permite filtro opcional por rama_id.
    - Incluye `associated_count` con el número real de proveedores asociados.
    """
    model_cls = _get_model_cls()

    qry = db.query(model_cls)

    if rama_id:
        qry = qry.filter(model_cls.rama_id == rama_id)

    items = qry.order_by(model_cls.nombre.asc(), model_cls.id.asc()).all()
    count_map = _get_subsegmento_count_map(db)

    return [
        _serialize_subsegmento(item, count_map.get(item.id, 0))
        for item in items
    ]


# ============================================================
# POST
# ============================================================

@router.post(
    "",
    response_model=TipoSubsegmentoProveedorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear subsegmento de proveedor",
)
def create_subsegmento_proveedor(
    payload: TipoSubsegmentoProveedorCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un subsegmento de proveedor.

    Reglas:
    - nombre obligatorio
    - nombre normalizado a MAYÚSCULAS
    - rama_id opcional
    - unicidad por (nombre, rama_id)
    """
    model_cls = _get_model_cls()

    nombre = normalize_upper(payload.nombre) or ""
    if not nombre:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nombre es obligatorio.",
        )

    rama_id = _validate_rama_if_present(db, payload.rama_id)

    _ensure_unique_nombre(
        db,
        model_cls,
        nombre=nombre,
        rama_id=rama_id,
    )

    obj = model_cls(
        id=_generate_subsegmento_proveedor_id(),
        nombre=nombre,
        rama_id=rama_id,
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_subsegmento(obj, 0)


# ============================================================
# PUT
# ============================================================

@router.put(
    "/{subsegmento_id}",
    response_model=TipoSubsegmentoProveedorRead,
    summary="Actualizar subsegmento de proveedor",
)
def update_subsegmento_proveedor(
    subsegmento_id: str,
    payload: TipoSubsegmentoProveedorUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un subsegmento de proveedor.

    Permite update parcial de:
    - nombre
    - rama_id
    """
    model_cls = _get_model_cls()

    obj = db.get(model_cls, subsegmento_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subsegmento de proveedor no encontrado.",
        )

    data = payload.model_dump(exclude_unset=True)

    if "nombre" in data:
        nombre = normalize_upper(data.get("nombre")) or ""
        if not nombre:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El nombre no puede estar vacío.",
            )
        obj.nombre = nombre

    if "rama_id" in data:
        obj.rama_id = _validate_rama_if_present(db, data.get("rama_id"))

    _ensure_unique_nombre(
        db,
        model_cls,
        nombre=obj.nombre,
        rama_id=obj.rama_id,
        exclude_id=obj.id,
    )

    db.commit()
    db.refresh(obj)

    count_map = _get_subsegmento_count_map(db)
    return _serialize_subsegmento(obj, count_map.get(obj.id, 0))


# ============================================================
# DELETE
# ============================================================

@router.delete(
    "/{subsegmento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar subsegmento de proveedor",
)
def delete_subsegmento_proveedor(
    subsegmento_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Elimina un subsegmento de proveedor si no tiene proveedores asociados.
    """
    model_cls = _get_model_cls()

    obj = db.get(model_cls, subsegmento_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subsegmento de proveedor no encontrado.",
        )

    linked = (
        db.query(models.Proveedor.id)
        .filter(models.Proveedor.subsegmento_id == subsegmento_id)
        .first()
    )
    if linked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar el subsegmento: tiene proveedores asociados.",
        )

    db.delete(obj)
    db.commit()
    return None