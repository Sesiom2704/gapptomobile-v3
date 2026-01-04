# backend/app/api/v1/ubicaciones_router.py
"""
Router: Ubicaciones (Países / Regiones / Localidades)

Mejoras principales:
1) Diagnóstico: imprime qué base de datos está usando el backend (current_database).
2) Autofix: si al crear Localidad hay colisión de PK (localidades_pkey),
   re-sincroniza la secuencia a MAX(id) y reintenta 1 vez.
3) Mantiene idempotencia por (nombre, region_id) y el comportamiento previo.

Nota sobre el bug observado:
- Tus consultas SQL muestran secuencia correcta (last_value=17 => nextval debería ser 18).
- Si el backend intenta insertar id=3, en práctica suele ser:
    a) backend conectado a otra BD
    b) secuencia en esa BD está desincronizada
- Este código te lo confirma en logs, y lo repara si aplica.
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
    Heurística: detecta duplicados UNIQUE/PK por texto del driver.
    """
    raw = str(getattr(e, "orig", e)).lower()
    return (
        ("duplicate key" in raw and "unique" in raw)  # Postgres
        or ("unique constraint" in raw)              # SQLite
        or ("duplicate entry" in raw)                # MySQL
    )


def _is_localidades_pk_collision(e: IntegrityError) -> bool:
    """
    Detecta específicamente la colisión por PRIMARY KEY de localidades.
    Ejemplo:
      duplicate key value violates unique constraint "localidades_pkey"
      DETAIL: Key (id)=(3) already exists.
    """
    raw = str(getattr(e, "orig", e)).lower()
    return "localidades_pkey" in raw and "key (id)=" in raw


def _integrity_to_http(e: IntegrityError, duplicate_msg: str):
    """
    Mapea IntegrityError a HTTP controlado:
    - 409 si es duplicado
    - 400 si es otra restricción
    """
    if _is_duplicate_integrity_error(e):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=duplicate_msg)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No se ha podido guardar por una restricción de datos. Revisa los campos.",
    )


def _debug_db_identity(db: Session) -> None:
    """
    Diagnóstico mínimo: confirma qué DB está usando el backend.

    Si esto no coincide con donde ejecutaste tus queries manuales,
    ya tienes la causa del problema.
    """
    try:
        row = db.execute(
            "SELECT current_database() AS db, inet_server_addr() AS addr, inet_server_port() AS port"
        ).mappings().first()
        if row:
            print(f"[ubicaciones][db] current_database={row['db']} addr={row['addr']} port={row['port']}")
    except Exception as ex:
        # No romper nada por logging
        print("[ubicaciones][db] No se pudo obtener identidad BD:", ex)


def _heal_localidades_sequence(db: Session) -> None:
    """
    Repara la secuencia de localidades para que el próximo nextval sea MAX(id)+1.

    Esto es seguro y estándar cuando hay imports/restores que desincronizan secuencias.

    Importante:
    - Usamos public.localidades_id_seq según tu query 2.
    - Ajusta si tu secuencia real difiere.
    """
    max_id = db.execute("SELECT COALESCE(MAX(id), 0) AS m FROM localidades").mappings().first()["m"]
    # setval(seq, value, is_called=true) => next nextval() devolverá value+1
    db.execute("SELECT setval('public.localidades_id_seq', :v, true)", {"v": int(max_id)})
    print(f"[ubicaciones] Heal sequence localidades_id_seq -> setval({max_id}, true)")


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

    existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
    if existente:
        return existente

    obj = models.Pais(nombre=nombre, codigo_iso=payload.codigo_iso)
    db.add(obj)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        existente = db.query(models.Pais).filter(models.Pais.nombre == nombre).first()
        if existente:
            return existente

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
    Crea localidad (idempotente por nombre+region_id).

    Protección adicional:
    - Si detectamos colisión PK (localidades_pkey), reparamos secuencia y reintentamos 1 vez.
    - Además imprimimos la identidad de BD (para descartar DB equivocada).
    """
    _debug_db_identity(db)

    nombre = _norm(payload.nombre)
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la localidad es obligatorio.")

    # Región debe existir
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

    def _insert_once() -> models.Localidad:
        obj = models.Localidad(nombre=nombre, region_id=payload.region_id)
        # Aseguramos que NUNCA se fuerza id desde Python
        obj.id = None  # defensivo
        db.add(obj)
        db.commit()
        return obj

    try:
        obj = _insert_once()
    except IntegrityError as e:
        db.rollback()

        # Carrera concurrente: puede existir ahora
        existente2 = (
            db.query(models.Localidad)
            .filter(models.Localidad.nombre == nombre, models.Localidad.region_id == payload.region_id)
            .first()
        )
        if existente2:
            return (
                db.query(models.Localidad)
                .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
                .filter(models.Localidad.id == existente2.id)
                .first()
            )

        # Caso especial: colisión PK => secuencia desincronizada o BD distinta
        if _is_localidades_pk_collision(e):
            print(
                "[ubicaciones] IntegrityError create_localidad (PK collision):",
                str(getattr(e, "orig", e)),
                "payload=",
                payload,
            )

            # Diagnóstico adicional: nextval real desde ESTA conexión
            try:
                nxt = db.execute("SELECT nextval('public.localidades_id_seq') AS n").mappings().first()["n"]
                print(f"[ubicaciones] Debug nextval(public.localidades_id_seq) (antes heal) -> {nxt}")
            except Exception as ex:
                print("[ubicaciones] No se pudo ejecutar nextval diagnóstico:", ex)

            # Heal sequence y reintento 1 vez
            _heal_localidades_sequence(db)
            try:
                obj = _insert_once()
            except IntegrityError as e2:
                db.rollback()
                print("[ubicaciones] IntegrityError tras heal+retry:", str(getattr(e2, "orig", e2)), "payload=", payload)
                _integrity_to_http(e2, "No se ha podido crear la localidad (conflicto de datos).")
        else:
            print("[ubicaciones] IntegrityError create_localidad:", str(getattr(e, "orig", e)), "payload=", payload)
            _integrity_to_http(e, "Ya existe una localidad con ese nombre en esa región.")

    # Refetch con contexto
    created = (
        db.query(models.Localidad)
        .options(joinedload(models.Localidad.region).joinedload(models.Region.pais))
        .filter(models.Localidad.id == obj.id)
        .first()
    )
    if not created:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Localidad creada pero no se ha podido recuperar su contexto.",
        )

    return created
