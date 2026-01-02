# backend/app/api/v1/monthly_summary_router.py

from __future__ import annotations

from datetime import date
from typing import Optional, List, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Integer  # ✅ Cast a Integer para evitar overflow SMALLINT

from backend.app.schemas.monthly_summary import (
    MonthlySummaryResponse,
    MonthlyGeneralKpi,
    MonthlyIngresosDetalle,
    MonthlyGastosDetalle,
    MonthlyDistribucionItem,
    MonthlyRunRate,
    MonthlyResumenNota,
    MonthlyPresupuestos,
)
from backend.app.db.models import Ingreso, Gasto, GastoCotidiano, CierreMensual, User
from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db

router = APIRouter()

# Segmento "Cotidiano" (se usa en toda la app)
SEGMENTO_COTIDIANO_ID = "COT-12345"

# Periodicidad de extras (normalizada)
PERIODICIDAD_PAGO_UNICO = "PAGO UNICO"
PERIODICIDAD_PAGO_UNICO_ALT = "PAGO ÚNICO"  # legacy por si existiera en BBDD


def _get_month_range(year: Optional[int], month: Optional[int]) -> Tuple[date, date]:
    """
    Devuelve el rango [ini, fin_excl) del mes solicitado.

    - ini: primer día del mes
    - fin_excl: primer día del mes siguiente (fin exclusivo)

    Usamos fin_excl para filtros SQL robustos:
      fecha >= ini AND fecha < fin_excl
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    ini = date(y, m, 1)
    if m == 12:
        fin_excl = date(y + 1, 1, 1)
    else:
        fin_excl = date(y, m + 1, 1)

    return ini, fin_excl


def _add_months(y: int, m: int, delta: int) -> Tuple[int, int]:
    """
    Suma (o resta) meses a un (year, month) y devuelve el nuevo (year, month).

    Ej:
      _add_months(2025, 1, -1) -> (2024, 12)
      _add_months(2025, 12,  1) -> (2026, 1)

    Implementación robusta basada en "mes absoluto":
      abs = year*12 + (month-1)
    """
    total = y * 12 + (m - 1) + delta
    y2 = total // 12
    m2 = (total % 12) + 1
    return y2, m2


@router.get(
    "/analytics/monthly-summary",
    response_model=MonthlySummaryResponse,
    name="monthly_summary_get",
)
def get_monthly_summary(
    year: Optional[int] = Query(None, description="Año (por defecto, año actual)"),
    month: Optional[int] = Query(None, description="Mes 1-12 (por defecto, mes actual)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
) -> MonthlySummaryResponse:
    """
    Resumen mensual de ingresos y gastos (alineado con Home):

    INGRESOS
    - REAL recurrentes: activo+kpi+cobrados dentro del mes, periodicidad != PAGO UNICO
    - REAL extras: cobrados dentro del mes, periodicidad = PAGO UNICO (sin filtrar activo/kpi)
    - PRESUPUESTO ingresos: activo+kpi, periodicidad != PAGO UNICO (extras NO se presupuestan)

    GASTOS
    - PRESUPUESTO gestionables: activo+kpi, segmento != COT, periodicidad != PAGO UNICO (extras NO se presupuestan)
    - PRESUPUESTO cotidianos: activo+kpi, segmento = COT
    - REAL gestionables recurrentes: pagados en mes, segmento != COT, periodicidad != PAGO UNICO (SIN filtros activo/kpi)
    - REAL gestionables extras: pagados en mes, segmento != COT, periodicidad = PAGO UNICO (incluye legacy PAGO ÚNICO)
    - REAL cotidianos: gasto_cotidiano pagado en mes
    - REAL gastos_mes: gestionables_recurrentes + gestionables_extras + cotidianos

    NOTA SOBRE "vs media 12m" y "run rate 12m":
    - Ambos se calculan contra los 12 cierres ANTERIORES al mes objetivo.
    - Esto evita "contaminar" la media incluyendo el propio mes objetivo.
    """
    ini, fin_excl = _get_month_range(year, month)
    anio = ini.year
    mes = ini.month
    mes_label = ini.strftime("%B %Y").capitalize()

    # -------------------------------------------------------------------------
    # ✅ Ventana 12 meses (benchmark) CORRECTA Y SIN OVERFLOW
    #
    # Queremos los 12 cierres anteriores al mes objetivo:
    #   end = mes objetivo - 1
    #   start = end - 11
    #
    # Ej (mes objetivo = 2025-12):
    #   end = 2025-11
    #   start = 2024-12
    #   => 12 meses: 202412..202511
    # -------------------------------------------------------------------------
    end_y, end_m = _add_months(anio, mes, -1)
    start_y, start_m = _add_months(end_y, end_m, -11)

    end_ym = int(end_y) * 100 + int(end_m)
    start_ym = int(start_y) * 100 + int(start_m)

    # period_ym como INTEGER evita overflow de SMALLINT en expresiones (ej 202512)
    period_ym = cast(CierreMensual.anio, Integer) * 100 + cast(CierreMensual.mes, Integer)

    # -------------------------------------------------------------------------
    # 1) INGRESOS (REAL + PRESUPUESTO)
    # -------------------------------------------------------------------------

    # (REAL) Recurrentes KPI del mes (excluye PAGO UNICO)
    ingresos_recurrentes_mes = float(
        (
            db.query(func.coalesce(func.sum(Ingreso.importe), 0.0))
            .filter(
                Ingreso.user_id == current_user.id,
                Ingreso.activo == True,  # noqa: E712
                Ingreso.kpi == True,  # noqa: E712
                Ingreso.cobrado == True,  # noqa: E712
                Ingreso.periodicidad != PERIODICIDAD_PAGO_UNICO,
                Ingreso.ultimo_ingreso_on >= ini,
                Ingreso.ultimo_ingreso_on < fin_excl,
            )
        ).scalar()
        or 0.0
    )

    # (PRESUPUESTO) ingresos recurrentes (excluye PAGO UNICO)
    presupuesto_ingresos = float(
        (
            db.query(func.coalesce(func.sum(Ingreso.importe), 0.0))
            .filter(
                Ingreso.user_id == current_user.id,
                Ingreso.activo == True,  # noqa: E712
                Ingreso.kpi == True,  # noqa: E712
                Ingreso.periodicidad != PERIODICIDAD_PAGO_UNICO,
            )
        ).scalar()
        or 0.0
    )

    # (REAL) extras cobrados en el mes (PAGO UNICO)
    ingresos_extra_importe, ingresos_extra_num = (
        db.query(
            func.coalesce(func.sum(Ingreso.importe), 0.0),
            func.count(Ingreso.id),
        )
        .filter(
            Ingreso.user_id == current_user.id,
            Ingreso.cobrado == True,  # noqa: E712
            Ingreso.periodicidad == PERIODICIDAD_PAGO_UNICO,
            Ingreso.ultimo_ingreso_on >= ini,
            Ingreso.ultimo_ingreso_on < fin_excl,
        )
        .first()
        or (0.0, 0)
    )
    ingresos_extra_importe = float(ingresos_extra_importe or 0.0)
    ingresos_extra_num = int(ingresos_extra_num or 0)

    ingresos_mes = ingresos_recurrentes_mes + ingresos_extra_importe

    # -------------------------------------------------------------------------
    # 2) PRESUPUESTOS DE GASTO (NO incluyen extras)
    # -------------------------------------------------------------------------

    # Gestionables presupuestados (excluye PAGO UNICO)
    presupuesto_gestionables = float(
        (
            db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
            .filter(
                Gasto.user_id == current_user.id,
                Gasto.activo == True,  # noqa: E712
                Gasto.kpi == True,  # noqa: E712
                Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
                Gasto.periodicidad != PERIODICIDAD_PAGO_UNICO,
            )
        ).scalar()
        or 0.0
    )

    # Cotidianos presupuestados
    presupuesto_cotidianos = float(
        (
            db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
            .filter(
                Gasto.user_id == current_user.id,
                Gasto.activo == True,  # noqa: E712
                Gasto.kpi == True,  # noqa: E712
                Gasto.segmento_id == SEGMENTO_COTIDIANO_ID,
            )
        ).scalar()
        or 0.0
    )

    gasto_total_presupuesto = presupuesto_gestionables + presupuesto_cotidianos

    presupuestos = MonthlyPresupuestos(
        ingresos_presupuesto=presupuesto_ingresos,
        gestionables_presupuesto=presupuesto_gestionables,
        cotidianos_presupuesto=presupuesto_cotidianos,
        gasto_total_presupuesto=gasto_total_presupuesto,
    )

    # -------------------------------------------------------------------------
    # 3) GASTOS REALES (consumidos)
    # -------------------------------------------------------------------------
    # Importante: NO filtramos por activo/kpi en consumidos gestionables.

    # Gestionables recurrentes consumidos (excluye PAGO UNICO)
    consumidos_gestionables_recurrentes = float(
        (
            db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
            .filter(
                Gasto.user_id == current_user.id,
                Gasto.pagado == True,  # noqa: E712
                Gasto.ultimo_pago_on >= ini,
                Gasto.ultimo_pago_on < fin_excl,
                Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
                Gasto.periodicidad != PERIODICIDAD_PAGO_UNICO,
            )
        ).scalar()
        or 0.0
    )

    # Gestionables extras consumidos (PAGO UNICO / PAGO ÚNICO)
    gastos_extra_importe, gastos_extra_num = (
        db.query(
            func.coalesce(func.sum(Gasto.importe_cuota), 0.0),
            func.count(Gasto.id),
        )
        .filter(
            Gasto.user_id == current_user.id,
            Gasto.pagado == True,  # noqa: E712
            Gasto.ultimo_pago_on >= ini,
            Gasto.ultimo_pago_on < fin_excl,
            Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
            Gasto.periodicidad.in_([PERIODICIDAD_PAGO_UNICO, PERIODICIDAD_PAGO_UNICO_ALT]),
        )
        .first()
        or (0.0, 0)
    )
    gastos_extra_importe = float(gastos_extra_importe or 0.0)
    gastos_extra_num = int(gastos_extra_num or 0)

    # Total gestionables consumidos
    consumidos_gestionables_total = consumidos_gestionables_recurrentes + gastos_extra_importe

    # Cotidianos consumidos (pagado = true)
    consumidos_cotidianos = float(
        (
            db.query(func.coalesce(func.sum(GastoCotidiano.importe), 0.0))
            .filter(
                GastoCotidiano.user_id == current_user.id,
                GastoCotidiano.pagado == True,  # noqa: E712
                GastoCotidiano.fecha >= ini,
                GastoCotidiano.fecha < fin_excl,
            )
        ).scalar()
        or 0.0
    )

    # Gastos totales reales del mes (sin doble contar extras)
    gastos_mes = consumidos_gestionables_total + consumidos_cotidianos

    # -------------------------------------------------------------------------
    # 4) KPIs generales
    # -------------------------------------------------------------------------

    ahorro_mes = ingresos_mes - gastos_mes

    # Media 12m: 12 cierres ANTERIORES al mes objetivo (start_ym..end_ym)
    cierres_12m_q = (
        db.query(
            func.coalesce(func.avg(CierreMensual.ingresos_reales), 0.0),
            func.coalesce(func.avg(CierreMensual.gastos_reales_total), 0.0),
        )
        .filter(
            CierreMensual.user_id == current_user.id,
            period_ym >= start_ym,
            period_ym <= end_ym,
        )
    )

    ingresos_media_12m, gastos_media_12m = cierres_12m_q.first() or (0.0, 0.0)
    ingresos_media_12m = float(ingresos_media_12m or 0.0)
    gastos_media_12m = float(gastos_media_12m or 0.0)

    ingresos_vs_media_pct = (
        ((ingresos_mes - ingresos_media_12m) / ingresos_media_12m * 100.0)
        if ingresos_media_12m > 0
        else None
    )
    gastos_vs_media_pct = (
        ((gastos_mes - gastos_media_12m) / gastos_media_12m * 100.0)
        if gastos_media_12m > 0
        else None
    )

    general = MonthlyGeneralKpi(
        ingresos_mes=ingresos_mes,
        gastos_mes=gastos_mes,
        ahorro_mes=ahorro_mes,
        ingresos_vs_media_12m_pct=ingresos_vs_media_pct,
        gastos_vs_media_12m_pct=gastos_vs_media_pct,
    )

    # -------------------------------------------------------------------------
    # 5) Detalle ingresos / gastos
    # -------------------------------------------------------------------------

    detalle_ingresos = MonthlyIngresosDetalle(
        recurrentes=ingresos_recurrentes_mes,
        extraordinarios=ingresos_extra_importe,
        num_extra=ingresos_extra_num,
    )

    detalle_gastos = MonthlyGastosDetalle(
        recurrentes=consumidos_gestionables_recurrentes,
        extraordinarios=gastos_extra_importe,
        num_extra=gastos_extra_num,
    )

    # -------------------------------------------------------------------------
    # 6) Distribuciones
    # -------------------------------------------------------------------------

    distribucion_ingresos: List[MonthlyDistribucionItem] = []
    if ingresos_mes > 0:
        if detalle_ingresos.recurrentes > 0:
            distribucion_ingresos.append(
                MonthlyDistribucionItem(
                    label="Recurrentes",
                    importe=detalle_ingresos.recurrentes,
                    porcentaje_sobre_total=(detalle_ingresos.recurrentes / ingresos_mes * 100.0),
                )
            )
        if detalle_ingresos.extraordinarios > 0:
            distribucion_ingresos.append(
                MonthlyDistribucionItem(
                    label="Extraordinarios",
                    importe=detalle_ingresos.extraordinarios,
                    porcentaje_sobre_total=(detalle_ingresos.extraordinarios / ingresos_mes * 100.0),
                )
            )

    distribucion_gastos: List[MonthlyDistribucionItem] = []
    if gastos_mes > 0:
        if consumidos_gestionables_recurrentes > 0:
            distribucion_gastos.append(
                MonthlyDistribucionItem(
                    label="Gestionables",
                    importe=consumidos_gestionables_recurrentes,
                    porcentaje_sobre_total=(consumidos_gestionables_recurrentes / gastos_mes * 100.0),
                )
            )
        if gastos_extra_importe > 0:
            distribucion_gastos.append(
                MonthlyDistribucionItem(
                    label="Extraordinarios",
                    importe=gastos_extra_importe,
                    porcentaje_sobre_total=(gastos_extra_importe / gastos_mes * 100.0),
                )
            )
        if consumidos_cotidianos > 0:
            distribucion_gastos.append(
                MonthlyDistribucionItem(
                    label="Cotidianos",
                    importe=consumidos_cotidianos,
                    porcentaje_sobre_total=(consumidos_cotidianos / gastos_mes * 100.0),
                )
            )

    # -------------------------------------------------------------------------
    # 7) Run rate 12 meses
    # -------------------------------------------------------------------------

    # Run rate: promedio de los 12 cierres ANTERIORES (no incluye el mes objetivo)
    cierres_det_q = (
        db.query(
            func.coalesce(func.avg(CierreMensual.ingresos_reales), 0.0),
            func.coalesce(func.avg(CierreMensual.gastos_reales_total), 0.0),
            func.coalesce(func.avg(CierreMensual.resultado_real), 0.0),
            func.count(CierreMensual.id),
        )
        .filter(
            CierreMensual.user_id == current_user.id,
            period_ym >= start_ym,
            period_ym <= end_ym,
        )
    )

    ingreso_medio_12m, gasto_medio_12m, ahorro_medio_12m, meses_usados = (
        cierres_det_q.first() or (0.0, 0.0, 0.0, 0)
    )
    ingreso_medio_12m = float(ingreso_medio_12m or 0.0)
    gasto_medio_12m = float(gasto_medio_12m or 0.0)
    ahorro_medio_12m = float(ahorro_medio_12m or 0.0)
    meses_usados = int(meses_usados or 0)

    run_rate_12m: Optional[MonthlyRunRate] = None
    if meses_usados > 0:
        run_rate_12m = MonthlyRunRate(
            ingreso_medio_12m=ingreso_medio_12m,
            gasto_medio_12m=gasto_medio_12m,
            ahorro_medio_12m=ahorro_medio_12m,
            proyeccion_ahorro_anual=ahorro_medio_12m * 12.0,
            meses_usados=meses_usados,
        )

    # -------------------------------------------------------------------------
    # 8) Alertas e Insight (ANTES: notas)
    # -------------------------------------------------------------------------
    #
    # Objetivo:
    # - Dar señales accionables sin generar "spam".
    # - Mantener compatibilidad: se devuelve la lista `notas` como antes.
    #
    # Convención de tipo:
    # - WARNING: requiere atención
    # - SUCCESS: señal positiva
    # - INFO: insight informativo
    # -------------------------------------------------------------------------

    notas: List[MonthlyResumenNota] = []

    def add_note(tipo: str, titulo: str, mensaje: str) -> None:
        # Evita duplicados por título (simple y suficiente)
        if any(n.titulo == titulo for n in notas):
            return
        notas.append(MonthlyResumenNota(tipo=tipo, titulo=titulo, mensaje=mensaje))

    # 8.1) Situaciones base
    if ingresos_mes <= 0 and gastos_mes > 0:
        add_note(
            "WARNING",
            "Gastos sin ingresos",
            "Este mes hay gastos registrados pero no se han registrado ingresos. Revisa cobros o categorización.",
        )

    if ahorro_mes < 0:
        add_note(
            "WARNING",
            "Mes en negativo",
            "Este mes has gastado más de lo que has ingresado. Revisa gastos extraordinarios y cotidianos.",
        )

    # 8.2) vs media 12m (interpretación: negativo = mejor, positivo = peor)
    # (El front pintará negativo en verde y positivo en rojo.)
    if gastos_vs_media_pct is not None:
        if gastos_vs_media_pct > 10:
            add_note(
                "WARNING",
                "Gasto por encima de la media",
                "Tus gastos están significativamente por encima de la media de los últimos 12 cierres. Revisa especialmente extraordinarios.",
            )
        elif gastos_vs_media_pct < -10:
            add_note(
                "SUCCESS",
                "Gasto por debajo de la media",
                "Buen control: tus gastos están claramente por debajo de la media de los últimos 12 cierres.",
            )

    if ingresos_vs_media_pct is not None:
        if ingresos_vs_media_pct < -15:
            add_note(
                "WARNING",
                "Ingresos por debajo de la media",
                "Tus ingresos están por debajo de la media de los últimos 12 cierres. Revisa si ha faltado algún cobro o KPI.",
            )
        elif ingresos_vs_media_pct > 10 and ahorro_mes > 0:
            add_note(
                "SUCCESS",
                "Buen mes de ingresos",
                "Tus ingresos están por encima de la media de los últimos 12 cierres. Aprovecha para reforzar ahorro o amortizar deuda.",
            )

    # 8.3) Peso de extraordinarios (gastos)
    if gastos_mes > 0 and gastos_extra_importe > 0:
        pct_extra_gastos = (gastos_extra_importe / gastos_mes) * 100.0
        if pct_extra_gastos >= 35:
            add_note(
                "WARNING",
                "Mucho gasto extraordinario",
                f"Los gastos extraordinarios representan aprox. un {pct_extra_gastos:.1f}% del total de gastos del mes.",
            )
        else:
            add_note(
                "INFO",
                "Gastos extraordinarios presentes",
                f"Este mes has tenido gastos extraordinarios (aprox. {pct_extra_gastos:.1f}% del total).",
            )

    # 8.4) Presupuesto vs real (si hay presupuesto > 0)
    if gasto_total_presupuesto > 0:
        desviacion_gasto_pct = ((gastos_mes - gasto_total_presupuesto) / gasto_total_presupuesto) * 100.0
        if desviacion_gasto_pct > 10:
            add_note(
                "WARNING",
                "Gasto por encima del presupuesto",
                f"Este mes has gastado aprox. un +{desviacion_gasto_pct:.1f}% sobre el presupuesto.",
            )
        elif desviacion_gasto_pct < -10:
            add_note(
                "SUCCESS",
                "Gasto por debajo del presupuesto",
                f"Buen control: este mes estás aprox. un {desviacion_gasto_pct:.1f}% por debajo del presupuesto.",
            )

    if presupuesto_cotidianos > 0:
        desviacion_cot_pct = ((consumidos_cotidianos - presupuesto_cotidianos) / presupuesto_cotidianos) * 100.0
        if desviacion_cot_pct > 10:
            add_note(
                "WARNING",
                "Cotidianos por encima del presupuesto",
                f"Los gastos cotidianos van aprox. un +{desviacion_cot_pct:.1f}% sobre el presupuesto.",
            )

    # 8.5) Insight general: ratio gastos/ingresos (solo si ingresos > 0)
    if ingresos_mes > 0:
        ratio_gasto = (gastos_mes / ingresos_mes) * 100.0
        add_note(
            "INFO",
            "Ratio de gasto sobre ingresos",
            f"Has destinado aproximadamente un {ratio_gasto:.1f}% de tus ingresos a gastos este mes.",
        )

        # Señal extra: eficiencia de gasto
        if ratio_gasto <= 70 and ahorro_mes > 0:
            add_note(
                "SUCCESS",
                "Buen equilibrio ingresos/gastos",
                "Tu ratio de gasto es bajo y el mes cierra en positivo. Mantén el patrón.",
            )

    # 8.6) Insight por ingresos extraordinarios (si existen)
    if ingresos_mes > 0 and ingresos_extra_importe > 0:
        pct_extra_ing = (ingresos_extra_importe / ingresos_mes) * 100.0
        add_note(
            "INFO",
            "Ingresos extraordinarios",
            f"Este mes has tenido ingresos extraordinarios (aprox. {pct_extra_ing:.1f}% del total).",
        )

    # Limitar cantidad para evitar saturación (orden actual ya prioriza WARNING/SUCCESS primero)
    # Ajusta el límite si quieres más/menos densidad de insight.
    MAX_NOTAS = 6
    if len(notas) > MAX_NOTAS:
        notas = notas[:MAX_NOTAS]

    # -------------------------------------------------------------------------
    # 9) Response (IMPORTANTE: consumidos_cotidianos es REQUIRED en tu schema)
    # -------------------------------------------------------------------------

    response = MonthlySummaryResponse(
        anio=anio,
        mes=mes,
        mes_label=mes_label,
        general=general,
        detalle_ingresos=detalle_ingresos,
        detalle_gastos=detalle_gastos,
        distribucion_ingresos=distribucion_ingresos,
        distribucion_gastos=distribucion_gastos,
        presupuestos=presupuestos,
        consumidos_cotidianos=consumidos_cotidianos,  # ✅ requerido
        run_rate_12m=run_rate_12m,
        notas=notas,
    )

    return response
