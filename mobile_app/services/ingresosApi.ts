// services/ingresosApi.ts
//
// Objetivo:
// - Mantener toda la funcionalidad actual de ingresos.
// - Añadir soporte sólido para flujo RAMA -> TIPO.
// - Mejorar UX: cachear tipos por rama para que, cuando el usuario pulse una rama,
//   los tipos aparezcan de forma inmediata si ya están precargados.
// - Mantener compatibilidad legacy con pantallas que siguen importando:
//     * fetchTiposIngreso
//     * TipoIngreso
//
// Notas:
// - Se conserva fetchTiposIngreso() como compatibilidad legacy.
// - Se añade caché en memoria por rama.
// - Se añaden helpers para precargar tipos por múltiples ramas.
//

import axios from 'axios';
import { api } from './api';
import { parseImporte } from '../utils/format';

import {
  Proveedor,
  Cuenta,
  Vivienda,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
} from './utilsApi';

// ========================
// Endpoints backend
// ========================
const ENDPOINT_INGRESOS_PENDIENTES = '/api/v1/ingresos/pendientes';
const ENDPOINT_INGRESOS_ACTIVOS = '/api/v1/ingresos/activos';
const ENDPOINT_INGRESOS_INACTIVOS = '/api/v1/ingresos/inactivos';
const ENDPOINT_INGRESOS_EXTRA = '/api/v1/ingresos/extra';
const ENDPOINT_INGRESOS_BASE = '/api/v1/ingresos';
const ENDPOINT_INGRESOS_RESUMEN = '/api/v1/ingresos/resumen_totales';

// Catálogos rama -> tipos
const ENDPOINT_RAMAS_INGRESO = '/api/v1/ingresos/ramas';
const endpointTiposIngresoPorRama = (ramaId: string) =>
  `/api/v1/ingresos/tipos-por-rama/${encodeURIComponent(ramaId)}`;

// Omisión mensual
const endpointOmitirIngreso = (id: string) => `${ENDPOINT_INGRESOS_BASE}/${id}/omitir`;
const endpointDeshacerOmisionIngreso = (id: string) =>
  `${ENDPOINT_INGRESOS_BASE}/${id}/deshacer-omision`;

// ========================
// Tipos de dominio
// ========================

export interface RamaIngreso {
  id: string;
  nombre: string;
}

export interface TipoIngreso {
  id: string;
  nombre: string;
  rama_id: string | null;
}

export interface TipoIngresoPorRama {
  id: string;
  nombre: string;
  rama_id: string | null;
}

export interface Ingreso {
  id: string;
  fecha_inicio: string | null;
  rango_cobro: string | null;
  periodicidad: string | null;

  rama_id: string | null;
  rama_nombre?: string | null;

  tipo_id: string | null;
  tipo_nombre?: string | null;

  referencia_vivienda_id?: string | null;
  concepto: string | null;
  importe: number;
  activo: boolean;
  cobrado: boolean;
  kpi: boolean;
  ingresos_cobrados: number;
  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;
  ultimo_ingreso_on?: string | null;
  cuenta_id?: string | null;
  cuenta_nombre?: string | null;

  omitido_este_mes?: boolean | null;
  contrato_alquiler?: string | null;
}

export interface IngresoCreatePayload {
  fecha_inicio: string;
  rango_cobro: string;
  periodicidad: string;
  rama_id: string;
  tipo_id: string;
  referencia_vivienda_id?: string | null;
  concepto: string;
  importe: string | number;
  cuenta_id?: string | null;
  id?: string;

  activo?: boolean;
  cobrado?: boolean;
  kpi?: boolean;

  createon?: string;
  modifiedon?: string;
  inactivatedon?: string;
  ultimo_ingreso_on?: string;
}

export interface IngresoUpdatePayload {
  fecha_inicio?: string;
  rango_cobro?: string;
  periodicidad?: string;
  rama_id?: string;
  tipo_id?: string;
  referencia_vivienda_id?: string | null;
  concepto?: string;
  importe?: string | number;
  cuenta_id?: string | null;
  activo?: boolean;
  cobrado?: boolean;
  kpi?: boolean;
  omitido_este_mes?: boolean;
}

export interface ResumenIngresos {
  objetivo: number;
  cobrados: number;
}

// ========================
// Caché en memoria rama -> tipos
// ========================

const tiposIngresoPorRamaCache = new Map<string, TipoIngresoPorRama[]>();

function normKey(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

export function clearTiposIngresoPorRamaCache(): void {
  tiposIngresoPorRamaCache.clear();
}

export function getTiposIngresoPorRamaCache(ramaId: string): TipoIngresoPorRama[] | null {
  const key = normKey(ramaId);
  return tiposIngresoPorRamaCache.get(key) ?? null;
}

function setTiposIngresoPorRamaCache(ramaId: string, tipos: TipoIngresoPorRama[]): void {
  const key = normKey(ramaId);
  tiposIngresoPorRamaCache.set(key, tipos);
}

// ========================
// Helpers internos
// ========================

function logAxiosError(prefix: string, err: unknown) {
  if (axios.isAxiosError(err)) {
    console.error(prefix, err.response?.data || err.message);
  } else {
    console.error(prefix, err);
  }
}

// ========================
// Catálogos para formulario
// ========================

export async function fetchRamasIngreso(): Promise<RamaIngreso[]> {
  const url = ENDPOINT_RAMAS_INGRESO;
  console.log('[ingresosApi] GET ramas ingreso ->', url);
  try {
    const resp = await api.get<RamaIngreso[]>(url);
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando ramas de ingreso', err);
    throw err;
  }
}

/**
 * Devuelve tipos por rama.
 *
 * Comportamiento:
 * - Por defecto intenta usar caché.
 * - Si forceRefresh=true, consulta backend y actualiza caché.
 */
export async function fetchTiposIngresoPorRama(
  ramaId: string,
  options?: { forceRefresh?: boolean }
): Promise<TipoIngresoPorRama[]> {
  const key = normKey(ramaId);
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh) {
    const cached = tiposIngresoPorRamaCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const url = endpointTiposIngresoPorRama(ramaId);
  console.log('[ingresosApi] GET tipos ingreso por rama ->', url);

  try {
    const resp = await api.get<TipoIngresoPorRama[]>(url);
    const data = resp.data ?? [];
    setTiposIngresoPorRamaCache(key, data);
    return data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando tipos de ingreso por rama', err);
    throw err;
  }
}

/**
 * Precarga silenciosa de tipos por varias ramas.
 * Útil para que el cambio de rama en el formulario sea inmediato.
 */
export async function preloadTiposIngresoPorRamas(ramaIds: string[]): Promise<void> {
  const uniqueIds = Array.from(
    new Set(
      (ramaIds ?? [])
        .map((x) => normKey(x))
        .filter((x) => x.length > 0)
    )
  );

  if (uniqueIds.length === 0) return;

  await Promise.all(
    uniqueIds.map(async (ramaId) => {
      try {
        await fetchTiposIngresoPorRama(ramaId);
      } catch (err) {
        console.warn('[ingresosApi] preloadTiposIngresoPorRamas fallo en rama=', ramaId, err);
      }
    })
  );
}

/**
 * Compatibilidad legacy:
 * - Devuelve el catálogo completo de tipos de ingreso agregando todas las ramas.
 * - Se usa en listados antiguos que siguen importando fetchTiposIngreso.
 */
export async function fetchTiposIngreso(): Promise<TipoIngreso[]> {
  const ramas = await fetchRamasIngreso();
  if (!ramas.length) return [];

  await preloadTiposIngresoPorRamas(ramas.map((r) => r.id));

  const merged = new Map<string, TipoIngreso>();

  for (const rama of ramas) {
    const tipos = getTiposIngresoPorRamaCache(rama.id) ?? [];
    for (const t of tipos) {
      merged.set(String(t.id), {
        id: String(t.id),
        nombre: String(t.nombre),
        rama_id: t.rama_id != null ? String(t.rama_id) : null,
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ========================
// Listados
// ========================

export async function fetchIngresosPendientes(): Promise<Ingreso[]> {
  const url = ENDPOINT_INGRESOS_PENDIENTES;
  console.log('[ingresosApi] GET pendientes ->', url);
  try {
    const resp = await api.get<Ingreso[]>(url);
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando pendientes', err);
    throw err;
  }
}

export async function fetchIngresosActivos(): Promise<Ingreso[]> {
  const url = ENDPOINT_INGRESOS_ACTIVOS;
  console.log('[ingresosApi] GET activos ->', url);
  try {
    const resp = await api.get<Ingreso[]>(url);
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando activos', err);
    throw err;
  }
}

export async function fetchIngresosInactivos(): Promise<Ingreso[]> {
  const url = ENDPOINT_INGRESOS_INACTIVOS;
  console.log('[ingresosApi] GET inactivos ->', url);
  try {
    const resp = await api.get<Ingreso[]>(url);
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando inactivos', err);
    throw err;
  }
}

export type FiltroIngresos = 'pendientes' | 'activos' | 'inactivos';

export async function fetchIngresosPorFiltro(filtro: FiltroIngresos): Promise<Ingreso[]> {
  switch (filtro) {
    case 'pendientes':
      return fetchIngresosPendientes();
    case 'activos':
      return fetchIngresosActivos();
    case 'inactivos':
      return fetchIngresosInactivos();
    default:
      return fetchIngresosActivos();
  }
}

// ========================
// Extraordinarios (PAGO UNICO)
// ========================

export interface FiltroIngresosExtra {
  month?: number;
  year?: number;
  q?: string;
}

export async function fetchIngresosExtra(filtro: FiltroIngresosExtra = {}): Promise<Ingreso[]> {
  const params: Record<string, string | number> = {};
  if (filtro.month != null) params.month = filtro.month;
  if (filtro.year != null) params.year = filtro.year;
  if (filtro.q && filtro.q.trim() !== '') params.q = filtro.q.trim();

  console.log('[ingresosApi] GET extra ->', ENDPOINT_INGRESOS_EXTRA, params);
  try {
    const resp = await api.get<Ingreso[]>(ENDPOINT_INGRESOS_EXTRA, { params });
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando ingresos extra', err);
    throw err;
  }
}

// ========================
// CRUD
// ========================

export async function fetchIngresoById(id: string): Promise<Ingreso> {
  const url = `${ENDPOINT_INGRESOS_BASE}/${id}`;
  console.log('[ingresosApi] GET ingreso ->', url);
  try {
    const resp = await api.get<Ingreso>(url);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando ingreso', err);
    throw err;
  }
}

export async function createIngreso(payload: IngresoCreatePayload): Promise<Ingreso> {
  const url = ENDPOINT_INGRESOS_BASE;
  console.log('[ingresosApi] POST crear ingreso ->', url, payload);
  try {
    const rawImporte =
      typeof payload.importe === 'number' ? String(payload.importe) : payload.importe;

    const body = {
      ...payload,
      importe: parseImporte(rawImporte),
    };

    const resp = await api.post<Ingreso>(url, body);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error creando ingreso', err);
    throw err;
  }
}

export async function updateIngreso(id: string, payload: IngresoUpdatePayload): Promise<Ingreso> {
  const url = `${ENDPOINT_INGRESOS_BASE}/${id}`;
  console.log('[ingresosApi] PATCH actualizar ingreso ->', url, payload);
  try {
    const body: any = { ...payload };

    if (payload.importe !== undefined) {
      const rawImporte =
        typeof payload.importe === 'number' ? String(payload.importe) : payload.importe;
      body.importe = parseImporte(rawImporte);
    }

    const resp = await api.patch<Ingreso>(url, body);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error actualizando ingreso', err);
    throw err;
  }
}

export async function eliminarIngreso(id: string): Promise<void> {
  const url = `${ENDPOINT_INGRESOS_BASE}/${id}`;
  console.log('[ingresosApi] DELETE ingreso ->', url);
  try {
    await api.delete(url);
  } catch (err) {
    logAxiosError('[ingresosApi] Error eliminando ingreso', err);
    throw err;
  }
}

// ========================
// Acciones
// ========================

export async function marcarIngresoComoCobrado(id: string): Promise<Ingreso> {
  const url = `${ENDPOINT_INGRESOS_BASE}/${id}/cobrar`;
  console.log('[ingresosApi] PUT cobrar ingreso ->', url);
  try {
    const resp = await api.put<Ingreso>(url);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error marcando como cobrado', err);
    throw err;
  }
}

export async function omitirIngresoEsteMes(id: string): Promise<Ingreso> {
  const url = endpointOmitirIngreso(id);
  console.log('[ingresosApi] PUT omitir ingreso este mes ->', url);
  try {
    const resp = await api.put<Ingreso>(url);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error omitiendo ingreso este mes', err);
    throw err;
  }
}

export async function deshacerOmisionIngresoEsteMes(id: string): Promise<Ingreso> {
  const url = endpointDeshacerOmisionIngreso(id);
  console.log('[ingresosApi] PUT deshacer omisión ingreso este mes ->', url);
  try {
    const resp = await api.put<Ingreso>(url);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error deshaciendo omisión ingreso este mes', err);
    throw err;
  }
}

// ========================
// Resumen KPI ingresos
// ========================

export async function fetchResumenIngresos(): Promise<ResumenIngresos> {
  const url = ENDPOINT_INGRESOS_RESUMEN;
  console.log('[ingresosApi] GET resumen_totales ->', url);
  try {
    const resp = await api.get<ResumenIngresos>(url);
    return resp.data;
  } catch (err) {
    logAxiosError('[ingresosApi] Error cargando resumen ingresos', err);
    throw err;
  }
}

// ========================
// Reexport de catálogos legacy
// ========================

export {
  Proveedor,
  Cuenta,
  Vivienda,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
};