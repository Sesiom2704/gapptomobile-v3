"""
Ruta: backend/app/api/v1/ubicaciones_router.py
Versión: 2.3.0
Descripción:
Router centralizado de ubicaciones de GapptoMobile v3.

Responsabilidades:
- Listar, crear, actualizar y eliminar países, regiones y localidades.
- Mantener idempotencia por nombre y relación jerárquica.
- Mapear errores de integridad a respuestas HTTP controladas.
- Devolver localidades con contexto completo (región y país).
- Re-sincronizar secuencias de países, regiones y localidades ante colisión de PK.

Notas:
- DELETE puede fallar con 409 si el registro está siendo usado por otra tabla.
- PUT valida duplicados por nombre y relación jerárquica antes de guardar.
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
    return (s or "").strip().upper()


def _is_duplicate_integrity_error(e: IntegrityError) -> bool:
    raw = str(getattr(e, "orig", e)).lower()
    return (
        ("duplicate key" in raw and "unique" in raw)
        or ("unique constraint" in raw)
        or ("duplicate entry" in raw)
    )


def _is_fk_integrity_error(e: IntegrityError) -> bool:
    raw = str(getattr(e, "orig", e)).lower()
    return (
        "foreign key" in raw
        or "violates foreign key constraint" in raw
        or "is still referenced" in raw
        or "cannot delete or update a parent row" in raw
    )


def _is_pk_collision(e: IntegrityError, table_name: str) -> bool:
    raw = str(getattr(e, "orig", e)).lower()
    return f"{table_name}_pkey" in raw and "key (id)=" in raw


def _integrity_to_http(e: IntegrityError, duplicate_msg: str) -> None:
    if _is_duplicate_integrity_error(e):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=duplicate_msg)

    if _is_fk_integrity_error(e):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar o modificar porque existen registros asociados.",
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No se ha podido guardar por una restricción de datos. Revisa los campos.",
    )


def _debug_db_identity(db: Session) -> None:
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
                _heal_sequence(db, "paises", "paises_id_seq")
                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    _integrity_to_http(e2, "Ya existe un país con este nombre.")
            else:
                _integrity_to_http(e, "Ya existe un país con este nombre.")

        return obj

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al crear país: {type(e).__name__}")
    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error inesperado al crear país: {type(e).__name__}")


@router.put("/paises/{pais_id}", response_model=Pais)
def update_pais(
    pais_id: int,
    payload: PaisCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Pais, pais_id)
        if not obj:
            raise HTTPException(status_code=404, detail="País no encontrado.")

        nombre = _norm(payload.nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El nombre del país es obligatorio.")

        duplicated = (
            db.query(models.Pais)
            .filter(models.Pais.nombre == nombre, models.Pais.id != pais_id)
            .first()
        )
        if duplicated:
            raise HTTPException(status_code=409, detail="Ya existe un país con este nombre.")

        obj.nombre = nombre
        obj.codigo_iso = _norm(payload.codigo_iso) if payload.codigo_iso else None

        db.commit()
        db.refresh(obj)
        return obj

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "Ya existe un país con este nombre.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError update_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al actualizar país: {type(e).__name__}")


@router.delete("/paises/{pais_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pais(
    pais_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Pais, pais_id)
        if not obj:
            raise HTTPException(status_code=404, detail="País no encontrado.")

        db.delete(obj)
        db.commit()
        return None

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "No se puede eliminar este país.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError delete_pais:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al eliminar país: {type(e).__name__}")


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
                _heal_sequence(db, "regiones", "regiones_id_seq")
                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    _integrity_to_http(e2, "Ya existe una región con este nombre en ese país.")
            else:
                _integrity_to_http(e, "Ya existe una región con este nombre en ese país.")

        created = _refetch_region_with_pais(db, obj.id)
        if not created:
            raise HTTPException(status_code=500, detail="Región creada pero no se ha podido recuperar su contexto.")

        return created

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al crear región: {type(e).__name__}")
    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error inesperado al crear región: {type(e).__name__}")


@router.put("/regiones/{region_id}", response_model=Region)
def update_region(
    region_id: int,
    payload: RegionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Region, region_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Región no encontrada.")

        nombre = _norm(payload.nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El nombre de la región es obligatorio.")

        pais = db.get(models.Pais, payload.pais_id)
        if not pais:
            raise HTTPException(status_code=404, detail="País no encontrado.")

        duplicated = (
            db.query(models.Region)
            .filter(
                models.Region.nombre == nombre,
                models.Region.pais_id == payload.pais_id,
                models.Region.id != region_id,
            )
            .first()
        )
        if duplicated:
            raise HTTPException(status_code=409, detail="Ya existe una región con este nombre en ese país.")

        obj.nombre = nombre
        obj.pais_id = payload.pais_id

        db.commit()

        updated = _refetch_region_with_pais(db, region_id)
        if not updated:
            raise HTTPException(status_code=500, detail="Región actualizada pero no se ha podido recuperar.")
        return updated

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "Ya existe una región con este nombre en ese país.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError update_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al actualizar región: {type(e).__name__}")


@router.delete("/regiones/{region_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_region(
    region_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Region, region_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Región no encontrada.")

        db.delete(obj)
        db.commit()
        return None

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "No se puede eliminar esta región.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError delete_region:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al eliminar región: {type(e).__name__}")


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
                _heal_sequence(db, "localidades", "localidades_id_seq")
                try:
                    obj = _insert_once()
                except IntegrityError as e2:
                    db.rollback()
                    _integrity_to_http(e2, "Ya existe una localidad con ese nombre en esa región.")
            else:
                _integrity_to_http(e, "Ya existe una localidad con ese nombre en esa región.")

        created = _refetch_localidad_with_context(db, obj.id)

        if not created:
            raise HTTPException(status_code=500, detail="Localidad creada pero no se ha podido recuperar su contexto.")

        return created

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError create_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al crear localidad: {type(e).__name__}")
    except Exception as e:
        db.rollback()
        print("[ubicaciones] Exception create_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error inesperado al crear localidad: {type(e).__name__}")


@router.put("/localidades/{localidad_id}", response_model=LocalidadWithContext)
def update_localidad(
    localidad_id: int,
    payload: LocalidadCreate,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Localidad, localidad_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Localidad no encontrada.")

        nombre = _norm(payload.nombre)
        if not nombre:
            raise HTTPException(status_code=422, detail="El nombre de la localidad es obligatorio.")

        region = db.get(models.Region, payload.region_id)
        if not region:
            raise HTTPException(status_code=404, detail="Región no encontrada.")

        duplicated = (
            db.query(models.Localidad)
            .filter(
                models.Localidad.nombre == nombre,
                models.Localidad.region_id == payload.region_id,
                models.Localidad.id != localidad_id,
            )
            .first()
        )
        if duplicated:
            raise HTTPException(status_code=409, detail="Ya existe una localidad con ese nombre en esa región.")

        obj.nombre = nombre
        obj.region_id = payload.region_id

        db.commit()

        updated = _refetch_localidad_with_context(db, localidad_id)
        if not updated:
            raise HTTPException(status_code=500, detail="Localidad actualizada pero no se ha podido recuperar.")
        return updated

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "Ya existe una localidad con ese nombre en esa región.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError update_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al actualizar localidad: {type(e).__name__}")


@router.delete("/localidades/{localidad_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_localidad(
    localidad_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_user),
):
    try:
        obj = db.get(models.Localidad, localidad_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Localidad no encontrada.")

        db.delete(obj)
        db.commit()
        return None

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        _integrity_to_http(e, "No se puede eliminar esta localidad.")
    except SQLAlchemyError as e:
        db.rollback()
        print("[ubicaciones] SQLAlchemyError delete_localidad:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de base de datos al eliminar localidad: {type(e).__name__}")
