// mobile_app/services/ubicacionesApi.ts
import { api } from './api';

export interface Pais {
  id: number;
  nombre: string;
  codigo_iso?: string | null;
}

export interface Region {
  id: number;
  nombre: string;
  pais_id: number;
  pais?: Pais | null;
}

export interface LocalidadWithContext {
  id: number;
  nombre: string;
  region_id: number;
  region: Region;
}

// --------------------
// LISTADOS
// --------------------

export async function listPaises(params?: {
  search?: string;
  limit?: number;
}): Promise<Pais[]> {
  const safeLimit = Math.min(params?.limit ?? 200, 500);

  const resp = await api.get<Pais[]>('/api/v1/ubicaciones/paises/', {
    params: {
      search: params?.search,
      limit: safeLimit,
    },
  });
  return resp.data ?? [];
}

export async function listRegiones(params?: {
  search?: string;
  paisId?: number;
  limit?: number;
}): Promise<Region[]> {
  const safeLimit = Math.min(params?.limit ?? 200, 500);

  const resp = await api.get<Region[]>('/api/v1/ubicaciones/regiones/', {
    params: {
      search: params?.search,
      pais_id: params?.paisId,
      limit: safeLimit,
    },
  });
  return resp.data ?? [];
}

export async function listLocalidades(params?: {
  search?: string;
  regionId?: number;
  paisId?: number;
  limit?: number;
}): Promise<LocalidadWithContext[]> {
  const safeLimit = Math.min(params?.limit ?? 50, 500);

  const resp = await api.get<LocalidadWithContext[]>('/api/v1/ubicaciones/localidades/', {
    params: {
      search: params?.search,
      region_id: params?.regionId,
      pais_id: params?.paisId,
      limit: safeLimit,
    },
  });
  return resp.data ?? [];
}

// --------------------
// CREACIÓN
// --------------------

export async function createPais(payload: {
  nombre: string;
  codigo_iso?: string | null;
}): Promise<Pais> {
  const resp = await api.post<Pais>('/api/v1/ubicaciones/paises/', payload);
  return resp.data;
}

export async function createRegion(payload: {
  nombre: string;
  pais_id: number;
}): Promise<Region> {
  const resp = await api.post<Region>('/api/v1/ubicaciones/regiones/', payload);
  return resp.data;
}

export async function createLocalidad(payload: {
  nombre: string;
  region_id: number;
}): Promise<LocalidadWithContext> {
  const resp = await api.post<LocalidadWithContext>('/api/v1/ubicaciones/localidades/', payload);
  return resp.data;
}
