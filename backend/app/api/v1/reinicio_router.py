# backend/app/api/v1/reinicio_router.py
"""
Router de REINICIO (mes) + PREVIEW + PROMEDIOS 3M + PREVIEW CIERRE (what-if).

Objetivo:
- Consolidar todo lo de reinicio del mes fuera de gastos_router:
  - eligibility
  - preview (sin insertar)
  - ejecutar reinicio (persistente)
  - cálculo promedios 3M contenedores COT
  - presupuesto total COT

Además:
- Preview cierre mensual (what-if): "si cerráramos el mes ahora",
  sin insertar cierre en DB.

Nota:
- No usamos capa services (según tu preferencia).
"""

from __future__ import annotations

from datetime import datetime, timezone, date
from calendar import monthrange
from typing import Optional, Tuple, Dict, Any

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.api.v1.auth_router import require_user

from backend.app.schemas.reinicio import (
    ReinicioMesEligibilityResponse,
    PresupuestoCotidianosTotalResponse,
    ReinicioMesPreviewResponse,
    ReinicioMesExecuteResponse,
    CierrePreviewOut,
)

router = APIRouter(prefix="/reinicio", tags=["reinicio"])


# =============================================================================
# Constantes (idénticas a lo que ya usabas)
# =============================================================================

SEG_COT = "COT-12345"
PERIOD_MESES = {"TRIMESTRAL": 3, "SEMESTRAL": 6, "ANUAL": 12}

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

PROM_GROUPS = {
    COT_TIPOS["GASOLINA"]: [
        COT_TIPOS["GASOLINA"],
        COT_TIPOS["PEAJES"],
        COT_TIPOS["MANT_VEH"],
    ],
    COT_TIPOS["RESTAURANTES"]: [
        COT_TIPOS["RESTAURANTES"],
        COT_TIPOS["HOTELES"],
        COT_TIPOS["ACTIVIDADES"],
    ],
    COT_TIPOS["ELECTRICIDAD"]: [COT_TIPOS["ELECTRICIDAD"]],
    COT_TIPOS["COMIDA"]:       [COT_TIPOS["COMIDA"]],
    COT_TIPOS["ROPA"]:         [COT_TIPOS["ROPA"]],
}


# =============================================================================
# Helpers - fechas
# =============================================================================

def _is_in_reinicio_window(now: Optional[date] = None) -> bool:
    """Ventana operativa: días 1..5 del mes."""
    now = now or date.today()
    return 1 <= int(now.day) <= 5


def _months_diff(d1: date, d2: date | None) -> int | None:
    """Diferencia en meses entre d1 y d2 (d1 - d2)."""
    if not d2:
        return None
    return (d1.year - d2.year) * 12 + (d1.month - d2.month)


def _add_months(d: date | None, n: int) -> date | None:
    """Suma n meses a una fecha ajustando el día al último del mes si aplica."""
    if not d:
        return None
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    last_day = monthrange(y, m)[1]
    return date(y, m, min(d.day, last_day))


def _month_bounds(y: int, m: int) -> Tuple[date, date]:
    """(primer_día, último_día) del mes."""
    last = monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def _month_range_dt(anio: int, mes: int) -> tuple[datetime, datetime]:
    """Devuelve [inicio_mes, inicio_mes_siguiente) para filtrar por fecha/datetime."""
    if mes < 1 or mes > 12:
        raise ValueError("mes fuera de rango")
    start = datetime(anio, mes, 1)
    end = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)
    return start, end


# =============================================================================
# Helpers - PROM-3M
# =============================================================================

def _sum_gc_tipo_mes(
    db: Session,
    tipo_id: str,
    start: date,
    end: date,
    user_id: Optional[int] = None,
) -> float:
    """Suma importe de GastoCotidiano.pagado en rango start-end."""
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
    m1: Tuple[date, date],
    m2: Tuple[date, date],
    m3: Tuple[date, date],
    user_id: Optional[int] = None,
) -> float:
    """Promedio de últimos 3 meses con gasto > 0."""
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
    m1: Tuple[date, date],
    m2: Tuple[date, date],
    m3: Tuple[date, date],
    user_id: Optional[int] = None,
) -> float:
    """Suma de promedios 3M."""
    total = 0.0
    for t in (tipo_ids or []):
        total += _avg_3m_for_tipo(db, t, m1, m2, m3, user_id=user_id)
    return round(total, 2)


def _apply_promedios_3m_por_tipo(db: Session, user_id: Optional[int] = None) -> int:
    """Recalcula importe/importe_cuota de gastos contenedor de COT según promedio 3 meses."""
    today = date.today()

    y1, m1 = today.year, today.month - 1
    if m1 == 0:
        m1, y1 = 12, y1 - 1
    start1, end1 = _month_bounds(y1, m1)

    y2, m2 = y1, m1 - 1
    if m2 == 0:
        m2, y2 = 12, y2 - 1
    start2, end2 = _month_bounds(y2, m2)

    y3, m3 = y2, m2 - 1
    if m3 == 0:
        m3, y3 = 12, y3 - 1
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

        for g in rows_q.all():
            g.importe = valor_contenedor
            g.importe_cuota = valor_contenedor
            g.modifiedon = func.now()
            total_updates += 1

    return total_updates


# =============================================================================
# Helpers - Presupuesto COT total
# =============================================================================

def _presupuesto_cotidianos_total(db: Session, user_id: int) -> float:
    """Presupuesto total mensual de gastos COT activos+kpi."""
    total = (
        db.query(func.coalesce(func.sum(models.Gasto.importe_cuota), 0.0))
        .filter(
            models.Gasto.user_id == user_id,
            models.Gasto.segmento_id == SEG_COT,
            models.Gasto.activo == True,
            models.Gasto.kpi == True,
        )
        .scalar()
    )
    return float(total or 0.0)


# =============================================================================
# Core - eligibility y reinicio
# =============================================================================

def _reiniciar_mes_eligibility_core(db: Session, user_id: int) -> Dict[str, int | bool]:
    """Sin cambios respecto a tu lógica anterior."""
    gastos_pend = (
        db.query(func.count())
        .select_from(models.Gasto)
        .filter(
            models.Gasto.user_id == user_id,
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
            models.Ingreso.user_id == user_id,
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
        "can_reiniciar": bool(can),
    }


def _reiniciar_estados_core(
    db: Session,
    user_id: int,
    aplicar_promedios: bool = False,
) -> dict:
    """Tu reinicio 1:1 (sin perder funcionalidad)."""
    today = date.today()
    counters: Dict[str, Any] = {
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
        .filter(models.Gasto.user_id == user_id, models.Gasto.activo == True)
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

        # COT: forzar visibilidad + KPI mensual
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
        .filter(models.Ingreso.user_id == user_id, models.Ingreso.activo == True)
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
        updated = _apply_promedios_3m_por_tipo(db, user_id=user_id)
        counters["gastos"]["promedios_actualizados"] = int(updated or 0)

    db.commit()
    return {"updated": counters}


def _build_summary(updated: dict) -> dict:
    """Mantiene el mismo shape que ya devolvías."""
    return {
        "Gastos": {
            "Mensuales reseteados": updated["gastos"]["mensuales_reseteados"],
            "Periódicos reactivados": updated["gastos"]["periodicos_reactivados"],
            "Periódicos mantenidos": updated["gastos"]["periodicos_mantenidos"],
            "COT forzados visibles": updated["gastos"]["cot_forzados_visibles"],
            "Promedios actualizados": updated["gastos"]["promedios_actualizados"],
        },
        "Ingresos": {
            "Mensuales reseteados": updated["ingresos"]["mensuales_reseteados"],
            "Periódicos reactivados": updated["ingresos"]["periodicos_reactivados"],
            "Periódicos mantenidos": updated["ingresos"]["periodicos_mantenidos"],
        },
    }


# =============================================================================
# Endpoints - MES (reinicio)
# =============================================================================

@router.get("/mes/eligibility", response_model=ReinicioMesEligibilityResponse)
def mes_eligibility(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    data = _reiniciar_mes_eligibility_core(db, user_id=current_user.id)
    return ReinicioMesEligibilityResponse(**data)


@router.get("/mes/presupuesto_total", response_model=PresupuestoCotidianosTotalResponse)
def mes_presupuesto_total(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    total = _presupuesto_cotidianos_total(db, user_id=current_user.id)
    return PresupuestoCotidianosTotalResponse(total=float(total))


@router.get("/mes/preview", response_model=ReinicioMesPreviewResponse)
def mes_preview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    window_ok = _is_in_reinicio_window()
    elig = _reiniciar_mes_eligibility_core(db, user_id=current_user.id)
    cot_total = _presupuesto_cotidianos_total(db, user_id=current_user.id)

    return ReinicioMesPreviewResponse(
        ventana_1_5_ok=window_ok,
        eligibility=ReinicioMesEligibilityResponse(**elig),
        presupuesto_cotidianos_total=PresupuestoCotidianosTotalResponse(total=float(cot_total)),
    )


@router.post("/mes/ejecutar", response_model=ReinicioMesExecuteResponse)
def mes_ejecutar(
    aplicar_promedios: bool = Query(False, description="Recalcula PROM-3M contenedores COT."),
    enforce_window: bool = Query(False, description="Si True, bloquea fuera del día 1..5."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    if enforce_window and not _is_in_reinicio_window():
        raise HTTPException(status_code=409, detail="Fuera de ventana (días 1..5).")

    result = _reiniciar_estados_core(
        db,
        user_id=current_user.id,
        aplicar_promedios=aplicar_promedios,
    )
    summary = _build_summary(result["updated"])
    return ReinicioMesExecuteResponse(updated=result["updated"], summary=summary)


# =============================================================================
# Endpoints - CIERRE (preview what-if)
# =============================================================================

@router.get("/cierre/preview", response_model=CierrePreviewOut)
def cierre_preview(
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    mes: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Preview "what-if": acumulado del mes indicado hasta ahora (sin insertar cierre).
    Por defecto: mes actual.
    """
    now = datetime.now(timezone.utc)
    anio_val = anio or now.year
    mes_val = mes or now.month

    start, end = _month_range_dt(anio_val, mes_val)

    Ingreso = models.Ingreso
    Gasto = models.Gasto

    # -----------------------------
    # IMPORTANTE: Ingreso NO tiene 'fecha' en tu modelo.
    # En tu código ya usas 'fecha_inicio'.
    # -----------------------------
    if not hasattr(Ingreso, "fecha_inicio"):
        raise HTTPException(
            status_code=500,
            detail="models.Ingreso no tiene 'fecha_inicio'. Indica el nombre real del campo fecha en Ingreso.",
        )
    if not hasattr(Gasto, "fecha"):
        raise HTTPException(
            status_code=500,
            detail="models.Gasto no tiene 'fecha'. Indica el nombre real del campo fecha en Gasto.",
        )

    q_ing = (
        db.query(func.coalesce(func.sum(Ingreso.importe), 0.0))
        .filter(Ingreso.user_id == current_user.id)
        .filter(Ingreso.fecha_inicio >= start)
        .filter(Ingreso.fecha_inicio < end)
    )

    q_gas = (
        db.query(func.coalesce(func.sum(Gasto.importe), 0.0))
        .filter(Gasto.user_id == current_user.id)
        .filter(Gasto.fecha >= start)
        .filter(Gasto.fecha < end)
    )

    ingresos_reales = float(q_ing.scalar() or 0.0)
    gastos_reales_total = float(q_gas.scalar() or 0.0)
    resultado_real = ingresos_reales - gastos_reales_total

    return CierrePreviewOut(
        anio=anio_val,
        mes=mes_val,
        as_of=now.isoformat(),
        ingresos_reales=ingresos_reales,
        gastos_reales_total=gastos_reales_total,
        resultado_real=resultado_real,
        ingresos_esperados=None,
        gastos_esperados_total=None,
        resultado_esperado=None,
        desv_resultado=None,
        desv_ingresos=None,
        desv_gastos_total=None,
        extras={
            "range_start": start.isoformat(),
            "range_end": end.isoformat(),
            "note": "Preview what-if: acumulado del mes hasta la fecha (no inserta cierre).",
            "ingreso_date_field": "fecha_inicio",
            "gasto_date_field": "fecha",
        },
    )
