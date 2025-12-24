# backend/app/api/v1/gastos_router.py

"""
Router de GASTOS para GapptoMobile v3.

Este fichero es una migración casi 1:1 del router de gastos de la v2,
adaptado a la nueva estructura:

- Usa backend.app.db.session.get_db como dependencia de BD.
- Usa backend.app.db.models como modelos ORM.
- Usa schemas de gastos para los modelos Pydantic.

IMPORTANTE:
- No se ha eliminado ninguna función ni endpoint respecto a la v2.
- Se mantiene toda la lógica de cuotas, liquidez, préstamos, reinicios, etc.
- Ahora todos los datos están vinculados a un usuario (user_id), de forma que
  cada usuario sólo puede ver y modificar sus propios gastos/ingresos.
"""

from typing import List, Dict, Any, Optional
from datetime import date
from datetime import date as _date
from calendar import monthrange

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    status,
    Query,
    Response,
)
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from sqlalchemy.orm import joinedload

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.gastos import (
    GastoSchema,
    GastoCreateSchema,
    GastoUpdateSchema,
)

from backend.app.utils.common import safe_float, adjust_liquidez
from backend.app.utils.id_utils import generate_gasto_id
from backend.app.api.v1.auth_router import require_user

# Creamos el router SIN prefix; el prefijo "/api/gastos" se define en main.py
router = APIRouter(tags=["gastos"])


# =========================
# Constantes
# =========================

# Segmento COTIDIANOS
SEG_COT = "COT-12345"   # segmento cotidian@s siempre visible

# Periodicidades y sus meses asociados
PERIOD_MESES = {"TRIMESTRAL": 3, "SEMESTRAL": 6, "ANUAL": 12}

# Tipos cotidianos (incluyendo los nuevos)
COT_TIPOS = {
    "COMIDA":       "COM-TIPOGASTO-311A33BD",
    "ELECTRICIDAD": "ELE-TIPOGASTO-47CC77E5",
    "GASOLINA":     "TIP-GASOLINA-SW1ZQO",     # contenedor VEHÍCULO
    "ROPA":         "ROP-TIPOGASTO-S227BB",
    "RESTAURANTES": "RES-TIPOGASTO-26ROES",    # contenedor OCIO
    "TRANSPORTE":   "TRA-TIPOGASTO-RB133Z",
    "HOTELES":      "HOT-TIPOGASTO-357FDG",
    "PEAJES":       "PEA-TIPOGASTO-7HDY89",
    "MANT_VEH":     "MAV-TIPOGASTO-BVC356",
    "ACTIVIDADES":  "ACT-TIPOGASTO-2X9H1Q",
}

# Grupos de promedio 3M
PROM_GROUPS = {
    # Vehículo (contenedor GASOLINA)
    COT_TIPOS["GASOLINA"]: [
        COT_TIPOS["GASOLINA"],
        COT_TIPOS["PEAJES"],
        COT_TIPOS["MANT_VEH"],
    ],
    # Ocio (contenedor RESTAURANTES)
    COT_TIPOS["RESTAURANTES"]: [
        COT_TIPOS["RESTAURANTES"],
        COT_TIPOS["HOTELES"],
        COT_TIPOS["ACTIVIDADES"],
    ],
    # Otros 1:1
    COT_TIPOS["ELECTRICIDAD"]: [COT_TIPOS["ELECTRICIDAD"]],
    COT_TIPOS["COMIDA"]:       [COT_TIPOS["COMIDA"]],
    COT_TIPOS["ROPA"]:         [COT_TIPOS["ROPA"]],
}


# =========================
# Helpers generales
# =========================

def to_payload(model):
    """
    Convierte un objeto Pydantic a dict. Soporta model_dump (Pydantic v2) o dict().
    """
    try:
        return model.model_dump(exclude_unset=False)
    except AttributeError:
        return model.dict()


# Campos que deben ir en mayúsculas (texto)
_UPPER_FIELDS = {"periodicidad", "nombre", "tienda", "rango_pago", "rama"}

# Campos ID que también deben ir en mayúsculas
_UPPER_ID_FIELDS = {
    "proveedor_id",
    "tipo_id",
    "segmento_id",
    "cuenta_id",
    "referencia_vivienda_id",
    # referencia_gasto NO se uppercasea (ids en minúsculas)
}


def _upperize_payload(d: Dict[str, Any]) -> None:
    """
    Recorre el dict y pasa a MAYÚSCULAS los campos definidos en
    _UPPER_FIELDS y _UPPER_ID_FIELDS, si son strings no vacíos.
    """
    for k in list(d.keys()):
        v = d.get(k, None)
        if v is None:
            continue
        if k in _UPPER_FIELDS | _UPPER_ID_FIELDS and isinstance(v, str):
            d[k] = v.upper()


def _str_empty_to_none(d: Dict[str, Any], keys: List[str]) -> None:
    """
    Para las keys indicadas:
    - Si el valor es string vacío o solo espacios, lo transforma en None.
    """
    for k in keys:
        if k in d and isinstance(d[k], str) and d[k].strip() == "":
            d[k] = None


def _per_cuota(g: models.Gasto) -> float:
    """
    Devuelve el importe por cuota de un gasto.
    - Prioriza g.importe_cuota si existe.
    - Si no, usa g.importe.
    """
    if getattr(g, "importe_cuota", None) is not None:
        return safe_float(g.importe_cuota)
    return safe_float(g.importe)


def _clamp(x: int, lo: int, hi: int) -> int:
    """
    Limita x al rango [lo, hi].
    """
    return max(lo, min(hi, x))


def _months_diff(d1: date, d2: date | None) -> int | None:
    """
    Diferencia en meses entre d1 y d2 (d1 - d2).
    Si d2 es None, devuelve None.
    """
    if not d2:
        return None
    return (d1.year - d2.year) * 12 + (d1.month - d2.month)


def _add_months(d: date | None, n: int) -> date | None:
    """
    Suma n meses a una fecha, ajustando el día si el mes resultante tiene
    menos días (ejemplo: sumar 1 mes a 31/01 → 28/02 o 29/02).
    """
    if not d:
        return None
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    last_day = monthrange(y, m)[1]
    return date(y, m, min(d.day, last_day))


# =========================
# Helpers: IDs
# =========================

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


def _serialize_gasto_ponderado(
    g: models.Gasto,
    pct_map: Dict[str, float],
) -> dict:
    """
    Serializa un gasto ponderándolo por participación_pct según referencia_vivienda_id.
    Si no hay ref o no está en el mapa, asume 100%.
    """
    ref = _norm_ref_id(getattr(g, "referencia_vivienda_id", None))
    pct = pct_map.get(ref, 100.0) if ref else 100.0
    f = pct / 100.0

    def _fnum(v):
        try:
            return float(v or 0.0)
        except Exception:
            return 0.0

    return {
        "id": g.id,
        "fecha": getattr(g, "fecha", None),
        "periodicidad": getattr(g, "periodicidad", None),
        "nombre": getattr(g, "nombre", None),
        "tienda": getattr(g, "tienda", None),
        "proveedor_id": getattr(g, "proveedor_id", None),
        "tipo_id": getattr(g, "tipo_id", None),
        "segmento_id": getattr(g, "segmento_id", None),
        "rama": getattr(g, "rama", None),
        "referencia_vivienda_id": getattr(g, "referencia_vivienda_id", None),
        "cuenta_id": getattr(g, "cuenta_id", None),

        "importe": round(_fnum(getattr(g, "importe", 0.0)) * f, 2),
        "importe_cuota": round(_fnum(getattr(g, "importe_cuota", 0.0)) * f, 2),
        "cuotas": getattr(g, "cuotas", None),
        "total": round(_fnum(getattr(g, "total", 0.0)) * f, 2),
        "cuotas_pagadas": getattr(g, "cuotas_pagadas", None),
        "cuotas_restantes": getattr(g, "cuotas_restantes", None),
        "importe_pendiente": round(
            _fnum(getattr(g, "importe_pendiente", 0.0)) * f, 2
        ),

        "rango_pago": getattr(g, "rango_pago", None),
        "activo": getattr(g, "activo", True),
        "pagado": getattr(g, "pagado", False),
        "kpi": getattr(g, "kpi", False),
        "createon": getattr(g, "createon", None),
        "modifiedon": getattr(g, "modifiedon", None),
        "referencia_gasto": getattr(g, "referencia_gasto", None),
        "inactivatedon": getattr(g, "inactivatedon", None),
    }


# =========================
# Helpers Pago Relacionado
# =========================

def _fetch_ref_gasto(db: Session, ref_id: str) -> models.Gasto | None:
    """
    Recupera el gasto referenciado (por referencia_gasto).
    Nota: aquí se busca por ID directo; el endpoint ya está protegido por usuario.
    """
    if not ref_id:
        return None
    return db.get(models.Gasto, (ref_id or "").lower())


def _units_from_amount(amount: float, per_cuota: float) -> int:
    """
    Convierte un importe en "nº de cuotas" enteras según importe por cuota.
    """
    if per_cuota <= 0:
        return 0
    return int(round(amount / per_cuota))


def _adjust_ref_by_units(db: Session, ref: models.Gasto, units_delta: int) -> None:
    """
    Ajusta las cuotas_restantes y el importe_pendiente de un gasto referenciado
    sumando/restando unidades (cuotas) según units_delta.
    """
    if ref is None:
        return
    if (ref.cuotas or 0) <= 0:
        raise HTTPException(
            status_code=422,
            detail="El gasto referenciado no tiene cuotas.",
        )
    per = _per_cuota(ref)
    max_rest = max((ref.cuotas or 0) - (ref.cuotas_pagadas or 0), 0)
    curr_rest = max(ref.cuotas_restantes or 0, 0)
    new_rest = _clamp(curr_rest + int(units_delta), 0, max_rest)
    ref.cuotas_restantes = new_rest
    ref.importe_pendiente = round(new_rest * per, 2)
    db.flush()


def _apply_pago_relacionado_create(db: Session, payload: Dict[str, Any]) -> None:
    """
    Al crear un gasto PAGO UNICO ligado a referencia_gasto:
    - Calcula cuántas "unidades" de cuota representa su importe.
    - Resta esas unidades a las cuotas_restantes del gasto referenciado.
    """
    if (payload.get("periodicidad") or "").upper() != "PAGO UNICO":
        return
    ref_id = payload.get("referencia_gasto")
    if not ref_id:
        return
    ref = _fetch_ref_gasto(db, ref_id)
    if not ref:
        raise HTTPException(
            status_code=422,
            detail="referencia_gasto inválida.",
        )
    per = _per_cuota(ref)
    units = _units_from_amount(safe_float(payload.get("importe")), per)
    if (ref.cuotas_restantes or 0) <= 0:
        raise HTTPException(
            status_code=422,
            detail="El gasto referenciado no tiene cuotas restantes.",
        )
    _adjust_ref_by_units(db, ref, -units)


def _apply_pago_relacionado_update(
    db: Session,
    old: models.Gasto,
    incoming: Dict[str, Any],
) -> None:
    """
    Ajusta el gasto referenciado cuando:
    - Se modifica periodicidad / importe / referencia_gasto del pago único.
    - Se cambia de PAGO UNICO a otra periodicidad o viceversa.
    - Se cambia entre distintos gastos referenciados.
    """
    old_is_pu = ((old.periodicidad or "").upper() == "PAGO UNICO")
    new_per   = (incoming.get("periodicidad", old.periodicidad) or "").upper()
    new_is_pu = (new_per == "PAGO UNICO")

    old_ref_id = old.referencia_gasto or None
    new_ref_id = incoming.get("referencia_gasto", old.referencia_gasto) or None

    old_imp = safe_float(old.importe)
    new_imp = safe_float(incoming.get("importe", old.importe))

    old_units = 0
    if old_is_pu and old_ref_id:
        old_ref = _fetch_ref_gasto(db, old_ref_id)
        if old_ref:
            old_units = _units_from_amount(old_imp, _per_cuota(old_ref))

    new_units = 0
    if new_is_pu and new_ref_id:
        new_ref = _fetch_ref_gasto(db, new_ref_id)
        if not new_ref:
            raise HTTPException(
                status_code=422,
                detail="referencia_gasto inválida.",
            )
        if (new_ref.cuotas or 0) <= 0:
            raise HTTPException(
                status_code=422,
                detail="El gasto referenciado no tiene cuotas.",
            )
        new_units = _units_from_amount(new_imp, _per_cuota(new_ref))

    if old_is_pu and old_ref_id and (not new_is_pu or not new_ref_id):
        ref = _fetch_ref_gasto(db, old_ref_id)
        if ref:
            _adjust_ref_by_units(db, ref, +old_units)
    elif (not old_is_pu or not old_ref_id) and new_is_pu and new_ref_id:
        ref = _fetch_ref_gasto(db, new_ref_id)
        if ref:
            _adjust_ref_by_units(db, ref, -new_units)
    elif old_is_pu and new_is_pu:
        if old_ref_id == new_ref_id and new_ref_id:
            ref = _fetch_ref_gasto(db, new_ref_id)
            if ref:
                delta = new_units - old_units
                _adjust_ref_by_units(db, ref, -delta)
        else:
            if old_ref_id:
                ref_old = _fetch_ref_gasto(db, old_ref_id)
                if ref_old:
                    _adjust_ref_by_units(db, ref_old, +old_units)
            if new_ref_id:
                ref_new = _fetch_ref_gasto(db, new_ref_id)
                if ref_new:
                    _adjust_ref_by_units(db, ref_new, -new_units)


def _apply_pago_relacionado_delete(db: Session, g: models.Gasto) -> None:
    """
    Si borramos un PAGO UNICO con referencia_gasto:
    - Devolvemos las cuotas al gasto referenciado.
    """
    if (g.periodicidad or "").upper() != "PAGO UNICO":
        return
    if not g.referencia_gasto:
        return
    ref = _fetch_ref_gasto(db, g.referencia_gasto)
    if not ref:
        return
    units = _units_from_amount(safe_float(g.importe), _per_cuota(ref))
    _adjust_ref_by_units(db, ref, +units)


# =========================
# Helpers PROM-3M (grupos)
# =========================

def _month_bounds(y: int, m: int) -> tuple[date, date]:
    """
    Devuelve (primer_día, último_día) del mes indicado.
    """
    last = monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def _sum_gc_tipo_mes(
    db: Session,
    tipo_id: str,
    start: date,
    end: date,
    user_id: Optional[int] = None,
) -> float:
    """
    Suma importe de GastoCotidiano.pagado para un tipo_id en un mes (rango start-end),
    filtrando por usuario si se indica user_id.
    """
    q = (
        db.query(func.coalesce(func.sum(models.GastoCotidiano.importe), 0.0))
        .filter(models.GastoCotidiano.tipo_id == tipo_id)
        .filter(models.GastoCotidiano.pagado == True)
        .filter(models.GastoCotidiano.fecha >= start)
        .filter(models.GastoCotidiano.fecha <= end)
    )
    if user_id is not None:
        q = q.filter(models.GastoCotidiano.user_id == user_id)

    return float(q.scalar() or 0.0)


def _avg_3m_for_tipo(
    db: Session,
    tipo_id: str,
    m1: tuple[date, date],
    m2: tuple[date, date],
    m3: tuple[date, date],
    user_id: Optional[int] = None,
) -> float:
    """
    Calcula el promedio de los últimos 3 meses con gasto > 0 para un tipo,
    filtrando por usuario si se indica user_id.
    """
    (s1, e1), (s2, e2), (s3, e3) = m1, m2, m3
    v3 = _sum_gc_tipo_mes(db, tipo_id, s3, e3, user_id=user_id)
    v2 = _sum_gc_tipo_mes(db, tipo_id, s2, e2, user_id=user_id)
    v1 = _sum_gc_tipo_mes(db, tipo_id, s1, e1, user_id=user_id)
    used = [v for v in (v3, v2, v1) if v > 0]
    if not used:
        return 0.0
    return round(sum(used) / len(used), 2)


def _sum_of_avgs_3m(
    db: Session,
    tipo_ids: list[str],
    m1: tuple[date, date],
    m2: tuple[date, date],
    m3: tuple[date, date],
    user_id: Optional[int] = None,
) -> float:
    """
    Suma de promedios 3M para un grupo de tipos, filtrando por usuario si aplica.
    """
    total = 0.0
    for t in (tipo_ids or []):
        total += _avg_3m_for_tipo(db, t, m1, m2, m3, user_id=user_id)
    return round(total, 2)


def _apply_promedios_3m_por_tipo(db: Session, user_id: Optional[int] = None) -> int:
    """
    Recalcula importe/importe_cuota de los gastos "contenedor" de COTIDIANOS
    según el promedio de los últimos 3 meses de sus subtipos, para un usuario.
    """
    today = date.today()

    y1 = today.year
    m1 = today.month - 1
    if m1 == 0:
        m1 = 12
        y1 -= 1
    start1, end1 = _month_bounds(y1, m1)

    y2 = y1
    m2 = m1 - 1
    if m2 == 0:
        m2 = 12
        y2 -= 1
    start2, end2 = _month_bounds(y2, m2)

    y3 = y2
    m3 = m2 - 1
    if m3 == 0:
        m3 = 12
        y3 -= 1
    start3, end3 = _month_bounds(y3, m3)

    m_1 = (start1, end1)
    m_2 = (start2, end2)
    m_3 = (start3, end3)

    total_updates = 0

    for contenedor_tipo, subtipos in PROM_GROUPS.items():
        valor_contenedor = _sum_of_avgs_3m(db, subtipos, m_1, m_2, m_3, user_id=user_id)
        if valor_contenedor <= 0:
            continue

        rows_q = (
            db.query(models.Gasto)
            .filter(models.Gasto.tipo_id == contenedor_tipo)
            .filter(models.Gasto.activo == True)
        )
        if user_id is not None:
            rows_q = rows_q.filter(models.Gasto.user_id == user_id)

        rows = rows_q.all()
        for g in rows:
            g.importe = valor_contenedor
            g.importe_cuota = valor_contenedor
            g.modifiedon = func.now()
            total_updates += 1

    return total_updates


# =========================
# Liquidez helpers
# =========================

def _sum_restante_plan(
    db: Session,
    prestamo_id: str,
    desde_num: int,
) -> tuple[float, float]:
    """
    Suma capital e intereses pendientes desde 'desde_num' (inclusive)
    para un préstamo.
    """
    rows = (
        db.query(models.PrestamoCuota)
        .filter(models.PrestamoCuota.prestamo_id == prestamo_id)
        .filter(models.PrestamoCuota.num_cuota >= desde_num)
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .all()
    )
    cap = sum(float(r.capital or 0) for r in rows)
    inte = sum(float(r.interes or 0) for r in rows)
    return (round(cap, 2), round(inte, 2))


# =========================
# Liquidez Préstamos
# =========================

def _mark_next_unpaid_installment_as_paid(
    db: Session,
    prestamo_id: str,
    gasto_id: str,
) -> bool:
    """
    Marca como pagada la siguiente cuota sin pagar de un préstamo y la vincula al gasto.
    Devuelve True si marcó alguna, False si no había pendientes.
    """
    cuota = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo_id,
            models.PrestamoCuota.pagada == False,
        )
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .first()
    )
    if not cuota:
        return False
    cuota.pagada = True
    cuota.fecha_pago = _date.today()
    cuota.gasto_id = gasto_id
    db.flush()
    return True


def _recompute_pendientes_prestamo(db: Session, prestamo_id: str) -> None:
    """
    Recalcula prestamos.cuotas_pagadas, capital_pendiente, intereses_pendientes.
    """
    p = db.get(models.Prestamo, prestamo_id)
    if not p:
        return
    c_paid = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo_id,
            models.PrestamoCuota.pagada == True,
        )
        .count()
    )
    p.cuotas_pagadas = int(c_paid or 0)

    next_unpaid = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo_id,
            models.PrestamoCuota.pagada == False,
        )
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .first()
    )
    start_num = int(next_unpaid.num_cuota) if next_unpaid else (p.cuotas_totales + 1)
    cap, inte = _sum_restante_plan(db, prestamo_id, start_num)
    p.capital_pendiente = cap
    p.intereses_pendientes = inte
    p.modifiedon = func.now()
    db.flush()


def _sync_prestamo_cuotas_by_gasto(
    db: Session,
    gasto: models.Gasto,
    prev_cuotas_pagadas: int | None,
):
    """
    Si el gasto está asociado a un préstamo, sincroniza el plan de cuotas
    a partir de gasto.cuotas_pagadas:
      - Marca pagadas las primeras N (gasto.cuotas_pagadas), con gasto_id = gasto.id
      - Desmarca el resto y borra gasto_id/fecha_pago si aplica
      - Recalcula capital/intereses pendientes y actualizar prestamo.cuotas_pagadas
    """
    prestamo_id = getattr(gasto, "prestamo_id", None)
    if not prestamo_id:
        return
    n = int(getattr(gasto, "cuotas_pagadas", 0) or 0)

    rows = (
        db.query(models.PrestamoCuota)
        .filter(models.PrestamoCuota.prestamo_id == prestamo_id)
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .all()
    )
    for r in rows:
        if r.num_cuota <= n:
            if not r.pagada:
                r.pagada = True
                r.fecha_pago = _date.today()
            r.gasto_id = gasto.id
        else:
            if r.pagada:
                r.pagada = False
                r.fecha_pago = None
            r.gasto_id = None
    db.flush()
    _recompute_pendientes_prestamo(db, prestamo_id)


# =========================
# GET
# =========================
@router.get("/pendientes", response_model=List[GastoSchema])
def list_pendientes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista los gastos pendientes (pagado = False y activo = True)
    SOLO del usuario autenticado.
    """
    q = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.pagado == False,
            models.Gasto.activo == True,
        )
        .order_by(models.Gasto.fecha.asc())
    )
    return q.all()

@router.get("/activos", response_model=List[GastoSchema])
def list_activos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista gastos con activo == True del usuario autenticado.
    """
    return (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo == True,
        )
        .all()
    )


@router.get("/inactivos", response_model=List[GastoSchema])
def list_inactivos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista gastos con activo == False del usuario autenticado.
    """
    return (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo == False,
        )
        .all()
    )


@router.get("/aportables", response_model=List[GastoSchema])
def listar_gastos_aportables(
    min_restantes: int = Query(0, ge=0),
    activo: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista gastos con cuotas_restantes > min_restantes del usuario autenticado,
    filtrando por activo si se solicita.
    """
    q = db.query(models.Gasto).filter(
        models.Gasto.user_id == current_user.id,
        models.Gasto.cuotas_restantes.isnot(None),
    )
    minimo = max(min_restantes, 0)
    q = q.filter(models.Gasto.cuotas_restantes > minimo)
    if activo is not None:
        q = q.filter(models.Gasto.activo == activo)
    q = q.order_by(models.Gasto.nombre.asc())
    return q.offset(offset).limit(limit).all()

@router.get("/", response_model=List[GastoSchema])
def list_todos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista TODOS los gastos (gestionables) del usuario autenticado.
    """
    return (
        db.query(models.Gasto)
        .options(
            joinedload(models.Gasto.proveedor_rel),
            joinedload(models.Gasto.tipo_rel),
            joinedload(models.Gasto.segmento),
            joinedload(models.Gasto.cuenta_rel),
            joinedload(models.Gasto.user),
        )
        .filter(models.Gasto.user_id == current_user.id)
        .order_by(models.Gasto.fecha.asc())
        .all()
    )


@router.get(
    "/aportables/legacy",
    response_model=List[GastoSchema],
    name="gastos_aportables_legacy",
)
def listar_gastos_aportables_dup(
    min_restantes: int = Query(1, ge=0),
    activo: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Versión legacy del listado de aportables (manteniendo compatibilidad antigua)
    para el usuario autenticado.
    """
    q = db.query(models.Gasto).filter(
        models.Gasto.user_id == current_user.id,
        models.Gasto.cuotas_restantes.isnot(None),
    )
    q = q.filter(models.Gasto.cuotas_restantes > min_restantes)
    if activo is not None:
        q = q.filter(models.Gasto.activo == activo)
    q = q.order_by(models.Gasto.nombre.asc())
    return q.offset(offset).limit(limit).all()


# =========================
# EXTRAORDINARIOS (PAGO ÚNICO) - GASTOS (ponderado)
# =========================

def _month_range(year: int, month: int) -> tuple[date, date]:
    """
    Devuelve (primer_día, último_día) del mes indicado.
    """
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


@router.get("/extra", response_model=List[GastoSchema])
def list_gastos_extra(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=1900, le=3000),
    q: Optional[str] = Query(
        None,
        description="Busca en nombre o proveedor",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista gastos con periodicidad = 'PAGO UNICO' del usuario autenticado
    y devuelve importes ponderados por Patrimonio.participacion_pct
    usando referencia_vivienda_id.
    """
    qset = (
        db.query(models.Gasto, models.Patrimonio.participacion_pct)
        .outerjoin(
            models.Patrimonio,
            models.Patrimonio.id == models.Gasto.referencia_vivienda_id,
        )
        .filter(models.Gasto.user_id == current_user.id)
        .filter(func.upper(models.Gasto.periodicidad) == "PAGO UNICO")
    )

    if month is not None and year is not None:
        start, end = _month_range(year, month)
        qset = qset.filter(
            models.Gasto.fecha >= start,
            models.Gasto.fecha <= end,
        )

    if q:
        patt = f"%{q.strip().lower()}%"
        qset = (
            qset.outerjoin(models.Proveedor, models.Proveedor.id == models.Gasto.proveedor_id)
            .filter(
                func.lower(func.coalesce(models.Gasto.nombre, "")).like(patt)
                | func.lower(func.coalesce(models.Proveedor.nombre, "")).like(patt)
            )
        )

    qset = qset.order_by(
        models.Gasto.fecha.desc().nullslast(),
        models.Gasto.createon.desc(),
    )

    rows = qset.all()
    out: List[dict] = []
    for g, pct in rows:
        ref = _norm_ref_id(getattr(g, "referencia_vivienda_id", None))
        factor = (float(pct or 100.0) / 100.0) if ref else 1.0
        base = float(g.importe or 0.0)
        ponderado = round(base * factor, 2)

        d = GastoSchema.model_validate(g).model_dump()
        d["importe"] = ponderado
        d["importe_cuota"] = ponderado
        out.append(d)
    return out


@router.get("/{gasto_id}", response_model=GastoSchema)
def get_gasto(
    gasto_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Recupera un gasto por id, siempre que pertenezca al usuario autenticado.
    """
    obj = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )
    return obj


# =========================
# CREATE
# =========================

@router.post(
    "/",
    response_model=GastoSchema,
    status_code=status.HTTP_201_CREATED,
)
def create_gasto(
    gasto_in: GastoCreateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un gasto gestionable para el usuario autenticado:
    - Normaliza campos (mayúsculas, vacíos -> None).
    - Genera id único.
    - Calcula cuotas, total, importe pendiente.
    - Ajusta liquidez si aplica.
    - Aplica lógica de pago relacionado (financiaciones/aportaciones).
    - Fuerza user_id = current_user.id (ignorando cualquier user_id del payload).
    """
    payload = to_payload(gasto_in)

    _str_empty_to_none(payload, [
        "tienda",
        "proveedor_id",
        "tipo_id",
        "segmento_id",
        "referencia_vivienda_id",
        "cuenta_id",
        "referencia_gasto",
        "periodicidad",
        "nombre",
        "rango_pago",
        "rama",
    ])
    _upperize_payload(payload)

    # Nunca confiamos en user_id que venga del cliente
    payload.pop("user_id", None)

    payload["id"] = generate_gasto_id(db)
    now_expr = func.now()
    payload["createon"] = now_expr
    payload["modifiedon"] = now_expr

    per_str    = (payload.get("periodicidad") or "").upper().strip()
    cuotas_in  = int(payload.get("cuotas") or 0)
    importe    = safe_float(payload.get("importe"))

    if payload.get("activo") is None:
        payload["activo"] = True
    if payload.get("pagado") is None:
        payload["pagado"] = False
    if payload.get("kpi") is None:
        payload["kpi"] = False

    # Inserción: si no marca cuotas, tratamos como 1 (y PU marca pagado=1)
    if cuotas_in > 0:
        cuotas_final = max(cuotas_in, 1)
        cuotas_pagadas = 0
    else:
        cuotas_final = 1
        cuotas_pagadas = 1 if per_str == "PAGO UNICO" else 0

    cuotas_restantes = max(cuotas_final - cuotas_pagadas, 0)

    payload["cuotas"]             = cuotas_final
    payload["cuotas_pagadas"]     = cuotas_pagadas
    payload["cuotas_restantes"]   = cuotas_restantes
    payload["importe_cuota"]      = round(importe, 2)
    payload["total"]              = round(cuotas_final * importe, 2)
    payload["importe_pendiente"]  = round(cuotas_restantes * importe, 2)

    if per_str == "PAGO UNICO":
        payload["inactivatedon"] = now_expr
        payload["activo"] = False
        payload["pagado"] = True
        payload["kpi"] = False
    else:
        payload["activo"] = True
        payload["pagado"] = False
        payload["kpi"] = True

    db_obj = models.Gasto(
        **payload,
        user_id=current_user.id,  # 👈 dueño del gasto
    )
    db.add(db_obj)

    # --- Ajuste de liquidez en CREATE ---
    # Regla: si es PAGO UNICO, restamos ya; si (por lo que sea) viene pagado=True, también restamos.
    if per_str == "PAGO UNICO" or bool(payload.get("pagado")) is True:
        adjust_liquidez(
            db,
            payload.get("cuenta_id"),
            -safe_float(payload.get("importe")),
        )

    # Pagos relacionados (aporta/unidades a financiación)
    _apply_pago_relacionado_create(db, payload)

    db.commit()
    db.refresh(db_obj)
    return db_obj


# =========================
# UPDATE
# =========================

@router.put("/{gasto_id}", response_model=GastoSchema)
def update_gasto(
    gasto_id: str,
    gasto_in: GastoUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un gasto gestionable del usuario autenticado, manteniendo toda la lógica de:
    - Cuotas (recurrente, financiación, pago único).
    - Liquidez (deltas según cambios de pagado/periodicidad/cuenta/importe).
    - Pagos relacionados (aportaciones a financiación).
    - Sincronización con plan de préstamo (PrestamoCuota).
    """
    db_obj = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not db_obj:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )

    incoming = gasto_in.model_dump(exclude_unset=True)

    _str_empty_to_none(incoming, [
        "tienda",
        "proveedor_id",
        "tipo_id",
        "segmento_id",
        "referencia_vivienda_id",
        "cuenta_id",
        "referencia_gasto",
        "periodicidad",
        "nombre",
        "rango_pago",
        "rama",
    ])
    _upperize_payload(incoming)

    # Nunca permitimos cambiar user_id desde fuera
    incoming.pop("user_id", None)

    # --- Snapshot PRE (para deltas de liquidez y sync préstamo) ---
    old_pagado   = bool(getattr(db_obj, "pagado", False))
    old_per      = (getattr(db_obj, "periodicidad", "") or "").upper().strip()
    old_cta      = getattr(db_obj, "cuenta_id", None)
    old_importe  = safe_float(getattr(db_obj, "importe", 0.0))
    prev_cp      = int(getattr(db_obj, "cuotas_pagadas", 0) or 0)
    prestamo_id  = getattr(db_obj, "prestamo_id", None)
    old_seg      = (getattr(db_obj, "segmento_id", None) or "").upper().strip()

    # Pagos relacionados (aporta/unidades a financiación) – antes de tocar campos
    _apply_pago_relacionado_update(db, db_obj, incoming)

    # Transición activo <-> inactivo (marca inactivatedon)
    if "activo" in incoming:
        prev = bool(getattr(db_obj, "activo", True))
        newv = bool(incoming["activo"])
        if prev and not newv:
            db_obj.inactivatedon = func.now()
        elif not prev and newv:
            db_obj.inactivatedon = None

    # Determinar periodicidad/importe destino
    per_str  = (incoming.get("periodicidad", db_obj.periodicidad) or "").upper().strip()
    importe  = safe_float(
        incoming.get(
            "importe",
            db_obj.importe if db_obj.importe is not None else db_obj.importe_cuota,
        )
    )

    # Blindaje: si llega cuotas=0 en edición, y NO es PAGO UNICO, y ya había >0, ignora
    if "cuotas" in incoming:
        try:
            if (
                int(incoming["cuotas"] or 0) == 0
                and (db_obj.cuotas or 0) > 0
                and per_str != "PAGO UNICO"
            ):
                incoming.pop("cuotas")
        except Exception:
            pass

    # Cuotas finales
    cuotas_raw   = incoming.get("cuotas", db_obj.cuotas)
    cuotas_final = int(cuotas_raw) if cuotas_raw is not None else int(db_obj.cuotas or 1)
    if cuotas_final <= 0:
        cuotas_final = 1

    # Clasificación
    is_pu           = (per_str == "PAGO UNICO")
    is_financiacion = (not is_pu) and (cuotas_final > 1)
    is_recurrente   = (
        (not is_pu)
        and (not is_financiacion)
        and (per_str in ("MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"))
    )

    # Cuotas pagadas entrada
    cp_raw = incoming.get("cuotas_pagadas", db_obj.cuotas_pagadas)
    cp_val = int(cp_raw) if cp_raw is not None else int(db_obj.cuotas_pagadas or 0)

    # Recalcula agregados del gasto en función de la clasificación
    if is_recurrente:
        cuotas_final       = 1
        cuotas_pagadas     = max(0, cp_val)
        cuotas_restantes   = 0
        importe_cuota      = round(importe, 2)
        total_calc         = round(1 * importe, 2)
        importe_pendiente  = 0.0
    elif is_financiacion:
        cuotas_pagadas     = max(0, min(cp_val, cuotas_final))
        cuotas_restantes   = max(cuotas_final - cuotas_pagadas, 0)
        importe_cuota      = round(importe, 2)
        total_calc         = round(cuotas_final * importe, 2)
        importe_pendiente  = round(cuotas_restantes * importe, 2)
    else:
        # PAGO ÚNICO u otros casos 1:N sin ser recurrente
        cuotas_pagadas     = max(0, min(cp_val, cuotas_final))
        cuotas_restantes   = max(cuotas_final - cuotas_pagadas, 0)
        importe_cuota      = round(importe, 2)
        total_calc         = round(cuotas_final * importe, 2)
        importe_pendiente  = round(cuotas_restantes * importe, 2)

    incoming["cuotas"]            = cuotas_final
    incoming["cuotas_pagadas"]    = cuotas_pagadas
    incoming["cuotas_restantes"]  = cuotas_restantes
    incoming["importe_cuota"]     = importe_cuota
    incoming["total"]             = total_calc
    incoming["importe_pendiente"] = importe_pendiente

    # Persiste cambios en el objeto
    for field, value in incoming.items():
        setattr(db_obj, field, value)

    # --- Snapshot POST (para deltas de liquidez) ---
    new_pagado   = bool(getattr(db_obj, "pagado", False))
    new_per      = (getattr(db_obj, "periodicidad", "") or "").upper().strip()
    new_cta      = getattr(db_obj, "cuenta_id", None)
    new_importe  = safe_float(
        getattr(db_obj, "importe", 0.0)
        if db_obj.importe is not None
        else getattr(db_obj, "importe_cuota", 0.0)
    )
    new_seg      = (getattr(db_obj, "segmento_id", None) or "").upper().strip()

    is_cot_before = (old_seg == SEG_COT)
    is_cot_after  = (new_seg == SEG_COT)
    skip_liquidez_for_cot = is_cot_before or is_cot_after

    # Liquidez en UPDATE:
    # Consideramos "efectivo" si es PAGO UNICO o si está pagado=True,
    # PERO si el gasto es COTIDIANO (antes o después) NO tocamos liquidez aquí.
    efectivo_antes = (old_per == "PAGO UNICO") or (old_pagado is True)
    efectivo_desp  = (new_per == "PAGO UNICO") or (new_pagado is True)

    if not skip_liquidez_for_cot:
        if efectivo_antes and efectivo_desp:
            # revertimos efecto anterior y aplicamos el nuevo (para cambios de importe / cuenta)
            if old_cta:
                adjust_liquidez(db, old_cta, +old_importe)
            if new_cta:
                adjust_liquidez(db, new_cta, -new_importe)
        elif efectivo_antes and not efectivo_desp:
            # deja de ser efectivo → devolvemos lo restado antes
            if old_cta:
                adjust_liquidez(db, old_cta, +old_importe)
        elif not efectivo_antes and efectivo_desp:
            # pasa a ser efectivo → aplicamos ahora
            if new_cta:
                adjust_liquidez(db, new_cta, -new_importe)

    # --- Sincronización con plan de préstamo si aplica ---
    if prestamo_id:
        _sync_prestamo_cuotas_by_gasto(db, db_obj, prev_cp)

    db_obj.modifiedon = func.now()
    db.commit()
    db.refresh(db_obj)
    return db_obj


# =========================
# PAGAR
# =========================

@router.put("/{gasto_id}/pagar", response_model=GastoSchema)
def pagar_gasto(
    gasto_id: str,
    db: Session = Depends(get_db),
    ajustar_liquidez: bool = Query(
        True,
        description="Si False, no modifica liquidez de la cuenta",
    ),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un gasto como pagado y actualiza:
    - Cuotas pagadas/restantes e importe pendiente.
    - Liquidez de la cuenta (salvo COTIDIANOS).
    - Estado activo/kpi según reglas de periodicidad.
    - Plan de préstamo si aplica.
    Sólo actúa sobre gastos del usuario autenticado.
    """
    g = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not g:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )

    per = (g.periodicidad or "").upper().strip()
    seg = (g.segmento_id or "").upper().strip()
    is_cot = (seg == SEG_COT)

    # Liquidez: solo si ajustar_liquidez=True Y NO es contenedor COTIDIANO
    if ajustar_liquidez and not is_cot:
        if per != "PAGO UNICO":
            per_unit = safe_float(
                g.importe if g.importe is not None else g.importe_cuota
            )
            if per_unit > 0 and g.cuenta_id:
                adjust_liquidez(db, g.cuenta_id, -per_unit)

    g.pagado = True

    cuotas_total = int(g.cuotas or 0)
    cuotas_pagadas_old = int(g.cuotas_pagadas or 0)
    cuotas_pagadas_new = cuotas_pagadas_old + 1

    is_pu = (per == "PAGO UNICO")
    is_financiacion = (not is_pu) and (cuotas_total > 1)
    is_recurrente = (
        (not is_pu)
        and (not is_financiacion)
        and (per in ("MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"))
    )

    if is_financiacion:
        if cuotas_total > 0 and cuotas_pagadas_new > cuotas_total:
            cuotas_pagadas_new = cuotas_total
        g.cuotas_pagadas = cuotas_pagadas_new
        g.cuotas_restantes = max(cuotas_total - cuotas_pagadas_new, 0)
        per_unit = g.importe if g.importe is not None else (g.importe_cuota or 0.0)
        g.importe_pendiente = round(
            float(per_unit) * float(g.cuotas_restantes or 0), 2
        )
        if cuotas_total > 1 and (g.cuotas_restantes or 0) == 0:
            g.activo = False
            g.kpi = False
            g.inactivatedon = func.now()
    elif is_recurrente:
        g.cuotas_pagadas = max(0, cuotas_pagadas_new)
        g.cuotas_restantes = 0
        g.importe_pendiente = 0.0
        if per not in ("MENSUAL", "PAGO UNICO"):
            g.kpi = False
    else:
        if cuotas_total > 0 and cuotas_pagadas_new > cuotas_total:
            cuotas_pagadas_new = cuotas_total
        g.cuotas_pagadas = cuotas_pagadas_new
        g.cuotas_restantes = max(cuotas_total - cuotas_pagadas_new, 0)
        per_unit = g.importe if g.importe is not None else (g.importe_cuota or 0.0)
        g.importe_pendiente = round(
            float(per_unit) * float(g.cuotas_restantes or 0), 2
        )
        if per not in ("MENSUAL", "PAGO UNICO"):
            g.kpi = False
        if cuotas_total > 1 and (g.cuotas_restantes or 0) == 0:
            g.activo = False
            g.kpi = False
            g.inactivatedon = func.now()

    # === SINCRONIZACIÓN PRÉSTAMO ===
    if getattr(g, "prestamo_id", None):
        _mark_next_unpaid_installment_as_paid(db, g.prestamo_id, g.id)
        _recompute_pendientes_prestamo(db, g.prestamo_id)

    # COT blindaje
    if seg == SEG_COT:
        g.activo = True
        if per == "MENSUAL":
            g.kpi = True
        if g.activo:
            g.inactivatedon = None

    g.modifiedon = func.now()
    db.commit()
    db.refresh(g)
    return g


# =========================
# DELETE con protección dependencias + reversión pagos relacionados
# =========================

@router.delete("/{gasto_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gasto(
    gasto_id: str,
    force: bool = Query(
        False,
        description=(
            "Si True, desvincula pagos relacionados (referencia_gasto=NULL) "
            "antes de borrar."
        ),
    ),
    cascade_prestamo: bool = Query(
        True,
        description=(
            "Si el gasto tiene prestamo_id, borra cuotas->prestamo->gasto."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Borra el gasto del usuario autenticado. Si cascade_prestamo=True y el gasto
    pertenece a un préstamo (prestamo_id no nulo), borra también todas sus cuotas
    y el propio préstamo.

    Si hay hijos (pagos relacionados) y no se pasa force=true, lanza 409.

    Adicional:
    - Si el gasto fue "efectivo" (PAGO UNICO o pagado=True),
      y modifiedon está en el mes actual,
      y NO es COTIDIANO,
      devolvemos a liquidez el importe efectivo.
    """
    g = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not g:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )

    hijos = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.referencia_gasto == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .all()
    )
    if hijos:
        if not force:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"No se puede eliminar: hay {len(hijos)} pagos relacionados que "
                    f"referencian este gasto. Repite con force=true para "
                    f"desvincularlos y continuar."
                ),
            )
        for h in hijos:
            h.referencia_gasto = None
            h.modifiedon = func.now()
        db.flush()

    # Reversión pagos relacionados
    _apply_pago_relacionado_delete(db, g)

    # --- Lógica de liquidez al borrar ---
    per = (g.periodicidad or "").upper().strip()
    seg = (g.segmento_id or "").upper().strip()
    is_cot = (seg == SEG_COT)

    pagado_flag = bool(getattr(g, "pagado", False))
    importe_efectivo = safe_float(
        g.importe if g.importe is not None else g.importe_cuota
    )

    efectivo = (per == "PAGO UNICO") or pagado_flag

    if not is_cot and efectivo and importe_efectivo > 0 and g.cuenta_id:
        today = date.today()
        mod = getattr(g, "modifiedon", None)
        same_month = False
        if mod is not None:
            try:
                same_month = (mod.year == today.year and mod.month == today.month)
            except Exception:
                same_month = False

        if same_month:
            adjust_liquidez(db, g.cuenta_id, +importe_efectivo)

    # Cascada de préstamo si aplica
    if cascade_prestamo and getattr(g, "prestamo_id", None):
        pid = g.prestamo_id
        db.query(models.PrestamoCuota).filter(
            models.PrestamoCuota.prestamo_id == pid
        ).delete(synchronize_session=False)
        db.query(models.Prestamo).filter(
            models.Prestamo.id == pid
        ).delete(synchronize_session=False)
        db.flush()

    db.delete(g)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =========================
# ACTIVAR / INACTIVAR
# =========================

@router.put("/{gasto_id}/activar", response_model=GastoSchema)
def activar_gasto(
    gasto_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un gasto del usuario autenticado como activo, visible en KPIs
    y limpia inactivatedon.
    """
    g = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not g:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )
    g.activo = True
    g.kpi = True
    g.inactivatedon = None
    g.modifiedon = func.now()
    db.commit()
    db.refresh(g)
    return g


@router.put("/{gasto_id}/inactivar", response_model=GastoSchema)
def inactivar_gasto(
    gasto_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un gasto del usuario autenticado como inactivo y lo excluye de KPIs.
    """
    g = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.id == gasto_id,
            models.Gasto.user_id == current_user.id,
        )
        .first()
    )
    if not g:
        raise HTTPException(
            status_code=404,
            detail="Gasto no encontrado o no autorizado",
        )
    g.activo = False
    g.kpi = False
    g.inactivatedon = func.now()
    g.modifiedon = func.now()
    db.commit()
    db.refresh(g)
    return g


# =========================
# REINICIO DE ESTADOS + REINICIAR MES
# =========================

def reiniciar_estados_core(
    db: Session,
    user_id: int,
    aplicar_promedios: bool = False,
) -> dict:
    """
    Lógica central de 'reiniciar mes' PARA UN USUARIO:
    - Resetea estados de gastos e ingresos según periodicidad.
    - Opcionalmente actualiza promedios 3M para contenedores COTIDIANOS.
    """
    today = date.today()
    counters = {
        "gastos": {
            "mensuales_reseteados": 0,
            "periodicos_reactivados": 0,
            "periodicos_mantenidos": 0,
            "cot_forzados_visibles": 0,
            "promedios_actualizados": 0,
        },
        "ingresos": {
            "mensuales_reseteados": 0,
            "periodicos_reactivados": 0,
            "periodicos_mantenidos": 0,
        },
    }

    gastos = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == user_id,
            models.Gasto.activo == True,
        )
        .all()
    )
    for g in gastos:
        changed = False
        per = (g.periodicidad or "").upper().strip()
        seg = (g.segmento_id or "").upper().strip()

        if per == "MENSUAL":
            if g.pagado is not False:
                g.pagado = False
                changed = True
                counters["gastos"]["mensuales_reseteados"] += 1

        elif per not in ("PAGO UNICO", "MENSUAL") and per in PERIOD_MESES:
            umbral = PERIOD_MESES[per]
            diff = _months_diff(today, g.fecha)
            if diff is not None and diff >= umbral:
                if g.pagado is not False:
                    g.pagado = False
                    changed = True
                if g.kpi is not True:
                    g.kpi = True
                    changed = True
                new_date = _add_months(g.fecha, umbral)
                if new_date and new_date != g.fecha:
                    g.fecha = new_date
                    changed = True
                counters["gastos"]["periodicos_reactivados"] += 1
            else:
                if g.activo is not True:
                    g.activo = True
                    changed = True
                if g.pagado is not True:
                    g.pagado = True
                    changed = True
                if g.kpi is not False:
                    g.kpi = False
                    changed = True
                counters["gastos"]["periodicos_mantenidos"] += 1

        if seg == SEG_COT:
            bump = False
            if g.activo is not True:
                g.activo = True
                bump = True
            if g.kpi is not True and per == "MENSUAL":
                g.kpi = True
                bump = True
            if bump:
                changed = True
                counters["gastos"]["cot_forzados_visibles"] += 1

        if changed:
            g.modifiedon = func.now()

    ingresos = (
        db.query(models.Ingreso)
        .filter(
            models.Ingreso.user_id == user_id,
            models.Ingreso.activo == True,
        )
        .all()
    )
    for inc in ingresos:
        changed = False
        per = (inc.periodicidad or "").upper().strip()
        base_date = inc.fecha_inicio

        if per == "MENSUAL":
            if getattr(inc, "cobrado", None) is not False:
                inc.cobrado = False
                changed = True
                counters["ingresos"]["mensuales_reseteados"] += 1
        elif per not in ("PAGO UNICO", "MENSUAL") and per in PERIOD_MESES:
            umbral = PERIOD_MESES[per]
            diff = _months_diff(today, base_date)
            if diff is not None and diff >= umbral:
                if getattr(inc, "cobrado", None) is not False:
                    inc.cobrado = False
                    changed = True
                if inc.kpi is not True:
                    inc.kpi = True
                    changed = True
                new_bd = _add_months(base_date, umbral) if base_date else None
                if new_bd and new_bd != inc.fecha_inicio:
                    inc.fecha_inicio = new_bd
                    changed = True
                counters["ingresos"]["periodicos_reactivados"] += 1
            else:
                if inc.activo is not True:
                    inc.activo = True
                    changed = True
                if getattr(inc, "cobrado", None) is not True:
                    inc.cobrado = True
                    changed = True
                if inc.kpi is not False:
                    inc.kpi = False
                    changed = True
                counters["ingresos"]["periodicos_mantenidos"] += 1

        if changed:
            inc.modifiedon = func.now()

    if aplicar_promedios:
        try:
            updated = _apply_promedios_3m_por_tipo(db, user_id=user_id)
            counters["gastos"]["promedios_actualizados"] = int(updated or 0)
        except Exception as e:
            print(f"[PROM-3M] ERROR: {e}")

    db.commit()
    return {"updated": counters}


@router.get("/reiniciar_mes/eligibility")
def reiniciar_mes_eligibility(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Indica si es "seguro" reiniciar mes PARA EL USUARIO ACTUAL:
    - No debe haber gastos activos+kpi con pagado=False
    - No debe haber ingresos activos+kpi con cobrado=False
    """
    gastos_pend = (
        db.query(func.count())
        .select_from(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.activo == True,
            models.Gasto.kpi == True,
            models.Gasto.pagado == False,
        )
        .scalar()
    )
    ingresos_pend = (
        db.query(func.count())
        .select_from(models.Ingreso)
        .filter(
            models.Ingreso.user_id == current_user.id,
            models.Ingreso.activo == True,
            models.Ingreso.kpi == True,
            models.Ingreso.cobrado == False,
        )
        .scalar()
    )
    can = (gastos_pend == 0) and (ingresos_pend == 0)
    return {
        "gastos_pendientes": int(gastos_pend or 0),
        "ingresos_pendientes": int(ingresos_pend or 0),
        "can_reiniciar": can,
    }


@router.post("/reiniciar_mes")
def reiniciar_mes(
    aplicar_promedios: bool = Query(
        False,
        description="Si True, recalcula importe/importe_cuota por PROM-3M.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Ejecuta la lógica completa de reinicio de mes PARA EL USUARIO ACTUAL
    y devuelve un resumen de lo que se ha cambiado (gastos e ingresos).
    """
    result = reiniciar_estados_core(
        db,
        user_id=current_user.id,
        aplicar_promedios=aplicar_promedios,
    )

    cot_list = (
        db.query(models.Gasto)
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.segmento_id == SEG_COT,
        )
        .all()
    )
    extra_forzados = 0
    for g in cot_list:
        was_inactive = (g.activo is False)
        if was_inactive or (
            g.kpi is False and (g.periodicidad or "").upper() == "MENSUAL"
        ):
            g.activo = True
            if (g.periodicidad or "").upper() == "MENSUAL":
                g.kpi = True
            if was_inactive:
                g.inactivatedon = None
            g.modifiedon = func.now()
            extra_forzados += 1
    if extra_forzados:
        db.commit()
        result["updated"]["gastos"]["cot_forzados_visibles"] += extra_forzados

    summary = {
        "Gastos": {
            "Mensuales reseteados": result["updated"]["gastos"]["mensuales_reseteados"],
            "Periódicos reactivados": result["updated"]["gastos"]["periodicos_reactivados"],
            "Periódicos mantenidos": result["updated"]["gastos"]["periodicos_mantenidos"],
            "COT forzados visibles": result["updated"]["gastos"]["cot_forzados_visibles"],
            "Promedios actualizados": result["updated"]["gastos"]["promedios_actualizados"],
        },
        "Ingresos": {
            "Mensuales reseteados": result["updated"]["ingresos"]["mensuales_reseteados"],
            "Periódicos reactivados": result["updated"]["ingresos"]["periodicos_reactivados"],
            "Periódicos mantenidos": result["updated"]["ingresos"]["periodicos_mantenidos"],
        },
    }

    return {"updated": result["updated"], "summary": summary}


# =========================
# COTIDIANOS – presupuesto total
# =========================

COTIDIANO_SEGMENTO_ID = SEG_COT


@router.get("/cotidianos/presupuesto_total")
def presupuesto_cotidianos_total(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve el presupuesto total mensual de los gastos COTIDIANOS
    activos+kpi del usuario autenticado.
    """
    total = (
        db.query(func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0))
        .filter(
            models.Gasto.user_id == current_user.id,
            models.Gasto.segmento_id == COTIDIANO_SEGMENTO_ID,
            models.Gasto.activo == True,
            models.Gasto.kpi == True,
        )
        .scalar()
    )
    return {"total": float(total or 0)}
