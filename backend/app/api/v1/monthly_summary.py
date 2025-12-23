# backend/app/schemas/monthly_summary.py

from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class MonthlyPresupuestos(BaseModel):
    """
    Presupuestos base (KPI/activo) del mes.
    Importante: NO incluyen extras (PAGO UNICO).
    """
    ingresos_presupuesto: float = Field(..., description="Presupuesto de ingresos recurrentes (KPI/activo, sin PAGO UNICO).")
    gestionables_presupuesto: float = Field(..., description="Presupuesto de gastos gestionables (KPI/activo, sin extras).")
    cotidianos_presupuesto: float = Field(..., description="Presupuesto de gastos cotidianos (KPI/activo).")
    gasto_total_presupuesto: float = Field(..., description="Suma de gestionables_presupuesto + cotidianos_presupuesto.")


class MonthlyGeneralKpi(BaseModel):
    """
    KPIs globales del mes actual:
    - ingresos_mes: ingresos reales del mes (recurrentes KPI del mes + extras cobrados en el mes)
    - gastos_mes: gastos reales del mes (gestionables pagados del mes + cotidianos consumidos del mes)
    - ahorro_mes: ingresos_mes - gastos_mes
    - ingresos_vs_media_12m_pct: % de desviación vs media de ingresos de los últimos 12 meses
    - gastos_vs_media_12m_pct: % de desviación vs media de gastos de los últimos 12 meses
    """
    ingresos_mes: float = Field(..., description="Total de ingresos del mes (reales).")
    gastos_mes: float = Field(..., description="Total de gastos del mes (reales).")
    ahorro_mes: float = Field(..., description="Ingresos - gastos del mes.")

    ingresos_vs_media_12m_pct: Optional[float] = Field(
        None,
        description="(ingresos_mes / media_ingresos_12m - 1) * 100, si hay datos suficientes.",
    )
    gastos_vs_media_12m_pct: Optional[float] = Field(
        None,
        description="(gastos_mes / media_gastos_12m - 1) * 100, si hay datos suficientes.",
    )


class MonthlyIngresosDetalle(BaseModel):
    """
    Desglose de INGRESOS del mes:
    - recurrentes: ingresos KPI/activo/cobrado en el mes EXCLUYENDO PAGO UNICO
    - extraordinarios: ingresos PAGO UNICO cobrados en el mes
    - num_extra: nº de ingresos extraordinarios en el mes
    """
    recurrentes: float = Field(..., description="Ingresos recurrentes del mes (KPI/activo/cobrado, sin PAGO UNICO).")
    extraordinarios: float = Field(..., description="Ingresos extraordinarios del mes (PAGO UNICO).")
    num_extra: int = Field(..., description="Número de ingresos extraordinarios (periodicidad = 'PAGO UNICO').")


class MonthlyGastosDetalle(BaseModel):
    """
    Desglose de GASTOS GESTIONABLES del mes:
    - recurrentes: gastos gestionables NO 'PAGO UNICO' pagados en el mes (segmento_id <> COT-12345)
    - extraordinarios: gastos gestionables 'PAGO UNICO' pagados en el mes (segmento_id <> COT-12345)
    - num_extra: nº de gastos extraordinarios en el mes
    """
    recurrentes: float = Field(..., description="Gastos gestionables recurrentes del mes (pagados, sin PAGO UNICO).")
    extraordinarios: float = Field(..., description="Gastos gestionables extraordinarios del mes (PAGO UNICO pagado).")
    num_extra: int = Field(..., description="Número de gastos gestionables extraordinarios del mes.")


class MonthlyDistribucionItem(BaseModel):
    """
    Elemento genérico de distribución (para ingresos o gastos):
    - label: texto para mostrar ('Gestionables', 'Cotidianos', 'Extraordinarios', etc.)
    - importe: valor en euros
    - porcentaje_sobre_total: porcentaje respecto al total (0-100)
    """
    label: str = Field(..., description="Etiqueta de la categoría.")
    importe: float = Field(..., description="Importe asociado a la categoría.")
    porcentaje_sobre_total: float = Field(..., description="Porcentaje que representa sobre el total (0-100).")


class MonthlyRunRate(BaseModel):
    """
    Run rate 12 meses basado en la tabla cierre_mensual:
    - ingreso_medio_12m: media de ingresos_reales últimos 12 cierres
    - gasto_medio_12m: media de gastos_reales_total últimos 12 cierres
    - ahorro_medio_12m: media de resultado_real últimos 12 cierres
    - proyeccion_ahorro_anual: ahorro_medio_12m * 12
    - meses_usados: nº de registros de cierre utilizados (por si no hay 12 todavía)
    """
    ingreso_medio_12m: float = Field(..., description="Media de ingresos reales últimos 12 meses.")
    gasto_medio_12m: float = Field(..., description="Media de gastos reales últimos 12 meses.")
    ahorro_medio_12m: float = Field(..., description="Media de resultado (ingresos-gastos) últimos 12 meses.")
    proyeccion_ahorro_anual: float = Field(..., description="Proyección de ahorro anual (ahorro_medio_12m * 12).")
    meses_usados: int = Field(..., description="Número de cierres mensuales usados para la media.")


class MonthlyResumenNota(BaseModel):
    """
    Nota / alerta para mostrar en la sección 'Notas rápidas del mes'.
    - tipo: WARNING / INFO / SUCCESS => para icono y color en el front
    - titulo: texto corto
    - mensaje: detalle
    """
    tipo: Literal["WARNING", "INFO", "SUCCESS"] = Field("INFO", description="Tipo de nota para controlar estilo visual.")
    titulo: str = Field(..., description="Título corto de la nota.")
    mensaje: str = Field(..., description="Texto explicativo de la nota.")


class MonthlySummaryResponse(BaseModel):
    """
    Resumen mensual completo que alimenta la pantalla /mes/resumen y el Home.

    Incluye:
    - presupuestos (KPI/activo, sin extras)
    - consumidos_cotidianos (real del mes de gastos cotidianos)
    """
    anio: int = Field(..., description="Año del periodo resumido.")
    mes: int = Field(..., description="Mes del periodo resumido (1-12).")
    mes_label: str = Field(..., description="Etiqueta amigable del mes, p.ej. 'DICIEMBRE 2025'.")

    general: MonthlyGeneralKpi
    detalle_ingresos: MonthlyIngresosDetalle
    detalle_gastos: MonthlyGastosDetalle

    distribucion_ingresos: List[MonthlyDistribucionItem]
    distribucion_gastos: List[MonthlyDistribucionItem]

    presupuestos: MonthlyPresupuestos = Field(..., description="Presupuestos KPI/activo del mes (sin extras).")
    consumidos_cotidianos: float = Field(..., description="Total real consumido en gastos cotidianos este mes.")

    run_rate_12m: Optional[MonthlyRunRate] = Field(
        None,
        description="Datos de run rate 12 meses; puede ser None si no hay cierres suficientes.",
    )

    notas: List[MonthlyResumenNota] = Field(default_factory=list, description="Notas rápidas / alertas para el mes.")
