// services/gastosActions.ts
//
// Capa fina para acciones de UI sobre Gasto (gestionable).
// Objetivo: evitar bugs por lógica duplicada en pantallas (ActionSheet, botones, etc.).
//
// - Define guards claros (puedeOmitir, puedeDeshacerOmision, puedePagar).
// - Ofrece funciones "safe" que devuelven mensajes de error amigables.

import axios from 'axios';
import {
  Gasto,
  marcarGastoComoPagado,
  omitirGastoEsteMes,
  deshacerOmisionGastoEsteMes,
} from './gastosApi';

export function isOmitido(g: Gasto): boolean {
  return (g.omitido_este_mes ?? false) === true;
}

export function puedeOmitir(g: Gasto): boolean {
  // Backend también protege (409 si pagado), pero lo evitamos en UI
  return !Boolean(g.pagado) && !isOmitido(g);
}

export function puedeDeshacerOmision(g: Gasto): boolean {
  return isOmitido(g);
}

export function puedePagar(g: Gasto): boolean {
  // En general: si ya está pagado, no tiene sentido.
  // (Si alguna periodicidad especial requiere otra regla, se centraliza aquí.)
  return !Boolean(g.pagado);
}

function toUserMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const detail = (err.response?.data as any)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (status) return `Error HTTP ${status}`;
  }
  return fallback;
}

export async function pagarGastoSafe(g: Gasto): Promise<{ ok: true; data: Gasto } | { ok: false; message: string }> {
  if (!puedePagar(g)) {
    return { ok: false, message: 'Este gasto ya está pagado.' };
  }
  try {
    const data = await marcarGastoComoPagado(g.id);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: toUserMessage(e, 'No se ha podido marcar como pagado.') };
  }
}

export async function omitirGastoSafe(g: Gasto): Promise<{ ok: true; data: Gasto } | { ok: false; message: string }> {
  if (!puedeOmitir(g)) {
    return { ok: false, message: 'No se puede omitir: ya está pagado u omitido.' };
  }
  try {
    const data = await omitirGastoEsteMes(g.id);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: toUserMessage(e, 'No se ha podido omitir el gasto.') };
  }
}

export async function deshacerOmisionSafe(g: Gasto): Promise<{ ok: true; data: Gasto } | { ok: false; message: string }> {
  if (!puedeDeshacerOmision(g)) {
    return { ok: false, message: 'Este gasto no está omitido.' };
  }
  try {
    const data = await deshacerOmisionGastoEsteMes(g.id);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: toUserMessage(e, 'No se ha podido deshacer la omisión.') };
  }
}
