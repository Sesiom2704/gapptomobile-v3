# backend/app/api/v1/ingresos_router.py

"""
Router de INGRESOS para GapptoMobile v3.

Migrado desde la v2 manteniendo:
- Estructura de endpoints.
- Lógica de liquidez (ajustes en CuentaBancaria).
- Lógica de PAGO UNICO (activo/cobrado/kpi/inactivatedon).
- Ponderación por participación_pct de Patrimonio en /extra.

Añadidos en v3:
- Asociación de cada ingreso a un user_id.
- Todos los endpoints filtran por el usuario autenticado (require_user).
- Normalización de textos a MAYÚSCULAS (excepto observaciones, que aquí no hay).

Solo se han cambiado:
- Imports a la nueva estructura backend.app.*.
- Uso de get_db desde backend.app.db.session.
- Registro del router sin prefix; el prefix se aplica en main.py como "/api/ingresos".
"""

from typing import List, Optional, Any, Dict
from datetime import date
from calendar import monthrange
import secrets
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
from sqlalchemy.orm import Session
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

# Creamos router sin prefix; se aplicará "/api/ingresos" en main.py
router = APIRouter(tags=["ingresos"])


# ============================================================
# Helpers generales
# ============================================================

_ID_RE = re.compile(r"^INGRESO-[A-Z0-9]{6}$")
_ALPHABET = string.ascii_uppercase + string.digits


def to_payload(model: BaseModel, *, exclude_unset: bool = False) -> Dict[str, Any]:
    """
    Helper de compatibilidad Pydantic v1/v2:
    - v2: usa model_dump()
    - v1: usa dict()
    """
    if hasattr(model, "model_dump"):  # Pydantic v2
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def _norm_ref_id(val) -> str | None:
    """
    Normaliza referencia_vivienda_id:
      - None / '' / 'none' (cualquier casing) -> None
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
    Convierte un objeto ORM de Ingreso en un dict listo para el schema.

    Se asegura de:
    - Convertir importe a float.
    - Resolver cuenta_id aunque venga por relación.
    """
    return {
        "id": obj.id,
        "fecha_inicio": getattr(obj, "fecha_inicio", None),
        "rango_cobro": getattr(obj, "rango_cobro", None),
        "periodicidad": getattr(obj, "periodicidad", None),
        "tipo_id": getattr(obj, "tipo_id", None),
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
        "cuenta_id": extract_cuenta_id(obj),
        "user_id": getattr(obj, "user_id", None),
    }


def _serialize_ingreso_ponderado(
    obj: Any,
    pct_map: Dict[str, float],
) -> Dict[str, Any]:
    """
    Serializa el ingreso ponderando el importe por la participación_pct
    de Patrimonio según referencia_vivienda_id.
    """
    data = _serialize_ingreso(obj)
    ref = _norm_ref_id(data.get("referencia_vivienda_id"))
    pct = pct_map.get(ref, 100.0) if ref else 100.0
    try:
        data["importe"] = round(
            float(data.get("importe") or 0.0) * (pct / 100.0), 2
        )
    except Exception:
        pass
    return data


def _normalize_ingreso_text_payload(d: Dict[str, Any]) -> None:
    """
    Aplica la regla global:
    - TODO TEXTO en BD DEBE IR EN MAYÚSCULAS (EXCEPTO observaciones).

    En ingresos no hay observaciones, así que:
    - rango_cobro, periodicidad, concepto se guardan UPPER.
    - tipo_id, referencia_vivienda_id, cuenta_id también se fuerzan a UPPER.
    """
    text_fields = [
        "rango_cobro",
        "periodicidad",
        "concepto",
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
    Recupera un ingreso asegurando que pertenece al usuario actual.
    """
    obj = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.id == ingreso_id,
            models.Ingreso.user_id == current_user.id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Ingreso no encontrado")
    return obj


# ============================================================
# Vistas rápidas (para UI)
# ============================================================

@router.get("/pendientes", response_model=List[IngresoSchema])
def list_pendientes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista ingresos NO cobrados del usuario actual,
    ordenados por fecha_inicio y createon.
    """
    objs = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.cobrado == False,
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
    Crea un ingreso para el usuario actual:

    - Normaliza strings vacíos a None.
    - Normaliza textos a MAYÚSCULAS (rango_cobro, periodicidad, concepto, tipo_id, referencia_vivienda_id, cuenta_id).
    - Asegura un ID con patrón 'INGRESO-XXXXXX'.
    - Aplica reglas de PAGO UNICO (activo / cobrado / kpi / inactivatedon).
    - Ajusta liquidez de la cuenta si es PAGO UNICO.
    - Asigna user_id = usuario autenticado.
    """
    payload = to_payload(ingreso_in)

    # Strings vacíos -> None
    for k in [
        "rango_cobro",
        "periodicidad",
        "tipo_id",
        "referencia_vivienda_id",
        "concepto",
        "cuenta_id",
    ]:
        if k in payload and isinstance(payload[k], str) and payload[k].strip() == "":
            payload[k] = None

    # Normalización a MAYÚSCULAS según regla global
    _normalize_ingreso_text_payload(payload)

    # ID con patrón requerido
    raw_id = (payload.get("id") or "").upper()
    payload["id"] = raw_id if _ID_RE.fullmatch(raw_id) else generate_ingreso_id()

    # Asignar usuario actual
    payload["user_id"] = current_user.id

    periodicidad = (payload.get("periodicidad") or "").strip().upper()
    importe = safe_float(payload.get("importe"))
    cuenta_id = payload.get("cuenta_id")

    # Reglas PAGO UNICO + ajuste de liquidez
    if periodicidad == PERIODICIDAD_PAGO_UNICO:
        payload["activo"] = False
        payload["cobrado"] = True
        payload["kpi"] = False
        payload["inactivatedon"] = func.now()
        payload["ultimo_ingreso_on"] = func.now()
    # Insert (reintenta si colisión de PK)
    for _ in range(5):
        try:
            obj = models.Ingreso(**payload)
            db.add(obj)

            # Si es PAGO UNICO, sumar liquidez en la cuenta (alta ya cobrada)
            if periodicidad == PERIODICIDAD_PAGO_UNICO:
                adjust_liquidez(db, cuenta_id, +importe)

            db.commit()
            db.refresh(obj)
            return _serialize_ingreso(obj)

        except IntegrityError:
            db.rollback()
            payload["id"] = generate_ingreso_id()
        except DataError as e:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"Datos inválidos: {e.orig}",
            )

    raise HTTPException(
        status_code=500,
        detail=(
            "No se pudo generar un ID único para el ingreso "
            "tras varios intentos."
        ),
    )


# ============================================================
# EXTRAORDINARIOS (PAGO ÚNICO) - INGRESOS (ponderado)
# ============================================================

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
    Lista INGRESOS con periodicidad = 'PAGO UNICO' del usuario actual,
    mostrando el importe ponderado por Patrimonio.participacion_pct.

    Se filtra por mes/año usando:
    - fecha_inicio (DATE), y si es NULL
    - createon::DATE (timestamp → date)
    """
    effective_date = func.coalesce(
        models.Ingreso.fecha_inicio,
        cast(models.Ingreso.createon, Date),
    )

    qset = (
        db.query(models.Ingreso, models.Patrimonio.participacion_pct)
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
        qset = qset.filter(
            func.lower(models.Ingreso.concepto).like(patt)
        )

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
    Lista TODOS los ingresos del usuario actual.
    """
    objs = (
        db.query(models.Ingreso)
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
    Recupera un ingreso por id, asegurando que pertenece al usuario actual.
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
    Actualiza un ingreso del usuario actual:
    - Normaliza strings vacíos a None.
    - Normaliza textos a MAYÚSCULAS (mismas reglas que en create).
    - Gestiona inactivatedon cuando se cambia activo True/False.
    - NO toca liquidez (la liquidez se ajusta en create/cobrar/borrar).
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    incoming = to_payload(ingreso_in, exclude_unset=True)

    # Strings vacíos -> None
    for k, v in list(incoming.items()):
        if isinstance(v, str) and v.strip() == "":
            incoming[k] = None

    # Normalización a MAYÚSCULAS en campos de texto/IDs
    _normalize_ingreso_text_payload(incoming)

    # Transición activo -> inactivo / inactivo -> activo
    if "activo" in incoming:
        prev = bool(getattr(obj, "activo", True))
        newv = bool(incoming["activo"])
        if prev and not newv:
            obj.inactivatedon = func.now()
        elif not prev and newv:
            obj.inactivatedon = None

    # Asignar campos
    for field, value in incoming.items():
        setattr(obj, field, value)

    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
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
    - Revierte el impacto en liquidez (resta lo que se sumó).
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    periodicidad = (getattr(obj, "periodicidad", "") or "").strip().upper()
    if periodicidad == "PAGO UNICO":
        importe = safe_float(getattr(obj, "importe", 0.0))
        cuenta_id = extract_cuenta_id(obj)
        adjust_liquidez(db, cuenta_id, -importe)

    db.delete(obj)
    db.commit()
    # Nota: 204 normalmente no devuelve body; lo dejamos por compatibilidad.
    return {"detail": "Ingreso eliminado"}


# ============================================================
# ACCIONES
# ============================================================

@router.put("/{ingreso_id}/cobrar", response_model=IngresoSchema)
def cobrar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso del usuario actual como cobrado y actualiza:
    - ingresos_cobrados (+1 si antes no lo estaba).
    - liquidez de la cuenta (solo si pasa de no cobrado a cobrado).
    """
    ingreso = _get_ingreso_for_user(db, ingreso_id, current_user)

    was_cobrado = bool(getattr(ingreso, "cobrado", False))
    ingreso.cobrado = True
    ingreso.ingresos_cobrados = (ingreso.ingresos_cobrados or 0) + (
        0 if was_cobrado else 1
    )
    ingreso.modifiedon = func.now()

    if not was_cobrado:
        ingreso.ultimo_ingreso_on = func.now()
        adjust_liquidez(
            db,
            extract_cuenta_id(ingreso),
            +safe_float(ingreso.importe),
        )

    db.commit()
    db.refresh(ingreso)
    return _serialize_ingreso(ingreso)


@router.put("/{ingreso_id}/activar", response_model=IngresoSchema)
def activar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso del usuario actual como activo.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    obj.activo = True
    obj.inactivatedon = None
    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
    return _serialize_ingreso(obj)


@router.put("/{ingreso_id}/inactivar", response_model=IngresoSchema)
def inactivar_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un ingreso del usuario actual como inactivo.
    """
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    obj.activo = False
    obj.inactivatedon = func.now()
    obj.modifiedon = func.now()
    db.commit()
    db.refresh(obj)
    return _serialize_ingreso(obj)


@router.get("/resumen_totales")
def resumen_totales(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve, SOLO para el usuario actual:
    - objetivo: suma de importes de ingresos activos+kpi.
    - cobrados: suma de importes de esos ingresos que ya están cobrados.
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
