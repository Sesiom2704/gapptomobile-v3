# backend/app/api/v1/ubicaciones_router.py
"""
Router: Ubicaciones (Países / Regiones / Localidades)

Objetivo:
- Mantener el comportamiento existente (listados + creación idempotente).
- Evitar errores 500 opacos en creación (especialmente create_localidad).
- Proveer mensajes controlados (409/400/404/422) cuando sea posible.

Contexto:
- En tu BBDD, localidades tiene constraint:
    UNIQUE (nombre, region_id)
  por tanto la idempotencia por (nombre, region_id) ES coherente.

Problema observado:
- El móvil recibe 500 al crear localidad.

Causas probables del 500 con FastAPI:
1) IntegrityError no mapeado => 500 (aquí ya lo mapeamos a 409/400).
2) ResponseValidationError (Pydantic):
   - response_model exige campos no opcionales (ej. LocalidadWithContext.region: Region),
     pero la relación o el país podría venir None por datos legacy o por no cargar relaciones.
   - Esto dispara un 500 interno de FastAPI.
   - Lo ideal es que los schemas permitan Optional en lo que pueda venir nulo en datos históricos,
     pero aquí reforzamos también la carga y hacemos comprobaciones.

Nota:
- Este router NO usa multiusuario en ubicaciones (catálogo global), se mantiene tu enfoque actual.
"""

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
def _norm(s: Optional[str]) -> str:
    """Normaliza texto: trim + upper."""
    return (s or "").strip().upper()


def _is_duplicate_integrity_error(e: IntegrityError) -> bool:
    """
    Heurística de duplicados según mensajes típicos de drivers (Postgres/SQLite/MySQL).
    No es perfecto, pero evita exponer 500 cuando la causa es "ya existe".
    """
    raw = str(getattr(e, "orig", e)).lower()
    return (
        ("duplicate key" in raw and "unique" in raw)  # Postgres
        or ("unique constraint" in raw)              # SQLite
        or ("duplicate entry" in raw)                # MySQL
    )


def _integrity_to_http(e: IntegrityError, duplicate_msg: str):
    """
    Convierte IntegrityError en HTTPException controlada:
    - 409 si parece duplicado.
    - 400 para otras restricciones (FK, etc.).
    """
    if _is_duplicate_integrity_error(e):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=duplicate_msg)

    # Cualquier otro IntegrityError (FK, nullability, etc.) lo devolvemos controlado.
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No se ha podido guardar por una restricción de datos. Revisa los campos.",
    )


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
    """
    Lista países (catálogo global).
    - Búsqueda por ilike
    - Limit hard-capped por Query (<= 500)
    """
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
    """
    Crea país (idempotente por nombre):
    - Si existe, devuelve el existente.
    - Si hay carrera concurrente, tras rollback reintenta devolver el existente.
    """
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre del país es obligatorio.")

    existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
    if existente:
        return existente

    obj = models.Pais(nombre=nombre, codigo_iso=payload.codigo_iso)
    db.add(obj)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()

        # Carrera concurrente: lo buscamos de nuevo
        existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
        if existente:
            return existente

        # Log de servidor (clave para diagnosticar 500/constraints)
        print("[ubicaciones] IntegrityError create_pais:", str(getattr(e, "orig", e)), "payload=", payload)
        _integrity_to_http(e, "Ya existe un país con este nombre.")

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
    """
    Lista regiones con su país cargado (joinedload).
    """
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
    """
    Crea región (idempotente por nombre+pais_id).
    Reglas:
    - No crea región si país no existe.
    - Devuelve con el país cargado (joinedload).
    """
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la región es obligatorio.")

    pais = db.get(models.Pais, payload.pais_id)
    if not pais:
        raise HTTPException(status_code=404, detail="País no encontrado.")

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

    obj = models.Region(nombre=nombre, pais_id=payload.pais_id)
    db.add(obj)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()

        # Carrera concurrente: reconsulta
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

        print("[ubicaciones] IntegrityError create_region:", str(getattr(e, "orig", e)), "payload=", payload)
        _integrity_to_http(e, "Ya existe una región con este nombre en ese país.")

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
    """
    Lista localidades con contexto completo:
    - Localidad.region
    - Region.pais
    """
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
    """
    Obtiene una localidad por id con contexto completo (region+pais).
    """
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
    """
    Crea localidad (idempotente por nombre+region_id).

    Reglas:
    - No crea localidad sin región (y por tanto sin país).
    - Normaliza nombre a MAYÚSCULAS.
    - Devuelve LocalidadWithContext (incluye region + pais).

    Mejora clave:
    - Convertimos IntegrityError en 409/400 (en vez de 500 opaco).
    - Refetch final robusto con joinedload para asegurar el contexto.

    Nota:
    - Con constraint UNIQUE(nombre, region_id) ya confirmada, si sigues viendo 500,
      lo más probable es ResponseValidationError (schema exige campos no opcionales).
      En ese caso, conviene revisar schemas Region/LocalidadWithContext para permitir Optional
      si existen datos históricos incompletos.
    """
    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la localidad es obligatorio.")

    # Regla: no se crea localidad sin región
    region = (
        db.query(models.Region)
        .options(joinedload(models.Region.pais))
        .filter(models.Region.id == payload.region_id)
        .first()
    )
    if not region:
        raise HTTPException(status_code=404, detail="Región no encontrada.")

    # Idempotencia por (nombre, region_id)
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
    except IntegrityError as e:
        db.rollback()

        # Carrera concurrente: si se creó justo ahora, devolvemos el existente
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

        # Log de servidor
        print("[ubicaciones] IntegrityError create_localidad:", str(getattr(e, "orig", e)), "payload=", payload)
        _integrity_to_http(e, "Ya existe una localidad con ese nombre en esa región.")

    # Refetch final con relaciones cargadas (region + pais)
    created = (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
        .filter(models.Localidad.id == obj.id)
        .first()
    )

    # Seguridad adicional: si por algún motivo no se encuentra, devolvemos error controlado
    if not created:
        # Esto NO debería ocurrir, pero evita un 500 opaco
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Localidad creada pero no se ha podido recuperar su contexto.",
        )

    return created
