// mobile_app/services/patrimonioApi.ts
//
// Servicio API para el módulo Patrimonio (Propiedades) en GapptoMobile v3.
//
// Importante:
// - En v3 NO usamos /picker en el front.
// - Todas las llamadas van contra /api/v1 (según tu main: prefix="/api/v1").
// - Este servicio asume que ya tienes configurado el axios instance en:
//     mobile_app/services/api.ts
//   con baseURL y auth headers (token) resueltos.
//
// Si tu instancia se llama distinto, ajusta el import de "api".

// mobile_app/services/patrimonioApi.ts

import { api } from './api';

export type TipoInmueble = 'VIVIENDA' | 'LOCAL' | 'GARAJE' | 'TRASTERO' | string;

export type PatrimonioRow = {
  id: string;

  calle?: string | null;
  numero?: string | null;
  escalera?: string | null;
  piso?: string | null;
  puerta?: string | null;
  localidad?: string | null;

  referencia?: string | null;
  direccion_completa?: string | null;

  tipo_inmueble?: TipoInmueble | null;
  fecha_adquisicion?: string | null; // "YYYY-MM-DD"
  activo?: boolean | null;
  disponible?: boolean | null;

  superficie_m2?: number | null;
  superficie_construida?: number | null;
  participacion_pct?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  garaje?: boolean | null;
  trastero?: boolean | null;
};

export type PatrimonioCreate = {
  calle?: string | null;
  numero?: string | null;
  escalera?: string | null;
  piso?: string | null;
  puerta?: string | null;
  localidad?: string | null;
  referencia?: string | null;

  tipo_inmueble?: TipoInmueble | null;
  fecha_adquisicion?: string | null; // "YYYY-MM-DD"

  disponible?: boolean | null;

  superficie_m2?: number | null;
  superficie_construida?: number | null;
  participacion_pct?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  garaje?: boolean | null;
  trastero?: boolean | null;
};

export type PatrimonioUpdate = {
  calle?: string | null;
  numero?: string | null;
  escalera?: string | null;
  piso?: string | null;
  puerta?: string | null;
  localidad?: string | null;
  referencia?: string | null;

  tipo_inmueble?: TipoInmueble | null;
  fecha_adquisicion?: string | null; // "YYYY-MM-DD"

  activo?: boolean | null;
  disponible?: boolean | null;

  superficie_m2?: number | null;
  superficie_construida?: number | null;
  participacion_pct?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  garaje?: boolean | null;
  trastero?: boolean | null;
};

// ---- Compra (Adquisición) ----

export type PatrimonioCompraIn = {
  valor_compra: number;
  valor_referencia?: number | null;
  impuestos_pct?: number | null;
  notaria?: number | null;
  agencia?: number | null;
  reforma_adecuamiento?: number | null;
  notas?: string | null;

  // compat si existe
  fecha_compra?: string | null; // "YYYY-MM-DD"

  // ✅ NUEVO (editable en UI)
  valor_mercado?: number | null;

  // ✅ NUEVO (se setea automáticamente al cambiar valor_mercado; preferible que el backend lo fuerce)
  valor_mercado_fecha?: string | null; // "YYYY-MM-DD"
};

export type PatrimonioCompraOut = PatrimonioCompraIn & {
  patrimonio_id: string;
  impuestos_eur?: number | null;
  total_inversion?: number | null;

  created_at?: string | null;
  updated_at?: string | null;

  activo?: boolean | null;
};

const BASE = '/api/v1/patrimonios';

function normalizePatrimonioRow(r: PatrimonioRow): PatrimonioRow {
  return {
    ...r,
    disponible: r.disponible === undefined || r.disponible === null ? true : r.disponible,
    activo: r.activo === undefined || r.activo === null ? true : r.activo,
  };
}

export async function listPatrimonios(params?: {
  activos?: boolean;
  disponibles?: boolean;
  ordenar?: 'asc' | 'desc';
}): Promise<PatrimonioRow[]> {
  const res = await api.get<PatrimonioRow[]>(BASE, { params });
  const data = Array.isArray(res.data) ? res.data : [];
  return data.map(normalizePatrimonioRow);
}

export async function getPatrimonio(patrimonioId: string): Promise<PatrimonioRow> {
  const res = await api.get<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}`);
  return normalizePatrimonioRow(res.data);
}

export async function createPatrimonio(payload: PatrimonioCreate): Promise<PatrimonioRow> {
  const res = await api.post<PatrimonioRow>(BASE, payload);
  return normalizePatrimonioRow(res.data);
}

export async function updatePatrimonio(patrimonioId: string, payload: PatrimonioUpdate): Promise<PatrimonioRow> {
  const res = await api.put<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}`, payload);
  return normalizePatrimonioRow(res.data);
}

export async function setPatrimonioActivo(patrimonioId: string, activo: boolean): Promise<PatrimonioRow> {
  const endpoint = activo ? 'activar' : 'inactivar';
  const res = await api.patch<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}/${endpoint}`);
  return normalizePatrimonioRow(res.data);
}

export async function setPatrimonioDisponible(patrimonioId: string, disponible: boolean): Promise<PatrimonioRow> {
  const endpoint = disponible ? 'disponible' : 'no_disponible';
  const res = await api.patch<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}/${endpoint}`);
  return normalizePatrimonioRow(res.data);
}

export async function getPatrimonioCompra(patrimonioId: string): Promise<PatrimonioCompraOut | null> {
  const res = await api.get<PatrimonioCompraOut | null>(`${BASE}/${encodeURIComponent(patrimonioId)}/compra`);
  return res.data ?? null;
}

export async function upsertPatrimonioCompra(
  patrimonioId: string,
  payload: PatrimonioCompraIn
): Promise<PatrimonioCompraOut> {
  const res = await api.put<PatrimonioCompraOut>(`${BASE}/${encodeURIComponent(patrimonioId)}/compra`, payload);
  return res.data;
}

async function httpGet<T>(path: string): Promise<T> {
  const res = await api.get<T>(path);
  return res.data;
}

const patrimonioApi = {
  listPatrimonios,
  getPatrimonio,
  createPatrimonio,
  updatePatrimonio,
  setPatrimonioActivo,
  setPatrimonioDisponible,
  getPatrimonioCompra,
  upsertPatrimonioCompra,
  httpGet,
};

export default patrimonioApi;
