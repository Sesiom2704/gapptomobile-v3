# backend/app/api/v1/reinicio_router.py
"""
Router de REINICIO (mes) + PREVIEW + (EJECUCIÓN) CIERRE MENSUAL.

Incluye:
- Reinicio de mes (eligibility / preview / ejecutar)
- Preview de cierre mensual (what-if) SIN insertar
- Ejecutar cierre mensual (insertar cabecera + detalle) CON SQL PURO para detalle

CAMBIO IMPORTANTE:
- Rangos de fecha son half-open: [start, end)
  Ejemplo: dic 2025 => [2025-12-01, 2026-01-01)

Notas:
- Se normaliza periodicidad: UPPER(REPLACE(periodicidad,'_',' ')) para tolerar 'PAGO_UNICO'.
- Inserción detalle:
    - 4 filas: COT, VIVI, GEST-RESTO, AHO
    - NO usa n_items (columna eliminada)
    - robusto ante ausencia de gen_random_uuid() en Postgres (Render suele no tener pgcrypto)
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional, Tuple
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend.app.api.v1.auth_router import require_user
from backend.app.db import models
from backend.app.db.session import get_db
from backend.app.schemas.reinicio import (
    CierreExecuteResponse,
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
SEG_VIVI = "VIVI-12345"
SEG_AHO = "AHO-12345"
SEG_GEST_RESTO = "GEST-RESTO"

# Ingreso "tipo ahorro" que se descuenta del real en el detalle AHO (según tu definición)
TING_AHO = "TING-2IB5N9"

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
    Calcula el snapshot del cierre del periodo (anio, mes) con las reglas definidas.

    Además, añade contadores útiles para UI (tabla 3 columnas):
    - n_ingresos_total
    - n_gastos_gestionables_reales
    - n_gastos_reales_total
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

    # Contador total de ingresos reales (para UI)
    n_ingresos_total = int(
        db.query(func.count())
        .select_from(Ingreso)
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .scalar()
        or 0
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

    # 3) desv_ingresos = esperados - reales
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

    # Contador de gastos gestionables reales (para UI)
    n_gastos_gestionables_reales = int(
        db.query(func.count())
        .select_from(Gasto)
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id != SEG_COT)
        .scalar()
        or 0
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

    # Contador total de gastos reales (para UI)
    n_gastos_reales_total = int(n_gastos_gestionables_reales + n_cotidianos)

    # 9..11) desviaciones de gastos
    desv_gestionables = float(gastos_gestionables_esperados - gastos_gestionables_reales)
    desv_cotidianos = float(gastos_cotidianos_esperados - gastos_cotidianos_reales)

    gastos_esperados_total = float(gastos_gestionables_esperados + gastos_cotidianos_esperados)
    desv_gastos_total = float(gastos_esperados_total - gastos_reales_total)

    # Resultado esperado/real
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
        "n_ingresos_total": n_ingresos_total,
        "n_gastos_gestionables_reales": n_gastos_gestionables_reales,
        "n_gastos_reales_total": n_gastos_reales_total,
        "liquidez_total": liquidez_total,
    }


# =============================================================================
# Core - insertar detalle cierre (SQL puro) + estrategia UUID robusta
# =============================================================================

DETAIL_INSERT_SQL_TEMPLATE = """
WITH
params AS (
  SELECT
    :user_id::int  AS user_id,
    :anio::int     AS anio,
    :mes::int      AS mes,
    {cierre_id_cast} AS cierre_id,
    :start_date::date AS start_date,
    :end_date::date   AS end_date
),

gastos_base AS (
  SELECT
    g.*,
    UPPER(REPLACE(COALESCE(g.periodicidad, ''), '_', ' ')) AS per_norm
  FROM gastos g
  JOIN params p ON p.user_id = g.user_id
  WHERE g.ultimo_pago_on >= (SELECT start_date FROM params)
    AND g.ultimo_pago_on <  (SELECT end_date   FROM params)
),

ingresos_base AS (
  SELECT i.*
  FROM ingresos i
  JOIN params p ON p.user_id = i.user_id
  WHERE i.ultimo_ingreso_on >= (SELECT start_date FROM params)
    AND i.ultimo_ingreso_on <  (SELECT end_date   FROM params)
),

-- 1) COT (COTIDIANOS)
cot_esperado AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
  FROM gastos_base
  WHERE segmento_id = :seg_cot
),
cot_real AS (
  SELECT COALESCE(SUM(gc.importe), 0)::float AS real
  FROM gastos_cotidianos gc
  JOIN params p ON p.user_id = gc.user_id
  WHERE gc.fecha >= (SELECT start_date FROM params)
    AND gc.fecha <  (SELECT end_date   FROM params)
    AND gc.pagado = TRUE
),

-- 2) VIVI (VIVIENDAS)
vivi_esperado AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
  FROM gastos_base
  WHERE segmento_id = :seg_vivi
    AND per_norm <> 'PAGO UNICO'
),
vivi_real AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS real
  FROM gastos_base
  WHERE segmento_id = :seg_vivi
),

-- 3) GEST-RESTO (GESTIONABLES)
gest_esperado AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
  FROM gastos_base
  WHERE segmento_id NOT IN (:seg_cot, :seg_vivi, :seg_aho)
    AND per_norm <> 'PAGO UNICO'
),
gest_real AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS real
  FROM gastos_base
  WHERE segmento_id NOT IN (:seg_cot, :seg_vivi, :seg_aho)
),

-- 4) AHO (AHORRO)
aho_esperado AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
  FROM gastos_base
  WHERE segmento_id = :seg_aho
    AND per_norm <> 'PAGO UNICO'
),
aho_gastos_real AS (
  SELECT COALESCE(SUM(importe_cuota), 0)::float AS real_gastos
  FROM gastos_base
  WHERE segmento_id = :seg_aho
),
aho_ingresos_real AS (
  SELECT COALESCE(SUM(importe), 0)::float AS real_ing
  FROM ingresos_base
  WHERE tipo_id = :ting_aho
),
aho_real AS (
  SELECT (SELECT real_gastos FROM aho_gastos_real) - (SELECT real_ing FROM aho_ingresos_real) AS real
),

rows AS (
  SELECT
    (SELECT cierre_id FROM params) AS cierre_id,
    (SELECT anio FROM params) AS anio,
    (SELECT mes  FROM params) AS mes,
    :seg_cot::text AS segmento_id,
    'COTIDIANOS'::text AS tipo_detalle,
    (SELECT esperado FROM cot_esperado) AS esperado,
    (SELECT real     FROM cot_real)     AS real
  UNION ALL
  SELECT
    (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
    :seg_vivi::text, 'VIVIENDAS'::text,
    (SELECT esperado FROM vivi_esperado),
    (SELECT real     FROM vivi_real)
  UNION ALL
  SELECT
    (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
    :seg_gest_resto::text, 'GESTIONABLES'::text,
    (SELECT esperado FROM gest_esperado),
    (SELECT real     FROM gest_real)
  UNION ALL
  SELECT
    (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
    :seg_aho::text, 'AHORRO'::text,
    (SELECT esperado FROM aho_esperado),
    (SELECT real     FROM aho_real)
)

INSERT INTO cierre_mensual_detalle (
  id,
  cierre_id,
  anio,
  mes,
  segmento_id,
  tipo_detalle,
  esperado,
  real,
  desviacion,
  cumplimiento_pct,
  incluye_kpi,
  fecha_cierre,
  user_id
)
SELECT
  {uuid_expr} AS id,
  r.cierre_id,
  r.anio,
  r.mes,
  r.segmento_id,
  r.tipo_detalle,
  r.esperado,
  r.real,
  (r.esperado - r.real) AS desviacion,
  CASE
    WHEN r.esperado IS NULL OR r.esperado = 0 THEN NULL
    ELSE ROUND((r.real / r.esperado) * 100.0, 2)
  END AS cumplimiento_pct,
  TRUE AS incluye_kpi,
  NOW() AS fecha_cierre,
  (SELECT user_id FROM params) AS user_id
FROM rows r;
"""


def _is_uuid_value(v: Any) -> bool:
    """Heurística segura: detecta si v es UUID o string UUID."""
    if isinstance(v, UUID):
        return True
    if isinstance(v, str):
        try:
            UUID(v)
            return True
        except Exception:
            return False
    return False


def _detect_uuid_function(db: Session) -> str | None:
    """
    Detecta una función de generación UUID disponible en Postgres.
    Orden:
      1) gen_random_uuid()   (pgcrypto)
      2) uuid_generate_v4()  (uuid-ossp)
    """
    try:
        db.execute(text("SELECT gen_random_uuid();"))
        return "gen_random_uuid()"
    except Exception:
        pass
    try:
        db.execute(text("SELECT uuid_generate_v4();"))
        return "uuid_generate_v4()"
    except Exception:
        return None


def _insert_cierre_detalles_sql_puro(
    db: Session,
    *,
    cierre_id: Any,
    user_id: int,
    anio: int,
    mes: int,
    start_date: date,
    end_date: date,
) -> int:
    """
    Inserta en cierre_mensual_detalle usando SQL puro.

    - Inserta 4 filas (COT, VIVI, GEST-RESTO, AHO).
    - NO usa n_items (columna eliminada).
    - Robusto ante:
        * cierre_id UUID o string
        * ausencia de gen_random_uuid() / uuid_generate_v4()
          (si no hay función, genera UUID en Python e inserta uno por fila)
    Devuelve: número de filas insertadas.
    """

    # 1) casteo cierre_id dentro del CTE params (evita fallos si NO es UUID)
    if _is_uuid_value(cierre_id):
        cierre_id_cast = ":cierre_id::uuid"
        cierre_id_param = str(cierre_id)
    else:
        cierre_id_cast = ":cierre_id::text"
        cierre_id_param = str(cierre_id)

    # 2) detectar función UUID en DB (si existe)
    uuid_func = _detect_uuid_function(db)

    # 3) si hay función, podemos generar id en SQL; si no, pre-generamos 4 UUIDs en Python
    if uuid_func:
        uuid_expr = uuid_func
        sql = DETAIL_INSERT_SQL_TEMPLATE.format(cierre_id_cast=cierre_id_cast, uuid_expr=uuid_expr)
        params = {
            "cierre_id": cierre_id_param,
            "user_id": int(user_id),
            "anio": int(anio),
            "mes": int(mes),
            "start_date": start_date,  # pasar date, no string
            "end_date": end_date,      # pasar date, no string
            "seg_cot": SEG_COT,
            "seg_vivi": SEG_VIVI,
            "seg_aho": SEG_AHO,
            "seg_gest_resto": SEG_GEST_RESTO,
            "ting_aho": TING_AHO,
        }
        res = db.execute(text(sql), params)
        # En psycopg3, rowcount suele venir bien en INSERT...SELECT
        return int(res.rowcount or 0)

    # 4) fallback sin función UUID: generar IDs Python y hacer INSERT separado (4 filas)
    #    Mantiene el mismo cálculo (CTEs), pero insertamos cada fila con id fijo.
    sql_base = DETAIL_INSERT_SQL_TEMPLATE.format(cierre_id_cast=cierre_id_cast, uuid_expr=":detalle_id")
    base_params = {
        "cierre_id": cierre_id_param,
        "user_id": int(user_id),
        "anio": int(anio),
        "mes": int(mes),
        "start_date": start_date,
        "end_date": end_date,
        "seg_cot": SEG_COT,
        "seg_vivi": SEG_VIVI,
        "seg_aho": SEG_AHO,
        "seg_gest_resto": SEG_GEST_RESTO,
        "ting_aho": TING_AHO,
    }

    inserted_total = 0
    # Ejecutamos 4 veces: cada ejecución generará 4 filas si dejamos el UNION ALL completo.
    # Para evitar duplicar, en este fallback no repetimos el UNION ALL 4 veces.
    # Solución: insertamos una sola vez, pero necesitamos un id por fila: imposible sin función UUID.
    # Por eso, en fallback hacemos un INSERT multi-row explícito calculando rows primero.
    #
    # Estrategia: extraer las 4 filas "rows" como SELECT y luego insertar desde Python.

    rows_sql = text(f"""
    WITH
    params AS (
      SELECT
        :user_id::int  AS user_id,
        :anio::int     AS anio,
        :mes::int      AS mes,
        {cierre_id_cast} AS cierre_id,
        :start_date::date AS start_date,
        :end_date::date   AS end_date
    ),
    gastos_base AS (
      SELECT g.*, UPPER(REPLACE(COALESCE(g.periodicidad, ''), '_', ' ')) AS per_norm
      FROM gastos g
      JOIN params p ON p.user_id = g.user_id
      WHERE g.ultimo_pago_on >= (SELECT start_date FROM params)
        AND g.ultimo_pago_on <  (SELECT end_date   FROM params)
    ),
    ingresos_base AS (
      SELECT i.*
      FROM ingresos i
      JOIN params p ON p.user_id = i.user_id
      WHERE i.ultimo_ingreso_on >= (SELECT start_date FROM params)
        AND i.ultimo_ingreso_on <  (SELECT end_date   FROM params)
    ),
    cot_esperado AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
      FROM gastos_base WHERE segmento_id = :seg_cot
    ),
    cot_real AS (
      SELECT COALESCE(SUM(gc.importe), 0)::float AS real
      FROM gastos_cotidianos gc
      JOIN params p ON p.user_id = gc.user_id
      WHERE gc.fecha >= (SELECT start_date FROM params)
        AND gc.fecha <  (SELECT end_date   FROM params)
        AND gc.pagado = TRUE
    ),
    vivi_esperado AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
      FROM gastos_base
      WHERE segmento_id = :seg_vivi AND per_norm <> 'PAGO UNICO'
    ),
    vivi_real AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS real
      FROM gastos_base WHERE segmento_id = :seg_vivi
    ),
    gest_esperado AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
      FROM gastos_base
      WHERE segmento_id NOT IN (:seg_cot, :seg_vivi, :seg_aho)
        AND per_norm <> 'PAGO UNICO'
    ),
    gest_real AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS real
      FROM gastos_base
      WHERE segmento_id NOT IN (:seg_cot, :seg_vivi, :seg_aho)
    ),
    aho_esperado AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS esperado
      FROM gastos_base
      WHERE segmento_id = :seg_aho AND per_norm <> 'PAGO UNICO'
    ),
    aho_gastos_real AS (
      SELECT COALESCE(SUM(importe_cuota), 0)::float AS real_gastos
      FROM gastos_base WHERE segmento_id = :seg_aho
    ),
    aho_ingresos_real AS (
      SELECT COALESCE(SUM(importe), 0)::float AS real_ing
      FROM ingresos_base WHERE tipo_id = :ting_aho
    ),
    aho_real AS (
      SELECT (SELECT real_gastos FROM aho_gastos_real) - (SELECT real_ing FROM aho_ingresos_real) AS real
    )
    SELECT
      (SELECT cierre_id FROM params) AS cierre_id,
      (SELECT anio FROM params) AS anio,
      (SELECT mes  FROM params) AS mes,
      :seg_cot::text AS segmento_id,
      'COTIDIANOS'::text AS tipo_detalle,
      (SELECT esperado FROM cot_esperado) AS esperado,
      (SELECT real     FROM cot_real)     AS real
    UNION ALL
    SELECT
      (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
      :seg_vivi::text, 'VIVIENDAS'::text,
      (SELECT esperado FROM vivi_esperado),
      (SELECT real     FROM vivi_real)
    UNION ALL
    SELECT
      (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
      :seg_gest_resto::text, 'GESTIONABLES'::text,
      (SELECT esperado FROM gest_esperado),
      (SELECT real     FROM gest_real)
    UNION ALL
    SELECT
      (SELECT cierre_id FROM params), (SELECT anio FROM params), (SELECT mes FROM params),
      :seg_aho::text, 'AHORRO'::text,
      (SELECT esperado FROM aho_esperado),
      (SELECT real     FROM aho_real)
    """)

    rows = db.execute(rows_sql, base_params).mappings().all()

    if not rows:
        return 0

    # Insert por fila con UUID python
    insert_one = text("""
    INSERT INTO cierre_mensual_detalle (
      id, cierre_id, anio, mes, segmento_id, tipo_detalle,
      esperado, real, desviacion, cumplimiento_pct,
      incluye_kpi, fecha_cierre, user_id
    ) VALUES (
      :id, :cierre_id, :anio, :mes, :segmento_id, :tipo_detalle,
      :esperado, :real, :desviacion, :cumplimiento_pct,
      TRUE, NOW(), :user_id
    )
    """)

    for r in rows:
        esperado = float(r["esperado"] or 0.0)
        real = float(r["real"] or 0.0)
        desviacion = esperado - real
        cumplimiento_pct = None
        if esperado and esperado != 0:
            cumplimiento_pct = round((real / esperado) * 100.0, 2)

        db.execute(
            insert_one,
            {
                "id": str(uuid4()),
                "cierre_id": str(r["cierre_id"]),
                "anio": int(r["anio"]),
                "mes": int(r["mes"]),
                "segmento_id": str(r["segmento_id"]),
                "tipo_detalle": str(r["tipo_detalle"]),
                "esperado": esperado,
                "real": real,
                "desviacion": desviacion,
                "cumplimiento_pct": cumplimiento_pct,
                "user_id": int(user_id),
            },
        )
        inserted_total += 1

    return inserted_total


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

            # Desglose importes
            "gastos_gestionables_esperados": snap["gastos_gestionables_esperados"],
            "gastos_gestionables_reales": snap["gastos_gestionables_reales"],
            "gastos_cotidianos_esperados": snap["gastos_cotidianos_esperados"],
            "gastos_cotidianos_reales": snap["gastos_cotidianos_reales"],
            "desv_gestionables": snap["desv_gestionables"],
            "desv_cotidianos": snap["desv_cotidianos"],
            "liquidez_total": snap["liquidez_total"],

            # Contadores históricos
            "n_recurrentes_ing": snap["n_recurrentes_ing"],
            "n_recurrentes_gas": snap["n_recurrentes_gas"],
            "n_unicos_ing": snap["n_unicos_ing"],
            "n_unicos_gas": snap["n_unicos_gas"],
            "n_cotidianos": snap["n_cotidianos"],

            # Contadores para tabla 3 columnas en UI
            "n_ingresos_total": snap["n_ingresos_total"],
            "n_gastos_gestionables_reales": snap["n_gastos_gestionables_reales"],
            "n_gastos_reales_total": snap["n_gastos_reales_total"],

            "periodicidad_norm": "UPPER(REPLACE(periodicidad,'_',' '))",
            "note": "Preview calculado con reglas del cierre (no inserta).",
        },
    )


# =============================================================================
# Endpoints - CIERRE (ejecutar / insertar)
# =============================================================================

@router.post("/cierre/ejecutar", response_model=CierreExecuteResponse)
def cierre_ejecutar(
    anio: Optional[int] = Query(None, ge=2000, le=2100),
    mes: Optional[int] = Query(None, ge=1, le=12),
    enforce_window: bool = Query(False, description="Si True, bloquea fuera del día 1..5."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Ejecuta el cierre mensual:
    - Inserta cabecera en cierre_mensual
    - Inserta detalle en cierre_mensual_detalle (SQL puro)

    Reglas:
    - Rango half-open [start, end)
    - VIVI esperado = periodicidad != PAGO UNICO
    - GEST-RESTO excluye COT, VIVI, AHO
    - AHO real = gastos_AHO - ingresos(tipo_id=TING_AHO)

    Control de duplicado:
    - Si existe cierre para (user_id, anio, mes) => 409
    """
    if enforce_window and not _is_in_reinicio_window():
        raise HTTPException(status_code=409, detail="Fuera de ventana (días 1..5).")

    now = datetime.now(timezone.utc)
    anio_val = anio or now.year
    mes_val = mes or now.month
    start_date, end_date = _month_range_date_half_open(anio_val, mes_val)

    # 1) Evitar duplicados por usuario
    existing = (
        db.query(models.CierreMensual)
        .filter(
            models.CierreMensual.user_id == current_user.id,
            models.CierreMensual.anio == anio_val,
            models.CierreMensual.mes == mes_val,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un cierre para ese año/mes.")

    # 2) Calcular snapshot con las mismas reglas del preview
    snap = _compute_cierre_snapshot_sql(db, user_id=current_user.id, anio=anio_val, mes=mes_val)

    # 3) Insertar cabecera + detalle en una única transacción
    try:
        cab = models.CierreMensual(
            anio=anio_val,
            mes=mes_val,
            user_id=current_user.id,
            criterio="CAJA",

            ingresos_esperados=float(snap["ingresos_esperados"]),
            ingresos_reales=float(snap["ingresos_reales"]),
            desv_ingresos=float(snap["desv_ingresos"]),

            gastos_gestionables_esperados=float(snap["gastos_gestionables_esperados"]),
            gastos_gestionables_reales=float(snap["gastos_gestionables_reales"]),
            gastos_cotidianos_esperados=float(snap["gastos_cotidianos_esperados"]),
            gastos_cotidianos_reales=float(snap["gastos_cotidianos_reales"]),

            gastos_esperados_total=float(snap["gastos_esperados_total"]),
            gastos_reales_total=float(snap["gastos_reales_total"]),

            desv_gestionables=float(snap["desv_gestionables"]),
            desv_cotidianos=float(snap["desv_cotidianos"]),
            desv_gastos_total=float(snap["desv_gastos_total"]),

            resultado_esperado=float(snap["resultado_esperado"]),
            resultado_real=float(snap["resultado_real"]),
            desv_resultado=float(snap["desv_resultado"]),

            n_recurrentes_ing=int(snap["n_recurrentes_ing"]),
            n_recurrentes_gas=int(snap["n_recurrentes_gas"]),
            n_unicos_ing=int(snap["n_unicos_ing"]),
            n_unicos_gas=int(snap["n_unicos_gas"]),
            n_cotidianos=int(snap["n_cotidianos"]),

            liquidez_total=float(snap["liquidez_total"]),
        )

        db.add(cab)
        db.flush()  # asegura cab.id disponible antes del detalle

        inserted = _insert_cierre_detalles_sql_puro(
            db,
            cierre_id=cab.id,
            user_id=current_user.id,
            anio=anio_val,
            mes=mes_val,
            start_date=start_date,
            end_date=end_date,
        )

        db.commit()

    except HTTPException:
        # Si es un HTTPException explícito, lo propagamos
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error insertando cierre mensual: {str(e)}")

    return CierreExecuteResponse(
        cierre_id=str(cab.id),
        anio=anio_val,
        mes=mes_val,
        inserted_detalles=int(inserted),
        range_start=start_date.isoformat(),
        range_end=end_date.isoformat(),
    )
