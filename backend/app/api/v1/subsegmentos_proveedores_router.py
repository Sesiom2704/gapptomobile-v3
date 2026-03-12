# backend/app/api/v1/subsegmentos_proveedores_router.py

"""
Ruta: backend/app/api/v1/subsegmentos_proveedores_router.py
Versión: 1.0.0
Descripción:
Router CRUD para la nueva tabla auxiliar de subsegmentos de proveedores.

Objetivos:
- Gestionar el catálogo `tipo_subsegmentos_proveedores`.
- Permitir relación opcional con `tipo_ramas_proveedores`.
- Impedir borrado si existen proveedores asociados.
- Mantener estilo y reglas del resto de auxiliares:
    * nombre normalizado a MAYÚSCULAS
    * ids generados en backend
    * unicidad razonable
"""

from __future__ import annotations

from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user
from backend.app.utils.text_utils import normalize_upper


router = APIRouter(
    prefix="/subsegmentos/proveedores",
    tags=["subsegmentos_proveedores"],
)


# =============================================================================
# Helpers
# =============================================================================
def _generate_subsegmento_proveedor_id() -> str:
    return "TSPR-" + uuid4().hex[:10].upper()


def _serialize(obj) -> dict:
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "rama_id": obj.rama_id,
    }


# =============================================================================
# GET
# =============================================================================
@router.get(
    "",
    response_model=List[dict],
    summary="Listar subsegmentos de proveedores",
)
def list_subsegmentos_proveedores(
    rama_id: Optional[str] = Query(None, description="Filtrar por rama_id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista los subsegmentos de proveedores.
    """
    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El modelo TipoSubsegmentoProveedor no está disponible en models.py",
        )

    qry = db.query(model_cls)

    if rama_id:
        qry = qry.filter(model_cls.rama_id == rama_id)

    rows = qry.order_by(model_cls.nombre.asc(), model_cls.id.asc()).all()
    return [_serialize(r) for r in rows]


# =============================================================================
# POST
# =============================================================================
@router.post(
    "",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Crear subsegmento de proveedor",
)
def create_subsegmento_proveedor(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un subsegmento de proveedor.
    """
    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El modelo TipoSubsegmentoProveedor no está disponible en models.py",
        )

    nombre = normalize_upper(payload.get("nombre")) or ""
    rama_id = (payload.get("rama_id") or "").strip() or None

    if not nombre:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nombre es obligatorio.",
        )

    if rama_id:
        rama_exists = db.get(models.TipoRamasProveedores, rama_id)
        if not rama_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La rama de proveedor indicada no existe.",
            )

    exists_q = db.query(model_cls).filter(model_cls.nombre == nombre)
    if rama_id:
        exists_q = exists_q.filter(model_cls.rama_id == rama_id)
    else:
        exists_q = exists_q.filter(model_cls.rama_id.is_(None))

    exists = exists_q.first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un subsegmento de proveedor con ese nombre para esa rama.",
        )

    obj = model_cls(
        id=_generate_subsegmento_proveedor_id(),
        nombre=nombre,
        rama_id=rama_id,
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize(obj)


# =============================================================================
# PUT
# =============================================================================
@router.put(
    "/{subsegmento_id}",
    response_model=dict,
    summary="Actualizar subsegmento de proveedor",
)
def update_subsegmento_proveedor(
    subsegmento_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un subsegmento de proveedor.
    """
    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El modelo TipoSubsegmentoProveedor no está disponible en models.py",
        )

    obj = db.get(model_cls, subsegmento_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subsegmento de proveedor no encontrado.",
        )

    if "nombre" in payload:
        nombre = normalize_upper(payload.get("nombre")) or ""
        if not nombre:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El nombre no puede estar vacío.",
            )
        obj.nombre = nombre

    if "rama_id" in payload:
        rama_id = (payload.get("rama_id") or "").strip() or None
        if rama_id:
            rama_exists = db.get(models.TipoRamasProveedores, rama_id)
            if not rama_exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La rama de proveedor indicada no existe.",
                )
        obj.rama_id = rama_id

    exists_q = db.query(model_cls).filter(
        model_cls.id != obj.id,
        model_cls.nombre == obj.nombre,
    )
    if obj.rama_id:
        exists_q = exists_q.filter(model_cls.rama_id == obj.rama_id)
    else:
        exists_q = exists_q.filter(model_cls.rama_id.is_(None))

    exists = exists_q.first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe otro subsegmento de proveedor con ese nombre para esa rama.",
        )

    db.commit()
    db.refresh(obj)
    return _serialize(obj)


# =============================================================================
# DELETE
# =============================================================================
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
    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El modelo TipoSubsegmentoProveedor no está disponible en models.py",
        )

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