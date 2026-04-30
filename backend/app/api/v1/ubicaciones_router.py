"""
Ruta: backend/app/api/v1/ubicaciones_router.py
Versión: 2.2.0
Descripción:
Router centralizado de ubicaciones de GapptoMobile v3.

Responsabilidades:
- Listar y crear países, regiones y localidades.
- Mantener idempotencia por nombre y relación jerárquica.
- Mapear errores de integridad a respuestas HTTP controladas.
- Devolver localidades con contexto completo (región y país).
- Re-sincronizar secuencias de países, regiones y localidades ante colisión de PK.

Mejoras:
- create_pais reforzado con reparación de secuencia.
- create_region reforzado con reparación de secuencia.
- create_localidad conserva reparación de secuencia y contexto completo.
"""

from __future__ import annotations

from typing import List, Optional
import traceback

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db
from backend.app.schemas.localidad import LocalidadCreate, LocalidadWithContext
from backend.app.schemas.pais import Pais, PaisCreate
from backend.app.schemas.region import Region, RegionCreate


router = APIRouter(prefix="/ubicaciones", tags=["ubicaciones"])


# =========================
# Helpers
# =========================

def _norm(s: Optional[str]) -> str:
    """
    Normaliza texto para comparaciones/altas:
    - trim
    - upper
    """
    return (s or "").strip().upper()


def _is_duplicate_integrity_error(e: IntegrityError) -> bool:
    """
    Heurística multi-motor para detectar duplicados UNIQUE/PK.
    """
    raw = str(getattr(e, "orig", e)).lower()
    return (
        ("duplicate key" in raw and "unique" in raw)
        or ("unique constraint" in raw)
        or ("duplicate entry" in raw)
    )


def _is_pk_collision(e: IntegrityError, table_name: str) -> bool:
    """
    Detecta colisión de primary key de una tabla concreta.
    """
    raw = str(getattr(e, "orig", e)).lower()
    return f"{table_name}_pkey" in raw and "key (id)=" in raw


def _integrity_to_http(e: IntegrityError, duplicate_msg: str) -> None:
    """
    Mapea IntegrityError a HTTP controlado.
    """
    if _is_duplicate_integrity_error(e):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=duplicate_msg)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No se ha podido guardar por una restricción de datos. Revisa los campos.",
    )


def _debug_db_identity(db: Session) -> None:
    """
    Diagnóstico mínimo para confirmar qué base de datos está usando el backend.
    """
    try:
        row = db.execute(
            text(
                """
                SELECT
                    current_database() AS db,
                    inet_server_addr() AS addr,
                    inet_server_port() AS port
                """
            )
        ).mappings().first()

        if row:
            print(
                f"[ubicaciones][db] current_database={row['db']} "
                f"addr={row['addr']} port={row['port']}"
            )
    except Exception as ex:
        print("[ubicaciones][db] No se pudo obtener identidad BD:", repr(ex))


def _heal_sequence(db: Session, table_name: str, sequence_name: str) -> None:
    """
    Repara una secuencia autoincremental para que nextval() devuelva MAX(id)+1.
    """
    max_id_row = db.execute(
        text(f"SELECT COALESCE(MAX(id), 0) AS m FROM {table_name}")
    ).mappings().first()

    max_id = int(max_id_row["m"] if max_id_row and max_id_row["m"] is not None else 0)

    db.execute(
        text(f"SELECT setval('public.{sequence_name}', :v, true)"),
        {"v": max_id},
    )

    print(f"[ubicaciones] Heal sequence {sequence_name} -> setval({max_id}, true)")


def _refetch_region_with_pais(db: Session, region_id: int) -> Optional[models.Region]:
    return (
        db.query(models.Region)
        .options(joinedload(models.Region.pais))
        .filter(models.Region.id == region_id)
        .first()
    )


def _refetch_localidad_with_context(db: Session, localidad_id: int) -> Optional[models.Localidad]:
    return (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
        .filter(models.Localidad.id == localidad_id)
        .first()
    )


# =========================
# PAÍSES
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
    """
    Crea un país de forma idempotente por nombre.

    Si ya existe un país con ese nombre, devuelve el existente.
    """
    try:
        _debug_db_identity(db)

        nombre = _norm(payload.nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El nombre del país es obligatorio.")

        codigo_iso = _norm(payload.codigo_iso) if payload.codigo_iso else None

        existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
        if existente:
            return existente

        def _insert_once() -> models.Pais:
            obj = models.Pais(nombre=nombre, codigo_iso=codigo_iso)
            obj.id = None
            db.add(obj)
            db.commit()
            db.refresh(obj)
            return obj

        try:
            obj = _insert_once()

        except IntegrityError as e:
            db.rollback()

            existente2 = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
            if existente2:
                return existente2

            if _is_pk_collision(e, "paises"):
                print(
                    "[ubicaciones] IntegrityError create_pais (PK collision):",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )

                _heal_sequence(db, "paises", "paises_id_seq")

                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    print(
                        "[ubicaciones] IntegrityError create_pais tras heal+retry:",
                        str(getattr(e2, "orig", e2)),
                        "payload=",
                        payload,
                    )
                    _integrity_to_http(e2, "Ya existe un país con este nombre.")
            else:
                print(
                    "[ubicaciones] IntegrityError create_pais:",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )
                _integrity_to_http(e, "Ya existe un país con este nombre.")

        return obj

    except HTTPException:
        raise

    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos al crear país: {type(e).__name__}",
        )

    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error inesperado al crear país: {type(e).__name__}",
        )


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
    """
    Crea una región/comunidad de forma idempotente por (nombre, pais_id).
    """
    try:
        _debug_db_identity(db)

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
            return _refetch_region_with_pais(db, existente.id)

        def _insert_once() -> models.Region:
            obj = models.Region(nombre=nombre, pais_id=payload.pais_id)
            obj.id = None
            db.add(obj)
            db.commit()
            db.refresh(obj)
            return obj

        try:
            obj = _insert_once()

        except IntegrityError as e:
            db.rollback()

            existente2 = (
                db.query(models.Region)
                .filter(models.Region.nombre == nombre, models.Region.pais_id == payload.pais_id)
                .first()
            )
            if existente2:
                return _refetch_region_with_pais(db, existente2.id)

            if _is_pk_collision(e, "regiones"):
                print(
                    "[ubicaciones] IntegrityError create_region (PK collision):",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )

                _heal_sequence(db, "regiones", "regiones_id_seq")

                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    print(
                        "[ubicaciones] IntegrityError create_region tras heal+retry:",
                        str(getattr(e2, "orig", e2)),
                        "payload=",
                        payload,
                    )
                    _integrity_to_http(e2, "Ya existe una región con este nombre en ese país.")
            else:
                print(
                    "[ubicaciones] IntegrityError create_region:",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )
                _integrity_to_http(e, "Ya existe una región con este nombre en ese país.")

        created = _refetch_region_with_pais(db, obj.id)
        if not created:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Región creada pero no se ha podido recuperar su contexto.",
            )

        return created

    except HTTPException:
        raise

    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos al crear región: {type(e).__name__}",
        )

    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error inesperado al crear región: {type(e).__name__}",
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


@router.post("/localidades/", response_model=LocalidadWithContext, status_code=status.HTTP_201_CREATED)
def create_localidad(
    payload: LocalidadCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    """
    Crea localidad de forma idempotente por (nombre, region_id).

    Devuelve siempre:
    - localidad
    - región
    - país
    """
    try:
        _debug_db_identity(db)

        nombre = _norm(payload.nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El nombre de la localidad es obligatorio.")

        region = (
            db.query(models.Region)
            .options(joinedload(models.Region.pais))
            .filter(models.Region.id == payload.region_id)
            .first()
        )
        if not region:
            raise HTTPException(status_code=404, detail="Región no encontrada.")

        existente = (
            db.query(models.Localidad)
            .filter(
                models.Localidad.nombre == nombre,
                models.Localidad.region_id == payload.region_id,
            )
            .first()
        )
        if existente:
            return _refetch_localidad_with_context(db, existente.id)

        def _insert_once() -> models.Localidad:
            obj = models.Localidad(nombre=nombre, region_id=payload.region_id)
            obj.id = None
            db.add(obj)
            db.commit()
            db.refresh(obj)
            return obj

        try:
            obj = _insert_once()

        except IntegrityError as e:
            db.rollback()

            existente2 = (
                db.query(models.Localidad)
                .filter(
                    models.Localidad.nombre == nombre,
                    models.Localidad.region_id == payload.region_id,
                )
                .first()
            )
            if existente2:
                return _refetch_localidad_with_context(db, existente2.id)

            if _is_pk_collision(e, "localidades"):
                print(
                    "[ubicaciones] IntegrityError create_localidad (PK collision):",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )

                _heal_sequence(db, "localidades", "localidades_id_seq")

                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    print(
                        "[ubicaciones] IntegrityError create_localidad tras heal+retry:",
                        str(getattr(e2, "orig", e2)),
                        "payload=",
                        payload,
                    )
                    _integrity_to_http(e2, "Ya existe una localidad con ese nombre en esa región.")
            else:
                print(
                    "[ubicaciones] IntegrityError create_localidad:",
                    str(getattr(e, "orig", e)),
                    "payload=",
                    payload,
                )
                _integrity_to_http(e, "Ya existe una localidad con ese nombre en esa región.")

        created = _refetch_localidad_with_context(db, obj.id)

        if not created:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Localidad creada pero no se ha podido recuperar su contexto.",
            )

        return created

    except HTTPException:
        raise

    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos al crear localidad: {type(e).__name__}",
        )

    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error inesperado al crear localidad: {type(e).__name__}",
        )