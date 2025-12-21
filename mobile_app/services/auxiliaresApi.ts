// services/auxiliaresApi.ts
import axios from 'axios';
import { api } from './api';

export type AuxEntity =
  | 'tipo_ingreso'
  | 'tipo_gasto'
  | 'tipo_ramas_gasto'
  | 'tipo_ramas_proveedores'
  | 'tipo_segmento_gasto';

export type AuxItemBase = { id: string; nombre: string };

export type TipoGastoItem = AuxItemBase & {
  rama_id: string;
  segmento_id: string | null;
};

// --------------------
// Mapeo entidad -> endpoint (REAL según OpenAPI)
// --------------------
function endpointFor(entity: AuxEntity): string {
  switch (entity) {
    case 'tipo_ingreso':
      return '/api/v1/tipos/ingresos';

    case 'tipo_gasto':
      return '/api/v1/tipos/gastos';

    case 'tipo_ramas_gasto':
      // ✅ EXISTE: /api/v1/ramas/gastos
      return '/api/v1/ramas/gastos';

    case 'tipo_ramas_proveedores':
      // ✅ EXISTE: /api/v1/ramas/proveedores
      return '/api/v1/ramas/proveedores';

    case 'tipo_segmento_gasto':
      // ✅ EXISTE: /api/v1/tipos/segmentos
      return '/api/v1/tipos/segmentos';

    default:
      return '/api/v1';
  }
}

// --------------------
// List
// --------------------
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
        err.message,
        'url=',
        url,
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

// --------------------
// Create
// --------------------
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
        err.message,
        'url=',
        url,
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

// --------------------
// Update
// --------------------
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
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error updateAux',
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
      console.error('[auxiliaresApi] Error updateAux', entity, err);
    }
    throw err;
  }
}

// --------------------
// Delete
// --------------------
export async function deleteAux(entity: AuxEntity, id: string): Promise<void> {
  const url = `${endpointFor(entity)}/${id}`;
  try {
    await api.delete(url);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[auxiliaresApi] Error deleteAux',
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
      console.error('[auxiliaresApi] Error deleteAux', entity, err);
    }
    throw err;
  }
}
