/**
 * Ruta: mobile_app/services/proveedoresApi.ts
 * Versión: 1.6.0
 * Descripción:
 * Servicio centralizado de proveedores para GapptoMobile.
 *
 * Responsabilidades:
 * - Listar, crear, actualizar y eliminar proveedores.
 * - Tipar correctamente todos los campos expuestos por backend.
 * - Dar soporte al formulario auxiliar de proveedores.
 * - Exponer associated_count cuando venga en listados backend.
 */

import axios from 'axios';
import { api } from './api';

// =======================
// Relaciones ligeras
// =======================

export type RamaProveedorRel = {
  id: string;
  nombre: string;
};

export type SubsegmentoProveedorRel = {
  id: string;
  nombre: string;
  rama_id?: string | null;
};

export type LocalidadRel = {
  id: number;
  nombre: string;
  region?: {
    id: number;
    nombre: string;
    pais?: {
      id: number;
      nombre: string;
    } | null;
  } | null;
};

// =======================
// Tipos principales
// =======================

export type ProveedorRead = {
  id: string;
  nombre: string;
  rama_id: string | null;

  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;
  localidad_id?: number | null;

  cif?: string | null;
  telefono?: string | null;
  email?: string | null;

  subsegmento?: string | null;
  subsegmento_id?: string | null;

  direccion?: string | null;
  codigo_postal?: string | null;
  persona_contacto?: string | null;

  activo?: boolean | null;
  observaciones?: string | null;
  acepta_urgencias?: boolean | null;
  ambito_servicio?: string | null;

  user_id?: number | null;
  associated_count?: number | null;

  created_at?: string | null;
  updated_at?: string | null;

  rama_rel?: RamaProveedorRel | null;
  subsegmento_rel?: SubsegmentoProveedorRel | null;
  localidad_rel?: LocalidadRel | null;
};

export type ProveedorCreate = {
  nombre: string;
  rama_id: string;

  localidad_id?: number | null;
  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;

  cif?: string | null;
  telefono?: string | null;
  email?: string | null;

  subsegmento?: string | null;
  subsegmento_id?: string | null;

  direccion?: string | null;
  codigo_postal?: string | null;
  persona_contacto?: string | null;

  activo?: boolean | null;
  observaciones?: string | null;
  acepta_urgencias?: boolean | null;
  ambito_servicio?: string | null;
};

export type ProveedorUpdate = {
  nombre?: string | null;
  rama_id?: string | null;

  localidad_id?: number | null;
  localidad?: string | null;
  pais?: string | null;
  comunidad?: string | null;

  cif?: string | null;
  telefono?: string | null;
  email?: string | null;

  subsegmento?: string | null;
  subsegmento_id?: string | null;

  direccion?: string | null;
  codigo_postal?: string | null;
  persona_contacto?: string | null;

  activo?: boolean | null;
  observaciones?: string | null;
  acepta_urgencias?: boolean | null;
  ambito_servicio?: string | null;
};

// Alias de compatibilidad
export type Proveedor = ProveedorRead;

// =======================
// Endpoint base
// =======================

const BASE = '/api/v1/proveedores';

// =======================
// Helpers internos
// =======================

function normalizeOptionalText(value?: string | null): string | null {
  const s = (value ?? '').trim();
  return s.length > 0 ? s : null;
}

function normalizeOptionalBool(value?: boolean | null): boolean | null | undefined {
  if (typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

function compactPayload<T extends Record<string, any>>(payload: T): T {
  const out: Record<string, any> = {};

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      out[key] = value;
    }
  });

  return out as T;
}

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
// API pública
// =======================

export async function listProveedores(params?: {
  rama_id?: string;
  subsegmento_id?: string;
}): Promise<ProveedorRead[]> {
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
    const safePayload = compactPayload<ProveedorCreate>({
      nombre: payload.nombre,
      rama_id: payload.rama_id,

      localidad_id: payload.localidad_id ?? undefined,
      localidad: normalizeOptionalText(payload.localidad),
      comunidad: normalizeOptionalText(payload.comunidad),
      pais: normalizeOptionalText(payload.pais),

      cif: normalizeOptionalText(payload.cif),
      telefono: normalizeOptionalText(payload.telefono),
      email: normalizeOptionalText(payload.email),

      subsegmento: normalizeOptionalText(payload.subsegmento),
      subsegmento_id: normalizeOptionalText(payload.subsegmento_id),

      direccion: normalizeOptionalText(payload.direccion),
      codigo_postal: normalizeOptionalText(payload.codigo_postal),
      persona_contacto: normalizeOptionalText(payload.persona_contacto),

      activo: normalizeOptionalBool(payload.activo),
      observaciones: normalizeOptionalText(payload.observaciones),
      acepta_urgencias: normalizeOptionalBool(payload.acepta_urgencias),
      ambito_servicio: normalizeOptionalText(payload.ambito_servicio),
    });

    const res = await api.post<ProveedorRead>(BASE, safePayload);
    return res.data;
  } catch (err) {
    logAxiosError('[proveedoresApi] Error createProveedor', err, { payload });
    throw err;
  }
}

export async function updateProveedor(
  provId: string,
  payload: ProveedorUpdate
): Promise<ProveedorRead> {
  try {
    const safePayload = compactPayload<ProveedorUpdate>({
      nombre: payload.nombre != null ? payload.nombre : undefined,
      rama_id: payload.rama_id != null ? payload.rama_id : undefined,

      localidad_id: payload.localidad_id ?? undefined,
      localidad: payload.localidad !== undefined ? normalizeOptionalText(payload.localidad) : undefined,
      comunidad: payload.comunidad !== undefined ? normalizeOptionalText(payload.comunidad) : undefined,
      pais: payload.pais !== undefined ? normalizeOptionalText(payload.pais) : undefined,

      cif: payload.cif !== undefined ? normalizeOptionalText(payload.cif) : undefined,
      telefono: payload.telefono !== undefined ? normalizeOptionalText(payload.telefono) : undefined,
      email: payload.email !== undefined ? normalizeOptionalText(payload.email) : undefined,

      subsegmento: payload.subsegmento !== undefined ? normalizeOptionalText(payload.subsegmento) : undefined,
      subsegmento_id:
        payload.subsegmento_id !== undefined
          ? normalizeOptionalText(payload.subsegmento_id)
          : undefined,

      direccion: payload.direccion !== undefined ? normalizeOptionalText(payload.direccion) : undefined,
      codigo_postal:
        payload.codigo_postal !== undefined
          ? normalizeOptionalText(payload.codigo_postal)
          : undefined,
      persona_contacto:
        payload.persona_contacto !== undefined
          ? normalizeOptionalText(payload.persona_contacto)
          : undefined,

      activo:
        payload.activo !== undefined ? normalizeOptionalBool(payload.activo) : undefined,
      observaciones:
        payload.observaciones !== undefined
          ? normalizeOptionalText(payload.observaciones)
          : undefined,
      acepta_urgencias:
        payload.acepta_urgencias !== undefined
          ? normalizeOptionalBool(payload.acepta_urgencias)
          : undefined,
      ambito_servicio:
        payload.ambito_servicio !== undefined
          ? normalizeOptionalText(payload.ambito_servicio)
          : undefined,
    });

    const res = await api.put<ProveedorRead>(
      `${BASE}/${encodeURIComponent(provId)}`,
      safePayload
    );
    return res.data;
  } catch (err) {
    logAxiosError('[proveedoresApi] Error updateProveedor', err, { provId, payload });
    throw err;
  }
}

export async function deleteProveedor(provId: string): Promise<void> {
  try {
    await api.delete(`${BASE}/${encodeURIComponent(provId)}`);
  } catch (err) {
    logAxiosError('[proveedoresApi] Error deleteProveedor', err, { provId });
    throw err;
  }
}

// =======================
// Helper específico para AuxEntityFormScreen
// =======================

export async function createProveedorFromAuxForm(args: {
  nombre: string;
  ramaId: string;

  localidadId?: number | null;
  localidadTexto?: string | null;
  comunidadTexto?: string | null;
  paisTexto?: string | null;

  cif?: string | null;
  telefono?: string | null;
  email?: string | null;

  subsegmento?: string | null;
  subsegmentoId?: string | null;

  direccion?: string | null;
  codigoPostal?: string | null;
  personaContacto?: string | null;

  activo?: boolean | null;
  observaciones?: string | null;
  aceptaUrgencias?: boolean | null;
  ambitoServicio?: string | null;
}): Promise<ProveedorRead> {
  const payload: ProveedorCreate = {
    nombre: args.nombre,
    rama_id: args.ramaId,

    localidad_id: args.localidadId ?? undefined,
    localidad: args.localidadTexto ?? null,
    comunidad: args.comunidadTexto ?? null,
    pais: args.paisTexto ?? null,

    cif: args.cif ?? null,
    telefono: args.telefono ?? null,
    email: args.email ?? null,

    subsegmento: args.subsegmento ?? null,
    subsegmento_id: args.subsegmentoId ?? null,

    direccion: args.direccion ?? null,
    codigo_postal: args.codigoPostal ?? null,
    persona_contacto: args.personaContacto ?? null,

    activo: args.activo ?? undefined,
    observaciones: args.observaciones ?? null,
    acepta_urgencias: args.aceptaUrgencias ?? undefined,
    ambito_servicio: args.ambitoServicio ?? null,
  };

  return createProveedor(payload);
}

const proveedoresApi = {
  listProveedores,
  createProveedor,
  createProveedorFromAuxForm,
  updateProveedor,
  deleteProveedor,
};

export default proveedoresApi;