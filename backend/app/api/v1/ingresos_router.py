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
- Soporte de ramas de ingreso:
    * Primero se elige rama.
    * Luego se listan los tipos asociados a esa rama.
    * En create/update se valida coherencia entre rama_id y tipo_id.

Debug reforzado:
- Logs de payload, columnas ORM, cuenta/vivienda/rama/tipo.
- Captura explícita de errores inesperados en create/update.
"""

from typing import List, Optional, Any, Dict
from datetime import date
from calendar import monthrange
import string
import re
import logging
import traceback

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
logger = logging.getLogger(__name__)


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


def _safe_repr(val: Any) -> str:
    try:
        return repr(val)
    except Exception:
        return "<unreprable>"


def _debug_ingreso_context(prefix: str, payload: Optional[Dict[str, Any]] = None) -> None:
    """
    Debug centralizado para ver rápido:
    - payload recibido
    - columnas ORM realmente disponibles
    """
    try:
        cols = list(models.Ingreso.__table__.columns.keys())
    except Exception as e:
        cols = [f"<error leyendo columnas ORM: {e}>"]

    logger.warning("%s | payload=%s", prefix, payload)
    logger.warning("%s | Ingreso ORM columns=%s", prefix, cols)


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
    """
    rama_rel = getattr(obj, "rama_rel", None)
    tipo_rel = getattr(obj, "tipo_rel", None)
    user_rel = getattr(obj, "user", None)
    cuenta_rel = getattr(obj, "cuenta", None)

    return {
        "id": obj.id,
        "fecha_inicio": getattr(obj, "fecha_inicio", None),
        "rango_cobro": getattr(obj, "rango_cobro", None),
        "periodicidad": getattr(obj, "periodicidad", None),

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

        "omitido_este_mes": getattr(obj, "omitido_este_mes", False),
        "ultimo_omitido_on": getattr(obj, "ultimo_omitido_on", None),
        "omitido_count": getattr(obj, "omitido_count", 0),

        "contrato_alquiler": getattr(obj, "contrato_alquiler", None),

        "cuenta_id": extract_cuenta_id(obj),
        "cuenta_nombre": getattr(cuenta_rel, "anagrama", None) or getattr(cuenta_rel, "referencia", None),

        "user_id": getattr(obj, "user_id", None),
        "user_nombre": getattr(user_rel, "full_name", None) or getattr(user_rel, "email", None),
    }


def _serialize_ingreso_ponderado(
    obj: Any,
    pct_map: Dict[str, float],
) -> Dict[str, Any]:
    """
    Serializa el ingreso ponderando el importe por participación_pct.
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
    obj = (
        db.query(models.TipoRamasIngreso)
        .filter(models.TipoRamasIngreso.id == rama_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="La rama de ingreso no existe")
    return obj


def _get_tipo_ingreso_or_404(db: Session, tipo_id: str) -> models.TipoIngreso:
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


def _validate_cuenta_for_user(
    db: Session,
    *,
    cuenta_id: Optional[str],
    current_user: models.User,
) -> Optional[models.CuentaBancaria]:
    """
    Valida que la cuenta exista y pertenezca al usuario actual.
    """
    if not cuenta_id:
        return None

    cuenta = (
        db.query(models.CuentaBancaria)
        .filter(
            models.CuentaBancaria.id == cuenta_id,
            models.CuentaBancaria.user_id == current_user.id,
        )
        .first()
    )
    if not cuenta:
        raise HTTPException(
            status_code=422,
            detail=f"La cuenta seleccionada no existe o no pertenece al usuario actual: {cuenta_id}",
        )
    return cuenta


def _validate_vivienda_for_user(
    db: Session,
    *,
    vivienda_id: Optional[str],
    current_user: models.User,
) -> Optional[models.Patrimonio]:
    """
    Valida que la vivienda exista y pertenezca al usuario actual.
    """
    if not vivienda_id:
        return None

    vivienda = (
        db.query(models.Patrimonio)
        .filter(
            models.Patrimonio.id == vivienda_id,
            models.Patrimonio.user_id == current_user.id,
        )
        .first()
    )
    if not vivienda:
        raise HTTPException(
            status_code=422,
            detail=f"La vivienda seleccionada no existe o no pertenece al usuario actual: {vivienda_id}",
        )
    return vivienda


# ============================================================
# Catálogos UI para selector rama -> tipos
# ============================================================

@router.get("/ramas", response_model=List[RamaIngresoOut])
def list_ramas_ingreso(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
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
# Vistas rápidas
# ============================================================

@router.get("/pendientes", response_model=List[IngresoSchema])
def list_pendientes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
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

@router.post("/", response_model=IngresoSchema, status_code=status.HTTP_201_CREATED)
@router.post("", response_model=IngresoSchema, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_ingreso(
    ingreso_in: IngresoCreateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un nuevo ingreso.

    Qué hace:
    - Normaliza el payload recibido.
    - Valida coherencia entre rama_id y tipo_id.
    - Valida cuenta y vivienda para el usuario actual.
    - Genera ID si no viene uno válido.
    - Asigna user_id automáticamente.
    - Inicializa campos omitidos si no vienen informados.
    - Aplica lógica especial para PAGO UNICO:
        * activo = False
        * cobrado = True
        * kpi = False
        * inactivatedon = now()
        * ultimo_ingreso_on = now()
        * ajuste de liquidez inmediato en cuenta asociada
    - Inserta el ingreso.
    - Reintenta si hay colisión de ID.
    - Devuelve el ingreso serializado con relaciones cargadas.

    Nota importante:
    - Se corrige el bug detectado: generate_ingreso_id requiere db.
    """

    try:
        # ------------------------------------------------------------
        # 1) Extraer payload del schema Pydantic
        # ------------------------------------------------------------
        payload = to_payload(ingreso_in)

        # ------------------------------------------------------------
        # 2) Convertir cadenas vacías en None para evitar basura tipo ""
        # ------------------------------------------------------------
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

        # ------------------------------------------------------------
        # 3) Normalización global a MAYÚSCULAS en textos funcionales
        # ------------------------------------------------------------
        _normalize_ingreso_text_payload(payload)

        logger.warning("[INGRESOS][CREATE] payload normalizado=%s", payload)

        # ------------------------------------------------------------
        # 4) Validaciones funcionales
        # ------------------------------------------------------------
        # - rama_id debe existir
        # - tipo_id debe existir
        # - tipo_id debe pertenecer a rama_id
        rama, tipo = _validate_rama_tipo_ingreso(
            db,
            rama_id=payload.get("rama_id"),
            tipo_id=payload.get("tipo_id"),
        )

        # - si viene cuenta_id, debe existir y pertenecer al usuario actual
        cuenta = _validate_cuenta_for_user(
            db,
            cuenta_id=payload.get("cuenta_id"),
            current_user=current_user,
        )

        # - si viene referencia_vivienda_id, debe existir y pertenecer al usuario actual
        vivienda = _validate_vivienda_for_user(
            db,
            vivienda_id=payload.get("referencia_vivienda_id"),
            current_user=current_user,
        )

        logger.warning(
            "[INGRESOS][CREATE] validaciones ok | rama=%s | tipo=%s | cuenta=%s | vivienda=%s | user_id=%s",
            getattr(rama, "id", None),
            getattr(tipo, "id", None),
            getattr(cuenta, "id", None),
            getattr(vivienda, "id", None),
            getattr(current_user, "id", None),
        )

        # ------------------------------------------------------------
        # 5) Resolver/generar ID
        # ------------------------------------------------------------
        # Si el cliente manda un ID válido con patrón INGRESO-XXXXXX, se respeta.
        # Si no, se genera uno nuevo comprobando colisión en BD.
        raw_id = (payload.get("id") or "").upper()
        payload["id"] = raw_id if _ID_RE.fullmatch(raw_id) else generate_ingreso_id(db)

        # ------------------------------------------------------------
        # 6) Campos de sistema y defaults defensivos
        # ------------------------------------------------------------
        payload["user_id"] = current_user.id
        payload.setdefault("omitido_este_mes", False)
        payload.setdefault("omitido_count", 0)

        # Si no viene ingresos_cobrados, el schema ya trae 0,
        # pero lo dejamos robusto por si cambia el flujo en el futuro.
        payload.setdefault("ingresos_cobrados", 0)

        # ------------------------------------------------------------
        # 7) Preparar lógica funcional según periodicidad
        # ------------------------------------------------------------
        periodicidad = (payload.get("periodicidad") or "").strip().upper()
        importe = safe_float(payload.get("importe"))
        cuenta_id = payload.get("cuenta_id")

        # Regla de negocio existente:
        # Un PAGO UNICO nace ya cobrado, no activo y no KPI.
        if periodicidad == PERIODICIDAD_PAGO_UNICO:
            payload["activo"] = False
            payload["cobrado"] = True
            payload["kpi"] = False
            payload["inactivatedon"] = func.now()
            payload["ultimo_ingreso_on"] = func.now()
            payload["omitido_este_mes"] = False

        # ------------------------------------------------------------
        # 8) Insert con reintentos por colisión de ID
        # ------------------------------------------------------------
        for _ in range(5):
            try:
                _debug_ingreso_context("[INGRESOS][CREATE][BEFORE ORM]", payload)

                # Crear objeto ORM
                obj = models.Ingreso(**payload)
                db.add(obj)

                logger.warning(
                    "[INGRESOS][CREATE] obj creado en ORM | id=%s | tipo_id=%s | rama_id=%s | cuenta_id=%s",
                    getattr(obj, "id", None),
                    getattr(obj, "tipo_id", None),
                    getattr(obj, "rama_id", None),
                    getattr(obj, "cuenta_id", None),
                )

                # Si es PAGO UNICO, impacta inmediatamente en liquidez
                if periodicidad == PERIODICIDAD_PAGO_UNICO:
                    logger.warning(
                        "[INGRESOS][CREATE] ajuste liquidez previo commit | cuenta_id=%s | importe=%s",
                        cuenta_id,
                        importe,
                    )
                    adjust_liquidez(db, cuenta_id, +importe)

                # Persistir
                db.commit()
                db.refresh(obj)

                logger.warning("[INGRESOS][CREATE] commit OK | ingreso_id=%s", obj.id)

                # Releer con relaciones para devolver respuesta completa y consistente
                obj = _get_ingreso_for_user(db, obj.id, current_user)
                response_data = _serialize_ingreso(obj)

                logger.warning("[INGRESOS][CREATE] response=%s", response_data)
                return response_data

            except IntegrityError as e:
                db.rollback()

                err_msg = str(getattr(e, "orig", e)).upper()
                logger.exception("[INGRESOS][CREATE] IntegrityError | payload=%s", payload)

                # Detectar colisión de PK para reintentar con nuevo ID
                is_duplicate_id = (
                    "INGRESOS_PKEY" in err_msg
                    or ("DUPLICATE KEY VALUE" in err_msg and "(ID)" in err_msg)
                    or "KEY (ID)=" in err_msg
                )

                if is_duplicate_id:
                    payload["id"] = generate_ingreso_id(db)
                    logger.warning(
                        "[INGRESOS][CREATE] retry por colisión de ID nuevo=%s",
                        payload["id"],
                    )
                    continue

                raise HTTPException(
                    status_code=400,
                    detail=f"Error de integridad al crear ingreso: {getattr(e, 'orig', e)}",
                )

            except DataError as e:
                db.rollback()
                logger.exception("[INGRESOS][CREATE] DataError | payload=%s", payload)
                raise HTTPException(
                    status_code=400,
                    detail=f"Datos inválidos: {e.orig}",
                )

            except HTTPException:
                db.rollback()
                raise

            except Exception as e:
                db.rollback()
                logger.exception("[INGRESOS][CREATE] Exception inesperada | payload=%s", payload)
                tb = traceback.format_exc()
                logger.error("[INGRESOS][CREATE] traceback=\n%s", tb)
                raise HTTPException(
                    status_code=500,
                    detail=f"Error inesperado al crear ingreso: {e.__class__.__name__}: {e}",
                )

        # Si llega aquí, hubo demasiadas colisiones de ID
        raise HTTPException(
            status_code=500,
            detail="No se pudo generar un ID único para el ingreso tras varios intentos.",
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception as e:
        db.rollback()
        logger.exception("[INGRESOS][CREATE] Exception previa al bucle de inserción")
        tb = traceback.format_exc()
        logger.error("[INGRESOS][CREATE] traceback previo=\n%s", tb)
        raise HTTPException(
            status_code=500,
            detail=f"Error inesperado antes de crear ingreso: {e.__class__.__name__}: {e}",
        )


def _month_range(year: int, month: int) -> tuple[date, date]:
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
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)
    return _serialize_ingreso(obj)


@router.patch("/{ingreso_id}", response_model=IngresoSchema)
def update_ingreso(
    ingreso_id: str,
    ingreso_in: IngresoUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    incoming = to_payload(ingreso_in, exclude_unset=True)

    for k, v in list(incoming.items()):
        if isinstance(v, str) and v.strip() == "":
            incoming[k] = None

    _normalize_ingreso_text_payload(incoming)
    logger.warning("[INGRESOS][UPDATE] incoming normalizado=%s | ingreso_id=%s", incoming, ingreso_id)

    _resolve_rama_tipo_for_update(db, obj=obj, incoming=incoming)

    # Validaciones explícitas si vienen
    if "cuenta_id" in incoming:
        _validate_cuenta_for_user(
            db,
            cuenta_id=incoming.get("cuenta_id"),
            current_user=current_user,
        )

    if "referencia_vivienda_id" in incoming:
        _validate_vivienda_for_user(
            db,
            vivienda_id=incoming.get("referencia_vivienda_id"),
            current_user=current_user,
        )

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

    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError as e:
        db.rollback()
        logger.exception("[INGRESOS][UPDATE] IntegrityError | ingreso_id=%s | incoming=%s", ingreso_id, incoming)
        raise HTTPException(
            status_code=400,
            detail=f"Error de integridad al actualizar ingreso: {getattr(e, 'orig', e)}",
        )
    except DataError as e:
        db.rollback()
        logger.exception("[INGRESOS][UPDATE] DataError | ingreso_id=%s | incoming=%s", ingreso_id, incoming)
        raise HTTPException(
            status_code=400,
            detail=f"Datos inválidos al actualizar ingreso: {e.orig}",
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception("[INGRESOS][UPDATE] Exception inesperada | ingreso_id=%s | incoming=%s", ingreso_id, incoming)
        tb = traceback.format_exc()
        logger.error("[INGRESOS][UPDATE] traceback=\n%s", tb)
        raise HTTPException(
            status_code=500,
            detail=f"Error inesperado al actualizar ingreso: {e.__class__.__name__}: {e}",
        )

    obj = _get_ingreso_for_user(db, obj.id, current_user)
    return _serialize_ingreso(obj)


@router.delete("/{ingreso_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ingreso(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = _get_ingreso_for_user(db, ingreso_id, current_user)

    try:
        periodicidad = (getattr(obj, "periodicidad", "") or "").strip().upper()
        importe = safe_float(getattr(obj, "importe", 0.0))
        cuenta_id = extract_cuenta_id(obj)

        logger.warning(
            "[INGRESOS][DELETE] ingreso_id=%s | periodicidad=%s | importe=%s | cuenta_id=%s | user_id=%s",
            ingreso_id,
            periodicidad,
            importe,
            cuenta_id,
            current_user.id,
        )

        if periodicidad == PERIODICIDAD_PAGO_UNICO:
            logger.warning(
                "[INGRESOS][DELETE] ajuste liquidez previo borrado | cuenta_id=%s | delta=%s",
                cuenta_id,
                -importe,
            )
            adjust_liquidez(db, cuenta_id, -importe)

        db.delete(obj)
        db.commit()

        logger.warning("[INGRESOS][DELETE] borrado OK | ingreso_id=%s", ingreso_id)
        return None

    except IntegrityError as e:
        db.rollback()
        logger.exception("[INGRESOS][DELETE] IntegrityError | ingreso_id=%s", ingreso_id)
        raise HTTPException(
            status_code=400,
            detail=f"Error de integridad al eliminar ingreso: {getattr(e, 'orig', e)}",
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception as e:
        db.rollback()
        logger.exception("[INGRESOS][DELETE] Exception inesperada | ingreso_id=%s", ingreso_id)
        tb = traceback.format_exc()
        logger.error("[INGRESOS][DELETE] traceback=\n%s", tb)
        raise HTTPException(
            status_code=500,
            detail=f"Error inesperado al eliminar ingreso: {e.__class__.__name__}: {e}",
        )

# ============================================================
# ACCIONES
# ============================================================

@router.put("/{ingreso_id}/omitir", response_model=IngresoSchema)
def omitir_ingreso_mes(
    ingreso_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
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