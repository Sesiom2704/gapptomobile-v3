// mobile_app/types/analytics.ts

// -----------------------------
// Día a día (DayToDayAnalysis)
// -----------------------------

export type Tendencia = 'UP' | 'DOWN' | 'FLAT';

export interface TodaySummary {
  fecha_label: string;
  total_hoy: number;
  num_movimientos: number;
  ticket_medio: number;
  diff_vs_ayer: string;
  tendencia: string;
}

export interface WeekSummary {
  total_semana: number;
  limite_semana: number;
  proyeccion_fin_semana: number;
  dias_restantes: number;
}

export interface MonthSummary {
  presupuesto_mes: number;
  gastado_mes: number;
}

export interface CategoryMonth {
  key: string;
  label: string;
  importe: number;
  porcentaje: number;
}

export interface CategoryKpi {
  tickets: number;
  ticket_medio: number;
  variacion_importe_pct: number;
  variacion_tickets_pct: number;
  peso_sobre_total_gasto: number;
}

export interface ProviderItem {
  nombre: string;
  importe: number;
  num_compras: number;
  tendencia: Tendencia;
}

export interface Last7DayItem {
  label: string;
  fecha: string;
  importe: number;
}

/**
 * ✅ NUEVO (backend): serie diaria del mes (para gráfica mensual)
 */
export interface DailySeriesItem {
  fecha: string; // YYYY-MM-DD
  dia: number; // 1..31
  importe: number;
}

/**
 * ✅ NUEVO (backend): serie mensual (últimos N meses)
 */
export interface MonthlySeriesItem {
  year: number;
  month: number; // 1..12
  label: string; // "YYYY-MM"
  importe: number;
  tickets: number;
}

/**
 * ✅ NUEVO (backend): KPIs de evolución sobre la serie mensual
 */
export interface EvolutionKpis {
  variacion_mes_pct: number;
  variacion_mes_abs: number;

  media_3m: number;
  media_6m: number;
  media_12m: number;

  tendencia: Tendencia;
  tendencia_detalle: string;

  max_mes_label?: string | null;
  max_mes_importe?: number | null;
  min_mes_label?: string | null;
  min_mes_importe?: number | null;
}

export interface DayToDayAnalysisResponse {
  today: TodaySummary;
  week: WeekSummary;
  month: MonthSummary;
  categorias_mes: CategoryMonth[];
  category_kpis: Record<string, CategoryKpi>;
  proveedores_por_categoria: Record<string, ProviderItem[]>;
  ultimos_7_dias: Last7DayItem[];
  alertas: string[];

  /**
   * ✅ NUEVO: para análisis mensual con gráficas (backend ya lo devuelve)
   * OJO: son opcionales para no romper si el backend aún no está desplegado.
   */
  serie_diaria_mes?: DailySeriesItem[] | null;
  serie_mensual?: MonthlySeriesItem[] | null;
  kpis_evolucion?: EvolutionKpis | null;
}

export interface DayToDayAnalysisRequest {
  fecha?: string;
  pago?: 'YO' | 'OTRO' | 'TODOS';
  categoria?: string;

  /**
   * Frontend usa tipoId; backend espera tipo_id
   */
  tipoId?: string;

  /**
   * ✅ NUEVO: ventana para serie mensual (backend espera months_back)
   * Si no se manda: backend usa su default (12).
   */
  monthsBack?: number;
}

// -----------------------------
// Resumen mensual (MonthlySummary)
// -----------------------------

export interface MonthlyGeneralKpi {
  ingresos_mes: number;
  gastos_mes: number;
  ahorro_mes: number;
  ingresos_vs_media_12m_pct: number | null;
  gastos_vs_media_12m_pct: number | null;
}

export interface MonthlyIngresosDetalle {
  recurrentes: number;
  extraordinarios: number;
  num_extra: number;
}

export interface MonthlyGastosDetalle {
  recurrentes: number;
  extraordinarios: number;
  num_extra: number;
}

export interface MonthlyDistribucionItem {
  label: string;
  importe: number;
  porcentaje_sobre_total: number;
}

export interface MonthlyRunRate {
  ingreso_medio_12m: number;
  gasto_medio_12m: number;
  ahorro_medio_12m: number;
  proyeccion_ahorro_anual: number;
  meses_usados: number;
}

export type MonthlyResumenNotaTipo = 'WARNING' | 'INFO' | 'SUCCESS';

export interface MonthlyResumenNota {
  tipo: MonthlyResumenNotaTipo;
  titulo: string;
  mensaje: string;
}

/** ✅ NUEVO: presupuestos “base” (sin extras) */
export interface MonthlyPresupuestos {
  ingresos_presupuesto: number;
  gestionables_presupuesto: number;
  cotidianos_presupuesto: number;
  gasto_total_presupuesto: number;
}

export interface MonthlySummaryResponse {
  anio: number;
  mes: number;
  mes_label: string;

  general: MonthlyGeneralKpi;

  detalle_ingresos: MonthlyIngresosDetalle;
  detalle_gastos: MonthlyGastosDetalle;

  distribucion_ingresos: MonthlyDistribucionItem[];
  distribucion_gastos: MonthlyDistribucionItem[];

  /** ✅ NUEVO: viene del backend */
  presupuestos?: MonthlyPresupuestos;

  run_rate_12m: MonthlyRunRate | null;

  notas: MonthlyResumenNota[];
}
