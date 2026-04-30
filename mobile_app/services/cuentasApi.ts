/**
 * Ruta: mobile_app/services/cuentasApi.ts
 * Versión: 2.2.0
 * Descripción:
 * Servicio centralizado para cuentas bancarias de GapptoMobile v3.
 *
 * Responsabilidades:
 * - Listar, obtener, crear, actualizar y eliminar cuentas bancarias.
 * - Mapear el contrato backend -> frontend.
 * - Exponer el contador real de registros asociados.
 * - Mantener compatibilidad con detalle de relaciones.
 * - Añadir soporte para participación de cuenta.
 */

import axios from 'axios';
import { api } from './api';

export type RelationCountItem = {
  key: string;
  label: string;
  count: number;
};

export interface CuentaBancaria {
  id: string;
  bancoId: string | null;
  referencia: string | null;
  anagrama: string | null;
  liquidezInicial: number;
  liquidez: number;
  participacionPct: number;
  activo: boolean;
  associatedCount: number;
  relationCounts?: RelationCountItem[];
}

const BASE_URL = '/api/v1/cuentas';

function mapRelationCountItem(data: any): RelationCountItem {
  return {
    key: String(data?.key ?? ''),
    label: String(data?.label ?? ''),
    count: Number(data?.count ?? 0),
  };
}

function safeParticipacionPct(value: any): number {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return 100;
  return parsed;
}

function mapCuentaRead(data: any): CuentaBancaria {
  const relationCounts: RelationCountItem[] | undefined = Array.isArray(data?.relation_counts)
    ? data.relation_counts.map(mapRelationCountItem).filter((item: RelationCountItem) => item.count > 0)
    : Array.isArray(data?.relationCounts)
      ? data.relationCounts.map(mapRelationCountItem).filter((item: RelationCountItem) => item.count > 0)
      : undefined;

  const associatedCountFromDetail =
    relationCounts?.reduce((acc: number, item: RelationCountItem) => acc + Number(item.count ?? 0), 0) ?? 0;

  const associatedCountRaw = Number(data?.associated_count ?? data?.associatedCount ?? 0);

  return {
    id: String(data?.id ?? ''),
    bancoId: data?.banco_id ?? data?.bancoId ?? null,
    referencia: data?.referencia ?? null,
    anagrama: data?.anagrama ?? null,
    liquidezInicial: Number(data?.liquidez_inicial ?? data?.liquidezInicial ?? 0),
    liquidez: Number(data?.liquidez ?? 0),
    participacionPct: safeParticipacionPct(data?.participacion_pct ?? data?.participacionPct),
    activo: Boolean(data?.activo ?? true),
    associatedCount: relationCounts?.length ? associatedCountFromDetail : associatedCountRaw,
    relationCounts,
  };
}

export async function listCuentas(params?: {
  bancoId?: string;
  activo?: boolean;
}): Promise<CuentaBancaria[]> {
  const q: Record<string, any> = {};

  if (params?.bancoId) q.banco_id = params.bancoId;
  if (typeof params?.activo === 'boolean') q.activo = params.activo;

  try {
    const resp = await api.get<any[]>(BASE_URL, { params: q });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    return rows.map(mapCuentaRead);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] listCuentas FAIL',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[cuentasApi] listCuentas FAIL', err);
    }
    throw err;
  }
}

export async function getCuenta(id: string): Promise<CuentaBancaria> {
  try {
    const resp = await api.get<any>(`${BASE_URL}/${encodeURIComponent(id)}`);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] getCuenta FAIL',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[cuentasApi] getCuenta FAIL', err);
    }
    throw err;
  }
}

export async function createCuenta(payload: {
  banco_id: string;
  referencia: string;
  liquidez_inicial: number;
  participacion_pct?: number;
  activo?: boolean;
}): Promise<CuentaBancaria> {
  try {
    console.log('[cuentasApi] POST createCuenta ->', `${BASE_URL}/`, payload);
    const resp = await api.post<any>(`${BASE_URL}/`, payload);
    console.log('[cuentasApi] createCuenta OK <-', resp.status, resp.data);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] createCuenta FAIL',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[cuentasApi] createCuenta FAIL', err);
    }
    throw err;
  }
}

export async function updateCuenta(
  id: string,
  payload: {
    banco_id?: string;
    referencia?: string;
    liquidez_inicial?: number;
    participacion_pct?: number;
    activo?: boolean;
  }
): Promise<CuentaBancaria> {
  try {
    console.log('[cuentasApi] PUT updateCuenta ->', `${BASE_URL}/${id}`, payload);
    const resp = await api.put<any>(`${BASE_URL}/${encodeURIComponent(id)}`, payload);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] updateCuenta FAIL',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[cuentasApi] updateCuenta FAIL', err);
    }
    throw err;
  }
}

export async function deleteCuenta(id: string): Promise<void> {
  try {
    await api.delete(`${BASE_URL}/${encodeURIComponent(id)}`);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] deleteCuenta FAIL',
        'message=',
        err.message,
        'status=',
        err.response?.status,
        'data=',
        JSON.stringify(err.response?.data ?? null)
      );
    } else {
      console.error('[cuentasApi] deleteCuenta FAIL', err);
    }
    throw err;
  }
}

const cuentasApi = {
  listCuentas,
  getCuenta,
  createCuenta,
  updateCuenta,
  deleteCuenta,
};

export default cuentasApi;