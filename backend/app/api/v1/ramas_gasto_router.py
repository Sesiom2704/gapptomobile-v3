from typing import List, Optional
import secrets

from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user

router = APIRouter(prefix="/aux/ramas-gasto", tags=["auxiliares"])


def _up(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    ss = s.strip().upper()
    return ss or None


@router.get("/", response_model=List[dict])
def list_ramas_gasto(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    ramas = db.query(models.TipoRamasGasto).order_by(models.TipoRamasGasto.nombre.asc()).all()
    # salida simple para no forzar schemas aún (si prefieres, lo pasamos a Pydantic)
    return [{"id": r.id, "nombre": r.nombre} for r in ramas]


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=dict)
def create_rama_gasto(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    nombre = _up(payload.get("nombre"))
    if not nombre:
        raise HTTPException(status_code=422, detail="El NOMBRE es obligatorio.")

    # Unicidad case-insensitive
    exists = (
        db.query(models.TipoRamasGasto)
        .filter(func.upper(func.trim(models.TipoRamasGasto.nombre)) == nombre)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe una rama de gasto con este nombre.")

    new_id = f"RG-{secrets.token_hex(6).upper()}"
    obj = models.TipoRamasGasto(id=new_id, nombre=nombre)

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {"id": obj.id, "nombre": obj.nombre}


@router.put("/{rama_id}/", response_model=dict)
def update_rama_gasto(
    rama_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Rama de gasto no encontrada.")

    nombre = payload.get("nombre", None)
    if nombre is not None:
        nombre = _up(nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El NOMBRE no puede estar vacío.")

        exists = (
            db.query(models.TipoRamasGasto)
            .filter(
                func.upper(func.trim(models.TipoRamasGasto.nombre)) == nombre,
                models.TipoRamasGasto.id != rama_id,
            )
            .first()
        )
        if exists:
            raise HTTPException(status_code=400, detail="Ya existe una rama de gasto con este nombre.")

        obj.nombre = nombre

    db.commit()
    db.refresh(obj)
    return {"id": obj.id, "nombre": obj.nombre}


@router.delete("/{rama_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_rama_gasto(
    rama_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = db.get(models.TipoRamasGasto, rama_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Rama de gasto no encontrada.")

    # Borrado protegido: si hay TipoGasto asociados, no se borra
    linked = (
        db.query(models.TipoGasto.id)
        .filter(models.TipoGasto.rama_id == rama_id)
        .first()
    )
    if linked:
        raise HTTPException(
            status_code=409,
            detail="No se puede borrar la rama: tiene tipos de gasto asociados.",
        )

    db.delete(obj)
    db.commit()
    return None
