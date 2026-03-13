"""
Ruta: backend/app/api/v1/proveedores_router.py
Versión: 1.5.0
Descripción:
Router de proveedores para GapptoMobile v3.

Responsabilidades:
- Listar, crear, actualizar y eliminar proveedores.
- Mantener soporte multiusuario.
- Mantener compatibilidad con ubicación legacy por texto y con flujo normalizado
  por localidad_id.
- Exponer y persistir todos los nuevos campos del ORM Proveedor.
- Mantener validaciones de negocio existentes.
- Soportar filtro por rama_id y por subsegmento_id.
- NUEVO:
    * devolver relation_counts
    * devolver associated_count
    para mostrar tablas relacionadas y nº de registros asociados.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.proveedores import (
    ProveedorCreate,
    ProveedorUpdate,
    ProveedorRead,
    RelationCountItem,
)
from backend.app.utils.text_utils import normalize_upper
from backend.app.utils.proveedor_utils import validate_proveedor_ubicacion_condicional
from backend.app.utils.id_utils import generate_proveedor_id

router = APIRouter(
    prefix="/proveedores",
    tags=["proveedores"],
)


# =============================================================================
# Helpers internos
# =============================================================================
def _resolve_ubicacion_from_localidad_id(db: Session, localidad_id: int) -> dict:
    """
    Deriva localidad/comunidad/pais desde localidad_id.
    """
    loc = db.get(models.Localidad, localidad_id)
    if not loc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="localidad_id inválido (no existe).",
        )

    region = getattr(loc, "region", None) or getattr(loc, "region_rel", None)
    pais_obj = None
    if region is not None:
        pais_obj = getattr(region, "pais", None) or getattr(region, "pais_rel", None)

    localidad_txt = normalize_upper(getattr(loc, "nombre", None))
    comunidad_txt = normalize_upper(getattr(region, "nombre", None) if region else None)
    pais_txt = normalize_upper(getattr(pais_obj, "nombre", None) if pais_obj else None)

    return {
        "localidad_id": loc.id,
        "localidad": localidad_txt,
        "comunidad": comunidad_txt,
        "pais": pais_txt,
    }


def _resolve_subsegmento_from_id(db: Session, subsegmento_id: Optional[str]) -> dict:
    """
    Intenta resolver el nombre del subsegmento a partir de subsegmento_id.
    Si no existe, devuelve el id y subsegmento=None.
    """
    if not subsegmento_id:
        return {
            "subsegmento_id": None,
            "subsegmento": None,
        }

    model_cls = getattr(models, "TipoSubsegmentoProveedor", None)
    if model_cls is None:
        return {
            "subsegmento_id": subsegmento_id,
            "subsegmento": None,
        }

    obj = db.get(model_cls, subsegmento_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="subsegmento_id inválido (no existe).",
        )

    return {
        "subsegmento_id": obj.id,
        "subsegmento": normalize_upper(getattr(obj, "nombre", None)),
    }


def _normalize_text_fields(data: dict) -> dict:
    """
    Normaliza a MAYÚSCULAS los campos de texto donde aplica.
    """
    text_fields_upper = [
        "nombre",
        "localidad",
        "comunidad",
        "pais",
        "cif",
        "subsegmento",
        "direccion",
        "codigo_postal",
        "persona_contacto",
        "ambito_servicio",
    ]

    for field in text_fields_upper:
        if field in data:
            data[field] = normalize_upper(data[field])

    if "email" in data and data["email"] is not None:
        data["email"] = str(data["email"]).strip().lower() or None

    if "telefono" in data and data["telefono"] is not None:
        data["telefono"] = str(data["telefono"]).strip() or None

    if "observaciones" in data and data["observaciones"] is not None:
        data["observaciones"] = str(data["observaciones"]).strip() or None

    return data


def _build_relation_counts(db: Session, prov_id: str) -> list[RelationCountItem]:
    """
    Devuelve todas las tablas relacionadas relevantes con su nº de registros.
    """
    counts = [
        RelationCountItem(
            key="gastos",
            label="Gastos",
            count=db.query(models.Gasto).filter(models.Gasto.proveedor_id == prov_id).count(),
        ),
        RelationCountItem(
            key="gastos_cotidianos",
            label="Gastos cotidianos",
            count=db.query(models.GastoCotidiano)
            .filter(models.GastoCotidiano.proveedor_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="cuentas_bancarias",
            label="Cuentas bancarias",
            count=db.query(models.CuentaBancaria)
            .filter(models.CuentaBancaria.banco_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="inversiones_como_proveedor",
            label="Inversiones como proveedor",
            count=db.query(models.Inversion)
            .filter(models.Inversion.proveedor_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="inversiones_como_dealer",
            label="Inversiones como dealer",
            count=db.query(models.Inversion)
            .filter(models.Inversion.dealer_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="incidencias_actuales",
            label="Incidencias actuales",
            count=db.query(models.Incidencia)
            .filter(models.Incidencia.proveedor_actual_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="asignaciones_incidencia",
            label="Asignaciones de incidencia",
            count=db.query(models.AsignacionIncidencia)
            .filter(models.AsignacionIncidencia.proveedor_id == prov_id)
            .count(),
        ),
        RelationCountItem(
            key="citas_incidencia",
            label="Citas de incidencia",
            count=db.query(models.CitaIncidencia)
            .filter(models.CitaIncidencia.proveedor_id == prov_id)
            .count(),
        ),
    ]

    return counts


def _serialize_proveedor_with_counts(db: Session, obj: models.Proveedor) -> ProveedorRead:
    relation_counts = _build_relation_counts(db, obj.id)
    associated_count = sum(item.count for item in relation_counts)

    return ProveedorRead.model_validate(
        {
            **ProveedorRead.model_validate(obj, from_attributes=True).model_dump(),
            "associated_count": associated_count,
            "relation_counts": [item.model_dump() for item in relation_counts],
        }
    )


# =============================================================================
# GET /proveedores
# =============================================================================
@router.get(
    "",
    response_model=List[ProveedorRead],
    summary="Listar proveedores",
)
def list_proveedores(
    rama_id: Optional[str] = Query(None, description="Filtrar por rama_id"),
    subsegmento_id: Optional[str] = Query(None, description="Filtrar por subsegmento_id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista proveedores del usuario autenticado.
    """
    qry = db.query(models.Proveedor).filter(models.Proveedor.user_id == current_user.id)

    if rama_id:
        qry = qry.filter(models.Proveedor.rama_id == rama_id)

    if subsegmento_id:
        qry = qry.filter(models.Proveedor.subsegmento_id == subsegmento_id)

    qry = qry.order_by(models.Proveedor.nombre.asc(), models.Proveedor.id.asc())
    rows = qry.all()
    return [_serialize_proveedor_with_counts(db, row) for row in rows]


# =============================================================================
# POST /proveedores
# =============================================================================
@router.post(
    "",
    response_model=ProveedorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear proveedor",
)
def create_proveedor(
    prov_in: ProveedorCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un proveedor nuevo.
    """
    payload = prov_in.model_dump()

    payload = _normalize_text_fields(payload)

    nombre_up = payload.get("nombre") or ""

    # Ubicación
    if payload.get("localidad_id"):
        ub = _resolve_ubicacion_from_localidad_id(db, payload["localidad_id"])
        payload["localidad"] = ub["localidad"]
        payload["comunidad"] = ub["comunidad"]
        payload["pais"] = ub["pais"]
        payload["localidad_id"] = ub["localidad_id"]
    else:
        payload["localidad_id"] = None

    # Subsegmento
    if payload.get("subsegmento_id"):
        sub = _resolve_subsegmento_from_id(db, payload["subsegmento_id"])
        payload["subsegmento_id"] = sub["subsegmento_id"]
        payload["subsegmento"] = sub["subsegmento"]
    else:
        payload["subsegmento"] = normalize_upper(payload.get("subsegmento"))

    # Unicidad nombre por usuario
    exists = (
        db.query(models.Proveedor)
        .filter(
            models.Proveedor.user_id == current_user.id,
            models.Proveedor.nombre == nombre_up,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un proveedor con este nombre.",
        )

    validate_proveedor_ubicacion_condicional(
        db,
        payload["rama_id"],
        payload.get("localidad"),
        payload.get("pais"),
        payload.get("comunidad"),
    )

    new_id = generate_proveedor_id(db)

    obj = models.Proveedor(
        id=new_id,
        user_id=current_user.id,
        nombre=payload["nombre"],
        rama_id=payload["rama_id"],
        localidad_id=payload.get("localidad_id"),
        localidad=payload.get("localidad"),
        pais=payload.get("pais"),
        comunidad=payload.get("comunidad"),
        cif=payload.get("cif"),
        telefono=payload.get("telefono"),
        email=payload.get("email"),
        subsegmento=payload.get("subsegmento"),
        subsegmento_id=payload.get("subsegmento_id"),
        direccion=payload.get("direccion"),
        codigo_postal=payload.get("codigo_postal"),
        persona_contacto=payload.get("persona_contacto"),
        activo=payload.get("activo", True),
        observaciones=payload.get("observaciones"),
        acepta_urgencias=payload.get("acepta_urgencias", False),
        ambito_servicio=payload.get("ambito_servicio"),
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_proveedor_with_counts(db, obj)


# =============================================================================
# PUT /proveedores/{prov_id}
# =============================================================================
@router.put(
    "/{prov_id}",
    response_model=ProveedorRead,
    summary="Actualizar proveedor",
)
def update_proveedor(
    prov_id: str,
    prov_in: ProveedorUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un proveedor existente.
    """
    obj = db.get(models.Proveedor, prov_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )

    data = prov_in.model_dump(exclude_unset=True)
    data = _normalize_text_fields(data)

    if "nombre" in data and data["nombre"] is not None:
        nombre_up = data["nombre"] or ""
        exists = (
            db.query(models.Proveedor)
            .filter(
                models.Proveedor.user_id == current_user.id,
                models.Proveedor.nombre == nombre_up,
                models.Proveedor.id != prov_id,
            )
            .first()
        )
        if exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un proveedor con este nombre.",
            )

    if "localidad_id" in data and data["localidad_id"]:
        ub = _resolve_ubicacion_from_localidad_id(db, data["localidad_id"])
        data["localidad"] = ub["localidad"]
        data["comunidad"] = ub["comunidad"]
        data["pais"] = ub["pais"]
        data["localidad_id"] = ub["localidad_id"]

    if "localidad_id" in data and data["localidad_id"] is None:
        pass

    if "subsegmento_id" in data:
        if data["subsegmento_id"]:
            sub = _resolve_subsegmento_from_id(db, data["subsegmento_id"])
            data["subsegmento_id"] = sub["subsegmento_id"]
            data["subsegmento"] = sub["subsegmento"]
        else:
            data["subsegmento_id"] = None
            data["subsegmento"] = None

    rama_objetivo = data.get("rama_id", obj.rama_id)
    loc_objetivo = data.get("localidad", obj.localidad)
    pais_objetivo = data.get("pais", obj.pais)
    com_objetivo = data.get("comunidad", obj.comunidad)

    validate_proveedor_ubicacion_condicional(
        db,
        rama_objetivo,
        loc_objetivo,
        pais_objetivo,
        com_objetivo,
    )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return _serialize_proveedor_with_counts(db, obj)


# =============================================================================
# DELETE /proveedores/{prov_id}
# =============================================================================
@router.delete(
    "/{prov_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar proveedor",
)
def delete_proveedor(
    prov_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Elimina un proveedor si no tiene referencias.
    """
    obj = db.get(models.Proveedor, prov_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )

    has_gastos = (
        db.query(models.Gasto.id)
        .filter(models.Gasto.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_cotidianos = (
        db.query(models.GastoCotidiano.id)
        .filter(models.GastoCotidiano.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_inversiones = (
        db.query(models.Inversion.id)
        .filter(
            or_(
                models.Inversion.proveedor_id == prov_id,
                models.Inversion.dealer_id == prov_id,
            )
        )
        .first()
        is not None
    )

    has_incidencias = (
        db.query(models.Incidencia.id)
        .filter(models.Incidencia.proveedor_actual_id == prov_id)
        .first()
        is not None
    )

    has_asignaciones = (
        db.query(models.AsignacionIncidencia.id)
        .filter(models.AsignacionIncidencia.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_citas = (
        db.query(models.CitaIncidencia.id)
        .filter(models.CitaIncidencia.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_cuentas = (
        db.query(models.CuentaBancaria.id)
        .filter(models.CuentaBancaria.banco_id == prov_id)
        .first()
        is not None
    )

    if (
        has_gastos
        or has_cotidianos
        or has_inversiones
        or has_incidencias
        or has_asignaciones
        or has_citas
        or has_cuentas
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: el proveedor está referenciado por otros registros.",
        )

    db.delete(obj)
    db.commit()
    return None