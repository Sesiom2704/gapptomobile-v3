// mobile_app/services/auxiliaresApi.ts

/**
 * Ruta: mobile_app/services/auxiliaresApi.ts
 * Versión: 1.3.0
 * Descripción:
 * Servicio centralizado para catálogos auxiliares.
 *
 * Responsabilidades:
 * - Resolver la URL real de cada entidad auxiliar.
 * - Listar, crear, actualizar y eliminar registros auxiliares.
 * - Añadir soporte para el nuevo catálogo:
 *     * tipo_subsegmento_proveedor
 *
 * Notas:
 * - Se mantiene compatibilidad con el resto de pantallas existentes.
 * - El tipado sigue siendo flexible para no romper formularios legacy.
 */

import axios from 'axios';
import { api } from './api';

export type AuxEntity =
  | 'tipo_ingreso'
  | 'tipo_gasto'
  | 'tipo_ramas_gasto'
  | 'tipo_ramas_ingreso'
  | 'tipo_ramas_proveedores'
  | 'tipo_segmento_gasto'
  | 'tipo_subsegmento_proveedor';

export type AuxItemBase = {
  id: string;
  nombre: string;
};

export type TipoGastoItem = AuxItemBase & {
  rama_id: string;
  segmento_id: string | null;
};

export type TipoIngresoItem = AuxItemBase & {
  rama_id: string;
};

export type TipoSubsegmentoProveedorItem = AuxItemBase & {
  rama_id?: string | null;
};

// ---------------------------------------------------------------------------
// Mapeo entidad -> endpoint backend
// ---------------------------------------------------------------------------
function endpointFor(entity: AuxEntity): string {
  switch (entity) {
    case 'tipo_ingreso':
      return '/api/v1/tipos/ingresos';

    case 'tipo_gasto':
      return '/api/v1/tipos/gastos';

    case 'tipo_ramas_gasto':
      return '/api/v1/ramas/gastos';

    case 'tipo_ramas_ingreso':
      return '/api/v1/ramas/ingresos';

    case 'tipo_ramas_proveedores':
      return '/api/v1/ramas/proveedores';

    case 'tipo_segmento_gasto':
      return '/api/v1/tipos/segmentos';

    case 'tipo_subsegmento_proveedor':
      return '/api/v1/subsegmentos/proveedores';

    default:
      return '/api/v1';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function logAxiosError(prefix: string, entity: AuxEntity, url: string, err: unknown) {
  if (axios.isAxiosError(err)) {
    console.error(
      prefix,
      entity,
      err.message,
      'url=',
      url,
      'status=',
      err.response?.status,
      'data=',
      JSON.stringify(err.response?.data ?? null)
    );
  } else {
    console.error(prefix, entity, err);
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export async function listAux<T = any>(
  entity: AuxEntity,
  params?: Record<string, any>
): Promise<T[]> {
  const url = endpointFor(entity);

  try {
    const resp = await api.get<T[]>(url, { params });
    return resp.data ?? [];
  } catch (err) {
    logAxiosError('[auxiliaresApi] Error listAux', entity, url, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createAux<T = any>(
  entity: AuxEntity,
  payload: any
): Promise<T> {
  const url = endpointFor(entity);

  try {
    const resp = await api.post<T>(url, payload);
    return resp.data as T;
  } catch (err) {
    logAxiosError('[auxiliaresApi] Error createAux', entity, url, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
export async function updateAux<T = any>(
  entity: AuxEntity,
  id: string,
  payload: any
): Promise<T> {
  const url = `${endpointFor(entity)}/${id}`;

  try {
    const resp = await api.put<T>(url, payload);
    return resp.data as T;
  } catch (err) {
    logAxiosError('[auxiliaresApi] Error updateAux', entity, url, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export async function deleteAux(entity: AuxEntity, id: string): Promise<void> {
  const url = `${endpointFor(entity)}/${id}`;

  try {
    await api.delete(url);
  } catch (err) {
    logAxiosError('[auxiliaresApi] Error deleteAux', entity, url, err);
    throw err;
  }
}