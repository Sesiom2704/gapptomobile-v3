// mobile_app/services/cuentasApi.ts

import axios from 'axios';
import { api } from './api';

export interface CuentaBancaria {
  id: string;
  bancoId: string | null;
  referencia: string | null;
  anagrama: string | null;
  liquidezInicial: number;
  liquidez: number;
  activo: boolean;
}

const BASE_URL = '/api/v1/cuentas';

function mapCuentaRead(data: any): CuentaBancaria {
  return {
    id: String(data.id),
    bancoId: data.banco_id ?? null,
    referencia: data.referencia ?? null,
    anagrama: data.anagrama ?? null,
    liquidezInicial: Number(data.liquidez_inicial ?? 0),
    liquidez: Number(data.liquidez ?? 0),
    activo: Boolean(data.activo ?? true),
  };
}

export async function listCuentas(params?: { bancoId?: string }): Promise<CuentaBancaria[]> {
  const q: any = {};
  if (params?.bancoId) q.banco_id = params.bancoId;

  const resp = await api.get(BASE_URL, { params: q });
  const rows = Array.isArray(resp.data) ? resp.data : [];
  return rows.map(mapCuentaRead);
}

export async function getCuenta(id: string): Promise<CuentaBancaria> {
  const resp = await api.get(`${BASE_URL}/${id}`);
  return mapCuentaRead(resp.data);
}

export async function createCuenta(payload: {
  banco_id: string;
  referencia: string;
  liquidez_inicial: number;
  activo?: boolean;
}): Promise<CuentaBancaria> {
  try {
    console.log('[cuentasApi] POST createCuenta ->', `${BASE_URL}/`, payload);
    const resp = await api.post(`${BASE_URL}/`, payload);
    console.log('[cuentasApi] createCuenta OK <-', resp.status, resp.data);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] createCuenta FAIL',
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
    activo?: boolean;
  }
): Promise<CuentaBancaria> {
  try {
    console.log('[cuentasApi] PUT updateCuenta ->', `${BASE_URL}/${id}`, payload);
    const resp = await api.put(`${BASE_URL}/${id}`, payload);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[cuentasApi] updateCuenta FAIL', err.response?.status, err.response?.data);
    } else {
      console.error('[cuentasApi] updateCuenta FAIL', err);
    }
    throw err;
  }
}

export async function deleteCuenta(id: string): Promise<void> {
  await api.delete(`${BASE_URL}/${id}`);
}
