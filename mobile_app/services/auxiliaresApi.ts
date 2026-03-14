/**
 * Ruta: mobile_app/services/auxiliaresApi.ts
 * Versión: 2.0.1
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

export type RelationCountItem = {
  key: string;
  label: string;
  count: number;
};

export type AuxItemBase = {
  id: string;
  nombre: string;
  associated_count?: number;
  relation_counts?: RelationCountItem[];
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

export type TipoRamaGastoItem = AuxItemBase;
export type TipoRamaIngresoItem = AuxItemBase;
export type TipoRamaProveedorItem = AuxItemBase;
export type TipoSegmentoGastoItem = AuxItemBase;

function normalizeRelationCountItem(raw: any): RelationCountItem {
  return {
    key: String(raw?.key ?? ''),
    label: String(raw?.label ?? ''),
    count: Number(raw?.count ?? 0),
  };
}

function normalizeAuxItem(raw: any): any {
  const normalized: any = {
    ...(raw ?? {}),
    id: String(raw?.id ?? ''),
    nombre: String(raw?.nombre ?? ''),
  };

  if ('associated_count' in (raw ?? {})) {
    normalized.associated_count = Number(raw?.associated_count ?? 0);
  }

  if (Array.isArray(raw?.relation_counts)) {
    normalized.relation_counts = raw.relation_counts.map(normalizeRelationCountItem);
  }

  return normalized;
}

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

export async function listAux<T = any>(
  entity: AuxEntity,
  params?: Record<string, any>
): Promise<T[]> {
  const url = endpointFor(entity);

  try {
    const resp = await api.get<any[]>(url, { params });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    return rows.map((row) => normalizeAuxItem(row) as T);
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

export async function createAux<T = any>(
  entity: AuxEntity,
  payload: any
): Promise<T> {
  const url = endpointFor(entity);

  try {
    const resp = await api.post<any>(url, payload);
    return normalizeAuxItem(resp.data) as T;
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

export async function updateAux<T = any>(
  entity: AuxEntity,
  id: string,
  payload: any
): Promise<T> {
  const url = `${endpointFor(entity)}/${encodeURIComponent(id)}`;

  try {
    const resp = await api.put<any>(url, payload);
    return normalizeAuxItem(resp.data) as T;
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