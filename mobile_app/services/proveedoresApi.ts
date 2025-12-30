// mobile_app/services/proveedoresApi.ts
import axios from 'axios';
import { api } from './api';

/**
 * Servicio centralizado para proveedores.
 *
 * Backend (según tu router):
 * - GET    /api/v1/proveedores
 * - POST   /api/v1/proveedores
 * - PUT    /api/v1/proveedores/{prov_id}
 *
 * IMPORTANTE:
 * - El backend NO recibe localidad_id / region_id / pais_id en ProveedorCreate/Update.
 * - Solo recibe campos de texto: localidad, comunidad, pais (y rama_id).
 */

// =======================
// Tipos (DTOs) coherentes con lo que usa la UI
// =======================

export type ProveedorRead = {
  id: string;
  nombre: string;
  rama_id: string | null;

  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;

  /**
   * Estos “rel” los usas en AuxEntityFormScreen en modo edición:
   * - editingProveedor.rama_rel?.nombre
   * - editingProveedor.localidad_rel?.region?.pais?.nombre
   *
   * Si tu backend realmente los devuelve en ProveedorRead, perfecto.
   * Si no, quedan opcionales y no rompen la app.
   */
  rama_rel?: { id: string; nombre: string } | null;

  // Si en tu backend ProveedorRead incluye una relación a localidad por FK, será algo así:
  // (en tu router actual NO se ve, pero tu UI lo usa, por eso lo tipamos opcional)
  localidad_id?: number | null;
  localidad_rel?: {
    id: number;
    nombre: string;
    region?: {
      id: number;
      nombre: string;
      pais?: { id: number; nombre: string } | null;
    } | null;
  } | null;
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

// Alias de compatibilidad (para imports existentes)
export type Proveedor = ProveedorRead;

// =======================
// Endpoint base
// =======================

const BASE = '/api/v1/proveedores';

// =======================
// Helpers de logging
// =======================

function logAxiosError(prefix: string, err: unknown, ctx?: any) {
  if (axios.isAxiosError(err)) {
    console.error(
      prefix,
      ctx ? JSON.stringify(ctx) : '',
      'message=',
      err.message,
      'status=',
      err.response?.status,
      'data=',
      JSON.stringify(err.response?.data ?? null)
    );
  } else {
    console.error(prefix, ctx ? JSON.stringify(ctx) : '', err);
  }
}

// =======================
// API
// =======================

export async function listProveedores(params?: { rama_id?: string }): Promise<ProveedorRead[]> {
  try {
    const res = await api.get<ProveedorRead[]>(BASE, { params });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    logAxiosError('[proveedoresApi] Error listProveedores', err, { params });
    throw err;
  }
}

export async function createProveedor(payload: ProveedorCreate): Promise<ProveedorRead> {
  try {
    const res = await api.post<ProveedorRead>(BASE, payload);
    return res.data;
  } catch (err) {
    logAxiosError('[proveedoresApi] Error createProveedor', err, { payload });
    throw err;
  }
}

export async function updateProveedor(provId: string, payload: ProveedorUpdate): Promise<ProveedorRead> {
  try {
    const res = await api.put<ProveedorRead>(`${BASE}/${encodeURIComponent(provId)}`, payload);
    return res.data;
  } catch (err) {
    logAxiosError('[proveedoresApi] Error updateProveedor', err, { provId, payload });
    throw err;
  }
}

/**
 * Solo funcionará cuando implementes DELETE en backend.
 */
export async function deleteProveedor(provId: string): Promise<void> {
  try {
    await api.delete(`${BASE}/${encodeURIComponent(provId)}`);
  } catch (err) {
    logAxiosError('[proveedoresApi] Error deleteProveedor', err, { provId });
    throw err;
  }
}

// =======================
// Helper específico para el formulario AuxEntityFormScreen
// =======================

/**
 * Este helper existía en tu pantalla, pero no estaba en el fichero que me pegaste antes.
 * Lo implementamos aquí de forma consistente con el backend:
 *
 * - No enviamos localidad_id (el backend no lo acepta).
 * - Priorizamos textos: localidadTexto/comunidadTexto/paisTexto.
 */
export async function createProveedorFromAuxForm(args: {
  nombre: string;
  ramaId: string;
  localidadId?: number | null; // se conserva por compatibilidad, pero NO se envía al backend
  localidadTexto?: string | null;
  comunidadTexto?: string | null;
  paisTexto?: string | null;
}): Promise<ProveedorRead> {
  const payload: ProveedorCreate = {
    nombre: args.nombre,
    rama_id: args.ramaId,
    localidad: (args.localidadTexto ?? null) as string | null,
    comunidad: (args.comunidadTexto ?? null) as string | null,
    pais: (args.paisTexto ?? null) as string | null,
  };

  // Nota: args.localidadId existe para la UI (selección), pero backend actual no lo usa.
  return createProveedor(payload);
}

// Export default por compatibilidad con imports antiguos
const proveedoresApi = {
  listProveedores,
  createProveedor,
  createProveedorFromAuxForm,
  updateProveedor,
  deleteProveedor,
};

export default proveedoresApi;
