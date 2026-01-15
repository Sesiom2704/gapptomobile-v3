// mobile_app/services/cierreCore.ts
import { api } from './api';

// Tipos mínimos reutilizables
export type CierreMensual = {
  id: string;
  anio: number;
  mes: number;
  fecha_cierre: string;
  user_id?: number | null;
  criterio: string;
  version: number;
  liquidez_total: number;

  ingresos_esperados: number;
  ingresos_reales: number;

  gastos_esperados_total: number;
  gastos_reales_total: number;

  resultado_esperado: number;
  resultado_real: number;
  desv_resultado: number;

  desv_ingresos?: number;
  gastos_gestionables_esperados?: number;
  gastos_gestionables_reales?: number;
  gastos_cotidianos_esperados?: number;
  gastos_cotidianos_reales?: number;
  desv_gestionables?: number;
  desv_cotidianos?: number;
  desv_gastos_total?: number;

  n_recurrentes_ing?: number;
  n_recurrentes_gas?: number;
  n_unicos_ing?: number;
  n_unicos_gas?: number;
  n_cotidianos?: number;
};

export type CierrePreview = {
  anio: number;
  mes: number;
  as_of: string;
  ingresos_reales: number;
  gastos_reales_total: number;
  resultado_real: number;

  ingresos_esperados?: number | null;
  gastos_esperados_total?: number | null;
  resultado_esperado?: number | null;

  desv_resultado?: number | null;
  desv_ingresos?: number | null;
  desv_gastos_total?: number | null;

  extras?: Record<string, any>;
};

const REINICIO_BASE = '/api/v1/reinicio';

// Llamadas “core” para evitar ciclos entre services
export async function fetchCierrePreview(opts?: { anio?: number; mes?: number }): Promise<CierrePreview> {
  const params: any = {};
  if (opts?.anio != null) params.anio = opts.anio;
  if (opts?.mes != null) params.mes = opts.mes;

  const res = await api.get<CierrePreview>(`${REINICIO_BASE}/cierre/preview`, { params });
  return res.data;
}

export async function generarCierreMensual(opts?: {
  force?: boolean;
  userId?: number;
  version?: number;
}): Promise<CierreMensual> {
  const params: any = { force: !!opts?.force };
  if (opts?.userId != null) params.user_id = opts.userId;
  if (opts?.version != null) params.version = opts.version;

  const res = await api.get<CierreMensual>('/api/v1/cierre_mensual/generar', { params });
  return res.data;
}
