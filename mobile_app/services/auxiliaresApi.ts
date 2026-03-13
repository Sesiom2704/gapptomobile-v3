/**
 * Ruta: mobile_app/services/auxiliaresApi.ts
 * Versión: 1.2.0
 * Descripción:
 * Servicio centralizado para tablas auxiliares de GapptoMobile v3.
 *
 * Responsabilidades:
 * - Resolver el endpoint correcto según la entidad auxiliar.
 * - Exponer operaciones CRUD homogéneas:
 *   * listAux
 *   * createAux
 *   * updateAux
 *   * deleteAux
 *
 * Ajustes incluidos:
 * - Soporte para la nueva entidad:
 *     * tipo_subsegmento_proveedor
 * - Tipado específico para:
 *     * TipoGastoItem
 *     * TipoIngresoItem
 *     * TipoSubsegmentoProveedorItem
 * - Logging robusto de errores Axios.
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
  rama_id: string | null;
};

// ============================================================
// Mapeo entidad -> endpoint backend
// ============================================================
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

// ============================================================
// List
// ============================================================
export async function listAux<T = any>(
  entity: AuxEntity,
  params?: Record<string, any>
): Promise<T[]> {
  const url = endpointFor(entity);

  try {
    const resp = await api.get<T[]>(url, { params });
    return resp.data ?? [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error listAux',
        entity,
        'url=',
        url,
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[auxiliaresApi] Error listAux', entity, err);
    }
    throw err;
  }
}

// ============================================================
// Create
// ============================================================
export async function createAux<T = any>(
  entity: AuxEntity,
  payload: any
): Promise<T> {
  const url = endpointFor(entity);

  try {
    const resp = await api.post<T>(url, payload);
    return resp.data as T;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error createAux',
        entity,
        'url=',
        url,
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[auxiliaresApi] Error createAux', entity, err);
    }
    throw err;
  }
}

// ============================================================
// Update
// ============================================================
export async function updateAux<T = any>(
  entity: AuxEntity,
  id: string,
  payload: any
): Promise<T> {
  const url = `${endpointFor(entity)}/${encodeURIComponent(id)}`;

  try {
    const resp = await api.put<T>(url, payload);
    return resp.data as T;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error updateAux',
        entity,
        'url=',
        url,
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[auxiliaresApi] Error updateAux', entity, err);
    }
    throw err;
  }
}

// ============================================================
// Delete
// ============================================================
export async function deleteAux(entity: AuxEntity, id: string): Promise<void> {
  const url = `${endpointFor(entity)}/${encodeURIComponent(id)}`;

  try {
    await api.delete(url);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error deleteAux',
        entity,
        'url=',
        url,
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[auxiliaresApi] Error deleteAux', entity, err);
    }
    throw err;
  }
}

const auxiliaresApi = {
  listAux,
  createAux,
  updateAux,
  deleteAux,
};

export default auxiliaresApi;