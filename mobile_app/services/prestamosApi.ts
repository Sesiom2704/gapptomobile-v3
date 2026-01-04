/**
 * Archivo: mobile_app/services/prestamosApi.ts
 *
 * OBJETIVO (FIX de bancos):
 *  - El selector “Banco” usa Proveedores pero debe mostrar solo aquellos cuya rama_id
 *    pertenezca a:
 *       - BANCOS (BAN-TIPORAMAPROVEEDOR-8D1302BD)
 *       - FINANCIERAS (FIN-TIPORAMAPROVEEDOR-8D1302BC)
 *  - El screen limita a 4 sugerencias; aquí devolvemos el catálogo ya filtrado y ordenado.
 *
 * IMPORTANTE:
 *  - Antes estabas mapeando proveedores a {id, nombre} y perdiendo rama_id.
 *  - Además usabas heurística looksLikeBanco() por nombre, lo que podía dejar lista vacía.
 *  - Ahora:
 *      1) preservamos rama_id en el catálogo de bancos
 *      2) filtramos estrictamente por rama_id (BAN/FIN)
 *      3) añadimos logs diagnósticos por si en staging algo no llega como esperamos
 *
 * Resto del facade se mantiene intacto.
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

// =====================================================
// ✅ IDs reales en tu tabla tipo_ramas_proveedores
// =====================================================
const RAMA_PROVEEDOR_FINANCIERAS_ID = 'FIN-TIPORAMAPROVEEDOR-8D1302BC';
const RAMA_PROVEEDOR_BANCOS_ID = 'BAN-TIPORAMAPROVEEDOR-8D1302BD';

const RAMAS_BANCO_VALIDAS = new Set<string>([
  RAMA_PROVEEDOR_FINANCIERAS_ID,
  RAMA_PROVEEDOR_BANCOS_ID,
]);

function safeStr(v: any): string {
  return v == null ? '' : String(v);
}

/**
 * Extrae rama_id de forma robusta.
 * En tu backend lo normal es p.rama_id; dejamos fallbacks por si cambia.
 */
function getProveedorRamaId(p: any): string {
  return safeStr(
    p?.rama_id ??
      p?.ramaId ??
      p?.rama_rel?.id ??
      p?.ramaRel?.id ??
      ''
  );
}

export type PrestamosCatalogs = {
  bancos: Array<{ id: string; nombre: string; rama_id: string }>;
  cuentas: Array<{ id: string; anagrama: string; banco_id?: string | null }>;
  viviendas: Array<{ id: string; referencia: string; direccion_completa?: string | null }>;
};

/**
 * Catálogos para el form de préstamo:
 *  - bancos: prov de ramas BANCOS/FINANCIERAS
 *  - cuentas: cuentas bancarias
 *  - viviendas: patrimonios/viviendas
 */
export async function catalogs(): Promise<PrestamosCatalogs> {
  const [proveedoresRaw, cuentasRaw, viviendasRaw] = await Promise.all([
    fetchProveedores().catch(() => [] as ProveedorFromUtils[]),
    fetchCuentas().catch(() => [] as CuentaFromUtils[]),
    fetchViviendas().catch(() => [] as ViviendaFromUtils[]),
  ]);

  // ---------------------------
  // Proveedores: preservamos rama_id
  // ---------------------------
  const proveedores = (proveedoresRaw ?? []).map((p: any) => ({
    id: safeStr(p.id),
    nombre: safeStr(p.nombre ?? p.id),
    rama_id: getProveedorRamaId(p),
  }));

  // ---------------------------
  // ✅ Filtrado estricto por rama_id (BANCOS o FINANCIERAS)
  // ---------------------------
  const bancos = proveedores
    .filter((p) => RAMAS_BANCO_VALIDAS.has(p.rama_id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Logs diagnósticos: si quedara vacío, verás qué ramas llegan realmente
  console.log('[prestamosApi][catalogs] proveedores.len=', proveedores.length);
  console.log('[prestamosApi][catalogs] bancos.len=', bancos.length);
  if (bancos.length === 0) {
    const ramasDetectadas = Array.from(new Set(proveedores.map((p) => p.rama_id).filter(Boolean)));
    console.log('[prestamosApi][catalogs] ramasDetectadas=', ramasDetectadas);
    console.log('[prestamosApi][catalogs] sampleProveedor=', proveedores.slice(0, 3));
  }

  // ---------------------------
  // Cuentas
  // Nota: si quieres mostrar liquidez en el screen, debes mapear liquidez aquí.
  // ---------------------------
  const cuentas = (cuentasRaw ?? [])
    .map((c: any) => ({
      id: safeStr(c.id),
      anagrama: safeStr(c.anagrama ?? c.referencia ?? c.id),
      banco_id: c.banco_id != null ? safeStr(c.banco_id) : null,
      // Si existe en tu API: liquidez: c.liquidez ?? null,
    }))
    .sort((a, b) => a.anagrama.localeCompare(b.anagrama));

  // ---------------------------
  // Viviendas
  // ---------------------------
  const viviendas = (viviendasRaw ?? [])
    .map((v: any) => ({
      id: safeStr(v.id),
      referencia: safeStr(v.referencia ?? v.id),
      direccion_completa: v.direccion_completa != null ? safeStr(v.direccion_completa) : null,
      // Si existe en tu API: activo: v.activo ?? true,
    }))
    .sort((a, b) => a.referencia.localeCompare(b.referencia));

  return { bancos, cuentas, viviendas };
}

/**
 * =========================================================
 * Facade para compatibilidad con screens V3
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
