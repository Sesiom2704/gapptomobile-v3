// services/gastosApi.ts
//
// Objetivo: API de gastos (gestionables) para GapptoMobile v3.
//
// Mantiene funcionalidad existente + hardening:
// - Normalización de payloads (importe/cuotas/etc).
// - FIX comentarios: en UPDATE solo se envía si el usuario lo tocó (comentariosDirty).
// - NUEVO: soporte de omisión mensual (omitido_este_mes) vía endpoints:
//      PUT /api/v1/gastos/{id}/omitir
//      PUT /api/v1/gastos/{id}/deshacer-omision
//
// Principios anti-bug aplicados:
// 1) "No pisar" campos opcionales por defecto (comentarios).
// 2) Tipos claros y helpers para payload -> body backend.
// 3) Logs estructurados de endpoints para diagnóstico.

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
const ENDPOINT_GASTOS_TODOS = '/api/v1/gastos/'; // importante la barra final

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

  // Campo opcional (NO upper-case)
  comentarios?: string | null;

  // Estado lógico
  activo?: boolean;
  pagado?: boolean;
  kpi?: boolean;

  // NUEVO v3 (omisión mensual)
  omitido_este_mes?: boolean;
  omitido_on?: string | null;
  omitido_count?: number;

  // Fechas de control
  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;
  ultimo_pago_on?: string | null;

  // Usuario
  user_id?: string | null;
  user_nombre?: string | null;

  // Relacionados opcionales (resueltos desde backend)
  tipo_nombre?: string;
  proveedor_nombre?: string;
  cuenta_anagrama?: string;
  segmento_nombre?: string;

  [key: string]: any;
}

/**
 * Payload de UI para crear/editar un gasto.
 * Mantiene keys del form (segmentoId, tipoId...) para no romper pantallas.
 */
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

  // comentarios (valor actual en el form)
  comentarios?: string;

  /**
   * FIX: indica si el usuario tocó el campo comentarios en el formulario
   * - true  -> enviar comentarios en UPDATE
   * - false/undefined -> NO enviar comentarios en UPDATE (no pisar BD)
   */
  comentariosDirty?: boolean;

  pagado?: boolean;
  activo?: boolean;
  kpi?: boolean;

  // financiación / préstamo (opcionales)
  cuotasPagadas?: number;
  prestamoId?: string;
  numCuota?: number;

  // timestamps opcionales (PAGO UNICO duplicado / migración)
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
 * Normaliza texto opcional:
 * - string vacía/espacios -> null
 * - string con contenido -> trimmed
 */
function normalizeOptionalText(val: unknown): string | null {
  const s = typeof val === 'string' ? val.trim() : '';
  return s.length > 0 ? s : null;
}

/**
 * Normaliza el payload del formulario (UI) al body del backend.
 *
 * Reglas:
 * - parseImporte para dinero string -> number.
 * - calcula importe/total según cuotas.
 * - mapea keys UI -> backend: segmento_id, tipo_id, proveedor_id, cuenta_id...
 * - flags pagado/activo/kpi si vienen informados.
 * - soporte de cuotas_pagadas, num_cuota, prestamo_id, timestamps.
 *
 * Comentarios:
 * - Aquí siempre lo normalizamos a string|null.
 * - La decisión de "enviar o no enviar" en UPDATE se hace en actualizarGasto().
 */
function normalizarPayloadGasto(payload: CrearGastoGestionablePayload) {
  const importeTotalNum = parseImporte(payload.importeTotal);
  const importeCuotaNum = parseImporte(payload.importeCuota);

  const safeTotal: number = importeTotalNum ?? 0;
  const safeCuota: number = importeCuotaNum ?? 0;

  const totalVal: number = Number.isFinite(safeTotal) ? safeTotal : 0;
  const cuotaVal: number = Number.isFinite(safeCuota) ? safeCuota : 0;

  const nCuotas: number =
    payload.numCuotas && payload.numCuotas > 0 ? payload.numCuotas : 1;

  let importe: number = 0;
  let total: number = 0;

  if (nCuotas <= 1) {
    // 1 cuota: PAGO ÚNICO o recurrente sin financiación
    const base = totalVal > 0 ? totalVal : cuotaVal;
    importe = base;
    total = base;
  } else {
    // Varias cuotas: financiación
    if (cuotaVal > 0) {
      importe = cuotaVal;
      total = cuotaVal * nCuotas;
    } else {
      // Si solo hay total, lo repartimos
      importe = nCuotas > 0 ? totalVal / nCuotas : totalVal;
      total = totalVal;
    }
  }

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

    // comentarios normalizado (string|null)
    comentarios: normalizeOptionalText(payload.comentarios),
  };

  // Flags opcionales (solo si vienen informados)
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
// LISTADO
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
    console.error('[gastosApi] Error cargando gastos', { url, status, err });
    throw err;
  }
}

// ========================
// CRUD GASTO GESTIONABLE
// ========================

/**
 * CREATE: en creación sí podemos enviar comentarios siempre (string|null).
 */
export async function crearGastoGestionable(payload: CrearGastoGestionablePayload): Promise<Gasto> {
  const body = normalizarPayloadGasto(payload);
  const url = ENDPOINT_GASTOS_TODOS;

  console.log('[gastosApi] POST crear gasto ->', url, body);
  const res = await api.post<Gasto>(url, body);
  return res.data;
}

/**
 * GET por ID (detalle / edición).
 */
export async function obtenerGasto(id: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${id}`;
  console.log('[gastosApi] GET gasto ->', url);
  const res = await api.get<Gasto>(url);
  return res.data;
}

/**
 * UPDATE:
 * FIX comentarios:
 * - Si NO hay comentariosDirty -> NO enviamos `comentarios` (no pisamos BD).
 * - Si comentariosDirty=true -> enviamos `comentarios` (string|null) permitiendo borrar.
 */
export async function actualizarGasto(
  id: string,
  payload: CrearGastoGestionablePayload
): Promise<Gasto> {
  const body = normalizarPayloadGasto(payload);
  const url = `/api/v1/gastos/${id}`;

  // Control explícito del envío de comentarios en UPDATE
  if (!payload.comentariosDirty) {
    delete body.comentarios;
  } else {
    // Si lo tocó: permitimos string o null
    body.comentarios = body.comentarios ?? null;
  }

  console.log('[gastosApi] PUT actualizar gasto ->', url, body);
  const res = await api.put<Gasto>(url, body);
  return res.data;
}

/**
 * DELETE gasto.
 */
export async function eliminarGasto(gastoId: string): Promise<void> {
  const url = `/api/v1/gastos/${gastoId}`;
  console.log('[gastosApi] DELETE gasto ->', url);
  await api.delete(url);
}

// ========================
// Acciones sobre gasto
// ========================

/**
 * Marcar un gasto como pagado (gestionables).
 *
 * Nota importante (confirmado por ti):
 * - Esto marca como pagado el GASTO (contenedor/gestionable) en /gastos.
 * - No afecta a la tabla de GASTOS COTIDIANOS (son recursos distintos).
 */
export async function marcarGastoComoPagado(gastoId: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${gastoId}/pagar`;
  console.log('[gastosApi] PUT pagar ->', url);
  const res = await api.put<Gasto>(url);
  return res.data;
}

/**
 * NUEVO: Omitir un gasto este mes.
 * - No marca pagado.
 * - No toca liquidez.
 * - Lo excluye de /gastos/pendientes.
 */
export async function omitirGastoEsteMes(gastoId: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${gastoId}/omitir`;
  console.log('[gastosApi] PUT omitir ->', url);
  const res = await api.put<Gasto>(url);
  return res.data;
}

/**
 * NUEVO: Deshacer la omisión del mes.
 */
export async function deshacerOmisionGastoEsteMes(gastoId: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${gastoId}/deshacer-omision`;
  console.log('[gastosApi] PUT deshacer-omision ->', url);
  const res = await api.put<Gasto>(url);
  return res.data;
}

// ========================
// REINICIAR MES (mantengo tu comportamiento actual)
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
 * Nota: este método parece placeholder en tu versión actual.
 * Mantengo exactamente el comportamiento para no romper nada.
 */
export async function fetchReinicioMesEligibility(): Promise<ReinicioMesEligibility> {
  const url = ENDPOINT_GASTOS_TODOS;
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
