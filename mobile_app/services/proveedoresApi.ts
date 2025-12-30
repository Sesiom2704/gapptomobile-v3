// mobile_app/services/proveedoresApi.ts
import axios from 'axios';
import { api } from './api';

// =======================
// Tipos (DTOs)
// =======================

export type ProveedorRow = {
  id: string;
  nombre: string;
  rama_id: string | null;

  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;

  // Si en tu ProveedorRead incluyes localidad_id en respuesta, añádelo:
  localidad_id?: number | null;
};

export type ProveedorCreate = {
  nombre: string;
  rama_id: string;
  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;
};

export type ProveedorUpdate = {
  nombre?: string | null;
  rama_id?: string | null;
  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;
};

const BASE = '/api/v1/proveedores';

// =======================
// API
// =======================

export async function listProveedores(params?: {
  rama_id?: string;
}): Promise<ProveedorRow[]> {
  try {
    const res = await api.get<ProveedorRow[]>(BASE, { params });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error listProveedores',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[proveedoresApi] Error listProveedores', err);
    }
    throw err;
  }
}

export async function createProveedor(payload: ProveedorCreate): Promise<ProveedorRow> {
  try {
    const res = await api.post<ProveedorRow>(BASE, payload);
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error createProveedor',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[proveedoresApi] Error createProveedor', err);
    }
    throw err;
  }
}

export async function updateProveedor(provId: string, payload: ProveedorUpdate): Promise<ProveedorRow> {
  try {
    const res = await api.put<ProveedorRow>(`${BASE}/${encodeURIComponent(provId)}`, payload);
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error updateProveedor',
        provId,
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[proveedoresApi] Error updateProveedor', provId, err);
    }
    throw err;
  }
}

// Solo funcionará cuando añadas DELETE en backend.
export async function deleteProveedor(provId: string): Promise<void> {
  try {
    await api.delete(`${BASE}/${encodeURIComponent(provId)}`);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error deleteProveedor',
        provId,
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[proveedoresApi] Error deleteProveedor', provId, err);
    }
    throw err;
  }
}

const proveedoresApi = {
  listProveedores,
  createProveedor,
  updateProveedor,
  deleteProveedor,
};

export default proveedoresApi;
