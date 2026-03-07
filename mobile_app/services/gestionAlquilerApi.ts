// mobile_app/services/gestionAlquilerApi.ts
//
// Servicio API para el módulo Gestión de Alquileres en GapptoMobile v1.
//
// Incluye:
// - Personas
// - Contratos
// - Participantes de contrato
// - Resumen activo por patrimonio
//
// Importante:
// - Todas las llamadas van contra /api/v1/gestion-alquiler
// - Este servicio asume que ya tienes configurado el axios instance en:
//     mobile_app/services/api.ts
//   con baseURL y auth headers (token) resueltos.
//
// Objetivo de esta versión:
// - Conectar las pantallas ya diseñadas con el backend nuevo.
// - Mantener el patrón de servicios simple y consistente con patrimonioApi.ts.

import axios from 'axios';
import { api } from './api';

// =====================================================
// Base
// =====================================================
const BASE = '/api/v1/gestion-alquiler';

const ENDPOINT_PERSONAS = `${BASE}/personas`;
const ENDPOINT_PERSONAS_PICKER = `${BASE}/personas/picker`;

const ENDPOINT_CONTRATOS = `${BASE}/contratos`;
const ENDPOINT_PATRIMONIO_RESUMEN_ACTIVO = (patrimonioId: string) =>
  `${BASE}/patrimonios/${encodeURIComponent(patrimonioId)}/resumen-activo`;

const ENDPOINT_CONTRATO_PARTICIPANTES = (contratoId: string) =>
  `${BASE}/contratos/${encodeURIComponent(contratoId)}/participantes`;

const ENDPOINT_PARTICIPANTE_BY_ID = (participanteId: string) =>
  `${BASE}/contratos/participantes/${encodeURIComponent(participanteId)}`;

// =====================================================
// Helpers
// =====================================================
function logAxiosError(prefix: string, err: unknown) {
  if (axios.isAxiosError(err)) {
    console.error(prefix, err.response?.data || err.message);
  } else {
    console.error(prefix, err);
  }
}

// =====================================================
// Tipos PERSONAS
// =====================================================
export type PersonaRow = {
  id: string;
  nombre_completo: string;

  dni?: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null; // YYYY-MM-DD
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

// =====================================================
// Tipos PARTICIPANTES
// =====================================================
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

  // Expansión de persona
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

// =====================================================
// Tipos CONTRATOS
// =====================================================
export type EstadoContrato =
  | 'activo'
  | 'pendiente'
  | 'finalizado'
  | 'cancelado'
  | string;

export type ContratoRow = {
  id: string;
  user_id?: number | null;

  patrimonio_id: string;

  fecha_inicio?: string | null; // YYYY-MM-DD
  fecha_fin?: string | null; // YYYY-MM-DD

  renta_mensual?: number | null;
  fianza?: number | null;

  estado?: EstadoContrato | null;

  incluye_luz?: boolean | null;
  incluye_agua?: boolean | null;
  incluye_internet?: boolean | null;

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
  fecha_inicio: string; // YYYY-MM-DD
  fecha_fin?: string | null;
  renta_mensual?: number | null;
  fianza?: number | null;
  estado?: EstadoContrato | null;
  incluye_luz?: boolean | null;
  incluye_agua?: boolean | null;
  incluye_internet?: boolean | null;
  observaciones?: string | null;
};

export type ContratoUpdate = {
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
};

export type ContratoResumenActivo = {
  contrato_id: string;
  estado: EstadoContrato;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  renta_mensual?: number | null;
  fianza?: number | null;
  participantes_resumen?: ParticipantesResumen | null;
};

// =====================================================
// Normalizadores
// =====================================================
function normalizePersonaRow(r: PersonaRow): PersonaRow {
  return {
    ...r,
    nombre_completo: r.nombre_completo ?? '',
  };
}

function normalizeContratoRow(r: ContratoRow): ContratoRow {
  return {
    ...r,
    incluye_luz: r.incluye_luz ?? false,
    incluye_agua: r.incluye_agua ?? false,
    incluye_internet: r.incluye_internet ?? false,
  };
}

function normalizeParticipanteRow(r: ContratoParticipanteRow): ContratoParticipanteRow {
  return {
    ...r,
    es_principal: !!r.es_principal,
  };
}

// =====================================================
// PERSONAS
// =====================================================
export async function listPersonas(params?: {
  q?: string;
  activas?: boolean;
}): Promise<PersonaRow[]> {
  console.log('[gestionAlquilerApi] GET personas ->', ENDPOINT_PERSONAS, params);
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
  console.log('[gestionAlquilerApi] GET personas picker ->', ENDPOINT_PERSONAS_PICKER, params);
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
  console.log('[gestionAlquilerApi] GET persona ->', url);
  try {
    const res = await api.get<PersonaRow>(url);
    return normalizePersonaRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error obteniendo persona', err);
    throw err;
  }
}

export async function createPersona(payload: PersonaCreate): Promise<PersonaRow> {
  console.log('[gestionAlquilerApi] POST crear persona ->', ENDPOINT_PERSONAS, payload);
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
  console.log('[gestionAlquilerApi] PUT actualizar persona ->', url, payload);
  try {
    const res = await api.put<PersonaRow>(url, payload);
    return normalizePersonaRow(res.data);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error actualizando persona', err);
    throw err;
  }
}

// =====================================================
// CONTRATOS
// =====================================================
export async function createContrato(payload: ContratoCreate): Promise<ContratoRow> {
  console.log('[gestionAlquilerApi] POST crear contrato ->', ENDPOINT_CONTRATOS, payload);
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
  console.log('[gestionAlquilerApi] GET contrato ->', url);
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
  console.log('[gestionAlquilerApi] PUT actualizar contrato ->', url, payload);
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
  console.log('[gestionAlquilerApi] GET resumen contrato activo patrimonio ->', url);
  try {
    const res = await api.get<ContratoResumenActivo | null>(url);
    return res.data ?? null;
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error obteniendo resumen activo por patrimonio', err);
    throw err;
  }
}

// =====================================================
// PARTICIPANTES
// =====================================================
export async function listContratoParticipantes(
  contratoId: string
): Promise<ContratoParticipanteRow[]> {
  const url = ENDPOINT_CONTRATO_PARTICIPANTES(contratoId);
  console.log('[gestionAlquilerApi] GET participantes contrato ->', url);
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
  console.log('[gestionAlquilerApi] POST crear participante contrato ->', url, payload);
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
  console.log('[gestionAlquilerApi] PUT actualizar participante ->', url, payload);
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
  console.log('[gestionAlquilerApi] DELETE participante ->', url);
  try {
    await api.delete(url);
  } catch (err) {
    logAxiosError('[gestionAlquilerApi] Error eliminando participante', err);
    throw err;
  }
}

// =====================================================
// Helper genérico
// =====================================================
async function httpGet<T>(path: string): Promise<T> {
  const res = await api.get<T>(path);
  return res.data;
}

// =====================================================
// Export agrupado
// =====================================================
const gestionAlquilerApi = {
  // personas
  listPersonas,
  listPersonasPicker,
  getPersona,
  createPersona,
  updatePersona,

  // contratos
  createContrato,
  getContrato,
  updateContrato,
  getContratoActivoResumenByPatrimonio,

  // participantes
  listContratoParticipantes,
  createContratoParticipante,
  updateContratoParticipante,
  deleteContratoParticipante,

  // helper
  httpGet,
};

export default gestionAlquilerApi;