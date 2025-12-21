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

import { api } from './api';

// =======================
// Tipos (DTOs)
// =======================

export type TipoInmueble = 'VIVIENDA' | 'LOCAL' | 'GARAJE' | 'TRASTERO' | string;

export type PatrimonioRow = {
  id: string;

// --- Dirección (v3 backend sí los devuelve) ---
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
  // Nota: el backend genera el ID siempre.
  calle?: string | null;
  numero?: string | null;
  escalera?: string | null;
  piso?: string | null;
  puerta?: string | null;
  localidad?: string | null;
  referencia?: string | null;

  tipo_inmueble?: TipoInmueble | null;
  fecha_adquisicion?: string | null; // "YYYY-MM-DD"

  // Flags
  disponible?: boolean | null;

  // Datos vivienda
  superficie_m2?: number | null;
  superficie_construida?: number | null;
  participacion_pct?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  garaje?: boolean | null;
  trastero?: boolean | null;
};

export type PatrimonioUpdate = {
  // Todos opcionales: se actualiza solo lo enviado.
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

  // Si finalmente expones "fecha_compra" desde la BD/view:
  fecha_compra?: string | null; // "YYYY-MM-DD"
};

export type PatrimonioCompraOut = PatrimonioCompraIn & {
  patrimonio_id: string;
  impuestos_eur?: number | null;
  total_inversion?: number | null;

  // Campos existentes en tu modelo v2/v3 (si están en respuesta)
  valor_mercado?: number | null;
  valor_mercado_fecha?: string | null; // "YYYY-MM-DD"

  created_at?: string | null; // ISO datetime
  updated_at?: string | null; // ISO datetime

  // compat opcional si algún día lo reintroduces
  activo?: boolean | null;
};

// =======================
// Helpers internos
// =======================

const BASE = '/api/v1/patrimonios';

// Algunas BDs antiguas pueden no tener disponible => tratamos undefined como true en UI
function normalizePatrimonioRow(r: PatrimonioRow): PatrimonioRow {
  return {
    ...r,
    disponible: r.disponible === undefined || r.disponible === null ? true : r.disponible,
    activo: r.activo === undefined || r.activo === null ? true : r.activo,
  };
}

// =======================
// API: Patrimonio
// =======================

/**
 * Listado de patrimonios (del usuario autenticado) con filtros opcionales.
 *
 * - activos: true/false
 * - disponibles: true/false (si existe columna en BD)
 * - ordenar: 'asc' | 'desc' por fecha_adquisicion
 */
export async function listPatrimonios(params?: {
  activos?: boolean;
  disponibles?: boolean;
  ordenar?: 'asc' | 'desc';
}): Promise<PatrimonioRow[]> {
  const res = await api.get<PatrimonioRow[]>(BASE, { params });
  const data = Array.isArray(res.data) ? res.data : [];
  return data.map(normalizePatrimonioRow);
}

/**
 * Detalle de un patrimonio por id.
 */
export async function getPatrimonio(patrimonioId: string): Promise<PatrimonioRow> {
  const res = await api.get<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}`);
  return normalizePatrimonioRow(res.data);
}

/**
 * Crear patrimonio (ID generado en backend).
 */
export async function createPatrimonio(payload: PatrimonioCreate): Promise<PatrimonioRow> {
  const res = await api.post<PatrimonioRow>(BASE, payload);
  return normalizePatrimonioRow(res.data);
}

/**
 * Actualizar patrimonio.
 */
export async function updatePatrimonio(patrimonioId: string, payload: PatrimonioUpdate): Promise<PatrimonioRow> {
  const res = await api.put<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}`, payload);
  return normalizePatrimonioRow(res.data);
}

/**
 * Activar/Inactivar patrimonio.
 */
export async function setPatrimonioActivo(patrimonioId: string, activo: boolean): Promise<PatrimonioRow> {
  const endpoint = activo ? 'activar' : 'inactivar';
  const res = await api.patch<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}/${endpoint}`);
  return normalizePatrimonioRow(res.data);
}

/**
 * Marcar disponible / no disponible.
 */
export async function setPatrimonioDisponible(patrimonioId: string, disponible: boolean): Promise<PatrimonioRow> {
  const endpoint = disponible ? 'disponible' : 'no_disponible';
  const res = await api.patch<PatrimonioRow>(`${BASE}/${encodeURIComponent(patrimonioId)}/${endpoint}`);
  return normalizePatrimonioRow(res.data);
}

// =======================
// API: Compra (Adquisición)
// =======================

/**
 * Obtener datos de compra (puede devolver null si no existe registro).
 */
export async function getPatrimonioCompra(patrimonioId: string): Promise<PatrimonioCompraOut | null> {
  const res = await api.get<PatrimonioCompraOut | null>(`${BASE}/${encodeURIComponent(patrimonioId)}/compra`);
  return res.data ?? null;
}

/**
 * Upsert de compra (PUT recomendado).
 */
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

// =======================
// Export agrupado (opcional)
// =======================

/**
 * Export default estilo "service object" por comodidad.
 * Si prefieres imports nombrados, puedes borrar este bloque.
 */
const patrimonioApi = {
  listPatrimonios,
  getPatrimonio,
  createPatrimonio,
  updatePatrimonio,
  setPatrimonioActivo,
  setPatrimonioDisponible,
  getPatrimonioCompra,
  upsertPatrimonioCompra,
  httpGet
};

export default patrimonioApi;
