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
//
// AJUSTE (2026-01): COTIDIANOS (segmento_id = 'COT-12345')
// - Concepto especial:
//    * importe       = presupuesto restante (se recalcula al insertar gastos cotidianos en otra tabla)
//    * importe_cuota = presupuesto (base)
//    * total         = no relevante
// - Por tanto, en COT permitimos que importe e importe_cuota sean independientes.

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
// Constantes negocio
// ========================
const SEG_COT = 'COT-12345';

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
 * Reglas generales (NO COT):
 * - importe e importe_cuota SIEMPRE iguales (importe por cuota).
 * - total = importe * cuotas.
 *
 * Reglas COT (segmentoId === SEG_COT):
 * - importe       = presupuesto restante (independiente)
 * - importe_cuota = presupuesto (independiente)
 * - total         = 0 (no relevante)
 * - cuotas        = 1 (blindaje defensivo)
 *
 * Comentarios:
 * - Aquí siempre lo normalizamos a string|null.
 * - La decisión de "enviar o no enviar" en UPDATE se hace en actualizarGasto().
 */
function normalizarPayloadGasto(payload: CrearGastoGestionablePayload) {
  const isCot = (payload.segmentoId || '').toUpperCase().trim() === SEG_COT;

  const importeTotalNum = parseImporte(payload.importeTotal);
  const importeCuotaNum = parseImporte(payload.importeCuota);

  const safeTotal: number = importeTotalNum ?? 0;
  const safeCuota: number = importeCuotaNum ?? 0;

  const totalVal: number = Number.isFinite(safeTotal) ? safeTotal : 0;
  const cuotaVal: number = Number.isFinite(safeCuota) ? safeCuota : 0;

  // ============================
  // Caso COTIDIANOS (concepto especial)
  // ============================
  if (isCot) {
    const presupuesto = cuotaVal; // importe_cuota
    const presupuestoRestante = totalVal; // importe

    const bodyCot: any = {
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

      // Importes / cuotas (COT)
      cuotas: 1,
      importe: presupuestoRestante,
      importe_cuota: presupuesto,
      total: 0,

      // comentarios normalizado (string|null)
      comentarios: normalizeOptionalText(payload.comentarios),
    };

    // Flags opcionales (solo si vienen informados)
    if (typeof payload.pagado === 'boolean') bodyCot.pagado = payload.pagado;
    if (typeof payload.activo === 'boolean') bodyCot.activo = payload.activo;
    if (typeof payload.kpi === 'boolean') bodyCot.kpi = payload.kpi;

    // Edición / financiación / préstamo (opcionales)
    if (typeof payload.cuotasPagadas === 'number') bodyCot.cuotas_pagadas = payload.cuotasPagadas;
    if (typeof payload.numCuota === 'number') bodyCot.num_cuota = payload.numCuota;

    if (typeof payload.prestamoId === 'string' && payload.prestamoId.trim() !== '') {
      bodyCot.prestamo_id = payload.prestamoId.trim();
    }

    // Timestamps opcionales (si backend los soporta)
    if (typeof payload.createOn === 'string') bodyCot.createon = payload.createOn;
    if (typeof payload.modifiedOn === 'string') bodyCot.modifiedon = payload.modifiedOn;
    if (typeof payload.inactivatedOn === 'string') bodyCot.inactivatedon = payload.inactivatedOn;
    if (typeof payload.ultimoPagoOn === 'string') bodyCot.ultimo_pago_on = payload.ultimoPagoOn;

    return bodyCot;
  }

  // ============================
  // Caso GENERAL (NO COT)
  // - importe e importe_cuota siempre iguales
  // - total = importe * cuotas
  // ============================
  const nCuotas: number = payload.numCuotas && payload.numCuotas > 0 ? payload.numCuotas : 1;

  // En NO-COT aceptamos que el usuario informe cualquiera de los dos inputs,
  // pero el modelo final es siempre: importe = importe_cuota.
  let importeUnit: number = 0;

  if (nCuotas <= 1) {
    // 1 cuota: usamos el "total" si existe, si no el de cuota
    importeUnit = (totalVal > 0 ? totalVal : cuotaVal) || 0;
  } else {
    // Varias cuotas: si hay cuota, manda; si no, repartimos el total.
    if (cuotaVal > 0) {
      importeUnit = cuotaVal;
    } else {
      importeUnit = nCuotas > 0 ? (totalVal / nCuotas) : totalVal;
    }
  }

  const totalCalc = round2(importeUnit * nCuotas);

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

    // Importes / cuotas (NO COT)
    cuotas: nCuotas,
    importe: round2(importeUnit),
    importe_cuota: round2(importeUnit),
    total: totalCalc,

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

/** redondeo defensivo a 2 decimales */
function round2(n: number): number {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
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
 * UPDATE específico:
 * Activar / desactivar gasto gestionable desde listados.
 *
 * Regla de negocio:
 * - Activar    => activo=true  y kpi=true
 * - Desactivar => activo=false y kpi=false
 *
 * Importante:
 * - Reutiliza actualizarGasto porque el backend actual trabaja con PUT completo.
 * - No enviamos comentariosDirty, así que actualizarGasto NO pisa comentarios.
 */
export async function cambiarEstadoActivoKpiGasto(
  gasto: Gasto,
  nuevoActivo: boolean
): Promise<Gasto> {
  return actualizarGasto(gasto.id, {
    nombre: gasto.nombre,
    segmentoId: gasto.segmento_id,
    tipoId: gasto.tipo_id,
    proveedorId: gasto.proveedor_id,
    tienda: gasto.tienda ?? undefined,

    numCuotas: gasto.cuotas ?? 1,
    importeCuota:
      gasto.importe_cuota != null
        ? String(gasto.importe_cuota)
        : String(gasto.importe ?? 0),
    importeTotal:
      gasto.importe != null
        ? String(gasto.importe)
        : String(gasto.importe_cuota ?? 0),

    periodicidad: gasto.periodicidad,
    cuentaId: gasto.cuenta_id,
    viviendaId: gasto.referencia_vivienda_id ?? null,

    fecha: gasto.fecha,
    rangoPago: gasto.rango_pago,
    referenciaGasto: gasto.referencia_gasto ?? undefined,

    // Se pasa el valor actual, pero comentariosDirty=false para no pisar BD.
    comentarios: gasto.comentarios ?? undefined,
    comentariosDirty: false,

    cuotasPagadas: gasto.cuotas_pagadas ?? 0,
    prestamoId: gasto.prestamo_id ?? undefined,
    numCuota: gasto.num_cuota ?? 1,

    activo: nuevoActivo,
    pagado: gasto.pagado ?? false,
    kpi: nuevoActivo,
  });
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

export async function marcarGastoComoPagado(gastoId: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${gastoId}/pagar`;
  console.log('[gastosApi] PUT pagar ->', url);
  const res = await api.put<Gasto>(url);
  return res.data;
}

export async function omitirGastoEsteMes(gastoId: string): Promise<Gasto> {
  const url = `/api/v1/gastos/${gastoId}/omitir`;
  console.log('[gastosApi] PUT omitir ->', url);
  const res = await api.put<Gasto>(url);
  return res.data;
}

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
