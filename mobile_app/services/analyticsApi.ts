// mobile_app/types/analytics.ts

export type PagoFiltro = 'TODOS' | 'YO' | 'OTRO';

export type DayToDayAnalysisRequest = {
  fecha?: string;                 // YYYY-MM-DD
  pago?: PagoFiltro;
  categoria?: string;
  tipoId?: string;

  // ✅ NUEVO: ventana para serie mensual (backend: months_back)
  monthsBack?: number;            // 2..36 (según backend)
};

export type TodaySummary = {
  fecha_label: string;
  total_hoy: number;
  num_movimientos: number;
  ticket_medio: number;
  diff_vs_ayer: string;
  tendencia: string;
};

export type WeekSummary = {
  total_semana: number;
  limite_semana: number;
  proyeccion_fin_semana: number;
  dias_restantes: number;
};

export type MonthSummary = {
  presupuesto_mes: number;
  gastado_mes: number;
};

export type CategoryMonth = {
  key: string;
  label: string;
  importe: number;
  porcentaje: number;
};

export type CategoryKpi = {
  tickets: number;
  ticket_medio: number;
  variacion_importe_pct: number;
  variacion_tickets_pct: number;
  peso_sobre_total_gasto: number;
};

export type ProviderItem = {
  nombre: string;
  importe: number;
  num_compras: number;
  tendencia: 'UP' | 'DOWN' | 'FLAT';
};

export type Last7DayItem = {
  label: string;
  fecha?: string;
  importe: number;
};

// ------------------------------------------------------------------
// ✅ NUEVO: Series para gráficas + KPIs de evolución (backend nuevo)
// ------------------------------------------------------------------
export type DailySeriesItem = {
  fecha: string;   // YYYY-MM-DD
  dia: number;     // 1..31
  importe: number;
};

export type MonthlySeriesItem = {
  year: number;
  month: number;   // 1..12
  label: string;   // "YYYY-MM"
  importe: number;
  tickets: number;
};

export type EvolutionKpis = {
  variacion_mes_pct: number;
  variacion_mes_abs: number;

  media_3m: number;
  media_6m: number;
  media_12m: number;

  tendencia: 'UP' | 'DOWN' | 'FLAT';
  tendencia_detalle: string;

  max_mes_label?: string | null;
  max_mes_importe?: number | null;
  min_mes_label?: string | null;
  min_mes_importe?: number | null;
};

// ------------------------------------------------------------------
// Response principal
// ------------------------------------------------------------------
export type DayToDayAnalysisResponse = {
  today: TodaySummary;
  week: WeekSummary;
  month: MonthSummary;
  categorias_mes: CategoryMonth[];
  category_kpis: Record<string, CategoryKpi>;
  proveedores_por_categoria: Record<string, ProviderItem[]>;
  ultimos_7_dias: Last7DayItem[];
  alertas: string[];

  // ✅ NUEVO (opcionales para no romper)
  serie_diaria_mes?: DailySeriesItem[];
  serie_mensual?: MonthlySeriesItem[];
  kpis_evolucion?: EvolutionKpis;
};

// Si tienes MonthlySummaryResponse en este mismo fichero, lo dejas tal cual.
export type MonthlySummaryResponse = any;
