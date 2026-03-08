# backend/app/api/v1/ingresos_router.py
"""
Router de INGRESOS para GapptoMobile v3.

Mantiene:
- Estructura de endpoints.
- Lógica de liquidez (ajustes en CuentaBancaria).
- Lógica de PAGO UNICO (activo/cobrado/kpi/inactivatedon).
- Ponderación por participación_pct de Patrimonio en /extra.
- Multiusuario con require_user.
- Normalización de textos a MAYÚSCULAS.

Añadidos en v3:
- Asociación de cada ingreso a un user_id.
- Estado omitido_este_mes.
- Campo contrato_alquiler.
- NUEVO: soporte de ramas de ingreso:
    * Primero se elige rama.
    * Luego se listan los tipos asociados a esa rama.
    * En create/update se valida coherencia entre rama_id y tipo_id.
"""

from typing import List, Optional, Any, Dict
from datetime import date
from calendar import monthrange
import string
import re

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    status,
    Query,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, cast, Date
from sqlalchemy.exc import IntegrityError, DataError

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.ingresos import (
    IngresoSchema,
    IngresoCreateSchema,
    IngresoUpdateSchema,
)
from backend.app.utils.common import safe_float, adjust_liquidez, extract_cuenta_id
from backend.app.utils.id_utils import generate_ingreso_id
from backend.app.utils.text_utils import normalize_upper
from backend.app.core.constants import PERIODICIDAD_PAGO_UNICO
from backend.app.api.v1.auth_router import require_user

router = APIRouter(tags=["ingresos"])


# ============================================================
# Schemas ligeros para catálogos UI
# ============================================================

class RamaIngresoOut(BaseModel):
    id: str
    nombre: str


class TipoIngresoOut(BaseModel):
    id: str
    nombre: str
    rama_id: Optional[str] = None


# ============================================================
# Helpers generales
# ============================================================

_ID_RE = re.compile(r"^INGRESO-[A-Z0-9]{6}$")
_ALPHABET = string.ascii_uppercase + string.digits


def to_payload(model: BaseModel, *, exclude_unset: bool = False) -> Dict[str, Any]:
    """
    Compatibilidad Pydantic v1/v2.
    """
    if hasattr(model, "model_dump"):  # Pydantic v2
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def _norm_ref_id(val) -> str | None:
    """
    Normaliza referencia_vivienda_id:
      - None / '' / 'none' -> None
      - Otro string -> UPPER(trim)
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    if s.lower() == "none":
        return None
    return s.upper()


def _serialize_ingreso(obj: Any) -> Dict[str, Any]:
    """
    Convierte un objeto ORM Ingreso en dict listo para el schema.

    Incluye:
    - rama_id
    - rama_nombre
    - tipo_nombre
    - omitidos
    - contrato_alquiler
    """
    rama_rel = getattr(obj, "rama_rel", None)
    tipo_rel = getattr(obj, "tipo_rel", None)
    user_rel = getattr(obj, "user", None)

    return {
        "id": obj.id,
        "fecha_inicio": getattr(obj, "fecha_inicio", None),
        "rango_cobro": getattr(obj, "rango_cobro", None),
        "periodicidad": getattr(obj, "periodicidad", None),

        # NUEVO: ramas
        "rama_id": getattr(obj, "rama_id", None),
        "rama_nombre": getattr(rama_rel, "nombre", None) if rama_rel else None,

        "tipo_id": getattr(obj, "tipo_id", None),
        "tipo_nombre": getattr(tipo_rel, "nombre", None) if tipo_rel else None,

        "referencia_vivienda_id": getattr(obj, "referencia_vivienda_id", None),
        "concepto": getattr(obj, "concepto", None),
        "importe": float(getattr(obj, "importe", 0) or 0),
        "activo": getattr(obj, "activo", True),
        "cobrado": getattr(obj, "cobrado", False),
        "kpi": getattr(obj, "kpi", False),
        "ingresos_cobrados": getattr(obj, "ingresos_cobrados", None),
        "createon": getattr(obj, "createon", None),
        "modifiedon": getattr(obj, "modifiedon", None),
        "inactivatedon": getattr(obj, "inactivatedon", None),
        "ultimo_ingreso_on": getattr(obj, "ultimo_ingreso_on", None),

        # omitidos
        "omitido_este_mes": getattr(obj, "omitido_este_mes", False),
        "ultimo_omitido_on": getattr(obj, "ultimo_omitido_on", None),
        "omitido_count": getattr(obj, "omitido_count", 0),

        # alquiler
        "contrato_alquiler": getattr(obj, "contrato_alquiler", None),

        "cuenta_id": extract_cuenta_id(obj),

        "user_id": getattr(obj, "user_id", None),
        "user_nombre": getattr(user_rel, "full_name", None) or getattr(user_rel, "email", None),
    }


def _serialize_ingreso_ponderado(
    obj: Any,
    pct_map: Dict[str, float],
) -> Dict[str, Any]:
    """
    Serializa el ingreso ponderando el importe por participación_pct
    según referencia_vivienda_id.
    """
    data = _serialize_ingreso(obj)
    ref = _norm_ref_id(data.get("referencia_vivienda_id"))
    pct = pct_map.get(ref, 100.0) if ref else 100.0
    try:
        data["importe"] = round(float(data.get("importe") or 0.0) * (pct / 100.0), 2)
    except Exception:
        pass
    return data


def _normalize_ingreso_text_payload(d: Dict[str, Any]) -> None:
    """
    Regla global:
    - Todo texto en BD en MAYÚSCULAS.

    En ingresos:
    - rango_cobro
    - periodicidad
    - concepto
    - rama_id
    - tipo_id
    - referencia_vivienda_id
    - cuenta_id
    """
    text_fields = [
        "rango_cobro",
        "periodicidad",
        "concepto",
        "rama_id",
        "tipo_id",
        "referencia_vivienda_id",
        "cuenta_id",
    ]
    for f in text_fields:
        if f in d:
            d[f] = normalize_upper(d.get(f))


def _get_ingreso_for_user(
    db: Session,
    ingreso_id: str,
    current_user: models.User,
) -> models.Ingreso:
    """
    Recupera un ingreso asegurando ownership del usuario actual.
    """
    obj = (
        db.query(models.Ingreso)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .filter(
            models.Ingreso.id == ingreso_id,
            models.Ingreso.user_id == current_user.id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Ingreso no encontrado")
    return obj


def _get_rama_ingreso_or_404(db: Session, rama_id: str) -> models.TipoRamasIngreso:
    """
    Valida que la rama exista.
    """
    obj = (
        db.query(models.TipoRamasIngreso)
        .filter(models.TipoRamasIngreso.id == rama_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="La rama de ingreso no existe")
    return obj


def _get_tipo_ingreso_or_404(db: Session, tipo_id: str) -> models.TipoIngreso:
    """
    Valida que el tipo exista.
    """
    obj = (
        db.query(models.TipoIngreso)
        .options(joinedload(models.TipoIngreso.rama_rel))
        .filter(models.TipoIngreso.id == tipo_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="El tipo de ingreso no existe")
    return obj


def _validate_rama_tipo_ingreso(
    db: Session,
    *,
    rama_id: Optional[str],
    tipo_id: Optional[str],
) -> tuple[Optional[models.TipoRamasIngreso], Optional[models.TipoIngreso]]:
    """
    Valida la coherencia entre rama_id y tipo_id.

    Reglas:
    - ambos deben venir informados para create y para updates de cambio funcional
    - la rama debe existir
    - el tipo debe existir
    - el tipo debe pertenecer a la rama
    """
    if not rama_id:
        raise HTTPException(status_code=422, detail="rama_id es obligatorio")
    if not tipo_id:
        raise HTTPException(status_code=422, detail="tipo_id es obligatorio")

    rama = _get_rama_ingreso_or_404(db, rama_id)
    tipo = _get_tipo_ingreso_or_404(db, tipo_id)

    if (tipo.rama_id or "").upper() != (rama.id or "").upper():
        raise HTTPException(
            status_code=422,
            detail="El tipo de ingreso no pertenece a la rama seleccionada.",
        )

    return rama, tipo


def _resolve_rama_tipo_for_update(
    db: Session,
    *,
    obj: models.Ingreso,
    incoming: Dict[str, Any],
) -> tuple[Optional[models.TipoRamasIngreso], Optional[models.TipoIngreso]]:
    """
    Resuelve rama/tipo final en update.

    Casos:
    - si viene rama_id y no tipo_id -> inválido
    - si viene tipo_id y no rama_id -> inválido
    - si no viene ninguno -> no valida nada
    - si vienen ambos -> valida combinación final
    """
    has_rama = "rama_id" in incoming
    has_tipo = "tipo_id" in incoming

    if has_rama != has_tipo:
        raise HTTPException(
            status_code=422,
            detail="Para cambiar la clasificación del ingreso debes enviar rama_id y tipo_id juntos.",
        )

    if not has_rama and not has_tipo:
        return None, None

    rama_id = incoming.get("rama_id")
    tipo_id = incoming.get("tipo_id")

    return _validate_rama_tipo_ingreso(
        db,
        rama_id=rama_id,
        tipo_id=tipo_id,
    )


# ============================================================
# Catálogos UI para selector rama -> tipos
# ============================================================

@router.get("/ramas", response_model=List[RamaIngresoOut])
def list_ramas_ingreso(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve las ramas de ingreso para pintar el primer nivel de botones en UI.
    """
    rows = (
        db.query(models.TipoRamasIngreso)
        .order_by(models.TipoRamasIngreso.nombre.asc())
        .all()
    )
    return [{"id": r.id, "nombre": r.nombre} for r in rows]


@router.get("/tipos-por-rama/{rama_id}", response_model=List[TipoIngresoOut])
def list_tipos_por_rama(
    rama_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve los tipos de ingreso asociados a una rama concreta.

    Este endpoint es el que usará el front después de pulsar un botón de rama.
    """
    rama_id = normalize_upper(rama_id)
    _get_rama_ingreso_or_404(db, rama_id)

    rows = (
        db.query(models.TipoIngreso)
        .filter(models.TipoIngreso.rama_id == rama_id)
        .order_by(models.TipoIngreso.nombre.asc())
        .all()
    )
    return [{"id": t.id, "nombre": t.nombre, "rama_id": t.rama_id} for t in rows]


# ============================================================
# Vistas rápidas (para UI)
# ============================================================

@router.get("/pendientes", response_model=List[IngresoSchema])
def list_pendientes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista ingresos NO cobrados del usuario actual.
    Excluye omitidos_este_mes.
    """
    objs = (
        db.query(models.Ingreso)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado == False,
            models.Ingreso.omitido_este_mes == False,
        )
        .order_by(
            models.Ingreso.fecha_inicio.asc().nullslast(),
            models.Ingreso.createon.asc(),
        )
        .all()
    )
    return [_serialize_ingreso(o) for o in objs]


@router.get("/activos", response_model=List[IngresoSchema])
def list_activos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista ingresos activos del usuario actual.
    """
    objs = (
        db.query(models.Ingreso)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo == True,
        )
        .order_by(
            models.Ingreso.fecha_inicio.asc().nullslast(),
            models.Ingreso.createon.asc(),
        )
        .all()
    )
    return [_serialize_ingreso(o) for o in objs]


@router.get("/inactivos", response_model=List[IngresoSchema])
def list_inactivos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista ingresos inactivos del usuario actual.
    """
    objs = (
        db.query(models.Ingreso)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo == False,
        )
        .order_by(
            models.Ingreso.fecha_inicio.asc().nullslast(),
            models.Ingreso.createon.asc(),
        )
        .all()
    )
    return [_serialize_ingreso(o) for o in objs]


# ============================================================
# CRUD
# ============================================================

@router.post(
    "/",
    response_model=IngresoSchema,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "",
    response_model=IngresoSchema,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def create_ingreso(
    ingreso_in: IngresoCreateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un ingreso para el usuario actual.

    NUEVO:
    - valida rama_id + tipo_id
    - el tipo debe pertenecer a la rama elegida
    """
    payload = to_payload(ingreso_in)

    for k in [
        "rango_cobro",
        "periodicidad",
        "rama_id",
        "tipo_id",
        "referencia_vivienda_id",
        "concepto",
        "cuenta_id",
    ]:
        if k in payload and isinstance(payload[k], str) and payload[k].strip() == "":
            payload[k] = None

    _normalize_ingreso_text_payload(payload)

    # Validación funcional nueva
    _validate_rama_tipo_ingreso(
        db,
        rama_id=payload.get("rama_id"),
        tipo_id=payload.get("tipo_id"),
    )

    raw_id = (payload.get("id") or "").upper()
    payload["id"] = raw_id if _ID_RE.fullmatch(raw_id) else generate_ingreso_id()

    payload["user_id"] = current_user.id

    payload.setdefault("omitido_este_mes", False)
    payload.setdefault("omitido_count", 0)

    periodicidad = (payload.get("periodicidad") or "").strip().upper()
    importe = safe_float(payload.get("importe"))
    cuenta_id = payload.get("cuenta_id")

    if periodicidad == PERIODICIDAD_PAGO_UNICO:
        payload["activo"] = False
        payload["cobrado"] = True
        payload["kpi"] = False
        payload["inactivatedon"] = func.now()
        payload["ultimo_ingreso_on"] = func.now()
        payload["omitido_este_mes"] = False

    for _ in range(5):
        try:
            obj = models.Ingreso(**payload)
            db.add(obj)

            if periodicidad == PERIODICIDAD_PAGO_UNICO:
                adjust_liquidez(db, cuenta_id, +importe)

            db.commit()
            db.refresh(obj)
            obj = _get_ingreso_for_user(db, obj.id, current_user)
            return _serialize_ingreso(obj)

        except IntegrityError as e:
            db.rollback()

            err_msg = str(getattr(e, "orig", e)).upper()

            # Solo reintentamos si realmente es colisión de PK / ID
            is_duplicate_id = (
                'INGRESOS_PKEY' in err_msg
                or 'DUPLICATE KEY VALUE' in err_msg and '(ID)' in err_msg
                or 'KEY (ID)=' in err_msg
            )

            if is_duplicate_id:
                payload["id"] = generate_ingreso_id()
                continue

            raise HTTPException(
                status_code=400,
                detail=f"Error de integridad al crear ingreso: {getattr(e, 'orig', e)}",
            )
        except DataError as e:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"Datos inválidos: {e.orig}",
            )

    raise HTTPException(
        status_code=500,
        detail="No se pudo generar un ID único para el ingreso tras varios intentos.",
    )


def _month_range(year: int, month: int) -> tuple[date, date]:
    """
    Devuelve (primer_día, último_día) del mes indicado.
    """
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


@router.get("/extra", response_model=List[IngresoSchema])
def list_ingresos_extra(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=1900, le=3000),
    q: Optional[str] = Query(None, description="Busca en concepto"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista ingresos PAGO UNICO del usuario actual,
    mostrando el importe ponderado por Patrimonio.participacion_pct.
    """
    effective_date = func.coalesce(
        models.Ingreso.fecha_inicio,
        cast(models.Ingreso.createon, Date),
    )

    qset = (
        db.query(models.Ingreso, models.Patrimonio.participacion_pct)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .outerjoin(
            models.Patrimonio,
            models.Patrimonio.id == models.Ingreso.referencia_vivienda_id,
        )
        .filter(
            models.Ingreso.user_id == current_user.id,
            func.upper(models.Ingreso.periodicidad) == PERIODICIDAD_PAGO_UNICO,
        )
    )

    if month is not None and year is not None:
        start, end = _month_range(year, month)
        qset = qset.filter(effective_date >= start, effective_date <= end)

    if q:
        patt = f"%{q.strip().lower()}%"
        qset = qset.filter(func.lower(models.Ingreso.concepto).like(patt))

    qset = qset.order_by(
        effective_date.desc().nullslast(),
        models.Ingreso.createon.desc(),
    )

    rows = qset.all()
    out: List[dict] = []
    for inc, pct in rows:
        ref = _norm_ref_id(getattr(inc, "referencia_vivienda_id", None))
        factor = (float(pct or 100.0) / 100.0) if ref else 1.0
        base = float(getattr(inc, "importe", 0.0) or 0.0)
        ponderado = round(base * factor, 2)

        d = _serialize_ingreso(inc)
        d["importe"] = ponderado
        out.append(d)

    return out


@router.get("/", response_model=List[IngresoSchema])
@router.get("", response_model=List[IngresoSchema], include_in_schema=False)
def list_all(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista todos los ingresos del usuario actual.
    """
    objs = (
        db.query(models.Ingreso)
        .options(
            joinedload(models.Ingreso.rama_rel),
            joinedload(models.Ingreso.tipo_rel),
            joinedload(models.Ingreso.user),
            joinedload(models.Ingreso.cuenta),
        )
        .filter(models.Ingreso.user_id == current_user.id)
        .order_by(
            models.Ingreso.fecha_inicio.asc().nullslast(),
            models.Ingreso.createon.asc(),
        )
        .all()
    )
    return [_serialize_ingreso(o) for o in objs]


@router.get("/{ingreso_id}", response_model=IngresoSchema)
def get_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Recupera un ingreso por id, asegurando ownership.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    return _serialize_ingreso(obj)


@router.patch("/{ingreso_id}", response_model=IngresoSchema)
def update_ingreso(
    ingreso_id: str,
    ingreso_in: IngresoUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un ingreso del usuario actual.

    Reglas nuevas:
    - si se cambia rama/tipo, deben venir ambos
    - el tipo debe pertenecer a la rama
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    incoming = to_payload(ingreso_in, exclude_unset=True)

    for k, v in list(incoming.items()):
        if isinstance(v, str) and v.strip() == "":
            incoming[k] = None

    _normalize_ingreso_text_payload(incoming)

    # Validación funcional nueva
    _resolve_rama_tipo_for_update(db, obj=obj, incoming=incoming)

    if incoming.get("cobrado") is True and incoming.get("omitido_este_mes") is True:
        raise HTTPException(
            status_code=422,
            detail="Estado inválido: un ingreso no puede estar cobrado y omitido a la vez.",
        )

    if incoming.get("omitido_este_mes") is True and bool(getattr(obj, "cobrado", False)) is True:
        raise HTTPException(status_code=409, detail="No se puede omitir un ingreso ya cobrado.")

    if "activo" in incoming:
        prev = bool(getattr(obj, "activo", True))
        newv = bool(incoming["activo"])
        if prev and not newv:
            obj.inactivatedon = func.now()
        elif not prev and newv:
            obj.inactivatedon = None

    if incoming.get("omitido_este_mes") is True:
        incoming["ultimo_omitido_on"] = func.now()

    for field, value in incoming.items():
        setattr(obj, field, value)

    if bool(getattr(obj, "cobrado", False)) is True:
        obj.omitido_este_mes = False

    if (getattr(obj, "periodicidad", "") or "").strip().upper() == PERIODICIDAD_PAGO_UNICO:
        obj.omitido_este_mes = False

    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
    obj = _get_ingreso_for_user(db, obj.id, current_user)
    return _serialize_ingreso(obj)


@router.delete("/{ingreso_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Elimina un ingreso del usuario actual.

    Si es PAGO UNICO:
    - revierte el impacto en liquidez.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    periodicidad = (getattr(obj, "periodicidad", "") or "").strip().upper()
    if periodicidad == PERIODICIDAD_PAGO_UNICO:
        importe = safe_float(getattr(obj, "importe", 0.0))
        cuenta_id = extract_cuenta_id(obj)
        adjust_liquidez(db, cuenta_id, -importe)

    db.delete(obj)
    db.commit()
    return {"detail": "Ingreso eliminado"}


# ============================================================
# ACCIONES
# ============================================================

@router.put("/{ingreso_id}/omitir", response_model=IngresoSchema)
def omitir_ingreso_mes(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso como omitido este mes.
    """
    ingreso = _get_ingreso_for_user(db, ingreso_id, current_user)

    if bool(getattr(ingreso, "cobrado", False)) is True:
        raise HTTPException(status_code=409, detail="No se puede omitir un ingreso ya cobrado.")

    per = (getattr(ingreso, "periodicidad", "") or "").strip().upper()
    if per == PERIODICIDAD_PAGO_UNICO:
        raise HTTPException(status_code=409, detail="No se puede omitir un PAGO UNICO.")

    ingreso.omitido_este_mes = True
    ingreso.ultimo_omitido_on = func.now()
    ingreso.modifiedon = func.now()

    db.commit()
    db.refresh(ingreso)
    ingreso = _get_ingreso_for_user(db, ingreso.id, current_user)
    return _serialize_ingreso(ingreso)


@router.put("/{ingreso_id}/deshacer-omision", response_model=IngresoSchema)
def deshacer_omision_ingreso_mes(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Revierte omitido este mes.
    """
    ingreso = _get_ingreso_for_user(db, ingreso_id, current_user)

    ingreso.omitido_este_mes = False
    ingreso.modifiedon = func.now()

    db.commit()
    db.refresh(ingreso)
    ingreso = _get_ingreso_for_user(db, ingreso.id, current_user)
    return _serialize_ingreso(ingreso)


@router.put("/{ingreso_id}/cobrar", response_model=IngresoSchema)
def cobrar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso como cobrado y ajusta liquidez si corresponde.
    """
    ingreso = _get_ingreso_for_user(db, ingreso_id, current_user)

    if bool(getattr(ingreso, "omitido_este_mes", False)) is True:
        ingreso.omitido_este_mes = False

    was_cobrado = bool(getattr(ingreso, "cobrado", False))
    ingreso.cobrado = True
    ingreso.ingresos_cobrados = (ingreso.ingresos_cobrados or 0) + (0 if was_cobrado else 1)
    ingreso.modifiedon = func.now()
    ingreso.ultimo_ingreso_on = func.now()

    if not was_cobrado:
        adjust_liquidez(
            db,
            extract_cuenta_id(ingreso),
            +safe_float(ingreso.importe),
        )

    db.commit()
    db.refresh(ingreso)
    ingreso = _get_ingreso_for_user(db, ingreso.id, current_user)
    return _serialize_ingreso(ingreso)


@router.put("/{ingreso_id}/activar", response_model=IngresoSchema)
def activar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso como activo.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    obj.activo = True
    obj.inactivatedon = None
    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
    obj = _get_ingreso_for_user(db, obj.id, current_user)
    return _serialize_ingreso(obj)


@router.put("/{ingreso_id}/inactivar", response_model=IngresoSchema)
def inactivar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso como inactivo.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    obj.activo = False
    obj.inactivatedon = func.now()
    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
    obj = _get_ingreso_for_user(db, obj.id, current_user)
    return _serialize_ingreso(obj)


@router.get("/resumen_totales")
def resumen_totales(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve:
    - objetivo: suma de ingresos activos+kpi
    - cobrados: suma de ingresos activos+kpi ya cobrados
    """
    objetivo = (
        db.query(func.coalesce(func.sum(models.Ingreso.importe), 0.0))
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo == True,
            models.Ingreso.kpi == True,
        )
        .scalar()
    )
    cobrados = (
        db.query(func.coalesce(func.sum(models.Ingreso.importe), 0.0))
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo == True,
            models.Ingreso.kpi == True,
            models.Ingreso.cobrado == True,
        )
        .scalar()
    )
    return {
        "objetivo": float(objetivo or 0),
        "cobrados": float(cobrados or 0),
    }