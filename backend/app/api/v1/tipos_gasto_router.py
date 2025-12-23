from typing import List, Optional
import secrets

from fastapi import APIRouter, HTTPException, Depends, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user

router = APIRouter(prefix="/aux/tipos-gasto", tags=["auxiliares"])


def _up(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    ss = s.strip().upper()
    return ss or None


@router.get("/", response_model=List[dict])
def list_tipos_gasto(
    rama_id: Optional[str] = Query(None, description="Filtra por rama_id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    q = db.query(models.TipoGasto)
    if rama_id:
        q = q.filter(models.TipoGasto.rama_id == rama_id)
    tipos = q.order_by(models.TipoGasto.nombre.asc()).all()

    return [
        {
            "id": t.id,
            "nombre": t.nombre,
            "rama_id": t.rama_id,
            "segmento_id": t.segmento_id,
        }
        for t in tipos
    ]


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=dict)
def create_tipo_gasto(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    nombre = _up(payload.get("nombre"))
    rama_id = (payload.get("rama_id") or "").strip()
    segmento_id = payload.get("segmento_id")
    segmento_id = (str(segmento_id).strip() if segmento_id else None)

    if not nombre:
        raise HTTPException(status_code=422, detail="El NOMBRE es obligatorio.")
    if not rama_id:
        raise HTTPException(status_code=422, detail="La RAMA es obligatoria.")

    # Validar que exista la rama
    rama = db.get(models.TipoRamasGasto, rama_id)
    if not rama:
        raise HTTPException(status_code=400, detail="La rama seleccionada no existe.")

    # Validar segmento si viene
    if segmento_id:
        seg = db.get(models.TipoSegmentoGasto, segmento_id)
        if not seg:
            raise HTTPException(status_code=400, detail="El segmento seleccionado no existe.")

    # Unicidad por (rama_id, nombre) case-insensitive
    exists = (
        db.query(models.TipoGasto)
        .filter(
            models.TipoGasto.rama_id == rama_id,
            func.upper(func.trim(models.TipoGasto.nombre)) == nombre,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un tipo de gasto con este nombre en esa rama.",
        )

    new_id = f"TG-{secrets.token_hex(6).upper()}"
    obj = models.TipoGasto(
        id=new_id,
        nombre=nombre,
        rama_id=rama_id,
        segmento_id=segmento_id,
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "rama_id": obj.rama_id,
        "segmento_id": obj.segmento_id,
    }


@router.put("/{tipo_id}/", response_model=dict)
def update_tipo_gasto(
    tipo_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = db.get(models.TipoGasto, tipo_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo de gasto no encontrado.")

    data_nombre = payload.get("nombre", None)
    data_rama_id = payload.get("rama_id", None)
    data_segmento_id = payload.get("segmento_id", None)

    if data_nombre is not None:
        nn = _up(data_nombre)
        if not nn:
            raise HTTPException(status_code=422, detail="El NOMBRE no puede estar vacío.")
        obj.nombre = nn

    if data_rama_id is not None:
        rr = str(data_rama_id).strip()
        if not rr:
            raise HTTPException(status_code=422, detail="La RAMA no puede estar vacía.")
        rama = db.get(models.TipoRamasGasto, rr)
        if not rama:
            raise HTTPException(status_code=400, detail="La rama seleccionada no existe.")
        obj.rama_id = rr

    if data_segmento_id is not None:
        # Permitimos poner None para “vaciar” (aunque hoy no se use)
        ss = str(data_segmento_id).strip() if data_segmento_id else None
        if ss:
            seg = db.get(models.TipoSegmentoGasto, ss)
            if not seg:
                raise HTTPException(status_code=400, detail="El segmento seleccionado no existe.")
        obj.segmento_id = ss

    # Re-validar unicidad (rama_id, nombre)
    exists = (
        db.query(models.TipoGasto)
        .filter(
            models.TipoGasto.id != obj.id,
            models.TipoGasto.rama_id == obj.rama_id,
            func.upper(func.trim(models.TipoGasto.nombre)) == obj.nombre,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un tipo de gasto con este nombre en esa rama.",
        )

    db.commit()
    db.refresh(obj)
    return {
        "id": obj.id,
        "nombre": obj.nombre,
        "rama_id": obj.rama_id,
        "segmento_id": obj.segmento_id,
    }


@router.delete("/{tipo_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_tipo_gasto(
    tipo_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = db.get(models.TipoGasto, tipo_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo de gasto no encontrado.")

    # Borrado protegido: si hay gastos asociados, bloquear
    linked_gasto = (
        db.query(models.Gasto.id)
        .filter(models.Gasto.tipo_id == tipo_id)
        .first()
    )
    if linked_gasto:
        raise HTTPException(
            status_code=409,
            detail="No se puede borrar el tipo de gasto: tiene gastos asociados.",
        )

    linked_cotidiano = (
        db.query(models.GastoCotidiano.id)
        .filter(models.GastoCotidiano.tipo_id == tipo_id)
        .first()
    )
    if linked_cotidiano:
        raise HTTPException(
            status_code=409,
            detail="No se puede borrar el tipo de gasto: tiene gastos cotidianos asociados.",
        )

    db.delete(obj)
    db.commit()
    return None
