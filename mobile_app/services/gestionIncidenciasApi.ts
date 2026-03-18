/**
 * Ruta: mobile_app/services/gestionIncidenciasApi.ts
 * Versión: 1.2.0
 * Descripción:
 * Servicio API para el módulo de incidencias en GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Consulta de incidencias activas visibles para el usuario autenticado.
 * - Consulta de incidencias por contrato.
 * - Consulta de detalle de incidencia por id.
 * - Listado de proveedores operativos de incidencias.
 * - Asignación de proveedor a incidencia.
 * - Programación de visita para incidencia.
 * - NUEVO: actualización controlada de incidencia.
 *
 * Notas de diseño:
 * - Esta versión se apoya en /api/v1/gestion-incidencias.
 * - La autenticación se resuelve por Bearer token del usuario logueado.
 * - No requiere gestorPersonaId en el front.
 */

import axios from 'axios';
import { api } from './api';
import { colors } from '../theme';

const BASE = '/api/v1/gestion-incidencias';

const ENDPOINT_INCIDENCIAS_ACTIVAS = `${BASE}/incidencias/activas`;
const ENDPOINT_INCIDENCIA_BY_ID = (incidenciaId: string) =>
  `${BASE}/incidencias/${encodeURIComponent(incidenciaId)}`;
const ENDPOINT_INCIDENCIAS_BY_CONTRATO = (contratoId: string) =>
  `${BASE}/contratos/${encodeURIComponent(contratoId)}/incidencias`;
const ENDPOINT_PROVEEDORES = `${BASE}/proveedores`;
const ENDPOINT_ASSIGN_PROVIDER = (incidenciaId: string) =>
  `${BASE}/incidencias/${encodeURIComponent(incidenciaId)}/assign-provider`;
const ENDPOINT_SCHEDULE_VISIT = (incidenciaId: string) =>
  `${BASE}/incidencias/${encodeURIComponent(incidenciaId)}/schedule-visit`;

function logAxiosError(prefix: string, err: unknown) {
  if (axios.isAxiosError(err)) {
    console.error(prefix, err.response?.data || err.message);
  } else {
    console.error(prefix, err);
  }
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export type EstadoIncidencia =
  | 'new'
  | 'under_review'
  | 'awaiting_provider_assignment'
  | 'awaiting_quote'
  | 'quote_submitted'
  | 'quote_approved'
  | 'scheduled'
  | 'tenant_confirmed'
  | 'tenant_reschedule_requested'
  | 'in_progress'
  | 'awaiting_parts'
  | 'pending_follow_up'
  | 'resolved'
  | 'closed'
  | 'cancelled'
  | string;

export type PrioridadIncidencia = 'low' | 'normal' | 'high' | 'urgent' | string;

export type EstadoCitaIncidencia =
  | 'proposed'
  | 'confirmed'
  | 'rescheduled'
  | 'completed'
  | 'missed'
  | 'cancelled'
  | string;

export type EstadoInquilinoCita =
  | 'pending_confirmation'
  | 'confirmed'
  | 'reschedule_requested'
  | 'rejected'
  | string;

export type ResponsableActual = {
  tipo: 'gestor' | 'supervisor' | 'proveedor' | string;
  id: string;
  nombre?: string | null;
};

export const INCIDENCIA_ESTADO_OPTIONS = [
  { value: 'new', label: 'Nueva' },
  { value: 'under_review', label: 'En gestión' },
  { value: 'awaiting_provider_assignment', label: 'Pendiente de asignación de proveedor' },
  { value: 'awaiting_quote', label: 'Pendiente de presupuesto' },
  { value: 'quote_submitted', label: 'Presupuesto recibido' },
  { value: 'quote_approved', label: 'Presupuesto aprobado' },
  { value: 'scheduled', label: 'Visita programada' },
  { value: 'tenant_confirmed', label: 'Confirmada por inquilino' },
  { value: 'tenant_reschedule_requested', label: 'Reprogramación solicitada' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'awaiting_parts', label: 'Pendiente de piezas' },
  { value: 'pending_follow_up', label: 'Pendiente de seguimiento' },
  { value: 'resolved', label: 'Resuelta' },
  { value: 'closed', label: 'Cerrada' },
  { value: 'cancelled', label: 'Cancelada' },
] as const;

export type CitaIncidenciaResumen = {
  id: string;
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  fecha_inicio_programada?: string | null;
  fecha_fin_programada?: string | null;
  estado_cita?: EstadoCitaIncidencia | null;
  estado_cita_label?: string | null;
  estado_inquilino?: EstadoInquilinoCita | null;
  estado_inquilino_label?: string | null;
};

export type HistorialEstadoIncidenciaItem = {
  id: string;
  estado_anterior?: string | null;
  estado_anterior_label?: string | null;
  estado_nuevo: string;
  estado_nuevo_label: string;
  persona_cambia_id?: string | null;
  persona_cambia_nombre?: string | null;
  rol_cambia?: string | null;
  nota?: string | null;
  fecha_creacion?: string | null;
};

export type CitaIncidenciaItem = {
  id: string;
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  fecha_inicio_programada?: string | null;
  fecha_fin_programada?: string | null;
  estado_cita?: EstadoCitaIncidencia | null;
  estado_cita_label?: string | null;
  estado_inquilino?: EstadoInquilinoCita | null;
  estado_inquilino_label?: string | null;
  propuesta_por_persona_id?: string | null;
  propuesta_por_persona_nombre?: string | null;
  confirmada_por_persona_id?: string | null;
  confirmada_por_persona_nombre?: string | null;
  fecha_confirmacion?: string | null;
  motivo_reprogramacion?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type IncidenciaListItem = {
  id: string;
  codigo: string;
  estado: EstadoIncidencia;
  estado_label?: string | null;
  categoria?: string | null;
  titulo?: string | null;
  prioridad?: PrioridadIncidencia | null;
  prioridad_label?: string | null;
  fecha_creacion?: string | null;
  proveedor_actual_id?: string | null;
  proveedor_actual_nombre?: string | null;
  gestor_actual_id?: string | null;
  gestor_actual_nombre?: string | null;
  localidad?: string | null;
  contrato_id?: string | null;
  patrimonio_id?: string | null;
};

export type IncidenciaListResponse = {
  ok: boolean;
  items: IncidenciaListItem[];
};

export type IncidenciaDetailResponse = {
  ok: boolean;
  id: string;
  codigo: string;
  contrato_id?: string | null;
  patrimonio_id?: string | null;
  persona_reporta_id?: string | null;
  rol_reporta?: string | null;
  categoria?: string | null;
  titulo?: string | null;
  descripcion?: string | null;
  prioridad?: PrioridadIncidencia | null;
  prioridad_label?: string | null;
  estado?: EstadoIncidencia | null;
  estado_label?: string | null;
  telefono_inquilino_snapshot?: string | null;
  notas_acceso?: string | null;
  fecha_creacion?: string | null;
  fecha_actualizacion?: string | null;
  fecha_cierre?: string | null;
  responsable_actual?: ResponsableActual | null;
  ultima_cita?: CitaIncidenciaResumen | null;
  historial?: HistorialEstadoIncidenciaItem[];
  citas?: CitaIncidenciaItem[];
};

export type ProveedorListItem = {
  id: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  localidad?: string | null;
  activo: boolean;
};

export type ProveedorListResponse = {
  ok: boolean;
  items: ProveedorListItem[];
};

export type IncidenciaActionResponse = {
  ok: boolean;
  incidencia: {
    id: string;
    codigo: string;
    estado: EstadoIncidencia;
    estado_label?: string | null;
    categoria?: string | null;
    titulo?: string | null;
    prioridad?: PrioridadIncidencia | null;
    prioridad_label?: string | null;
    fecha_creacion?: string | null;
    contrato_id?: string | null;
    patrimonio_id?: string | null;
  };
  mensaje?: string | null;
};

export type ScheduleVisitPayload = {
  proveedor_id: string;
  fecha_inicio_programada: string;
  fecha_fin_programada?: string | null;
  motivo_reprogramacion?: string | null;
  nota?: string | null;
};

export type AssignProviderPayload = {
  proveedor_id: string;
  nota?: string | null;
};

export type IncidenciaUpdatePayload = {
  titulo?: string | null;
  descripcion?: string | null;
  telefono_inquilino_snapshot?: string | null;
  notas_acceso?: string | null;
  estado?: EstadoIncidencia | null;
  nota_operativa?: string | null;
};

export type IncidenciaUpdateResponse = {
  ok: boolean;
  incidencia: IncidenciaDetailResponse;
  mensaje?: string | null;
};

export type ScheduleVisitResponse = {
  ok: boolean;
  incidencia: IncidenciaActionResponse['incidencia'];
  cita?: CitaIncidenciaResumen | null;
  mensaje?: string | null;
};

function normalizeIncidenciaListItem(r: any): IncidenciaListItem {
  return {
    id: String(r?.id ?? ''),
    codigo: String(r?.codigo ?? ''),
    estado: String(r?.estado ?? ''),
    estado_label: r?.estado_label ?? null,
    categoria: r?.categoria ?? null,
    titulo: r?.titulo ?? null,
    prioridad: r?.prioridad ?? null,
    prioridad_label: r?.prioridad_label ?? null,
    fecha_creacion: r?.fecha_creacion ?? null,
    proveedor_actual_id: r?.proveedor_actual_id ?? null,
    proveedor_actual_nombre: r?.proveedor_actual_nombre ?? null,
    gestor_actual_id: r?.gestor_actual_id ?? null,
    gestor_actual_nombre: r?.gestor_actual_nombre ?? null,
    localidad: r?.localidad ?? null,
    contrato_id: r?.contrato_id ?? null,
    patrimonio_id: r?.patrimonio_id ?? null,
  };
}

function normalizeCitaResumen(r: any): CitaIncidenciaResumen | null {
  if (!r) return null;

  return {
    id: String(r?.id ?? ''),
    proveedor_id: r?.proveedor_id ?? null,
    proveedor_nombre: r?.proveedor_nombre ?? null,
    fecha_inicio_programada: r?.fecha_inicio_programada ?? null,
    fecha_fin_programada: r?.fecha_fin_programada ?? null,
    estado_cita: r?.estado_cita ?? null,
    estado_cita_label: r?.estado_cita_label ?? null,
    estado_inquilino: r?.estado_inquilino ?? null,
    estado_inquilino_label: r?.estado_inquilino_label ?? null,
  };
}

function normalizeResponsableActual(r: any): ResponsableActual | null {
  if (!r) return null;

  return {
    tipo: String(r?.tipo ?? ''),
    id: String(r?.id ?? ''),
    nombre: r?.nombre ?? null,
  };
}

function normalizeIncidenciaDetail(r: any): IncidenciaDetailResponse {
  return {
    ok: !!r?.ok,
    id: String(r?.id ?? ''),
    codigo: String(r?.codigo ?? ''),
    contrato_id: r?.contrato_id ?? null,
    patrimonio_id: r?.patrimonio_id ?? null,
    persona_reporta_id: r?.persona_reporta_id ?? null,
    rol_reporta: r?.rol_reporta ?? null,
    categoria: r?.categoria ?? null,
    titulo: r?.titulo ?? null,
    descripcion: r?.descripcion ?? null,
    prioridad: r?.prioridad ?? null,
    prioridad_label: r?.prioridad_label ?? null,
    estado: r?.estado ?? null,
    estado_label: r?.estado_label ?? null,
    telefono_inquilino_snapshot: r?.telefono_inquilino_snapshot ?? null,
    notas_acceso: r?.notas_acceso ?? null,
    fecha_creacion: r?.fecha_creacion ?? null,
    fecha_actualizacion: r?.fecha_actualizacion ?? null,
    fecha_cierre: r?.fecha_cierre ?? null,
    responsable_actual: normalizeResponsableActual(r?.responsable_actual),
    ultima_cita: normalizeCitaResumen(r?.ultima_cita),
    historial: Array.isArray(r?.historial) ? r.historial.map(normalizeHistorialItem) : [],
    citas: Array.isArray(r?.citas) ? r.citas.map(normalizeCitaItem) : [],
  };
}

function normalizeHistorialItem(r: any): HistorialEstadoIncidenciaItem {
  return {
    id: String(r?.id ?? ''),
    estado_anterior: r?.estado_anterior ?? null,
    estado_anterior_label: r?.estado_anterior_label ?? null,
    estado_nuevo: String(r?.estado_nuevo ?? ''),
    estado_nuevo_label: String(r?.estado_nuevo_label ?? ''),
    persona_cambia_id: r?.persona_cambia_id ?? null,
    persona_cambia_nombre: r?.persona_cambia_nombre ?? null,
    rol_cambia: r?.rol_cambia ?? null,
    nota: r?.nota ?? null,
    fecha_creacion: r?.fecha_creacion ?? null,
  };
}

function normalizeCitaItem(r: any): CitaIncidenciaItem {
  return {
    id: String(r?.id ?? ''),
    proveedor_id: r?.proveedor_id ?? null,
    proveedor_nombre: r?.proveedor_nombre ?? null,
    fecha_inicio_programada: r?.fecha_inicio_programada ?? null,
    fecha_fin_programada: r?.fecha_fin_programada ?? null,
    estado_cita: r?.estado_cita ?? null,
    estado_cita_label: r?.estado_cita_label ?? null,
    estado_inquilino: r?.estado_inquilino ?? null,
    estado_inquilino_label: r?.estado_inquilino_label ?? null,
    propuesta_por_persona_id: r?.propuesta_por_persona_id ?? null,
    propuesta_por_persona_nombre: r?.propuesta_por_persona_nombre ?? null,
    confirmada_por_persona_id: r?.confirmada_por_persona_id ?? null,
    confirmada_por_persona_nombre: r?.confirmada_por_persona_nombre ?? null,
    fecha_confirmacion: r?.fecha_confirmacion ?? null,
    motivo_reprogramacion: r?.motivo_reprogramacion ?? null,
    created_at: r?.created_at ?? null,
    updated_at: r?.updated_at ?? null,
  };
}

export function getIncidenciaEstadoColorToken(estado?: string | null): string {
  const value = String(estado ?? '').trim().toLowerCase();

  const redStates = new Set([
    'new',
    'awaiting_provider_assignment',
    'tenant_reschedule_requested',
    'awaiting_parts',
    'pending_follow_up',
    'cancelled',
  ]);

  const yellowStates = new Set([
    'under_review',
    'awaiting_quote',
    'quote_submitted',
    'quote_approved',
    'scheduled',
    'in_progress',
  ]);

  const greenStates = new Set([
    'tenant_confirmed',
    'resolved',
    'closed',
  ]);

  if (redStates.has(value)) return colors.danger;
  if (yellowStates.has(value)) return colors.warning;
  if (greenStates.has(value)) return colors.success;

  return colors.textSecondary;
}

export function getIncidenciaDisplaySubtitle(item: IncidenciaListItem): string {
  const parts = [
    item.categoria ? String(item.categoria) : '',
    item.estado_label ? String(item.estado_label) : '',
    item.proveedor_actual_nombre ? String(item.proveedor_actual_nombre) : '',
  ].filter(Boolean);

  return parts.join(' · ');
}

export async function listIncidenciasActivas(params?: {
  contratoId?: string;
}): Promise<IncidenciaListItem[]> {
  try {
    const res = await api.get<IncidenciaListResponse>(ENDPOINT_INCIDENCIAS_ACTIVAS, {
      params: {
        contrato_id: params?.contratoId || undefined,
      },
    });

    return safeArray(res.data?.items).map(normalizeIncidenciaListItem);
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error listando incidencias activas', err);
    throw err;
  }
}

export async function listIncidenciasByContrato(
  contratoId: string
): Promise<IncidenciaListItem[]> {
  try {
    const res = await api.get<IncidenciaListResponse>(ENDPOINT_INCIDENCIAS_BY_CONTRATO(contratoId));
    return safeArray(res.data?.items).map(normalizeIncidenciaListItem);
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error listando incidencias por contrato', err);
    throw err;
  }
}

export async function getIncidencia(incidenciaId: string): Promise<IncidenciaDetailResponse> {
  try {
    const res = await api.get<IncidenciaDetailResponse>(ENDPOINT_INCIDENCIA_BY_ID(incidenciaId));
    return normalizeIncidenciaDetail(res.data);
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error obteniendo incidencia', err);
    throw err;
  }
}

export async function updateIncidencia(
  incidenciaId: string,
  payload: IncidenciaUpdatePayload
): Promise<IncidenciaUpdateResponse> {
  try {
    const res = await api.put<IncidenciaUpdateResponse>(
      ENDPOINT_INCIDENCIA_BY_ID(incidenciaId),
      payload
    );

    return {
      ...res.data,
      incidencia: normalizeIncidenciaDetail(res.data?.incidencia),
    };
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error actualizando incidencia', err);
    throw err;
  }
}

export async function listProveedoresIncidencias(): Promise<ProveedorListItem[]> {
  try {
    const res = await api.get<ProveedorListResponse>(ENDPOINT_PROVEEDORES);
    return safeArray(res.data?.items).map((r: any) => ({
      id: String(r?.id ?? ''),
      nombre: String(r?.nombre ?? ''),
      telefono: r?.telefono ?? null,
      email: r?.email ?? null,
      localidad: r?.localidad ?? null,
      activo: !!r?.activo,
    }));
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error listando proveedores', err);
    throw err;
  }
}

export async function assignProveedorIncidencia(
  incidenciaId: string,
  payload: AssignProviderPayload
): Promise<IncidenciaActionResponse> {
  try {
    const res = await api.post<IncidenciaActionResponse>(
      ENDPOINT_ASSIGN_PROVIDER(incidenciaId),
      payload
    );

    return res.data;
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error asignando proveedor', err);
    throw err;
  }
}

export async function scheduleVisitIncidencia(
  incidenciaId: string,
  payload: ScheduleVisitPayload
): Promise<ScheduleVisitResponse> {
  try {
    const res = await api.post<ScheduleVisitResponse>(
      ENDPOINT_SCHEDULE_VISIT(incidenciaId),
      payload
    );

    return {
      ...res.data,
      cita: normalizeCitaResumen(res.data?.cita),
    };
  } catch (err) {
    logAxiosError('[gestionIncidenciasApi] Error programando visita', err);
    throw err;
  }
}

const gestionIncidenciasApi = {
  listIncidenciasActivas,
  listIncidenciasByContrato,
  getIncidencia,
  updateIncidencia,
  listProveedoresIncidencias,
  assignProveedorIncidencia,
  scheduleVisitIncidencia,
  getIncidenciaEstadoColorToken,
  getIncidenciaDisplaySubtitle,
};

export default gestionIncidenciasApi;