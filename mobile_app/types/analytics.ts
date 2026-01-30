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

/**
 * Mes en curso (cotidianos)
 *
 * - presupuesto_mes: presupuesto marcado (tabla gastos, importe_cuota)
 * - gastado_mes: semántico según filtro pago (YO/OTRO/TODOS)
 * - total_mes/pagado_mes/invitado_mes: split REAL del mes (independiente del filtro pago)
 *
 * ✅ Los campos split son opcionales para no romper si backend antiguo no los devuelve.
 */
export interface MonthSummary {
  presupuesto_mes: number;
  gastado_mes: number;

  // ✅ NUEVO: split real del mes
  total_mes?: number;
  pagado_mes?: number;
  invitado_mes?: number;
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

/**
 * Proveedor agregado.
 * ✅ `tipo_id` (opcional) permite desglosar por componentes dentro de un contenedor
 *    (p.ej. OCIO → Transporte/Hospedaje/Actividades).
 */
export interface ProviderItem {
  nombre: string;
  importe: number;
  num_compras: number;
  tendencia: Tendencia;

  // ✅ NUEVO (backend): opcional
  tipo_id?: string | null;
}

export interface Last7DayItem {
  label: string;
  fecha: string;
  importe: number;
}

/**
 * ✅ NUEVO (backend): insight estructurado (Opción B)
 */
export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface InsightItem {
  id: string;
  title: string;
  message: string;
  severity: InsightSeverity;
  meta?: Record<string, any> | null;
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
   * ✅ NUEVO (Opción B): insights estructurados
   * OJO: opcional para no romper si backend no está desplegado.
   */
  insights?: InsightItem[];

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

/**
 * ✅ Presupuestos base (sin extras)
 * ✅ Ampliado: originales + omitidos (para barras 3 estados Home)
 */
export interface MonthlyPresupuestos {
  // Legacy (ajustados - pueden excluir omitidos según backend)
  ingresos_presupuesto: number;
  gestionables_presupuesto: number;
  cotidianos_presupuesto: number;
  gasto_total_presupuesto: number;

  // ✅ NUEVO: presupuesto original (sin excluir omitidos)
  ingresos_presupuesto_original?: number | null;
  gestionables_presupuesto_original?: number | null;
  cotidianos_presupuesto_original?: number | null;
  gasto_total_presupuesto_original?: number | null;

  // ✅ NUEVO: omitidos del mes (si aplica)
  ingresos_omitidos_mes?: number | null;
  gestionables_omitidos_mes?: number | null;
  cotidianos_omitidos_mes?: number | null;
  gasto_total_omitido_mes?: number | null;
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

  /** ✅ viene del backend */
  presupuestos?: MonthlyPresupuestos;

  /** ✅ requerido en tu backend */
  consumidos_cotidianos: number;

  run_rate_12m: MonthlyRunRate | null;

  notas: MonthlyResumenNota[];
}
