# backend/app/api/v1/analytics/monthly_summary_router.py
"""
Monthly Summary Router (analytics/monthly-summary)

Objetivo:
- Proveer un resumen mensual de ingresos y gastos coherente con Home (GapptoMobile v3).
- Separar explícitamente:
  - Real recurrente vs real extraordinario (PAGO ÚNICO)
  - Presupuesto (plan) vs consumido (real)
- Aplicar participación de vivienda en métricas visibles del Home cuando ingreso/gasto está vinculado a patrimonio.

Regla de participación:
- Si un ingreso/gasto tiene referencia_vivienda_id, se aplica:
      importe * patrimonio.participacion_pct / 100
- Si no tiene vivienda asociada, computa al 100%.
- Esto NO afecta a la operativa real de cobrar/pagar: las acciones siguen moviendo el importe completo.

Notas v3:
- `periodicidad` se normaliza para tolerar valores legacy como 'PAGO_UNICO'.
- Ventanas de fechas: [ini, fin_excl) para robustez en SQL.
"""

from __future__ import annotations

from datetime import date
from typing import Optional, List, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Integer, and_

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
from backend.app.db.models import (
    Ingreso,
    Gasto,
    GastoCotidiano,
    CierreMensual,
    User,
    Patrimonio,
)
from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db

router = APIRouter()

SEGMENTO_COTIDIANO_ID = "COT-12345"
PERIODICIDAD_PAGO_UNICO_NORM = "PAGO UNICO"


def _periodicidad_norm_sql(col):
    return func.upper(func.replace(func.coalesce(col, ""), "_", " "))


def _participacion_factor_sql():
    """
    Factor SQL de participación de vivienda.

    Ejemplos:
    - participacion_pct = 100 => factor 1.0
    - participacion_pct = 50  => factor 0.5
    - NULL / sin vivienda     => factor 1.0
    """
    return func.coalesce(Patrimonio.participacion_pct, 100.0) / 100.0


def _get_month_range(year: Optional[int], month: Optional[int]) -> Tuple[date, date]:
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
    total = y * 12 + (m - 1) + delta
    y2 = total // 12
    m2 = (total % 12) + 1
    return y2, m2


def _ingresos_base_query(db: Session, current_user: User):
    """
    Query base de ingresos con LEFT JOIN a patrimonio para aplicar participación.

    Importante:
    - El join valida también user_id para no mezclar datos de usuarios.
    """
    return (
        db.query(Ingreso)
        .outerjoin(
            Patrimonio,
            and_(
                Patrimonio.id == Ingreso.referencia_vivienda_id,
                Patrimonio.user_id == Ingreso.user_id,
            ),
        )
        .filter(Ingreso.user_id == current_user.id)
    )


def _gastos_base_query(db: Session, current_user: User):
    """
    Query base de gastos con LEFT JOIN a patrimonio para aplicar participación.
    """
    return (
        db.query(Gasto)
        .outerjoin(
            Patrimonio,
            and_(
                Patrimonio.id == Gasto.referencia_vivienda_id,
                Patrimonio.user_id == Gasto.user_id,
            ),
        )
        .filter(Gasto.user_id == current_user.id)
    )


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
    Resumen mensual de ingresos y gastos.

    En Home se muestran importes ponderados por participación cuando el movimiento
    está vinculado a una vivienda. La operativa bancaria real queda intacta.
    """
    ini, fin_excl = _get_month_range(year, month)
    anio = ini.year
    mes = ini.month
    mes_label = ini.strftime("%B %Y").capitalize()

    end_y, end_m = _add_months(anio, mes, -1)
    start_y, start_m = _add_months(end_y, end_m, -11)

    end_ym = int(end_y) * 100 + int(end_m)
    start_ym = int(start_y) * 100 + int(start_m)

    period_ym = cast(CierreMensual.anio, Integer) * 100 + cast(CierreMensual.mes, Integer)

    per_ing = _periodicidad_norm_sql(Ingreso.periodicidad)
    per_gas = _periodicidad_norm_sql(Gasto.periodicidad)

    factor = _participacion_factor_sql()

    # -------------------------------------------------------------------------
    # 1) INGRESOS REALES
    # -------------------------------------------------------------------------

    ingresos_recurrentes_mes = float(
        (
            _ingresos_base_query(db, current_user)
            .with_entities(func.coalesce(func.sum(Ingreso.importe * factor), 0.0))
            .filter(
                Ingreso.activo == True,   # noqa: E712
                Ingreso.kpi == True,      # noqa: E712
                Ingreso.cobrado == True,  # noqa: E712
                per_ing != PERIODICIDAD_PAGO_UNICO_NORM,
                per_ing != "",
                Ingreso.ultimo_ingreso_on >= ini,
                Ingreso.ultimo_ingreso_on < fin_excl,
            )
        ).scalar()
        or 0.0
    )

    ingresos_extra_importe, ingresos_extra_num = (
        _ingresos_base_query(db, current_user)
        .with_entities(
            func.coalesce(func.sum(Ingreso.importe * factor), 0.0),
            func.count(Ingreso.id),
        )
        .filter(
            Ingreso.cobrado == True,  # noqa: E712
            per_ing == PERIODICIDAD_PAGO_UNICO_NORM,
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
    # 2) PRESUPUESTOS Y OMITIDOS
    # -------------------------------------------------------------------------

    presupuesto_ingresos_original = float(
        (
            _ingresos_base_query(db, current_user)
            .with_entities(func.coalesce(func.sum(Ingreso.importe * factor), 0.0))
            .filter(
                Ingreso.activo == True,  # noqa: E712
                Ingreso.kpi == True,     # noqa: E712
                per_ing != PERIODICIDAD_PAGO_UNICO_NORM,
                per_ing != "",
            )
        ).scalar()
        or 0.0
    )

    ingresos_omitidos_mes = 0.0
    if hasattr(Ingreso, "omitido_este_mes"):
        ingresos_omitidos_mes = float(
            (
                _ingresos_base_query(db, current_user)
                .with_entities(func.coalesce(func.sum(Ingreso.importe * factor), 0.0))
                .filter(
                    Ingreso.activo == True,  # noqa: E712
                    Ingreso.kpi == True,     # noqa: E712
                    Ingreso.omitido_este_mes == True,  # noqa: E712
                    per_ing != PERIODICIDAD_PAGO_UNICO_NORM,
                    per_ing != "",
                )
            ).scalar()
            or 0.0
        )

    presupuesto_ingresos = max(0.0, presupuesto_ingresos_original - ingresos_omitidos_mes)

    presupuesto_gestionables_original = float(
        (
            _gastos_base_query(db, current_user)
            .with_entities(func.coalesce(func.sum(Gasto.importe_cuota * factor), 0.0))
            .filter(
                Gasto.activo == True,  # noqa: E712
                Gasto.kpi == True,     # noqa: E712
                Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
                per_gas != PERIODICIDAD_PAGO_UNICO_NORM,
                per_gas != "",
            )
        ).scalar()
        or 0.0
    )

    presupuesto_cotidianos_original = float(
        (
            db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
            .filter(
                Gasto.user_id == current_user.id,
                Gasto.activo == True,  # noqa: E712
                Gasto.kpi == True,     # noqa: E712
                Gasto.segmento_id == SEGMENTO_COTIDIANO_ID,
            )
        ).scalar()
        or 0.0
    )

    gestionables_omitidos_mes = 0.0
    cotidianos_omitidos_mes = 0.0

    if hasattr(Gasto, "omitido_este_mes"):
        gestionables_omitidos_mes = float(
            (
                _gastos_base_query(db, current_user)
                .with_entities(func.coalesce(func.sum(Gasto.importe_cuota * factor), 0.0))
                .filter(
                    Gasto.activo == True,  # noqa: E712
                    Gasto.kpi == True,     # noqa: E712
                    Gasto.omitido_este_mes == True,  # noqa: E712
                    Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
                    per_gas != PERIODICIDAD_PAGO_UNICO_NORM,
                    per_gas != "",
                )
            ).scalar()
            or 0.0
        )

        cotidianos_omitidos_mes = float(
            (
                db.query(func.coalesce(func.sum(Gasto.importe_cuota), 0.0))
                .filter(
                    Gasto.user_id == current_user.id,
                    Gasto.activo == True,  # noqa: E712
                    Gasto.kpi == True,     # noqa: E712
                    Gasto.omitido_este_mes == True,  # noqa: E712
                    Gasto.segmento_id == SEGMENTO_COTIDIANO_ID,
                )
            ).scalar()
            or 0.0
        )

    presupuesto_gestionables = max(0.0, presupuesto_gestionables_original - gestionables_omitidos_mes)
    presupuesto_cotidianos = max(0.0, presupuesto_cotidianos_original - cotidianos_omitidos_mes)

    gasto_total_presupuesto_original = presupuesto_gestionables_original + presupuesto_cotidianos_original
    gasto_total_presupuesto = presupuesto_gestionables + presupuesto_cotidianos
    gasto_total_omitido_mes = gestionables_omitidos_mes + cotidianos_omitidos_mes

    presupuestos = MonthlyPresupuestos(
        ingresos_presupuesto=presupuesto_ingresos,
        gestionables_presupuesto=presupuesto_gestionables,
        cotidianos_presupuesto=presupuesto_cotidianos,
        gasto_total_presupuesto=gasto_total_presupuesto,
        ingresos_presupuesto_original=presupuesto_ingresos_original,
        gestionables_presupuesto_original=presupuesto_gestionables_original,
        cotidianos_presupuesto_original=presupuesto_cotidianos_original,
        gasto_total_presupuesto_original=gasto_total_presupuesto_original,
        ingresos_omitidos_mes=ingresos_omitidos_mes,
        gestionables_omitidos_mes=gestionables_omitidos_mes,
        cotidianos_omitidos_mes=cotidianos_omitidos_mes,
        gasto_total_omitido_mes=gasto_total_omitido_mes,
    )

    # -------------------------------------------------------------------------
    # 3) GASTOS REALES
    # -------------------------------------------------------------------------

    consumidos_gestionables_recurrentes = float(
        (
            _gastos_base_query(db, current_user)
            .with_entities(func.coalesce(func.sum(Gasto.importe_cuota * factor), 0.0))
            .filter(
                Gasto.pagado == True,  # noqa: E712
                Gasto.ultimo_pago_on >= ini,
                Gasto.ultimo_pago_on < fin_excl,
                Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
                per_gas != PERIODICIDAD_PAGO_UNICO_NORM,
                per_gas != "",
            )
        ).scalar()
        or 0.0
    )

    gastos_extra_importe, gastos_extra_num = (
        _gastos_base_query(db, current_user)
        .with_entities(
            func.coalesce(func.sum(Gasto.importe_cuota * factor), 0.0),
            func.count(Gasto.id),
        )
        .filter(
            Gasto.pagado == True,  # noqa: E712
            Gasto.ultimo_pago_on >= ini,
            Gasto.ultimo_pago_on < fin_excl,
            Gasto.segmento_id != SEGMENTO_COTIDIANO_ID,
            per_gas == PERIODICIDAD_PAGO_UNICO_NORM,
        )
        .first()
        or (0.0, 0)
    )
    gastos_extra_importe = float(gastos_extra_importe or 0.0)
    gastos_extra_num = int(gastos_extra_num or 0)

    consumidos_gestionables_total = consumidos_gestionables_recurrentes + gastos_extra_importe

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

    gastos_mes = consumidos_gestionables_total + consumidos_cotidianos
    ahorro_mes = ingresos_mes - gastos_mes

    # -------------------------------------------------------------------------
    # 4) KPIs generales / medias 12m
    # -------------------------------------------------------------------------

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
    # 5) Distribuciones
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
    # 6) Run rate 12 meses
    # -------------------------------------------------------------------------

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
    # 7) Notas
    # -------------------------------------------------------------------------

    notas: List[MonthlyResumenNota] = []

    def add_note(tipo: str, titulo: str, mensaje: str) -> None:
        if any(n.titulo == titulo for n in notas):
            return
        notas.append(MonthlyResumenNota(tipo=tipo, titulo=titulo, mensaje=mensaje))

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

    if ingresos_mes > 0:
        ratio_gasto = (gastos_mes / ingresos_mes) * 100.0
        add_note(
            "INFO",
            "Ratio de gasto sobre ingresos",
            f"Has destinado aproximadamente un {ratio_gasto:.1f}% de tus ingresos a gastos este mes.",
        )
        if ratio_gasto <= 70 and ahorro_mes > 0:
            add_note(
                "SUCCESS",
                "Buen equilibrio ingresos/gastos",
                "Tu ratio de gasto es bajo y el mes cierra en positivo. Mantén el patrón.",
            )

    if ingresos_mes > 0 and ingresos_extra_importe > 0:
        pct_extra_ing = (ingresos_extra_importe / ingresos_mes) * 100.0
        add_note(
            "INFO",
            "Ingresos extraordinarios",
            f"Este mes has tenido ingresos extraordinarios (aprox. {pct_extra_ing:.1f}% del total).",
        )

    MAX_NOTAS = 6
    if len(notas) > MAX_NOTAS:
        notas = notas[:MAX_NOTAS]

    return MonthlySummaryResponse(
        anio=anio,
        mes=mes,
        mes_label=mes_label,
        general=general,
        detalle_ingresos=detalle_ingresos,
        detalle_gastos=detalle_gastos,
        distribucion_ingresos=distribucion_ingresos,
        distribucion_gastos=distribucion_gastos,
        presupuestos=presupuestos,
        consumidos_cotidianos=consumidos_cotidianos,
        run_rate_12m=run_rate_12m,
        notas=notas,
    )