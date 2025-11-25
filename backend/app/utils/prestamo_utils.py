"""
Utilidades de negocio para PRÉSTAMOS en GapptoMobile v3.

Aquí centralizamos la lógica común que usan los endpoints:

- Traducción de periodicidad -> periodos/año y meses de salto.
- Generación de plan francés (cuota constante).
- Recalcular capital/intereses pendientes de un préstamo.
- Recalcular plan tras una amortización de capital (reduciendo plazo).
- Resolver, a partir de una "clasificación" (HIPOTECA / PERSONAL),
  qué tipo de gasto y segmento corresponden.

La idea es que el router de préstamos se limite a:
  - Validar inputs
  - Orquestar llamadas a estas funciones
  - Crear / actualizar modelos SQLAlchemy
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from math import log, ceil
from typing import Optional, Tuple, List

from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db import models
from backend.app.utils.id_utils import generate_prestamo_cuota_id
from backend.app.core.constants import (
    HIPOTECA_TIPO_GASTO_ID,
    PRESTAMO_TIPO_GASTO_ID,
    SEGMENTO_VIVIENDA_ID,
    SEGMENTO_FINANCIERO_ID,
)


# ============================
# Periodicidad y fechas
# ============================

def periodos_por_anio(periodicidad: str) -> int:
    """
    Devuelve el número de periodos al año según la periodicidad textual:

    - "MENSUAL"    -> 12
    - "TRIMESTRAL" -> 4
    - "SEMESTRAL"  -> 2
    - Cualquier otro valor -> 1 (ANUAL por defecto)

    Se usa tanto para calcular el tipo por periodo como para el número total
    de cuotas teóricas.
    """
    p = (periodicidad or "").upper()
    if p == "MENSUAL":
        return 12
    if p == "TRIMESTRAL":
        return 4
    if p == "SEMESTRAL":
        return 2
    return 1


def step_meses(periodicidad: str) -> int:
    """
    Cuántos meses avanza cada cuota según la periodicidad:

    - MENSUAL    -> 1
    - TRIMESTRAL -> 3
    - SEMESTRAL  -> 6
    - ANUAL      -> 12
    """
    p = (periodicidad or "").upper()
    if p == "MENSUAL":
        return 1
    if p == "TRIMESTRAL":
        return 3
    if p == "SEMESTRAL":
        return 6
    return 12


def add_months(d: date, months: int) -> date:
    """
    Suma `months` meses a una fecha `d` de forma sencilla,
    limitando el día a 28 para evitar problemas con meses más cortos.
    """
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    dd = min(d.day, 28)
    return date(y, m, dd)


# ============================
# Plan francés
# ============================

def generar_plan_frances(
    fecha_inicio: date,
    plazo_meses: int,
    periodicidad: str,
    principal: Decimal,
    tin_pct: Decimal,
) -> List[dict]:
    """
    Genera un plan de amortización francés (cuota constante) para un préstamo.

    Parámetros:
    - fecha_inicio: fecha de la primera cuota.
    - plazo_meses: plazo total en meses.
    - periodicidad: MENSUAL / TRIMESTRAL / SEMESTRAL / ANUAL.
    - principal: capital inicial.
    - tin_pct: tipo de interés nominal anual en %.

    Devuelve una lista de dicts, cada uno con:
      - num_cuota (int)
      - fecha_vencimiento (date)
      - importe_cuota (Decimal)
      - capital (Decimal)
      - interes (Decimal)
      - seguros (Decimal)  [de momento 0.00]
      - comisiones (Decimal) [de momento 0.00]
      - saldo_posterior (Decimal)
    """
    if plazo_meses <= 0 or principal <= 0:
        return []

    periodos = periodos_por_anio(periodicidad)
    step = step_meses(periodicidad)

    # Número de cuotas N según plazo y periodicidad
    if periodos == 12:
        N = plazo_meses
    elif periodos == 4:
        N = (plazo_meses + 2) // 3
    elif periodos == 2:
        N = (plazo_meses + 5) // 6
    else:
        N = (plazo_meses + 11) // 12
    if N <= 0:
        return []

    r = (tin_pct / Decimal(100)) / Decimal(periodos)
    plan: List[dict] = []

    # Cuota P
    if r == 0:
        cuota = (principal / Decimal(N)).quantize(Decimal("0.01"))
    else:
        pow_ = (Decimal(1) + r) ** N
        cuota = (principal * (r * pow_) / (pow_ - 1)).quantize(Decimal("0.01"))

    saldo = principal
    for k in range(1, N + 1):
        interes = (saldo * r).quantize(Decimal("0.01"))
        capital = (cuota - interes).quantize(Decimal("0.01"))
        # Ajuste de última cuota para dejar saldo a cero
        if k == N:
            capital = saldo
        saldo = (saldo - capital).quantize(Decimal("0.01"))

        f = add_months(fecha_inicio, step * (k - 1))
        plan.append(
            {
                "num_cuota": k,
                "fecha_vencimiento": f,
                "importe_cuota": cuota,
                "capital": capital,
                "interes": interes,
                "seguros": Decimal("0.00"),
                "comisiones": Decimal("0.00"),
                "saldo_posterior": saldo,
            }
        )
    return plan


# ============================
# Clasificación -> IDs de tipo/segmento
# ============================

def map_ids_por_clasificacion(clasificacion: Optional[str]) -> Tuple[str, str]:
    """
    A partir de la 'clasificación' textual devuelve:
      (tipo_gasto_id, segmento_id)

    Reglas actuales:
    - HIPOTECA -> (HIPOTECA_TIPO_GASTO_ID, SEGMENTO_VIVIENDA_ID)
    - cualquier otro valor -> (PRESTAMO_TIPO_GASTO_ID, SEGMENTO_FINANCIERO_ID)
    """
    c = (clasificacion or "").upper()
    if c == "HIPOTECA":
        return HIPOTECA_TIPO_GASTO_ID, SEGMENTO_VIVIENDA_ID
    return PRESTAMO_TIPO_GASTO_ID, SEGMENTO_FINANCIERO_ID


# ============================
# Agregados de préstamo
# ============================

def recompute_pendientes_prestamo(db: Session, prestamo_id: str) -> None:
    """
    Recalcula y actualiza en la tabla de PRESTAMO:

      - cuotas_pagadas
      - capital_pendiente
      - intereses_pendientes

    a partir de las cuotas registradas en PRESTAMO_CUOTA.
    """
    p = db.get(models.Prestamo, prestamo_id)
    if not p:
        return

    # Nº de cuotas pagadas
    c_paid = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo_id,
            models.PrestamoCuota.pagada == True,
        )
        .count()
    )
    p.cuotas_pagadas = int(c_paid or 0)

    # Primera cuota impagada (para saber desde dónde sumar pendientes)
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

    rows = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo_id,
            models.PrestamoCuota.num_cuota >= start_num,
        )
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .all()
    )

    cap = sum(float(x.capital or 0) for x in rows)
    inte = sum(float(x.interes or 0) for x in rows)

    if hasattr(p, "capital_pendiente"):
        p.capital_pendiente = round(cap, 2)
    if hasattr(p, "intereses_pendientes"):
        p.intereses_pendientes = round(inte, 2)

    p.modifiedon = datetime.utcnow()
    db.flush()


# ============================
# Amortización: helpers internos
# ============================

def r_periodico(tin_pct: Decimal, periodicidad: str) -> Decimal:
    """
    Convierte un TIN anual (%) en tipo por periodo, en función de la periodicidad.
    """
    periodos = periodos_por_anio(periodicidad)
    r = (Decimal(tin_pct or 0) / Decimal(100)) / Decimal(periodos or 1)
    return r


def _calc_num_periodos_desde_PV_P(PV: Decimal, P: Decimal, r: Decimal) -> int:
    """
    Calcula el número de periodos N manteniendo una cuota P para un capital PV
    con tipo periódico r, usando la fórmula de la anualidad:

      N = - ln(1 - r*PV/P) / ln(1+r)

    Se redondea hacia arriba (ceil) y se asegura N >= 1.
    """
    PV = Decimal(PV)
    P = Decimal(P)
    r = Decimal(r)

    if PV <= 0:
        return 0
    if r <= 0:
        # Sin interés: N ≈ PV / P
        if P <= 0:
            return 0
        return int(max(1, ceil((PV / P).quantize(Decimal("0.01")))))

    x = 1.0 - float((r * PV) / P)
    if x <= 0.0:
        # Evitamos log de 0 o negativo
        return 1

    N = -log(x) / log(1.0 + float(r))
    return int(max(1, ceil(N)))


# ============================
# Amortización: recalcular plan
# ============================

def recalcular_plan_reduciendo_plazo(
    db: Session,
    prestamo: models.Prestamo,
    capital_amortizado: Decimal,
) -> None:
    """
    Recalcula el plan de un préstamo después de amortizar CAPITAL:

    - saldo_nuevo = capital_pendiente - capital_amortizado.
    - Si saldo_nuevo <= 0 -> préstamo CANCELADO, se borran cuotas impagadas.
    - Si saldo_nuevo > 0:
        * Se mantiene periodicidad.
        * Se intenta mantener la cuota de la próxima cuota impagada.
        * Se recalcula un nuevo número de cuotas (Nnew) reduciendo plazo.
        * Se genera un nuevo bloque de cuotas impagadas.
        * Se actualizan agregados y, si existe, el GASTO asociado.
    """
    # Aseguramos que los agregados estén actualizados antes de recalcular
    recompute_pendientes_prestamo(db, prestamo.id)

    cap_pend = Decimal(str(getattr(prestamo, "capital_pendiente", 0) or 0)).quantize(
        Decimal("0.01")
    )
    capital_amortizado = Decimal(str(capital_amortizado or 0)).quantize(
        Decimal("0.01")
    )
    saldo_nuevo = (cap_pend - capital_amortizado).quantize(Decimal("0.01"))

    # Si la amortización cancela todo el capital pendiente
    if saldo_nuevo <= 0:
        # Borramos cuotas impagadas
        db.query(models.PrestamoCuota).filter(
            models.PrestamoCuota.prestamo_id == prestamo.id,
            models.PrestamoCuota.pagada == False,
        ).delete(synchronize_session=False)

        prestamo.estado = "CANCELADO"
        prestamo.fecha_vencimiento = date.today()
        prestamo.modifiedon = datetime.utcnow()
        prestamo.capital_pendiente = Decimal("0.00")
        prestamo.intereses_pendientes = Decimal("0.00")

        # Ajustar el gasto asociado, si existe
        if getattr(prestamo, "referencia_gasto", None):
            g = db.get(models.Gasto, prestamo.referencia_gasto)
            if g:
                g.cuotas_restantes = 0
                g.importe_pendiente = 0.0
                g.kpi = False
                g.activo = False
                g.inactivatedon = func.now()

        db.flush()
        return

    # Si queda capital pendiente, recalculamos plan reduciendo plazo
    next_unpaid = (
        db.query(models.PrestamoCuota)
        .filter(
            models.PrestamoCuota.prestamo_id == prestamo.id,
            models.PrestamoCuota.pagada == False,
        )
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .first()
    )
    paid_count = int(prestamo.cuotas_pagadas or 0)
    start_num = int(next_unpaid.num_cuota) if next_unpaid else (paid_count + 1)

    # Fecha base para las nuevas cuotas
    if next_unpaid:
        first_date = next_unpaid.fecha_vencimiento
    else:
        first_date = add_months(
            prestamo.fecha_vencimiento, step_meses(prestamo.periodicidad)
        ) or prestamo.fecha_vencimiento

    # Cuota objetivo: la de la siguiente cuota impagada (si la hay)
    if next_unpaid:
        P0 = Decimal(str(next_unpaid.importe_cuota or 0)).quantize(Decimal("0.01"))
    else:
        # Estimación de cuota si no hay cuotas pendientes registradas
        r = r_periodico(prestamo.tin_pct, prestamo.periodicidad)
        N_approx = Decimal(12)
        if r == 0:
            P0 = (saldo_nuevo / N_approx).quantize(Decimal("0.01"))
        else:
            pow_ = (Decimal(1) + r) ** int(N_approx)
            P0 = (saldo_nuevo * (r * pow_) / (pow_ - 1)).quantize(Decimal("0.01"))
        if P0 <= 0:
            P0 = saldo_nuevo

    r = r_periodico(prestamo.tin_pct, prestamo.periodicidad)
    Nnew = _calc_num_periodos_desde_PV_P(saldo_nuevo, P0, r)
    if Nnew <= 0:
        Nnew = 1

    # Borramos las cuotas impagadas actuales
    db.query(models.PrestamoCuota).filter(
        models.PrestamoCuota.prestamo_id == prestamo.id,
        models.PrestamoCuota.pagada == False,
    ).delete(synchronize_session=False)

    # Generamos el nuevo bloque de cuotas impagadas
    cuotas_new: List[models.PrestamoCuota] = []
    saldo = saldo_nuevo
    step = step_meses(prestamo.periodicidad)
    now = datetime.utcnow()

    for i in range(Nnew):
        k = start_num + i
        f_vto = add_months(first_date, step * i) or first_date

        if r == 0:
            interes = Decimal("0.00")
            capital = min(P0, saldo)
            importe = capital
        else:
            interes = (saldo * r).quantize(Decimal("0.01"))
            capital = (P0 - interes).quantize(Decimal("0.01"))
            if capital <= 0:
                capital = Decimal("0.01")
            if i == Nnew - 1:
                capital = saldo
            importe = (capital + interes).quantize(Decimal("0.01"))

        saldo_posterior = (saldo - capital).quantize(Decimal("0.01"))

        cuota_obj = models.PrestamoCuota(
            id=generate_prestamo_cuota_id(db),
            prestamo_id=prestamo.id,
            num_cuota=k,
            fecha_vencimiento=f_vto,
            importe_cuota=importe,
            capital=capital,
            interes=interes,
            seguros=Decimal("0.00"),
            comisiones=Decimal("0.00"),
            saldo_posterior=saldo_posterior,
            pagada=False,
            createon=now,
            modifiedon=now,
        )
        cuotas_new.append(cuota_obj)
        saldo = saldo_posterior

    if cuotas_new:
        db.add_all(cuotas_new)
        prestamo.cuotas_totales = int(paid_count + len(cuotas_new))
        prestamo.fecha_vencimiento = cuotas_new[-1].fecha_vencimiento

    # Recalcular agregados con el nuevo plan
    recompute_pendientes_prestamo(db, prestamo.id)

    # Actualizar el gasto asociado, si existe
    if getattr(prestamo, "referencia_gasto", None):
        g = db.get(models.Gasto, prestamo.referencia_gasto)
        if g:
            g.cuotas = prestamo.cuotas_totales
            g.cuotas_pagadas = paid_count
            g.cuotas_restantes = len(cuotas_new)
            # Tomamos la cuota de la primera nueva cuota
            if cuotas_new:
                P0_new = cuotas_new[0].importe_cuota
                g.importe = float(P0_new)
                g.importe_cuota = float(P0_new)
                g.total = round(float(P0_new) * float(g.cuotas or 0), 2)
                g.importe_pendiente = round(
                    float(P0_new) * float(g.cuotas_restantes or 0),
                    2,
                )
            g.modifiedon = func.now()

    prestamo.modifiedon = func.now()
    db.flush()
