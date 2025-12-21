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

export interface DayToDayAnalysisResponse {
  today: TodaySummary;
  week: WeekSummary;
  month: MonthSummary;
  categorias_mes: CategoryMonth[];
  category_kpis: Record<string, CategoryKpi>;
  proveedores_por_categoria: Record<string, ProviderItem[]>;
  ultimos_7_dias: Last7DayItem[];
  alertas: string[];
}

export interface DayToDayAnalysisRequest {
  fecha?: string;
  pago?: 'YO' | 'OTRO' | 'TODOS';
  categoria?: string;
  tipoId?: string;
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
