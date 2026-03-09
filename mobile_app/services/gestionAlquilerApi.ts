/**
 * Archivo: mobile_app/services/gestionAlquilerApi.ts
 * Versión: 3.2.0
 *
 * Servicio API para el módulo Gestión de Alquileres.
 *
 * Mejoras:
 * - Soporte a objeto_alquiler en contratos
 * - Endpoint de opciones dinámicas por patrimonio
 * - Helpers de etiquetas para mostrar objeto de alquiler
 */

import axios from 'axios';
import { api } from './api';

const BASE = '/api/v1/gestion-alquiler';

const ENDPOINT_PERSONAS = `${BASE}/personas`;
const ENDPOINT_PERSONAS_PICKER = `${BASE}/personas/picker`;

const ENDPOINT_CONTRATOS = `${BASE}/contratos`;
const ENDPOINT_PATRIMONIO_RESUMEN_ACTIVO = (patrimonioId: string) =>
  `${BASE}/patrimonios/${encodeURIComponent(patrimonioId)}/resumen-activo`;

const ENDPOINT_PATRIMONIO_OPCIONES_CONTRATO = (patrimonioId: string) =>
  `${BASE}/patrimonios/${encodeURIComponent(patrimonioId)}/opciones-contrato`;

const ENDPOINT_CONTRATO_PARTICIPANTES = (contratoId: string) =>
  `${BASE}/contratos/${encodeURIComponent(contratoId)}/participantes`;

const ENDPOINT_PARTICIPANTE_BY_ID = (participanteId: string) =>
  `${BASE}/contratos/participantes/${encodeURIComponent(participanteId)}`;

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

export type PersonaRow = {
  id: string;
  nombre_completo: string;
  dni?: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null;
  observaciones?: string | null;
  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;
};

export type PersonaPickerRow = {
  id: string;
  nombre_completo: string;
  dni?: string | null;
  telefono?: string | null;
};

export type PersonaCreate = {
  nombre_completo: string;
  dni?: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null;
  observaciones?: string | null;
};

export type PersonaUpdate = {
  nombre_completo?: string | null;
  dni?: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null;
  observaciones?: string | null;
  inactivatedon?: string | null;
};

export type RolParticipante = 'inquilino' | 'avalista' | 'gestor' | string;

export type ParticipantesResumen = {
  inquilino_principal?: string | null;
  inquilinos?: string[];
  avalistas?: string[];
  gestor?: string | null;
};

export type ContratoParticipanteRow = {
  id: string;
  contrato_id: string;
  persona_id: string;
  rol: RolParticipante;
  es_principal: boolean;
  observaciones?: string | null;
  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;
  nombre_completo?: string | null;
  dni?: string | null;
  telefono?: string | null;
  email?: string | null;
};

export type ContratoParticipanteCreate = {
  persona_id: string;
  rol: RolParticipante;
  es_principal?: boolean;
  observaciones?: string | null;
};

export type ContratoParticipanteUpdate = {
  rol?: RolParticipante;
  es_principal?: boolean;
  observaciones?: string | null;
  inactivatedon?: string | null;
};

export type EstadoContrato =
  | 'activo'
  | 'pendiente'
  | 'finalizado'
  | 'cancelado'
  | string;

export type ObjetoAlquilerCode =
  | 'completa'
  | 'vivienda'
  | 'garaje'
  | 'trastero'
  | 'garaje_trastero'
  | 'vivienda_garaje'
  | 'vivienda_trastero'
  | `habitacion_${number}`
  | string;

export type ContratoObjetoOpcionRow = {
  code: ObjetoAlquilerCode;
  label: string;
  enabled: boolean;
  disabled_reason?: string | null;
};

export type ContratoObjetoOpcionesResponse = {
  patrimonio_id: string;
  opciones: ContratoObjetoOpcionRow[];
};

export type ContratoRow = {
  id: string;
  user_id?: number | null;

  patrimonio_id: string;
  objeto_alquiler: ObjetoAlquilerCode;
  objeto_alquiler_label?: string | null;

  fecha_inicio?: string | null;
  fecha_fin?: string | null;

  renta_mensual?: number | null;
  fianza?: number | null;

  estado?: EstadoContrato | null;

  incluye_luz?: boolean | null;
  incluye_agua?: boolean | null;
  incluye_internet?: boolean | null;
  incremento_ipc?: boolean | null;

  observaciones?: string | null;

  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;

  referencia_vivienda?: string | null;
  direccion_completa?: string | null;

  participantes_resumen?: ParticipantesResumen | null;
};

export type ContratoCreate = {
  patrimonio_id: string;
  objeto_alquiler: ObjetoAlquilerCode;
  fecha_inicio: string;
  fecha_fin?: string | null;
  renta_mensual?: number | null;
  fianza?: number | null;
  estado?: EstadoContrato | null;
  incluye_luz?: boolean | null;
  incluye_agua?: boolean | null;
  incluye_internet?: boolean | null;
  observaciones?: string | null;
  incremento_ipc?: boolean | null;
};

export type ContratoUpdate = {
  objeto_alquiler?: ObjetoAlquilerCode | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  renta_mensual?: number | null;
  fianza?: number | null;
  estado?: EstadoContrato | null;
  incluye_luz?: boolean | null;
  incluye_agua?: boolean | null;
  incluye_internet?: boolean | null;
  observaciones?: string | null;
  inactivatedon?: string | null;
  incremento_ipc?: boolean | null;
};

export type ContratoResumenActivo = {
  contrato_id: string;
  estado: EstadoContrato;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  renta_mensual?: number | null;
  fianza?: number | null;
  objeto_alquiler?: ObjetoAlquilerCode | null;
  objeto_alquiler_label?: string | null;
  participantes_resumen?: ParticipantesResumen | null;
};

export type ListContratosParams = {
  patrimonio_id?: string;
};

function normalizePersonaRow(r: PersonaRow): PersonaRow {
  return {
    ...r,
    nombre_completo: r.nombre_completo ?? '',
  };
}

function normalizeContratoRow(r: ContratoRow): ContratoRow {
  return {
    ...r,
    patrimonio_id: String(r.patrimonio_id ?? ''),
    objeto_alquiler: String(r.objeto_alquiler ?? 'completa'),
    objeto_alquiler_label: r.objeto_alquiler_label ?? getObjetoAlquilerLabel(r.objeto_alquiler ?? 'completa'),
    incluye_luz: r.incluye_luz ?? false,
    incluye_agua: r.incluye_agua ?? false,
    incluye_internet: r.incluye_internet ?? false,
    incremento_ipc: r.incremento_ipc ?? false,
    participantes_resumen: r.participantes_resumen ?? {
      inquilino_principal: null,
      inquilinos: [],
      avalistas: [],
      gestor: null,
    },
  };
}

function normalizeParticipanteRow(r: ContratoParticipanteRow): ContratoParticipanteRow {
  return {
    ...r,
    es_principal: !!r.es_principal,
  };
}

export function getObjetoAlquilerLabel(code?: string | null): string {
  const c = String(code ?? '').trim().toLowerCase();

  if (c === 'completa') return 'Completa';
  if (c === 'vivienda') return 'Vivienda';
  if (c === 'garaje') return 'Garaje';
  if (c === 'trastero') return 'Trastero';
  if (c === 'garaje_trastero') return 'Garaje + Trastero';
  if (c === 'vivienda_garaje') return 'Vivienda + Garaje';
  if (c === 'vivienda_trastero') return 'Vivienda + Trastero';

  if (c.startsWith('habitacion_')) {
    const n = c.replace('habitacion_', '');
    return `Hab ${n}`;
  }

  return c || '—';
}

export function getContratoDisplayTenantName(contrato: ContratoRow | null | undefined): string {
  if (!contrato) return '';

  const resumen = contrato.participantes_resumen;
  const principal = String(resumen?.inquilino_principal ?? '').trim();
  if (principal) return principal;

  const firstInquilino = safeArray(resumen?.inquilinos)
    .map((x) => String(x ?? '').trim())
    .find((x) => x.length > 0);
  if (firstInquilino) return firstInquilino;

  return '';
}

export function getContratoDisplaySubtitle(contrato: ContratoRow | null | undefined): string {
  if (!contrato) return '';
  const tenant = getContratoDisplayTenantName(contrato);
  const objeto = getObjetoAlquilerLabel(contrato.objeto_alquiler);
  return tenant ? `${tenant} · ${objeto}` : objeto;
}

export async function listPersonas(params?: {
  q?: string;
  activas?: boolean;
}): Promise<PersonaRow[]> {
  try {
    const res = await api.get<PersonaRow[]>(ENDPOINT_PERSONAS, { params });
    const data = Array.isArray(res.data) ? res.data : [];
    return data.map(normalizePersonaRow);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error listando personas', err);
    throw err;
  }
}

export async function listPersonasPicker(params?: {
  q?: string;
}): Promise<PersonaPickerRow[]> {
  try {
    const res = await api.get<PersonaPickerRow[]>(ENDPOINT_PERSONAS_PICKER, { params });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error listando picker de personas', err);
    throw err;
  }
}

export async function getPersona(personaId: string): Promise<PersonaRow> {
  const url = `${ENDPOINT_PERSONAS}/${encodeURIComponent(personaId)}`;
  try {
    const res = await api.get<PersonaRow>(url);
    return normalizePersonaRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error obteniendo persona', err);
    throw err;
  }
}

export async function createPersona(payload: PersonaCreate): Promise<PersonaRow> {
  try {
    const res = await api.post<PersonaRow>(ENDPOINT_PERSONAS, payload);
    return normalizePersonaRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error creando persona', err);
    throw err;
  }
}

export async function updatePersona(personaId: string, payload: PersonaUpdate): Promise<PersonaRow> {
  const url = `${ENDPOINT_PERSONAS}/${encodeURIComponent(personaId)}`;
  try {
    const res = await api.put<PersonaRow>(url, payload);
    return normalizePersonaRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error actualizando persona', err);
    throw err;
  }
}

export async function listContratos(params?: ListContratosParams): Promise<ContratoRow[]> {
  try {
    const res = await api.get<ContratoRow[]>(ENDPOINT_CONTRATOS, { params });
    const data = Array.isArray(res.data) ? res.data : [];
    return data.map(normalizeContratoRow);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error listando contratos', err);
    throw err;
  }
}

export async function listOpcionesContratoPorPatrimonio(params: {
  patrimonioId: string;
  contratoIdExclude?: string | null;
}): Promise<ContratoObjetoOpcionesResponse> {
  const url = ENDPOINT_PATRIMONIO_OPCIONES_CONTRATO(params.patrimonioId);
  try {
    const res = await api.get<ContratoObjetoOpcionesResponse>(url, {
      params: {
        contrato_id_exclude: params.contratoIdExclude || undefined,
      },
    });

    return {
      patrimonio_id: String(res.data?.patrimonio_id ?? params.patrimonioId),
      opciones: Array.isArray(res.data?.opciones) ? res.data.opciones : [],
    };
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error cargando opciones de contrato por patrimonio', err);
    throw err;
  }
}

export async function createContrato(payload: ContratoCreate): Promise<ContratoRow> {
  try {
    const res = await api.post<ContratoRow>(ENDPOINT_CONTRATOS, payload);
    return normalizeContratoRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error creando contrato', err);
    throw err;
  }
}

export async function getContrato(contratoId: string): Promise<ContratoRow> {
  const url = `${ENDPOINT_CONTRATOS}/${encodeURIComponent(contratoId)}`;
  try {
    const res = await api.get<ContratoRow>(url);
    return normalizeContratoRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error obteniendo contrato', err);
    throw err;
  }
}

export async function updateContrato(contratoId: string, payload: ContratoUpdate): Promise<ContratoRow> {
  const url = `${ENDPOINT_CONTRATOS}/${encodeURIComponent(contratoId)}`;
  try {
    const res = await api.put<ContratoRow>(url, payload);
    return normalizeContratoRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error actualizando contrato', err);
    throw err;
  }
}

export async function getContratoActivoResumenByPatrimonio(
  patrimonioId: string
): Promise<ContratoResumenActivo | null> {
  const url = ENDPOINT_PATRIMONIO_RESUMEN_ACTIVO(patrimonioId);
  try {
    const res = await api.get<ContratoResumenActivo | null>(url);
    return res.data ?? null;
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error obteniendo resumen activo por patrimonio', err);
    throw err;
  }
}

export async function listContratoParticipantes(
  contratoId: string
): Promise<ContratoParticipanteRow[]> {
  const url = ENDPOINT_CONTRATO_PARTICIPANTES(contratoId);
  try {
    const res = await api.get<ContratoParticipanteRow[]>(url);
    const data = Array.isArray(res.data) ? res.data : [];
    return data.map(normalizeParticipanteRow);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error listando participantes de contrato', err);
    throw err;
  }
}

export async function createContratoParticipante(
  contratoId: string,
  payload: ContratoParticipanteCreate
): Promise<ContratoParticipanteRow> {
  const url = ENDPOINT_CONTRATO_PARTICIPANTES(contratoId);
  try {
    const res = await api.post<ContratoParticipanteRow>(url, payload);
    return normalizeParticipanteRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error creando participante de contrato', err);
    throw err;
  }
}

export async function updateContratoParticipante(
  participanteId: string,
  payload: ContratoParticipanteUpdate
): Promise<ContratoParticipanteRow> {
  const url = ENDPOINT_PARTICIPANTE_BY_ID(participanteId);
  try {
    const res = await api.put<ContratoParticipanteRow>(url, payload);
    return normalizeParticipanteRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error actualizando participante', err);
    throw err;
  }
}

export async function deleteContratoParticipante(participanteId: string): Promise<void> {
  const url = ENDPOINT_PARTICIPANTE_BY_ID(participanteId);
  try {
    await api.delete(url);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error eliminando participante', err);
    throw err;
  }
}

async function httpGet<T>(path: string): Promise<T> {
  const res = await api.get<T>(path);
  return res.data;
}

const gestionAlquilerApi = {
  listPersonas,
  listPersonasPicker,
  getPersona,
  createPersona,
  updatePersona,
  listContratos,
  listOpcionesContratoPorPatrimonio,
  createContrato,
  getContrato,
  updateContrato,
  getContratoActivoResumenByPatrimonio,
  listContratoParticipantes,
  createContratoParticipante,
  updateContratoParticipante,
  deleteContratoParticipante,
  getObjetoAlquilerLabel,
  getContratoDisplayTenantName,
  getContratoDisplaySubtitle,
  httpGet,
};

export default gestionAlquilerApi;