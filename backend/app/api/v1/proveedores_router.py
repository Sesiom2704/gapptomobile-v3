"""
Ruta: backend/app/api/v1/proveedores_router.py
Versión: 1.7.0
Descripción:
Router de proveedores para GapptoMobile v3.

Responsabilidades:
- Listar, crear, actualizar y eliminar proveedores.
- Mantener soporte multiusuario.
- Mantener compatibilidad con ubicación legacy por texto y con flujo normalizado
  por localidad_id.
- Exponer y persistir todos los campos del ORM Proveedor.
- Mantener validaciones de negocio existentes.
- Soportar filtro por rama_id y por subsegmento_id.
- Exponer relaciones del proveedor bajo demanda para no penalizar el rendimiento
  del formulario/listado principal.

Cambios de esta versión:
- En /proveedores:
    * se añade `associated_count` por proveedor para que el listado frontend
      pueda mostrar el número real de registros asociados.
- En /{prov_id}/relaciones:
    * se filtran las relaciones con count = 0
    * associated_count se calcula sobre las relaciones visibles
"""

from __future__ import annotations

from typing import List, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func

from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.proveedores import (
    ProveedorCreate,
    ProveedorUpdate,
    ProveedorRead,
    ProveedorRelationsRead,
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
    loc = (
        db.query(models.Localidad)
        .options(
            joinedload(models.Localidad.region).joinedload(models.Region.pais)
        )
        .filter(models.Localidad.id == localidad_id)
        .first()
    )
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


def _get_proveedor_for_user(
    db: Session,
    prov_id: str,
    current_user: models.User,
) -> models.Proveedor:
    obj = (
        db.query(models.Proveedor)
        .filter(
            models.Proveedor.id == prov_id,
            models.Proveedor.user_id == current_user.id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )
    return obj


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


def _merge_count_maps(*maps: Dict[str, int]) -> Dict[str, int]:
    """
    Suma múltiples mapas de contadores por la misma clave.
    """
    merged: Dict[str, int] = {}
    for mp in maps:
        for key, value in mp.items():
            merged[key] = merged.get(key, 0) + int(value or 0)
    return merged


def _get_proveedor_associated_count_map(
    db: Session,
    current_user: models.User,
) -> Dict[str, int]:
    """
    Calcula el número real de referencias asociadas por proveedor del usuario.

    Relaciones consideradas:
    - cuentas_bancarias
    - gastos
    - gastos_cotidianos
    - inversiones_como_proveedor
    - inversiones_como_dealer
    - incidencias_actuales
    - asignaciones_incidencia
    - citas_incidencia
    """
    cuentas_rows = (
        db.query(models.CuentaBancaria.banco_id, func.count(models.CuentaBancaria.id))
        .filter(models.CuentaBancaria.banco_id.isnot(None))
        .group_by(models.CuentaBancaria.banco_id)
        .all()
    )

    gastos_rows = (
        db.query(models.Gasto.proveedor_id, func.count(models.Gasto.id))
        .filter(
            models.Gasto.proveedor_id.isnot(None),
            models.Gasto.user_id == current_user.id,
        )
        .group_by(models.Gasto.proveedor_id)
        .all()
    )

    cotidianos_rows = (
        db.query(models.GastoCotidiano.proveedor_id, func.count(models.GastoCotidiano.id))
        .filter(
            models.GastoCotidiano.proveedor_id.isnot(None),
            models.GastoCotidiano.user_id == current_user.id,
        )
        .group_by(models.GastoCotidiano.proveedor_id)
        .all()
    )

    inversiones_proveedor_rows = (
        db.query(models.Inversion.proveedor_id, func.count(models.Inversion.id))
        .filter(
            models.Inversion.proveedor_id.isnot(None),
            models.Inversion.user_id == current_user.id,
        )
        .group_by(models.Inversion.proveedor_id)
        .all()
    )

    inversiones_dealer_rows = (
        db.query(models.Inversion.dealer_id, func.count(models.Inversion.id))
        .filter(
            models.Inversion.dealer_id.isnot(None),
            models.Inversion.user_id == current_user.id,
        )
        .group_by(models.Inversion.dealer_id)
        .all()
    )

    incidencias_rows = (
        db.query(models.Incidencia.proveedor_actual_id, func.count(models.Incidencia.id))
        .filter(
            models.Incidencia.proveedor_actual_id.isnot(None),
            models.Incidencia.user_id == current_user.id,
        )
        .group_by(models.Incidencia.proveedor_actual_id)
        .all()
    )

    asignaciones_rows = (
        db.query(models.AsignacionIncidencia.proveedor_id, func.count(models.AsignacionIncidencia.id))
        .filter(models.AsignacionIncidencia.proveedor_id.isnot(None))
        .group_by(models.AsignacionIncidencia.proveedor_id)
        .all()
    )

    citas_rows = (
        db.query(models.CitaIncidencia.proveedor_id, func.count(models.CitaIncidencia.id))
        .filter(models.CitaIncidencia.proveedor_id.isnot(None))
        .group_by(models.CitaIncidencia.proveedor_id)
        .all()
    )

    return _merge_count_maps(
        _build_count_map(cuentas_rows),
        _build_count_map(gastos_rows),
        _build_count_map(cotidianos_rows),
        _build_count_map(inversiones_proveedor_rows),
        _build_count_map(inversiones_dealer_rows),
        _build_count_map(incidencias_rows),
        _build_count_map(asignaciones_rows),
        _build_count_map(citas_rows),
    )


def _build_proveedor_relation_counts(
    db: Session,
    prov_id: str,
) -> list[RelationCountItem]:
    """
    Devuelve el detalle de tablas relacionadas y su número de registros.
    Solo devuelve relaciones con count > 0.
    """
    relation_defs = [
        (
            "cuentas_bancarias",
            "Cuentas bancarias",
            db.query(models.CuentaBancaria).filter(models.CuentaBancaria.banco_id == prov_id).count(),
        ),
        (
            "gastos",
            "Gastos",
            db.query(models.Gasto).filter(models.Gasto.proveedor_id == prov_id).count(),
        ),
        (
            "gastos_cotidianos",
            "Gastos cotidianos",
            db.query(models.GastoCotidiano).filter(models.GastoCotidiano.proveedor_id == prov_id).count(),
        ),
        (
            "inversiones_como_proveedor",
            "Inversiones como proveedor",
            db.query(models.Inversion).filter(models.Inversion.proveedor_id == prov_id).count(),
        ),
        (
            "inversiones_como_dealer",
            "Inversiones como dealer",
            db.query(models.Inversion).filter(models.Inversion.dealer_id == prov_id).count(),
        ),
        (
            "incidencias_actuales",
            "Incidencias actuales",
            db.query(models.Incidencia).filter(models.Incidencia.proveedor_actual_id == prov_id).count(),
        ),
        (
            "asignaciones_incidencia",
            "Asignaciones de incidencias",
            db.query(models.AsignacionIncidencia).filter(models.AsignacionIncidencia.proveedor_id == prov_id).count(),
        ),
        (
            "citas_incidencia",
            "Citas de incidencias",
            db.query(models.CitaIncidencia).filter(models.CitaIncidencia.proveedor_id == prov_id).count(),
        ),
    ]

    return [
        RelationCountItem(key=key, label=label, count=count)
        for key, label, count in relation_defs
        if int(count or 0) > 0
    ]


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
    Incluye associated_count para el listado frontend.
    """
    qry = (
        db.query(models.Proveedor)
        .options(
            joinedload(models.Proveedor.rama_rel),
            joinedload(models.Proveedor.subsegmento_rel),
            joinedload(models.Proveedor.localidad_rel)
            .joinedload(models.Localidad.region)
            .joinedload(models.Region.pais),
        )
        .filter(models.Proveedor.user_id == current_user.id)
    )

    if rama_id:
        qry = qry.filter(models.Proveedor.rama_id == rama_id)

    if subsegmento_id:
        qry = qry.filter(models.Proveedor.subsegmento_id == subsegmento_id)

    items = qry.order_by(models.Proveedor.nombre.asc(), models.Proveedor.id.asc()).all()
    count_map = _get_proveedor_associated_count_map(db, current_user)

    result: list[ProveedorRead] = []
    for item in items:
        serialized = ProveedorRead.model_validate(item).model_dump()
        serialized["associated_count"] = int(count_map.get(item.id, 0))
        result.append(ProveedorRead(**serialized))

    return result


# =============================================================================
# GET /proveedores/{prov_id}/relaciones
# =============================================================================
@router.get(
    "/{prov_id}/relaciones",
    response_model=ProveedorRelationsRead,
    summary="Consultar relaciones del proveedor",
)
def get_proveedor_relaciones(
    prov_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve el detalle de tablas relacionadas y el número de registros asociados
    al proveedor. Se usa bajo demanda desde el formulario.
    """
    obj = _get_proveedor_for_user(db, prov_id, current_user)
    relation_counts = _build_proveedor_relation_counts(db, prov_id)
    associated_count = sum(item.count for item in relation_counts)

    return ProveedorRelationsRead(
        id=obj.id,
        nombre=obj.nombre,
        associated_count=associated_count,
        relation_counts=relation_counts,
    )


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

    if payload.get("localidad_id"):
        ub = _resolve_ubicacion_from_localidad_id(db, payload["localidad_id"])
        payload["localidad"] = ub["localidad"]
        payload["comunidad"] = ub["comunidad"]
        payload["pais"] = ub["pais"]
        payload["localidad_id"] = ub["localidad_id"]
    else:
        payload["localidad_id"] = None

    if payload.get("subsegmento_id"):
        sub = _resolve_subsegmento_from_id(db, payload["subsegmento_id"])
        payload["subsegmento_id"] = sub["subsegmento_id"]
        payload["subsegmento"] = sub["subsegmento"]
    else:
        payload["subsegmento"] = normalize_upper(payload.get("subsegmento"))

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
    return obj


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
    obj = _get_proveedor_for_user(db, prov_id, current_user)

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
    return obj


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
    obj = _get_proveedor_for_user(db, prov_id, current_user)

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

    if (
        has_gastos
        or has_cotidianos
        or has_inversiones
        or has_incidencias
        or has_asignaciones
        or has_citas
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: el proveedor está referenciado por movimientos o incidencias.",
        )

    db.delete(obj)
    db.commit()
    return None
