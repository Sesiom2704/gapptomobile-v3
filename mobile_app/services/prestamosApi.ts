/**
 * Archivo: mobile_app/services/prestamosApi.ts
 *
 * Responsabilidad:
 *   - Encapsular todas las llamadas HTTP de Préstamos (listado, detalle, cuotas, acciones).
 *   - Proveer tipado estable para que los screens no dependan del shape “raw” del backend.
 *   - Centralizar rutas para mantener cambios controlados (si cambia el prefix, se toca aquí).
 *
 * Maneja:
 *   - UI: N/A.
 *   - Estado: N/A.
 *   - Datos:
 *       - Lectura: listPrestamos/getPrestamo/getCuotas
 *       - Escritura: create/update, pagar/desmarcar, vincular gasto, amortizar
 *   - Navegación: N/A.
 *
 * Entradas / Salidas:
 *   - Props: N/A.
 *   - route.params: N/A.
 *   - Efectos: N/A.
 *
 * Dependencias clave:
 *   - api client interno (axios/fetch wrapper) del proyecto.
 *
 * Reutilización:
 *   - Candidato a externalizar: MEDIO (patrón CRUD estándar).
 *   - Riesgos: si el backend cambia shape, hay que ajustar tipos y normalización aquí.
 *
 * Notas de estilo:
 *   - No hacer transformaciones complejas aquí; solo normalización ligera y tipado.
 */

/**
 * Archivo: mobile_app/services/prestamosApi.ts
 *
 * Actualización:
 *  - FIX: catalogs() deja de usar endpoints legacy (/api/*) y pasa a reutilizar utilsApi
 *    que ya apunta a /api/v1/* (proveedores/cuentas/patrimonios).
 *  - Se mantiene el resto intacto (tipado, normalizadores, facade prestamosApi).
 */

import { api } from './api';

// ✅ Reutilizamos los fetch helpers v3 ya existentes
import {
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
  type Proveedor as ProveedorFromUtils,
  type Cuenta as CuentaFromUtils,
  type Vivienda as ViviendaFromUtils,
} from './utilsApi';

export type EstadoPrestamo = 'ACTIVO' | 'CANCELADO' | 'INACTIVO' | string;
export type Periodicidad = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | string;
export type TipoInteres = 'FIJO' | 'VARIABLE' | 'MIXTO' | string;

export type PrestamoItem = {
  id: string;
  nombre: string;
  proveedor_id: string;
  cuenta_id: string;
  referencia_vivienda_id?: string | null;

  fecha_inicio: string; // YYYY-MM-DD
  periodicidad: Periodicidad;
  plazo_meses: number;

  importe_principal: number;
  tipo_interes: TipoInteres;
  tin_pct: number;
  tae_pct?: number | null;

  indice?: string | null;
  diferencial_pct?: number | null;

  comision_apertura?: number | null;
  otros_gastos_iniciales?: number | null;

  estado: EstadoPrestamo;
  cuotas_totales: number;
  cuotas_pagadas: number;

  capital_pendiente?: number | null;
  intereses_pendientes?: number | null;

  fecha_vencimiento: string;
  rango_pago?: string | null;

  activo: boolean;
  referencia_gasto?: string | null;
};

export type PrestamoCuota = {
  id: string;
  prestamo_id: string;
  num_cuota: number;
  fecha_vencimiento: string;

  importe_cuota: number;
  capital: number;
  interes: number;
  seguros: number;
  comisiones: number;
  saldo_posterior: number;

  pagada: boolean;
  fecha_pago?: string | null;
  gasto_id?: string | null;
};

export type PrestamoCreate = {
  nombre: string;
  proveedor_id: string;
  referencia_vivienda_id?: string | null;
  cuenta_id: string;

  fecha_inicio: string; // YYYY-MM-DD
  periodicidad: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  plazo_meses: number;

  importe_principal: number;
  tipo_interes: 'FIJO' | 'VARIABLE' | 'MIXTO';
  tin_pct: number;
  tae_pct?: number | null;

  indice?: string | null;
  diferencial_pct?: number | null;

  comision_apertura?: number | null;
  otros_gastos_iniciales?: number | null;

  rango_pago?: string | null;
  activo?: boolean;
};

export type PrestamoUpdate = Partial<PrestamoCreate> & {
  estado?: 'ACTIVO' | 'CANCELADO' | 'INACTIVO';
};

const BASE = '/api/v1/prestamos';

const n = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const normalizePrestamo = (raw: any): PrestamoItem => ({
  id: String(raw?.id ?? ''),
  nombre: String(raw?.nombre ?? ''),
  proveedor_id: String(raw?.proveedor_id ?? ''),
  cuenta_id: String(raw?.cuenta_id ?? ''),
  referencia_vivienda_id: raw?.referencia_vivienda_id ?? null,

  fecha_inicio: String(raw?.fecha_inicio ?? ''),
  periodicidad: String(raw?.periodicidad ?? ''),
  plazo_meses: n(raw?.plazo_meses),

  importe_principal: n(raw?.importe_principal),
  tipo_interes: String(raw?.tipo_interes ?? ''),
  tin_pct: n(raw?.tin_pct),
  tae_pct: raw?.tae_pct != null ? n(raw?.tae_pct) : null,

  indice: raw?.indice ?? null,
  diferencial_pct: raw?.diferencial_pct != null ? n(raw?.diferencial_pct) : null,

  comision_apertura: raw?.comision_apertura != null ? n(raw?.comision_apertura) : null,
  otros_gastos_iniciales: raw?.otros_gastos_iniciales != null ? n(raw?.otros_gastos_iniciales) : null,

  estado: String(raw?.estado ?? ''),
  cuotas_totales: n(raw?.cuotas_totales),
  cuotas_pagadas: n(raw?.cuotas_pagadas),

  capital_pendiente: raw?.capital_pendiente != null ? n(raw?.capital_pendiente) : null,
  intereses_pendientes: raw?.intereses_pendientes != null ? n(raw?.intereses_pendientes) : null,

  fecha_vencimiento: String(raw?.fecha_vencimiento ?? ''),
  rango_pago: raw?.rango_pago ?? null,

  activo: Boolean(raw?.activo ?? true),
  referencia_gasto: raw?.referencia_gasto ?? null,
});

const normalizeCuota = (raw: any): PrestamoCuota => ({
  id: String(raw?.id ?? ''),
  prestamo_id: String(raw?.prestamo_id ?? ''),
  num_cuota: n(raw?.num_cuota),
  fecha_vencimiento: String(raw?.fecha_vencimiento ?? ''),

  importe_cuota: n(raw?.importe_cuota),
  capital: n(raw?.capital),
  interes: n(raw?.interes),
  seguros: n(raw?.seguros),
  comisiones: n(raw?.comisiones),
  saldo_posterior: n(raw?.saldo_posterior),

  pagada: Boolean(raw?.pagada ?? false),
  fecha_pago: raw?.fecha_pago ?? null,
  gasto_id: raw?.gasto_id ?? null,
});

export async function listPrestamos(params?: {
  q?: string;
  estado?: string;
  vencen?: 'MES';
}): Promise<PrestamoItem[]> {
  const r = await api.get(BASE, { params });
  const data = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.items) ? r.data.items : [];
  return data.map(normalizePrestamo);
}

export async function getPrestamo(prestamoId: string): Promise<PrestamoItem> {
  const r = await api.get(`${BASE}/${prestamoId}`);
  return normalizePrestamo(r.data);
}

export async function getCuotas(prestamoId: string): Promise<PrestamoCuota[]> {
  const r = await api.get(`${BASE}/${prestamoId}/cuotas`);
  const data = Array.isArray(r.data) ? r.data : [];
  return data.map(normalizeCuota);
}

export async function createPrestamo(payload: PrestamoCreate): Promise<PrestamoItem> {
  const r = await api.post(BASE, payload);
  return normalizePrestamo(r.data);
}

export async function updatePrestamo(prestamoId: string, payload: PrestamoUpdate): Promise<PrestamoItem> {
  const r = await api.put(`${BASE}/${prestamoId}`, payload);
  return normalizePrestamo(r.data);
}

export async function pagarCuota(cuotaId: string): Promise<{ ok: boolean }> {
  const r = await api.post(`${BASE}/cuotas/${cuotaId}/pagar`);
  return r.data;
}

export async function desmarcarCuota(cuotaId: string): Promise<{ ok: boolean }> {
  const r = await api.post(`${BASE}/cuotas/${cuotaId}/desmarcar`);
  return r.data;
}

export async function vincularGastoCuota(cuotaId: string, gastoId: string): Promise<{ ok: boolean }> {
  const r = await api.post(`${BASE}/cuotas/${cuotaId}/vincular_gasto`, { gasto_id: gastoId });
  return r.data;
}

export async function amortizarPrestamo(
  prestamoId: string,
  payload: { cantidad: number; cancelacion_pct?: number; cuenta_id?: string | null }
) {
  const r = await api.post(`${BASE}/${prestamoId}/amortizar`, payload);
  return r.data;
}

export type PrestamosCatalogs = {
  bancos: Array<{ id: string; nombre: string }>;
  cuentas: Array<{ id: string; anagrama: string; banco_id?: string | null }>;
  viviendas: Array<{ id: string; referencia: string; direccion_completa?: string | null }>;
};

/**
 * Heurística para “bancos”:
 * - En tu UI el selector se llama Banco pero realmente viene de Proveedores.
 * - Si no tienes un campo tipo/segmento/ramas en proveedor, una heurística común es:
 *    - si el nombre contiene BANCO/CAIXA/SANTANDER/BBVA/etc.
 * - Para NO romper nada: si no detectamos ninguno, devolvemos TODOS como “bancos”
 *   (mejor UX que lista vacía).
 */
function looksLikeBanco(nombre: string): boolean {
  const n = (nombre || '').toUpperCase();
  return (
    n.includes('BANCO') ||
    n.includes('CAIXA') ||
    n.includes('SANTANDER') ||
    n.includes('BBVA') ||
    n.includes('SABADELL') ||
    n.includes('UNICAJA') ||
    n.includes('KUTXA') ||
    n.includes('IBERCAJA') ||
    n.includes('ABANCA') ||
    n.includes('ING')
  );
}

function safeStr(v: any): string {
  return v == null ? '' : String(v);
}

/**
 * ✅ FIX PRINCIPAL:
 *  - Antes: /api/proveedores, /api/cuentas_bancarias, /api/patrimonios/picker (legacy) => 404
 *  - Ahora: reutilizamos utilsApi (v3) => /api/v1/proveedores, /api/v1/cuentas, /api/v1/patrimonios
 */
export async function catalogs(): Promise<PrestamosCatalogs> {
  const [proveedores, cuentasRaw, viviendasRaw] = await Promise.all([
    fetchProveedores().catch(() => [] as ProveedorFromUtils[]),
    fetchCuentas().catch(() => [] as CuentaFromUtils[]),
    fetchViviendas().catch(() => [] as ViviendaFromUtils[]),
  ]);

  const provMapped = (proveedores ?? []).map((p: any) => ({
    id: safeStr(p.id),
    nombre: safeStr(p.nombre ?? p.id),
  }));

  // Filtrado de “bancos” con fallback a “todos”
  const bancosFiltrados = provMapped.filter((p) => looksLikeBanco(p.nombre));
  const bancos = (bancosFiltrados.length > 0 ? bancosFiltrados : provMapped).sort((a, b) =>
    a.nombre.localeCompare(b.nombre)
  );

  const cuentas = (cuentasRaw ?? [])
    .map((c: any) => ({
      id: safeStr(c.id),
      anagrama: safeStr(c.anagrama ?? c.referencia ?? c.id),
      banco_id: c.banco_id != null ? safeStr(c.banco_id) : null,
    }))
    .sort((a, b) => a.anagrama.localeCompare(b.anagrama));

  const viviendas = (viviendasRaw ?? [])
    .map((v: any) => ({
      id: safeStr(v.id),
      referencia: safeStr(v.referencia ?? v.id),
      direccion_completa: v.direccion_completa != null ? safeStr(v.direccion_completa) : null,
    }))
    .sort((a, b) => a.referencia.localeCompare(b.referencia));

  return { bancos, cuentas, viviendas };
}

/**
 * =========================================================
 * Facade para compatibilidad con los screens V3
 * =========================================================
 */
export const prestamosApi = {
  // Lectura
  list: listPrestamos,
  get: getPrestamo,
  cuotas: getCuotas,

  // Escritura
  create: createPrestamo,
  update: updatePrestamo,

  // Acciones cuotas
  pagarCuota,
  desmarcarCuota,
  vincularGastoCuota,

  // Acciones préstamo
  amortizar: amortizarPrestamo,

  // Catálogos (para el Form)
  catalogs,
};
