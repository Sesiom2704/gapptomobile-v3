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

CAMBIO IMPORTANTE (2026-01):
- La preview de cierre (/reinicio/cierre/preview) se ajusta para que use
  EXACTAMENTE las mismas reglas/SQL que defines para los importes del cierre:

  Para un periodo [start, end) (ej: 2025-12-01 .. 2026-01-01):

  1) ingresos_esperados:
     ingresos where ultimo_ingreso_on in range AND periodicidad <> 'PAGO UNICO'

  2) ingresos_reales:
     ingresos where ultimo_ingreso_on in range

  3) desv_ingresos = esperados - reales

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
  14) n_unicos_ing      = COUNT ingresos en range AND periodicidad='PAGO UNICO'
  15) n_unicos_gas      = (según tu especificación original: COUNT gastos en range AND segmento_id = SEG_COT)
      Nota: esto es contraintuitivo (parece "unicos gas" pero filtras COT).
      Se mantiene 1:1 con tu definición para que cuadre.

  16) n_cotidianos = COUNT rows de (7) (pagado=true en gastos_cotidianos)

  17) liquidez_total:
      cuentas_bancarias where activo=true

- Se usa rango half-open [start, end) siempre (ej: end=2026-01-01 para diciembre).
- Se normaliza periodicidad de forma defensiva para tolerar 'PAGO_UNICO' vs 'PAGO UNICO'
  (UPPER + reemplazo de '_' por ' ').

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
    """
    Devuelve [inicio_mes, inicio_mes_siguiente) para filtrar por fecha/datetime.

    Nota: Este helper se usa en otras partes del router.
    Para la preview de cierre ajustada a tus SQL, usamos _month_range_date_half_open().
    """
    if mes < 1 or mes > 12:
        raise ValueError("mes fuera de rango")
    start = datetime(anio, mes, 1)
    end = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)
    return start, end


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
# Helpers - normalización de periodicidad (defensivo)
# =============================================================================

def _periodicidad_norm_sql(col):
    """
    Normaliza 'periodicidad' para tolerar variaciones:
    - 'PAGO_UNICO' vs 'PAGO UNICO'
    - mayúsculas/minúsculas

    Equivalentemente a: UPPER(REPLACE(periodicidad, '_', ' '))
    """
    return func.upper(func.replace(func.coalesce(col, ""), "_", " "))


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
    """Suma importe de GastoCotidiano.pagado en rango start-end (inclusive en este helper histórico)."""
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
# Core - cálculo snapshot cierre según TU SQL (fuente de verdad)
# =============================================================================

def _compute_cierre_snapshot_sql(
    db: Session,
    user_id: int,
    anio: int,
    mes: int,
) -> dict:
    """
    Calcula el "snapshot" del cierre para el periodo (anio, mes) usando EXACTAMENTE
    las reglas de importes/contadores que has definido.

    Devuelve un dict con:
      - importes esperados/reales + desviaciones
      - contadores
      - liquidez_total
      - resultado_esperado / resultado_real / desv_resultado

    Importante:
    - Rango siempre half-open [start, end)
    - Fechas/columnas:
        ingresos.ultimo_ingreso_on
        gastos.ultimo_pago_on
        gastos_cotidianos.fecha
        cuentas_bancarias.activo
    """
    start_date, end_date = _month_range_date_half_open(anio, mes)

    # Modelos
    Ingreso = models.Ingreso
    Gasto = models.Gasto
    GastoCot = models.GastoCotidiano  # tabla gastos_cotidianos en DB
    Cuenta = models.CuentaBancaria if hasattr(models, "CuentaBancaria") else None

    # Validación defensiva de columnas (para fallar con mensaje claro si el modelo no coincide)
    required_ing_cols = ["ultimo_ingreso_on", "importe", "periodicidad", "user_id"]
    required_gas_cols = ["ultimo_pago_on", "importe_cuota", "segmento_id", "periodicidad", "user_id"]
    required_gc_cols = ["fecha", "importe", "pagado", "user_id"]

    for c in required_ing_cols:
        if not hasattr(Ingreso, c):
            raise HTTPException(status_code=500, detail=f"models.Ingreso no tiene '{c}' (requerido para snapshot cierre).")
    for c in required_gas_cols:
        if not hasattr(Gasto, c):
            raise HTTPException(status_code=500, detail=f"models.Gasto no tiene '{c}' (requerido para snapshot cierre).")
    for c in required_gc_cols:
        if not hasattr(GastoCot, c):
            raise HTTPException(status_code=500, detail=f"models.GastoCotidiano no tiene '{c}' (requerido para snapshot cierre).")

    if Cuenta is not None:
        if not hasattr(Cuenta, "liquidez") or not hasattr(Cuenta, "activo") or not hasattr(Cuenta, "user_id"):
            # Si existe el modelo pero no cuadra, preferimos un error explícito.
            raise HTTPException(status_code=500, detail="models.CuentaBancaria no tiene columnas esperadas (liquidez/activo/user_id).")

    # Normalización SQL de periodicidad (tolerante a 'PAGO_UNICO' vs 'PAGO UNICO')
    per_ing = _periodicidad_norm_sql(Ingreso.periodicidad)
    per_gas = _periodicidad_norm_sql(Gasto.periodicidad)

    # -------------------------------------------------------------------------
    # 1) ingresos_esperados + 12) n_recurrentes_ing
    # -------------------------------------------------------------------------
    q_ing_rec = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(Ingreso.importe), 0.0).label("sum_importe"),
        )
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .filter(per_ing != "PAGO UNICO")
    ).one()

    ingresos_esperados = float(q_ing_rec.sum_importe or 0.0)
    n_recurrentes_ing = int(q_ing_rec.n_rows or 0)

    # -------------------------------------------------------------------------
    # 2) ingresos_reales
    # -------------------------------------------------------------------------
    q_ing_all = (
        db.query(func.coalesce(func.sum(Ingreso.importe), 0.0))
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
    ).scalar()

    ingresos_reales = float(q_ing_all or 0.0)

    # -------------------------------------------------------------------------
    # 14) n_unicos_ing (PAGO UNICO)
    # -------------------------------------------------------------------------
    q_ing_unicos = (
        db.query(func.count())
        .filter(Ingreso.user_id == user_id)
        .filter(Ingreso.ultimo_ingreso_on >= start_date)
        .filter(Ingreso.ultimo_ingreso_on < end_date)
        .filter(per_ing == "PAGO UNICO")
    ).scalar()

    n_unicos_ing = int(q_ing_unicos or 0)

    # 3) desv_ingresos = esperados - reales (según tu definición)
    desv_ingresos = float(ingresos_esperados - ingresos_reales)

    # -------------------------------------------------------------------------
    # 4) gastos_gestionables_esperados + 13) n_recurrentes_gas
    #    (importe_cuota, no PAGO UNICO, no COT)
    # -------------------------------------------------------------------------
    q_gas_gest_rec = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(Gasto.importe_cuota), 0.0).label("sum_importe"),
        )
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(per_gas != "PAGO UNICO")
        .filter(Gasto.segmento_id != SEG_COT)
    ).one()

    gastos_gestionables_esperados = float(q_gas_gest_rec.sum_importe or 0.0)
    n_recurrentes_gas = int(q_gas_gest_rec.n_rows or 0)

    # -------------------------------------------------------------------------
    # 5) gastos_gestionables_reales (importe_cuota, no COT)
    # -------------------------------------------------------------------------
    q_gas_gest_all = (
        db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id != SEG_COT)
    ).scalar()

    gastos_gestionables_reales = float(q_gas_gest_all or 0.0)

    # -------------------------------------------------------------------------
    # 6) gastos_cotidianos_esperados (desde tabla gastos, segmento COT, importe_cuota)
    # -------------------------------------------------------------------------
    q_cot_esp = (
        db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id == SEG_COT)
    ).scalar()

    gastos_cotidianos_esperados = float(q_cot_esp or 0.0)

    # -------------------------------------------------------------------------
    # 7) gastos_cotidianos_reales + 16) n_cotidianos
    #    (desde gastos_cotidianos, importe, pagado=true)
    # -------------------------------------------------------------------------
    q_cot_real = (
        db.query(
            func.count().label("n_rows"),
            func.coalesce(func.sum(GastoCot.importe), 0.0).label("sum_importe"),
        )
        .filter(GastoCot.user_id == user_id)
        .filter(GastoCot.fecha >= start_date)
        .filter(GastoCot.fecha < end_date)
        .filter(GastoCot.pagado == True)
    ).one()

    gastos_cotidianos_reales = float(q_cot_real.sum_importe or 0.0)
    n_cotidianos = int(q_cot_real.n_rows or 0)

    # -------------------------------------------------------------------------
    # 15) n_unicos_gas (mantener 1:1 con tu definición)
    #     OJO: tu definición filtra segmento_id = COT, no periodicidad PAGO UNICO.
    # -------------------------------------------------------------------------
    q_n_unicos_gas = (
        db.query(func.count())
        .filter(Gasto.user_id == user_id)
        .filter(Gasto.ultimo_pago_on >= start_date)
        .filter(Gasto.ultimo_pago_on < end_date)
        .filter(Gasto.segmento_id == SEG_COT)
    ).scalar()

    n_unicos_gas = int(q_n_unicos_gas or 0)

    # -------------------------------------------------------------------------
    # 8) gastos_reales_total = (5) + (7)
    # -------------------------------------------------------------------------
    gastos_reales_total = float(gastos_gestionables_reales + gastos_cotidianos_reales)

    # -------------------------------------------------------------------------
    # 9)  desv_gestionables = (4) - (5)
    # 10) desv_cotidianos   = (6) - (7)
    # 11) desv_gastos_total = ((4)+(6)) - (8)
    # -------------------------------------------------------------------------
    desv_gestionables = float(gastos_gestionables_esperados - gastos_gestionables_reales)
    desv_cotidianos = float(gastos_cotidianos_esperados - gastos_cotidianos_reales)

    gastos_esperados_total = float(gastos_gestionables_esperados + gastos_cotidianos_esperados)
    desv_gastos_total = float(gastos_esperados_total - gastos_reales_total)

    # -------------------------------------------------------------------------
    # Resultado esperado/real + desviación
    # - No lo listaste como sentencia, pero el modelo de cierre lo usa y lo necesitas.
    # -------------------------------------------------------------------------
    resultado_esperado = float(ingresos_esperados - gastos_esperados_total)
    resultado_real = float(ingresos_reales - gastos_reales_total)
    desv_resultado = float(resultado_esperado - resultado_real)

    # -------------------------------------------------------------------------
    # 17) liquidez_total (si existe el modelo de cuentas)
    # -------------------------------------------------------------------------
    liquidez_total = 0.0
    if Cuenta is not None:
        q_liq = (
            db.query(func.coalesce(func.sum(Cuenta.liquidez), 0.0))
            .filter(Cuenta.user_id == user_id)
            .filter(Cuenta.activo == True)
        ).scalar()
        liquidez_total = float(q_liq or 0.0)

    return {
        "periodo": {"anio": int(anio), "mes": int(mes), "start": start_date.isoformat(), "end": end_date.isoformat()},
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
        "meta": {
            "notes": [
                "Snapshot calculado con reglas SQL de cierre (ultimo_ingreso_on / ultimo_pago_on / gastos_cotidianos pagado).",
                "Rango half-open [start, end).",
                "Periodicidad normalizada: UPPER(REPLACE(periodicidad,'_',' ')).",
            ]
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
# Endpoints - CIERRE (preview what-if)  ✅ AJUSTADO A TU SQL
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

    Importante:
    - Este endpoint ya NO usa las columnas fecha_inicio/fecha como antes.
    - Ahora usa tu “fuente de verdad” para el cierre:
        * ingresos.ultimo_ingreso_on
        * gastos.ultimo_pago_on
        * gastos_cotidianos.fecha (pagado=true)
        * cuentas_bancarias.liquidez (activo=true)

    Por defecto:
    - Si no envías (anio, mes), se usa el mes actual.
    """
    now = datetime.now(timezone.utc)
    anio_val = anio or now.year
    mes_val = mes or now.month

    snap = _compute_cierre_snapshot_sql(db, user_id=current_user.id, anio=anio_val, mes=mes_val)

    # Encajamos el resultado en el schema de salida existente CierrePreviewOut.
    # Si tu schema admite extras, lo rellenamos con trazas de rango y notas.
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
            # Rango exacto usado (DATE half-open)
            "range_start": snap["periodo"]["start"],
            "range_end": snap["periodo"]["end"],

            # Desgloses útiles para debug/UI
            "gastos_gestionables_esperados": snap["gastos_gestionables_esperados"],
            "gastos_gestionables_reales": snap["gastos_gestionables_reales"],
            "gastos_cotidianos_esperados": snap["gastos_cotidianos_esperados"],
            "gastos_cotidianos_reales": snap["gastos_cotidianos_reales"],
            "desv_gestionables": snap["desv_gestionables"],
            "desv_cotidianos": snap["desv_cotidianos"],
            "liquidez_total": snap["liquidez_total"],

            # Contadores
            "n_recurrentes_ing": snap["n_recurrentes_ing"],
            "n_recurrentes_gas": snap["n_recurrentes_gas"],
            "n_unicos_ing": snap["n_unicos_ing"],
            "n_unicos_gas": snap["n_unicos_gas"],
            "n_cotidianos": snap["n_cotidianos"],

            # Notas/metadata
            "meta": snap.get("meta", {}),
        },
    )
