// mobile_app/services/inversionesApi.ts
//
// Servicio API para el módulo Inversiones en GapptoMobile v3.
//
// Endpoints backend:
//   /api/v1/inversiones
//   /api/v1/inversiones/{id}
//   /api/v1/inversiones/{id}/kpis
//   /api/v1/inversiones/{id}/metricas
//
// Requiere axios instance en: mobile_app/services/api.ts

import { api } from './api';

// -----------------------
// Tipos
// -----------------------

export type MiniEntity = {
  id: string;
  nombre: string;
};

export type TipoGastoMini = {
  id: string;
  nombre: string;
  rama_id?: string | null;
  segmento_id?: string | null;
};

export type InversionEstado = 'ACTIVA' | 'CERRADA' | 'DESCARTADA' | string;

export type InversionRow = {
  id: string;
  user_id: number;

  tipo_gasto_id: string;
  proveedor_id?: string | null;
  dealer_id?: string | null;

  nombre: string;
  descripcion?: string | null;

  estado?: InversionEstado | null;
  fase?: string | null;

  fecha_creacion?: string | null; // YYYY-MM-DD
  fecha_inicio?: string | null;
  fecha_objetivo_salida?: string | null;
  fecha_cierre_real?: string | null;

  moneda?: string | null;

  aporte_estimado?: number | null;
  aporte_final?: number | null;
  retorno_esperado_total?: number | null;
  retorno_final_total?: number | null;

  roi_esperado_pct?: number | null;
  moic_esperado?: number | null;
  irr_esperada_pct?: number | null;
  plazo_esperado_meses?: number | null;

  roi_final_pct?: number | null;
  moic_final?: number | null;
  irr_final_pct?: number | null;
  plazo_final_meses?: number | null;

  notas?: string | null;

  tipo_gasto?: TipoGastoMini | null;
  proveedor?: MiniEntity | null;
  dealer?: MiniEntity | null;

  created_at?: string | null;
  updated_at?: string | null;
};

export type InversionCreate = Omit<InversionRow, 'id' | 'user_id' | 'tipo_gasto' | 'proveedor' | 'dealer' | 'created_at' | 'updated_at'>;
export type InversionUpdate = Partial<InversionCreate>;

export type InversionMetricaIn = {
  escenario?: string | null;
  clave: string;
  valor_num?: number | null;
  valor_texto?: string | null;
  unidad?: string | null;
  origen?: string | null;
};

export type InversionMetricaOut = InversionMetricaIn & {
  id: number;
  inversion_id: string;
  created_at?: string | null;
};

export type KpiBlock = {
  aporte?: number | null;
  retorno_total?: number | null;
  plazo_meses?: number | null;

  roi_pct?: number | null;
  moic?: number | null;
  irr_pct_aprox?: number | null;

  puede_calcular_moic: boolean;
  puede_calcular_roi: boolean;
  puede_calcular_irr: boolean;
};

export type InversionKpisOut = {
  inversion_id: string;
  esperado: KpiBlock;
  final: KpiBlock;
};

// -----------------------
// Constantes
// -----------------------

const BASE = '/api/v1/inversiones';

// -----------------------
// API
// -----------------------

export async function listInversiones(params?: {
  estado?: string;
  tipo_gasto_id?: string;
  proveedor_id?: string;
  dealer_id?: string;
}): Promise<InversionRow[]> {
  const res = await api.get<InversionRow[]>(BASE, { params });
  return Array.isArray(res.data) ? res.data : [];
}

export async function getInversion(inversionId: string): Promise<InversionRow> {
  const res = await api.get<InversionRow>(`${BASE}/${encodeURIComponent(inversionId)}`);
  return res.data;
}

export async function createInversion(payload: InversionCreate): Promise<InversionRow> {
  const res = await api.post<InversionRow>(BASE, payload);
  return res.data;
}

export async function updateInversion(inversionId: string, payload: InversionUpdate): Promise<InversionRow> {
  const res = await api.put<InversionRow>(`${BASE}/${encodeURIComponent(inversionId)}`, payload);
  return res.data;
}

export async function deleteInversion(inversionId: string): Promise<void> {
  await api.delete(`${BASE}/${encodeURIComponent(inversionId)}`);
}

export async function getInversionKpis(inversionId: string): Promise<InversionKpisOut> {
  const res = await api.get<InversionKpisOut>(`${BASE}/${encodeURIComponent(inversionId)}/kpis`);
  return res.data;
}

export async function listInversionMetricas(inversionId: string): Promise<InversionMetricaOut[]> {
  const res = await api.get<InversionMetricaOut[]>(`${BASE}/${encodeURIComponent(inversionId)}/metricas`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function createInversionMetrica(inversionId: string, payload: InversionMetricaIn): Promise<InversionMetricaOut> {
  const res = await api.post<InversionMetricaOut>(`${BASE}/${encodeURIComponent(inversionId)}/metricas`, payload);
  return res.data;
}

export async function deleteInversionMetrica(inversionId: string, metricaId: number): Promise<void> {
  await api.delete(`${BASE}/${encodeURIComponent(inversionId)}/metricas/${metricaId}`);
}

const inversionesApi = {
  listInversiones,
  getInversion,
  createInversion,
  updateInversion,
  deleteInversion,
  getInversionKpis,
  listInversionMetricas,
  createInversionMetrica,
  deleteInversionMetrica,
};

export default inversionesApi;
