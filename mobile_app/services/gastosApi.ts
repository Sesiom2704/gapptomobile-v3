// services/gastosApi.ts
//
// Objetivo: API de gastos (gestionables) para GapptoMobile v3.
// Cambios añadidos en esta versión:
// - Soporte completo del campo opcional `comentarios` (backend: gastos.comentarios).
// - Mantiene TODA la funcionalidad existente (endpoints, normalización de importes, flags, timestamps, etc.)
// - Estructurado y comentado para que sea fácil de mantener.
//
// Nota importante:
// - `comentarios` se envía como string o null.
// - Si no viene informado, se omite o se manda null (ambas son válidas si backend lo define Optional).

import axios from 'axios';
import { api } from './api';
import { parseImporte } from '../utils/format';

import {
  TipoGasto,
  Proveedor,
  Cuenta,
  Vivienda,
  fetchTiposGasto,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
} from './utilsApi';

// ========================
// Endpoints de backend
// ========================
const ENDPOINT_GASTOS_PENDIENTES = '/api/v1/gastos/pendientes';
const ENDPOINT_GASTOS_ACTIVOS = '/api/v1/gastos/activos';
const ENDPOINT_GASTOS_TODOS = '/api/v1/gastos/';

// ========================
// Tipos básicos
// ========================

export type FiltroGastos = 'pendientes' | 'activos' | 'todos';

export interface Gasto {
  id: string;
  nombre: string;
  fecha: string;
  periodicidad: string;
  tipo_id: string;
  segmento_id: string;
  proveedor_id: string;
  cuenta_id: string;
  referencia_vivienda_id?: string | null;
  rango_pago: string;
  cuotas: number;
  importe: number;
  importe_cuota: number;
  total: number;
  referencia_gasto?: string | null;
  tienda?: string | null;

  // NUEVO: comentarios (no obligatorio)
  comentarios?: string | null;

  // Estado lógico
  activo?: boolean;
  pagado?: boolean;
  kpi?: boolean;

  // Fechas de control
  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;
  ultimo_pago_on?: string | null;

  // Usuario
  user_id?: string | null;
  user_nombre?: string | null;

  // Relacionados opcionales (vienen ya resueltos desde backend)
  tipo_nombre?: string;
  proveedor_nombre?: string;
  cuenta_anagrama?: string;
  segmento_nombre?: string;

  [key: string]: any;
}

export interface CrearGastoGestionablePayload {
  nombre: string;
  segmentoId: string;
  tipoId: string;
  proveedorId: string;
  tienda?: string;
  numCuotas: number;
  importeCuota?: string;
  importeTotal: string;
  periodicidad: string;
  cuentaId: string;
  viviendaId?: string | null;
  fecha: string;
  rangoPago: string;
  referenciaGasto?: string;

  // NUEVO: comentarios (opcional)
  comentarios?: string;

  pagado?: boolean;
  activo?: boolean;
  kpi?: boolean;

  // (opcional si quieres que el backend pueda usarlos ahora o más adelante)
  cuotasPagadas?: number;
  prestamoId?: string;
  numCuota?: number;

  // timestamps opcionales (para duplicado PAGO UNICO)
  createOn?: string;
  modifiedOn?: string;
  inactivatedOn?: string;
  ultimoPagoOn?: string;
}

// ========================
// Utilidades internas
// ========================

function endpointPorFiltro(filtro: FiltroGastos): string {
  switch (filtro) {
    case 'pendientes':
      return ENDPOINT_GASTOS_PENDIENTES;
    case 'activos':
      return ENDPOINT_GASTOS_ACTIVOS;
    case 'todos':
    default:
      return ENDPOINT_GASTOS_TODOS;
  }
}

/**
 * Normaliza el payload del formulario (UI) al body real del backend.
 *
 * Reglas importantes (mantiene comportamiento actual):
 * - Convierte importes con parseImporte y asegura numbers válidos.
 * - Calcula `importe` y `total` en función de cuotas / cuota / total.
 * - Setea campos en nombres backend: segmento_id, tipo_id, proveedor_id, etc.
 * - Mantiene flags pagado/activo/kpi si vienen informados.
 * - Mantiene soporte de prestamo_id, cuotas_pagadas, num_cuota, timestamps.
 *
 * NUEVO:
 * - `comentarios` se envía como string o null. Si viene vacío, enviamos null.
 */
function normalizarPayloadGasto(payload: CrearGastoGestionablePayload) {
  // parseImporte devuelve number | null → lo normalizamos a number
  const importeTotalNum = parseImporte(payload.importeTotal);
  const importeCuotaNum = parseImporte(payload.importeCuota);

  // A partir de aquí, TODO son number, nunca null
  const safeTotal: number = importeTotalNum ?? 0;
  const safeCuota: number = importeCuotaNum ?? 0;

  const totalVal: number = isNaN(safeTotal) ? 0 : safeTotal;
  const cuotaVal: number = isNaN(safeCuota) ? 0 : safeCuota;

  const nCuotas: number = payload.numCuotas && payload.numCuotas > 0 ? payload.numCuotas : 1;

  let importe: number = 0;
  let total: number = 0;

  if (nCuotas <= 1) {
    // PAGO ÚNICO o recurrente sin financiación:
    // importe = total (o cuota si total no viene)
    const base = totalVal > 0 ? totalVal : cuotaVal;
    importe = base;
    total = base;
  } else {
    // Varias cuotas (financiación)
    if (cuotaVal > 0) {
      // El usuario ha fijado la cuota → cuota manda
      importe = cuotaVal;
      total = cuotaVal * nCuotas;
    } else {
      // No hay cuota, pero sí total → sacamos cuota desde total
      importe = nCuotas > 0 ? totalVal / nCuotas : totalVal;
      total = totalVal;
    }
  }

  // Normaliza comentarios: si llega vacío o solo espacios, mejor null
  const comentariosTrim = (payload.comentarios ?? '').trim();
  const comentariosValue: string | null = comentariosTrim.length > 0 ? comentariosTrim : null;

  const body: any = {
    // Texto principal
    nombre: payload.nombre.trim().toUpperCase(),

    // Fecha y periodicidad
    fecha: payload.fecha,
    periodicidad: payload.periodicidad,

    // IDs
    segmento_id: payload.segmentoId,
    tipo_id: payload.tipoId,
    proveedor_id: payload.proveedorId,
    cuenta_id: payload.cuentaId,

    // Campos opcionales
    tienda: payload.tienda ?? null,
    referencia_vivienda_id: payload.viviendaId ?? null,
    rango_pago: payload.rangoPago,
    referencia_gasto: payload.referenciaGasto ?? null,

    // Importes / cuotas
    cuotas: nCuotas,
    importe,
    total,
    importe_cuota: cuotaVal || importe,

    // NUEVO: comentarios
    comentarios: comentariosValue,
  };

  // Flags opcionales (si el formulario manda valores explícitos)
  if (typeof payload.pagado === 'boolean') body.pagado = payload.pagado;
  if (typeof payload.activo === 'boolean') body.activo = payload.activo;
  if (typeof payload.kpi === 'boolean') body.kpi = payload.kpi;

  // Edición / financiación / préstamo
  if (typeof payload.cuotasPagadas === 'number') body.cuotas_pagadas = payload.cuotasPagadas;
  if (typeof payload.numCuota === 'number') body.num_cuota = payload.numCuota;

  if (typeof payload.prestamoId === 'string' && payload.prestamoId.trim() !== '') {
    body.prestamo_id = payload.prestamoId.trim();
  }

  // Timestamps opcionales (si backend los soporta)
  if (typeof payload.createOn === 'string') body.createon = payload.createOn;
  if (typeof payload.modifiedOn === 'string') body.modifiedon = payload.modifiedOn;
  if (typeof payload.inactivatedOn === 'string') body.inactivatedon = payload.inactivatedOn;
  if (typeof payload.ultimoPagoOn === 'string') body.ultimo_pago_on = payload.ultimoPagoOn;

  return body;
}

// ========================
// GASTOS GESTIONABLES
// ========================

export async function fetchGastos(
  filtro: FiltroGastos = 'pendientes',
  params: Record<string, any> = {}
): Promise<Gasto[]> {
  const url = endpointPorFiltro(filtro);
  try {
    console.log('[gastosApi] GET gastos ->', url, 'params:', params);
    const res = await api.get<Gasto[]>(url, { params });
    return res.data ?? [];
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    console.error('Error cargando gastos', err, status, url);
    throw err;
  }
}

// ========================
// CRUD GASTO GESTIONABLE
// ========================

/**
 * Crea un gasto gestionable (no cotidiano).
 */
export async function crearGastoGestionable(payload: CrearGastoGestionablePayload): Promise<Gasto> {
  const body = normalizarPayloadGasto(payload);
  const url = '/api/v1/gastos/'; // importante la barra final

  console.log('[gastosApi] POST crear gasto ->', url, body);
  const res = await api.post<Gasto>(url, body);
  return res.data;
}

/**
 * Obtener gasto por ID (para edición / detalle).
 */
export async function obtenerGasto(id: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${id}`;
  console.log('[gastosApi] GET gasto ->', url);
  const res = await api.get<Gasto>(url);
  return res.data;
}

/**
 * Actualizar un gasto existente.
 */
export async function actualizarGasto(id: string, payload: CrearGastoGestionablePayload): Promise<Gasto> {
  const body = normalizarPayloadGasto(payload);
  const url = `/api/v1/gastos/${id}`;

  console.log('[gastosApi] PUT actualizar gasto ->', url, body);
  const res = await api.put<Gasto>(url, body);
  return res.data;
}

// ========================
// Acciones sobre gasto
// ========================

/**
 * Marca un gasto como pagado (endpoint backend ya aplica lógica de cuotas/liquidez).
 */
export async function marcarGastoComoPagado(gastoId: string): Promise<void> {
  const url = `/api/v1/gastos/${gastoId}/pagar`;
  console.log('[gastosApi] PUT pagar ->', url);
  await api.put(url);
}

/**
 * Elimina un gasto.
 */
export async function eliminarGasto(gastoId: string): Promise<void> {
  const url = `/api/v1/gastos/${gastoId}`;
  console.log('[gastosApi] DELETE gasto ->', url);
  await api.delete(url);
}

// ========================
// REINICIAR MES (backend ya lo soporta)
// ========================

export type ReinicioMesEligibility = {
  gastos_pendientes: number;
  ingresos_pendientes: number;
  can_reiniciar: boolean;
};

export type ReinicioMesResult = {
  updated: any;
  summary: {
    Gastos: Record<string, number>;
    Ingresos: Record<string, number>;
  };
};

/**
 * Nota: este método parece "placeholder" en tu versión actual:
 * - Está apuntando a '/api/v1/gastos/' (mismo endpoint que lista todos)
 * - Mantengo exactamente tu comportamiento para no romper nada.
 * Si tienes un endpoint real de eligibility, lo cambiamos aquí.
 */
export async function fetchReinicioMesEligibility(): Promise<ReinicioMesEligibility> {
  const url = '/api/v1/gastos/';
  const res = await api.get<ReinicioMesEligibility>(url);
  return res.data;
}

export async function fetchPresupuestoCotidianosTotal(): Promise<number> {
  const url = '/api/v1/gastos/cotidianos/presupuesto_total';
  const res = await api.get<{ total: number }>(url);
  return Number(res.data?.total ?? 0);
}

// Reexport de tipos y helpers de catálogos para compatibilidad
export {
  TipoGasto,
  Proveedor,
  Cuenta,
  Vivienda,
  fetchTiposGasto,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
};
