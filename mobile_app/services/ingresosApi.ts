// services/ingresosApi.ts
import axios from 'axios';
import { api } from './api';
import { parseImporte } from '../utils/format';

import {
  Proveedor,
  Cuenta,
  Vivienda,
  TipoIngreso,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
  fetchTiposIngreso,
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

/**
 * ========================
 * ✅ NUEVO: Omisión mensual (Ingresos)
 * ========================
 *
 * Ajusta estas rutas a tu backend real.
 *
 * Recomendación (consistente con patrón REST de "acción"):
 *  - PUT /api/v1/ingresos/:id/omitir
 *  - PUT /api/v1/ingresos/:id/deshacer_omision
 *
 * Si tu backend usa POST en lugar de PUT, cambia el método en las funciones.
 */
const endpointOmitirIngreso = (id: string) => `${ENDPOINT_INGRESOS_BASE}/${id}/omitir`;
const endpointDeshacerOmisionIngreso = (id: string) =>
  `${ENDPOINT_INGRESOS_BASE}/${id}/deshacer_omision`;

// ========================
// Tipos de dominio
// ========================

export interface Ingreso {
  id: string;
  fecha_inicio: string | null;
  rango_cobro: string | null;
  periodicidad: string | null;
  tipo_id: string | null;
  tipo_nombre?: string | null; // 👈 AÑADIDO
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

  /**
   * ✅ NUEVO: omisión mensual (igual idea que gastos)
   * - true  => omitido este mes (no debería aparecer en pendientes, según backend)
   * - false => normal
   */
  omitido_este_mes?: boolean | null;
}

export interface IngresoCreatePayload {
  fecha_inicio: string; // "2025-12-01"
  rango_cobro: string; // "1-3", "10-15", etc.
  periodicidad: string; // "MENSUAL", "PAGO UNICO", ...
  tipo_id: string;
  referencia_vivienda_id?: string | null;
  concepto: string;
  importe: string | number;
  cuenta_id?: string | null;
  id?: string; // opcional, normalmente lo genera el backend

  // estado opcional (para duplicado)
  activo?: boolean;
  cobrado?: boolean;
  kpi?: boolean;

  // timestamps opcionales
  createon?: string;
  modifiedon?: string;
  inactivatedon?: string;
  ultimo_ingreso_on?: string;
}

export interface IngresoUpdatePayload {
  fecha_inicio?: string;
  rango_cobro?: string;
  periodicidad?: string;
  tipo_id?: string;
  referencia_vivienda_id?: string | null;
  concepto?: string;
  importe?: string | number;
  cuenta_id?: string | null;
  activo?: boolean;
  cobrado?: boolean;
  kpi?: boolean;

  /**
   * Opcional: si algún día quisieras permitir setear omisión desde el form.
   * Hoy NO lo usamos, pero es inocuo.
   */
  omitido_este_mes?: boolean;
}

// Resumen de KPI ingresos (objetivo vs cobrados)
export interface ResumenIngresos {
  objetivo: number;
  cobrados: number;
}

// ========================
// Helpers internos (defensivos)
// ========================

function logAxiosError(prefix: string, err: unknown) {
  if (axios.isAxiosError(err)) {
    console.error(prefix, err.response?.data || err.message);
  } else {
    console.error(prefix, err);
  }
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

/**
 * En la UI, este será tu "TODOS": ingresos activos
 * (cobrados o no, pero activos = true).
 */
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

/**
 * Helper genérico por filtro, por si quieres unificar en el ListScreen.
 */
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
  month?: number; // 1..12
  year?: number; // 4 dígitos
  q?: string; // búsqueda por concepto
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
    const rawImporte = typeof payload.importe === 'number' ? String(payload.importe) : payload.importe;

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

/**
 * Elimina un ingreso (en backend revertirá liquidez si es PAGO UNICO).
 */
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

/**
 * ========================
 * ✅ NUEVO: Omisión mensual
 * ========================
 *
 * Nota UX:
 * - Omitir NO es "cobrar", ni es "desactivar".
 * - Es una exclusión mensual (idealmente backend la aplica al listar pendientes).
 */
export async function omitirIngresoEsteMes(id: string): Promise<Ingreso> {
  const url = endpointOmitirIngreso(id);
  console.log('[ingresosApi] PUT omitir ingreso este mes ->', url);

  try {
    // Si tu backend usa POST en vez de PUT, cambia a: api.post<Ingreso>(url)
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
    // Si tu backend usa POST en vez de PUT, cambia a: api.post<Ingreso>(url)
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
// Reexport de catálogos para formularios
// ========================

export {
  Proveedor,
  Cuenta,
  Vivienda,
  TipoIngreso,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
  fetchTiposIngreso,
};
