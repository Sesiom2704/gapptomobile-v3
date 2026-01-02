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

CAMBIO IMPORTANTE:
- /reinicio/cierre/preview calcula con EXACTAMENTE las mismas reglas que has definido:

Periodo = [start, end) (half-open). Ej: dic 2025 => [2025-12-01, 2026-01-01)

1) ingresos_esperados:
   ingresos where ultimo_ingreso_on in range AND periodicidad <> 'PAGO UNICO'

2) ingresos_reales:
   ingresos where ultimo_ingreso_on in range

3) desv_ingresos = (1) - (2)

4) gastos_gestionables_esperados:
   gastos where ultimo_pago_on in range AND periodicidad <> 'PAGO UNICO' AND segmento_id <> SEG_COT

5) gastos_gestionables_reales:
   gastos where ultimo_pago_on in range AND segmento_id <> SEG_COT

6) gastos_cotidianos_esperados:
   gastos where ultimo_pago_on in range AND segmento_id = SEG_COT

7) gastos_cotidianos_reales:
   gastos_cotidianos where fecha in range AND pagado = true

8) gastos_reales_total = (5) + (7)

9)  desv_gestionables = (4) - (5)
10) desv_cotidianos   = (6) - (7)
11) desv_gastos_total = ((4)+(6)) - (8)

12) n_recurrentes_ing = COUNT rows de (1)
13) n_recurrentes_gas = COUNT rows de (4)
14) n_unicos_ing      = COUNT ingresos in range AND periodicidad='PAGO UNICO'
15) n_unicos_gas      = (según tu definición) COUNT gastos in range AND segmento_id = SEG_COT
16) n_cotidianos      = COUNT rows de (7)

17) liquidez_total:
    cuentas_bancarias where activo=true

Nota:
- Se normaliza periodicidad: UPPER(REPLACE(periodicidad,'_',' ')) para tolerar 'PAGO_UNICO'.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db
from backend.app.schemas.reinicio import (
    CierrePreviewOut,
    PresupuestoCotidianosTotalResponse,
    ReinicioMesEligibilityResponse,
    ReinicioMesExecuteResponse,
    ReinicioMesPreviewResponse,
)

router = APIRouter(prefix="/reinicio", tags=["reinicio"])


# =============================================================================
# Constantes
# =============================================================================

SEG_COT = "COT-12345"
PERIOD_MESES = {"TRIMESTRAL": 3, "SEMESTRAL": 6, "ANUAL": 12}


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
    """(primer_día, último_día) del mes (inclusive)."""
    last = monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def _month_range_date_half_open(anio: int, mes: int) -> tuple[date, date]:
    """
    Rango de mes half-open [start, end) en DATE.
    Ejemplo: dic 2025 => [2025-12-01, 2026-01-01)
    """
    if mes < 1 or mes > 12:
        raise ValueError("mes fuera de rango")
    start = date(anio, mes, 1)
    end = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return start, end


# =============================================================================
# Helpers - normalización de periodicidad
# =============================================================================

def _periodicidad_norm_sql(col):
    """
    Normaliza periodicidad para tolerar:
    - 'PAGO_UNICO' vs 'PAGO UNICO'
    - mayúsculas/minúsculas
    """
    return func.upper(func.replace(func.coalesce(col, ""), "_", " "))


# =============================================================================
# Helpers - Presupuesto COT total
# =============================================================================

def _presupuesto_cotidianos_total(db: Session, user_id: int) -> float:
    """Presupuesto total mensual de gastos COT activos + KPI."""
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
# Core - eligibility
# =============================================================================

def _reiniciar_mes_eligibility_core(db: Session, user_id: int) -> Dict[str, int | bool]:
    """
    Regla actual:
    - No se puede reiniciar si hay gastos/ingresos KPI pendientes.
    """
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


# =============================================================================
# Core - reinicio (manteniendo tu lógica)
# =============================================================================

def _reiniciar_estados_core(db: Session, user_id: int, aplicar_promedios: bool = False) -> dict:
    """
    Reinicio 1:1 con tu comportamiento existente (reseteo mensual, reactivación periódicos, etc.).
    """
    today = date.today()
    counters: Dict[str, Any] = {
        "gastos": {
            "mensuales_reseteados": 0,
            "periodicos_reactivados": 0,
            "periodicos_mantenidos": 0,
            "cot_forzados_visibles": 0,
            "promedios_actualizados": 0,  # se mantiene por compatibilidad
        },
        "ingresos": {
            "mensuales_reseteados": 0,
            "periodicos_reactivados": 0,
            "periodicos_mantenidos": 0,
        },
    }

    # --- Gastos ---
    gastos = (
        db.query(models.Gasto)
        .filter(models.Gasto.user_id == user_id, models.Gasto.activo == True)
        .all()
    )

    for g in gastos:
        changed = False
        per = (g.periodicidad or "").upper().strip().replace("_", " ")
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

    # --- Ingresos ---
    ingresos = (
        db.query(models.Ingreso)
        .filter(models.Ingreso.user_id == user_id, models.Ingreso.activo == True)
        .all()
    )

    for inc in ingresos:
        changed = False
        per = (inc.periodicidad or "").upper().strip().replace("_", " ")
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

    # Nota: aquí no ejecuto promedios porque tu snippet original los tenía en otro bloque.
    # Si quieres reactivar PROM-3M, lo enchufamos aquí con una función equivalente a la que ya usabas.

    db.commit()
    return {"updated": counters}


def _build_summary(updated: dict) -> dict:
    """Mantiene el shape histórico del summary."""
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
# Core - snapshot cierre (según tus SQL)
# =============================================================================

def _compute_cierre_snapshot_sql(db: Session, user_id: int, anio: int, mes: int) -> dict:
    """
    Calcula el snapshot del cierre del periodo (anio, mes) con las reglas definidas arriba.
    """
    start_date, end_date = _month_range_date_half_open(anio, mes)

    Ingreso = models.Ingreso
    Gasto = models.Gasto
    GastoCot = models.GastoCotidiano
    Cuenta = models.CuentaBancaria

    # Validación defensiva de columnas: si algo no cuadra, error claro.
    for col in ("ultimo_ingreso_on", "importe", "periodicidad", "user_id"):
        if not hasattr(Ingreso, col):
            raise HTTPException(status_code=500, detail=f"models.Ingreso no tiene '{col}' (requerido en cierre preview).")
    for col in ("ultimo_pago_on", "importe_cuota", "segmento_id", "periodicidad", "user_id"):
        if not hasattr(Gasto, col):
            raise HTTPException(status_code=500, detail=f"models.Gasto no tiene '{col}' (requerido en cierre preview).")
    for col in ("fecha", "importe", "pagado", "user_id"):
        if not hasattr(GastoCot, col):
            raise HTTPException(status_code=500, detail=f"models.GastoCotidiano no tiene '{col}' (requerido en cierre preview).")
    for col in ("liquidez", "activo", "user_id"):
        if not hasattr(Cuenta, col):
            raise HTTPException(status_code=500, detail=f"models.CuentaBancaria no tiene '{col}' (requerido en cierre preview).")

    per_ing = _periodicidad_norm_sql(Ingreso.periodicidad)
    per_gas = _periodicidad_norm_sql(Gasto.periodicidad)

    # 1) ingresos_esperados + 12) n_recurrentes_ing
    ing_rec = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(Ingreso.importe), 0.0).label("sum_importe"),
        )
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .filter(per_ing != "PAGO UNICO")
        .one()
    )
    ingresos_esperados = float(ing_rec.sum_importe or 0.0)
    n_recurrentes_ing = int(ing_rec.n_rows or 0)

    # 2) ingresos_reales
    ingresos_reales = float(
        db.query(func.coalesce(func.sum(Ingreso.importe), 0.0))
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .scalar()
        or 0.0
    )

    # 14) n_unicos_ing
    n_unicos_ing = int(
        db.query(func.count())
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .filter(per_ing == "PAGO UNICO")
        .scalar()
        or 0
    )

    # 3) desv_ingresos = esperados - reales (según tu definición)
    desv_ingresos = float(ingresos_esperados - ingresos_reales)

    # 4) gastos_gestionables_esperados + 13) n_recurrentes_gas
    gas_gest_rec = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(Gasto.importe_cuota), 0.0).label("sum_importe"),
        )
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(per_gas != "PAGO UNICO")
        .filter(Gasto.segmento_id != SEG_COT)
        .one()
    )
    gastos_gestionables_esperados = float(gas_gest_rec.sum_importe or 0.0)
    n_recurrentes_gas = int(gas_gest_rec.n_rows or 0)

    # 5) gastos_gestionables_reales
    gastos_gestionables_reales = float(
        db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id != SEG_COT)
        .scalar()
        or 0.0
    )

    # 6) gastos_cotidianos_esperados (desde gastos)
    gastos_cotidianos_esperados = float(
        db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id == SEG_COT)
        .scalar()
        or 0.0
    )

    # 7) gastos_cotidianos_reales + 16) n_cotidianos (desde gastos_cotidianos)
    cot_real = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(GastoCot.importe), 0.0).label("sum_importe"),
        )
        .filter(GastoCot.user_id == user_id)
        .filter(GastoCot.fecha >= start_date)
        .filter(GastoCot.fecha < end_date)
        .filter(GastoCot.pagado == True)
        .one()
    )
    gastos_cotidianos_reales = float(cot_real.sum_importe or 0.0)
    n_cotidianos = int(cot_real.n_rows or 0)

    # 15) n_unicos_gas (tu definición: segmento_id = COT)
    n_unicos_gas = int(
        db.query(func.count())
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id == SEG_COT)
        .scalar()
        or 0
    )

    # 8) gastos_reales_total
    gastos_reales_total = float(gastos_gestionables_reales + gastos_cotidianos_reales)

    # 9..11) desviaciones de gastos
    desv_gestionables = float(gastos_gestionables_esperados - gastos_gestionables_reales)
    desv_cotidianos = float(gastos_cotidianos_esperados - gastos_cotidianos_reales)

    gastos_esperados_total = float(gastos_gestionables_esperados + gastos_cotidianos_esperados)
    desv_gastos_total = float(gastos_esperados_total - gastos_reales_total)

    # Resultado esperado/real (necesario en UI)
    resultado_esperado = float(ingresos_esperados - gastos_esperados_total)
    resultado_real = float(ingresos_reales - gastos_reales_total)
    desv_resultado = float(resultado_esperado - resultado_real)

    # 17) liquidez_total
    liquidez_total = float(
        db.query(func.coalesce(func.sum(Cuenta.liquidez), 0.0))
        .filter(Cuenta.user_id == user_id)
        .filter(Cuenta.activo == True)
        .scalar()
        or 0.0
    )

    return {
        "periodo": {"anio": anio, "mes": mes, "start": start_date.isoformat(), "end": end_date.isoformat()},
        "ingresos_esperados": ingresos_esperados,
        "ingresos_reales": ingresos_reales,
        "desv_ingresos": desv_ingresos,
        "gastos_gestionables_esperados": gastos_gestionables_esperados,
        "gastos_gestionables_reales": gastos_gestionables_reales,
        "gastos_cotidianos_esperados": gastos_cotidianos_esperados,
        "gastos_cotidianos_reales": gastos_cotidianos_reales,
        "gastos_esperados_total": gastos_esperados_total,
        "gastos_reales_total": gastos_reales_total,
        "desv_gestionables": desv_gestionables,
        "desv_cotidianos": desv_cotidianos,
        "desv_gastos_total": desv_gastos_total,
        "resultado_esperado": resultado_esperado,
        "resultado_real": resultado_real,
        "desv_resultado": desv_resultado,
        "n_recurrentes_ing": n_recurrentes_ing,
        "n_recurrentes_gas": n_recurrentes_gas,
        "n_unicos_ing": n_unicos_ing,
        "n_unicos_gas": n_unicos_gas,
        "n_cotidianos": n_cotidianos,
        "liquidez_total": liquidez_total,
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
    aplicar_promedios: bool = Query(False, description="(Reservado) PROM-3M contenedores COT."),
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
    Preview "what-if" del cierre mensual, SIN insertar en DB.

    Si no envías (anio, mes), se usa el mes actual (UTC).
    """
    now = datetime.now(timezone.utc)
    anio_val = anio or now.year
    mes_val = mes or now.month

    snap = _compute_cierre_snapshot_sql(db, user_id=current_user.id, anio=anio_val, mes=mes_val)

    return CierrePreviewOut(
        anio=anio_val,
        mes=mes_val,
        as_of=now.isoformat(),

        ingresos_reales=float(snap["ingresos_reales"]),
        gastos_reales_total=float(snap["gastos_reales_total"]),
        resultado_real=float(snap["resultado_real"]),

        ingresos_esperados=float(snap["ingresos_esperados"]),
        gastos_esperados_total=float(snap["gastos_esperados_total"]),
        resultado_esperado=float(snap["resultado_esperado"]),

        desv_resultado=float(snap["desv_resultado"]),
        desv_ingresos=float(snap["desv_ingresos"]),
        desv_gastos_total=float(snap["desv_gastos_total"]),

        extras={
            "range_start": snap["periodo"]["start"],
            "range_end": snap["periodo"]["end"],
            "gastos_gestionables_esperados": snap["gastos_gestionables_esperados"],
            "gastos_gestionables_reales": snap["gastos_gestionables_reales"],
            "gastos_cotidianos_esperados": snap["gastos_cotidianos_esperados"],
            "gastos_cotidianos_reales": snap["gastos_cotidianos_reales"],
            "desv_gestionables": snap["desv_gestionables"],
            "desv_cotidianos": snap["desv_cotidianos"],
            "liquidez_total": snap["liquidez_total"],
            "n_recurrentes_ing": snap["n_recurrentes_ing"],
            "n_recurrentes_gas": snap["n_recurrentes_gas"],
            "n_unicos_ing": snap["n_unicos_ing"],
            "n_unicos_gas": snap["n_unicos_gas"],
            "n_cotidianos": snap["n_cotidianos"],
            "periodicidad_norm": "UPPER(REPLACE(periodicidad,'_',' '))",
            "note": "Preview calculado con reglas del cierre (no inserta).",
        },
    )
