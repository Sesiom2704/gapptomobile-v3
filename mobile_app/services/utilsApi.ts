// services/utilsApi.ts
import axios from 'axios';
import { api } from './api';

// Importamos el servicio unificado de proveedores
import {
  listProveedores,
  Proveedor as ProveedorFromProveedoresApi,
} from './proveedoresApi';

import { listAux, TipoGastoItem } from './auxiliaresApi';

// ========================
// Tipos comunes de catálogo
// ========================

export interface TipoGasto {
  id: string;
  nombre: string;
  rama_id?: string | null;
  segmento_id?: string | null;
}

export interface TipoIngreso {
  id: string;
  nombre: string;
}

// Reutilizamos el tipo Proveedor del servicio de proveedores
export type Proveedor = ProveedorFromProveedoresApi;

export interface Cuenta {
  id: string;
  banco_id?: string | null;
  referencia: string;
  anagrama: string;
  liquidez_inicial: number;
  liquidez: number;
  activo: boolean;
}


export interface Vivienda {
  id: string;
  referencia: string;
  direccion_completa: string;
  activo: boolean;
}

// ========================
// Endpoints backend
// (solo para logging y otros catálogos)
// ========================
const ENDPOINT_TIPOS_GASTO   = '/api/v1/tipos/gastos';
const ENDPOINT_TIPOS_INGRESO = '/api/v1/tipos/ingresos';  // cuando tengas router de tipos ingreso
const ENDPOINT_PROVEEDORES   = '/api/v1/proveedores';      // el call real va por listProveedores()
const ENDPOINT_CUENTAS       = '/api/v1/cuentas';
const ENDPOINT_VIVIENDAS     = '/api/v1/patrimonios';

// ========================
// Fetch helpers
// ========================

/**
 * Carga tipos de gasto.
 * Si se pasa segmentoId, se envía como query param para que el backend filtre
 * (segmento_id=<segmentoId>). Si no, devuelve todos los tipos.
 */

export async function fetchTiposGasto(segmentoId?: string): Promise<TipoGasto[]> {
  console.log('[utilsApi] GET tipos gasto (aux) segmentoId =', segmentoId);
  const data = await listAux<TipoGastoItem>('tipo_gasto', segmentoId ? { segmento_id: segmentoId } : undefined);
  return data ?? [];
}


export async function fetchTiposIngreso(): Promise<TipoIngreso[]> {
  console.log('[utilsApi] GET tipos ingreso (aux)');
  const data = await listAux<TipoIngreso>('tipo_ingreso');
  return data ?? [];
}

/**
 * Carga proveedores del usuario actual.
 * Ahora reutilizamos el servicio centralizado listProveedores()
 * que ya usa el cliente `api` con el token configurado.
 */
export async function fetchProveedores(): Promise<Proveedor[]> {
  const url = ENDPOINT_PROVEEDORES;
  console.log('[utilsApi] GET proveedores ->', url);
  try {
    const data = await listProveedores();
    return data ?? [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[utilsApi] Error cargando proveedores', err.message);
    } else {
      console.error('[utilsApi] Error cargando proveedores', err);
    }
    throw err;
  }
}

export async function fetchCuentas(): Promise<Cuenta[]> {
  const url = ENDPOINT_CUENTAS;
  console.log('[utilsApi] GET cuentas ->', url);
  try {
    const resp = await api.get<Cuenta[]>(url);
    return resp.data ?? [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[utilsApi] Error cargando cuentas', err.message);
    } else {
      console.error('[utilsApi] Error cargando cuentas', err);
    }
    throw err;
  }
}

export async function fetchViviendas(): Promise<Vivienda[]> {
  const url = ENDPOINT_VIVIENDAS;
  console.log('[utilsApi] GET viviendas ->', url);
  try {
    const resp = await api.get<Vivienda[]>(url);
    return resp.data ?? [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[utilsApi] Error cargando viviendas', err.message);
    } else {
      console.error('[utilsApi] Error cargando viviendas', err);
    }
    throw err;
  }
}
