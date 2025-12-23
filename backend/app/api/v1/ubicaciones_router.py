# backend/app/api/v1/ubicaciones_router.py

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user

from backend.app.schemas.pais import Pais, PaisCreate
from backend.app.schemas.region import Region, RegionCreate
from backend.app.schemas.localidad import LocalidadWithContext, LocalidadCreate

router = APIRouter(prefix="/ubicaciones", tags=["ubicaciones"])


# -------------------------
# Helpers
# -------------------------
def _norm(s: str) -> str:
    return (s or "").strip().upper()


# =========================
# PAISES
# =========================

@router.get("/paises/", response_model=List[Pais])
def list_paises(
    search: Optional[str] = Query(None, description="Buscar por nombre (contiene)."),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    q = db.query(models.Pais)

    if search:
        term = f"%{search.strip()}%"
        q = q.filter(models.Pais.nombre.ilike(term))

    return q.order_by(models.Pais.nombre.asc()).limit(limit).all()


@router.post("/paises/", response_model=Pais, status_code=status.HTTP_201_CREATED)
def create_pais(
    payload: PaisCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre del país es obligatorio.")

    # idempotente: si existe, lo devolvemos
    existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
    if existente:
        return existente

    obj = models.Pais(nombre=nombre, codigo_iso=payload.codigo_iso)
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # por si carrera concurrente
        existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
        if existente:
            return existente
        raise
    db.refresh(obj)
    return obj


# =========================
# REGIONES
# =========================

@router.get("/regiones/", response_model=List[Region])
def list_regiones(
    search: Optional[str] = Query(None, description="Buscar por nombre (contiene)."),
    pais_id: Optional[int] = Query(None, description="Filtrar por país."),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    q = db.query(models.Region).options(joinedload(models.Region.pais))

    if pais_id is not None:
        q = q.filter(models.Region.pais_id == pais_id)

    if search:
        term = f"%{search.strip()}%"
        q = q.filter(models.Region.nombre.ilike(term))

    return q.order_by(models.Region.nombre.asc()).limit(limit).all()


@router.post("/regiones/", response_model=Region, status_code=status.HTTP_201_CREATED)
def create_region(
    payload: RegionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la región es obligatorio.")

    # Regla: no se crea región sin país
    pais = db.get(models.Pais, payload.pais_id)
    if not pais:
        raise HTTPException(status_code=404, detail="País no encontrado.")

    existente = (
        db.query(models.Region)
        .filter(models.Region.nombre == nombre, models.Region.pais_id == payload.pais_id)
        .first()
    )
    if existente:
        # devolvemos con pais cargado
        return (
            db.query(models.Region)
            .options(joinedload(models.Region.pais))
            .filter(models.Region.id == existente.id)
            .first()
        )

    obj = models.Region(nombre=nombre, pais_id=payload.pais_id)
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existente = (
            db.query(models.Region)
            .filter(models.Region.nombre == nombre, models.Region.pais_id == payload.pais_id)
            .first()
        )
        if existente:
            return (
                db.query(models.Region)
                .options(joinedload(models.Region.pais))
                .filter(models.Region.id == existente.id)
                .first()
            )
        raise
    db.refresh(obj)

    return (
        db.query(models.Region)
        .options(joinedload(models.Region.pais))
        .filter(models.Region.id == obj.id)
        .first()
    )


# =========================
# LOCALIDADES
# =========================

@router.get("/localidades/", response_model=List[LocalidadWithContext])
def list_localidades(
    search: Optional[str] = Query(None, description="Buscar por nombre (contiene)."),
    region_id: Optional[int] = Query(None, description="Filtrar por región."),
    pais_id: Optional[int] = Query(None, description="Filtrar por país (vía región)."),
    limit: int = Query(50, ge=1, le=500, description="Máximo resultados."),
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    q = (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
    )

    if search:
        term = f"%{search.strip()}%"
        q = q.filter(models.Localidad.nombre.ilike(term))

    if region_id is not None:
        q = q.filter(models.Localidad.region_id == region_id)

    if pais_id is not None:
        q = q.join(models.Localidad.region).filter(models.Region.pais_id == pais_id)

    return q.order_by(models.Localidad.nombre.asc()).limit(limit).all()


@router.get("/localidades/{localidad_id}", response_model=LocalidadWithContext)
def get_localidad(
    localidad_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    localidad = (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
        .filter(models.Localidad.id == localidad_id)
        .first()
    )
    if not localidad:
        raise HTTPException(status_code=404, detail="Localidad no encontrada")
    return localidad


@router.post("/localidades/", response_model=LocalidadWithContext, status_code=status.HTTP_201_CREATED)
def create_localidad(
    payload: LocalidadCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la localidad es obligatorio.")

    # Regla: no se crea localidad sin región (y por tanto sin país)
    region = (
        db.query(models.Region)
        .options(joinedload(models.Region.pais))
        .filter(models.Region.id == payload.region_id)
        .first()
    )
    if not region:
        raise HTTPException(status_code=404, detail="Región no encontrada.")

    # idempotente por (nombre, region_id)
    existente = (
        db.query(models.Localidad)
        .filter(models.Localidad.nombre == nombre, models.Localidad.region_id == payload.region_id)
        .first()
    )
    if existente:
        return (
            db.query(models.Localidad)
            .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
            .filter(models.Localidad.id == existente.id)
            .first()
        )

    obj = models.Localidad(nombre=nombre, region_id=payload.region_id)
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existente = (
            db.query(models.Localidad)
            .filter(models.Localidad.nombre == nombre, models.Localidad.region_id == payload.region_id)
            .first()
        )
        if existente:
            return (
                db.query(models.Localidad)
                .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
                .filter(models.Localidad.id == existente.id)
                .first()
            )
        raise
    db.refresh(obj)

    return (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
        .filter(models.Localidad.id == obj.id)
        .first()
    )
