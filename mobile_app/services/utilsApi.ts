// services/utilsApi.ts
import axios from 'axios';
import { api } from './api';

/**
 * Este fichero agrupa "fetch helpers" para catálogos.
 * Algunos catálogos están centralizados en servicios específicos:
 * - proveedores -> proveedoresApi (listProveedores)
 * - auxiliares -> auxiliaresApi (listAux)
 *
 * Objetivo: que las pantallas consuman funciones simples como fetchProveedores()
 * sin duplicar lógica de requests.
 */

// Importamos el servicio unificado de proveedores
import { listProveedores, Proveedor as ProveedorFromProveedoresApi } from './proveedoresApi';

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

/**
 * Reutilizamos el tipo Proveedor exportado desde proveedoresApi.ts
 * (es un alias de ProveedorRow).
 */
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

/**
 * Nota: ENDPOINT_PROVEEDORES se mantiene por logging,
 * pero el request real se hace con listProveedores() (servicio centralizado).
 */
const ENDPOINT_TIPOS_GASTO = '/api/v1/tipos/gastos';
const ENDPOINT_TIPOS_INGRESO = '/api/v1/tipos/ingresos'; // cuando tengas router de tipos ingreso
const ENDPOINT_PROVEEDORES = '/api/v1/proveedores'; // call real va por listProveedores()
const ENDPOINT_CUENTAS = '/api/v1/cuentas';
const ENDPOINT_VIVIENDAS = '/api/v1/patrimonios';

// ========================
// Fetch helpers
// ========================

/**
 * Carga tipos de gasto.
 * - Si se pasa segmentoId, se filtra por segmento_id en backend.
 * - Si no, devuelve todos los tipos.
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
 * Reutiliza el servicio centralizado listProveedores()
 * que usa el cliente `api` con token configurado.
 */
export async function fetchProveedores(): Promise<Proveedor[]> {
  const url = ENDPOINT_PROVEEDORES;
  console.log('[utilsApi] GET proveedores ->', url);

  try {
    const data = await listProveedores();
    return data ?? [];
  } catch (err) {
    // Logging robusto para ver status y data reales si falla
    if (axios.isAxiosError(err)) {
      console.error(
        '[utilsApi] Error cargando proveedores',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[utilsApi] Error cargando proveedores (non-axios)', err);
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
      console.error(
        '[utilsApi] Error cargando cuentas',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[utilsApi] Error cargando cuentas (non-axios)', err);
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
      console.error(
        '[utilsApi] Error cargando viviendas',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[utilsApi] Error cargando viviendas (non-axios)', err);
    }
    throw err;
  }
}
