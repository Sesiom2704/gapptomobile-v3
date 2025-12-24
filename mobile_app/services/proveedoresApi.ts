// mobile_app/services/proveedoresApi.ts
import axios from 'axios';
import { api } from './api';
import { RamaProveedor } from './ramasProveedoresApi';

/**
 * Tipos auxiliares para País / Región / Localidad
 * (alineados con los schemas de backend).
 */
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
  region?: Region | null;
}

/**
 * Tipos para Proveedor (coinciden con schemas Proveedor / ProveedorCreate / ProveedorUpdate)
 */
export interface Proveedor {
  id: string;
  nombre: string;

  rama_id?: string | null;
  localidad_id?: number | null;

  localidad?: string | null;
  comunidad?: string | null;
  pais?: string | null;

  user_id: number;

  localidad_rel?: LocalidadWithContext | null;
  rama_rel?: RamaProveedor | null;
}

/**
 * Payload de creación (backend espera snake_case)
 */
export interface ProveedorCreateRequest {
  nombre: string;
  rama_id?: string | null;

  // Flujo normalizado
  localidad_id?: number | null;

  // Flujo legacy (opcionales)
  localidad?: string | null;
  comunidad?: string | null;
  pais?: string | null;
}

export type ProveedorUpdateRequest = Partial<ProveedorCreateRequest>;

export async function listProveedores(options?: {
  ramaId?: string;
}): Promise<Proveedor[]> {
  /**
   * Importante:
   * - En el backend, el LIST (GET) suele estar en '/api/v1/proveedores' (sin slash final)
   * - Mientras que CREATE (POST) puede estar en '/api/v1/proveedores/' (con slash final)
   * Si llamamos al GET con '/', y en esa URL existe un POST, FastAPI responde 405 (Method Not Allowed).
   */
  const urlList = '/api/v1/proveedores'; // ✅ SIN slash final

  try {
    const resp = await api.get<Proveedor[]>(urlList, {
      params: options?.ramaId ? { rama_id: options.ramaId } : undefined,
    });
    return resp.data ?? [];
  } catch (err) {
    // Fallback: si por cualquier motivo el backend estuviera al revés en algún entorno
    if (axios.isAxiosError(err) && err.response?.status === 405) {
      const urlAlt = '/api/v1/proveedores/'; // fallback legacy
      const resp = await api.get<Proveedor[]>(urlAlt, {
        params: options?.ramaId ? { rama_id: options.ramaId } : undefined,
      });
      return resp.data ?? [];
    }
    throw err;
  }
}

/**
 * CREAR PROVEEDOR
 * POST /api/v1/proveedores/
 */
export async function createProveedor(
  payload: ProveedorCreateRequest
): Promise<Proveedor> {
  try {
    const resp = await api.post<Proveedor>('/api/v1/proveedores', payload);
    return resp.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error createProveedor',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        err.response?.data
      );
    } else {
      console.error('[proveedoresApi] Error createProveedor', err);
    }
    throw err;
  }
}

/**
 * ACTUALIZAR PROVEEDOR
 * PUT /api/v1/proveedores/{id}/
 */
export async function updateProveedor(
  id: string,
  payload: ProveedorUpdateRequest
): Promise<Proveedor> {
  try {
    const resp = await api.put<Proveedor>(`/api/v1/proveedores${id}/`, payload);
    return resp.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error updateProveedor',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        err.response?.data
      );
    } else {
      console.error('[proveedoresApi] Error updateProveedor', err);
    }
    throw err;
  }
}

/**
 * ELIMINAR PROVEEDOR
 * DELETE /api/v1/proveedores/{id}/
 */
export async function deleteProveedor(id: string): Promise<void> {
  try {
    await api.delete(`/api/v1/proveedores${id}/`);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[proveedoresApi] Error deleteProveedor',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        err.response?.data
      );
    } else {
      console.error('[proveedoresApi] Error deleteProveedor', err);
    }
    throw err;
  }
}

/**
 * Helper orientado al formulario auxiliar:
 * Recibe los campos tal y como los tienes en AuxEntityFormScreen
 * y construye el payload correcto para el backend (snake_case).
 */
export async function createProveedorFromAuxForm(params: {
  nombre: string;
  ramaId?: string | null;
  localidadId?: number | null;
  localidadTexto?: string | null;
  comunidadTexto?: string | null;
  paisTexto?: string | null;
}): Promise<Proveedor> {
  const payload: ProveedorCreateRequest = {
    nombre: params.nombre.trim(),
    rama_id: params.ramaId ?? null,
    localidad_id: params.localidadId ?? null,
    localidad: params.localidadTexto?.trim() ? params.localidadTexto.trim() : null,
    comunidad: params.comunidadTexto?.trim() ? params.comunidadTexto.trim() : null,
    pais: params.paisTexto?.trim() ? params.paisTexto.trim() : null,
  };

  return createProveedor(payload);
}
