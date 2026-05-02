/**
 * Ruta: mobile_app/services/ubicacionesApi.ts
 * Versión: 2.3.0
 * Descripción:
 * Servicio centralizado para ubicaciones.
 *
 * Responsabilidades:
 * - Listar, crear, actualizar y eliminar países, regiones y localidades.
 * - Mantener tipado completo para formularios jerárquicos:
 *      país -> región/comunidad -> localidad.
 *
 * Notas:
 * - El backend normaliza nombres a MAYÚSCULAS.
 * - Las altas son idempotentes: si ya existe, el backend devuelve el registro existente.
 * - Las bajas pueden fallar si existen registros asociados; el backend debe responder 409.
 */

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
// Helpers
// --------------------

function cleanText(value: string): string {
  return String(value ?? '').trim();
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = String(value ?? '').trim();
  return cleaned.length ? cleaned : null;
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
      search: cleanOptionalText(params?.search),
      limit: safeLimit,
    },
  });

  return Array.isArray(resp.data) ? resp.data : [];
}

export async function listRegiones(params?: {
  search?: string;
  paisId?: number;
  limit?: number;
}): Promise<Region[]> {
  const safeLimit = Math.min(params?.limit ?? 200, 500);

  const resp = await api.get<Region[]>('/api/v1/ubicaciones/regiones/', {
    params: {
      search: cleanOptionalText(params?.search),
      pais_id: params?.paisId,
      limit: safeLimit,
    },
  });

  return Array.isArray(resp.data) ? resp.data : [];
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
      search: cleanOptionalText(params?.search),
      region_id: params?.regionId,
      pais_id: params?.paisId,
      limit: safeLimit,
    },
  });

  return Array.isArray(resp.data) ? resp.data : [];
}

// --------------------
// CREACIÓN
// --------------------

export async function createPais(payload: {
  nombre: string;
  codigo_iso?: string | null;
}): Promise<Pais> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre del país es obligatorio.');
  }

  const resp = await api.post<Pais>('/api/v1/ubicaciones/paises/', {
    nombre,
    codigo_iso: cleanOptionalText(payload.codigo_iso),
  });

  return resp.data;
}

export async function createRegion(payload: {
  nombre: string;
  pais_id: number;
}): Promise<Region> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre de la región es obligatorio.');
  }

  if (!payload.pais_id) {
    throw new Error('El país es obligatorio para crear una región.');
  }

  const resp = await api.post<Region>('/api/v1/ubicaciones/regiones/', {
    nombre,
    pais_id: payload.pais_id,
  });

  return resp.data;
}

export async function createLocalidad(payload: {
  nombre: string;
  region_id: number;
}): Promise<LocalidadWithContext> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre de la localidad es obligatorio.');
  }

  if (!payload.region_id) {
    throw new Error('La región es obligatoria para crear una localidad.');
  }

  const resp = await api.post<LocalidadWithContext>('/api/v1/ubicaciones/localidades/', {
    nombre,
    region_id: payload.region_id,
  });

  return resp.data;
}

// --------------------
// ACTUALIZACIÓN
// --------------------

export async function updatePais(
  id: number | string,
  payload: {
    nombre: string;
    codigo_iso?: string | null;
  }
): Promise<Pais> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre del país es obligatorio.');
  }

  const resp = await api.put<Pais>(`/api/v1/ubicaciones/paises/${encodeURIComponent(String(id))}`, {
    nombre,
    codigo_iso: cleanOptionalText(payload.codigo_iso),
  });

  return resp.data;
}

export async function updateRegion(
  id: number | string,
  payload: {
    nombre: string;
    pais_id: number;
  }
): Promise<Region> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre de la región es obligatorio.');
  }

  if (!payload.pais_id) {
    throw new Error('El país es obligatorio para actualizar una región.');
  }

  const resp = await api.put<Region>(`/api/v1/ubicaciones/regiones/${encodeURIComponent(String(id))}`, {
    nombre,
    pais_id: payload.pais_id,
  });

  return resp.data;
}

export async function updateLocalidad(
  id: number | string,
  payload: {
    nombre: string;
    region_id: number;
  }
): Promise<LocalidadWithContext> {
  const nombre = cleanText(payload.nombre);

  if (!nombre) {
    throw new Error('El nombre de la localidad es obligatorio.');
  }

  if (!payload.region_id) {
    throw new Error('La región es obligatoria para actualizar una localidad.');
  }

  const resp = await api.put<LocalidadWithContext>(
    `/api/v1/ubicaciones/localidades/${encodeURIComponent(String(id))}`,
    {
      nombre,
      region_id: payload.region_id,
    }
  );

  return resp.data;
}

// --------------------
// ELIMINACIÓN
// --------------------

export async function deletePais(id: number | string): Promise<void> {
  await api.delete(`/api/v1/ubicaciones/paises/${encodeURIComponent(String(id))}`);
}

export async function deleteRegion(id: number | string): Promise<void> {
  await api.delete(`/api/v1/ubicaciones/regiones/${encodeURIComponent(String(id))}`);
}

export async function deleteLocalidad(id: number | string): Promise<void> {
  await api.delete(`/api/v1/ubicaciones/localidades/${encodeURIComponent(String(id))}`);
}

const ubicacionesApi = {
  listPaises,
  listRegiones,
  listLocalidades,
  createPais,
  createRegion,
  createLocalidad,
  updatePais,
  updateRegion,
  updateLocalidad,
  deletePais,
  deleteRegion,
  deleteLocalidad,
};

export default ubicacionesApi;
