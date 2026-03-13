/**
 * Ruta: mobile_app/services/cuentasApi.ts
 * Versión: 2.0.0
 * Descripción:
 * Servicio centralizado para cuentas bancarias de GapptoMobile v3.
 *
 * Responsabilidades:
 * - Listar, obtener, crear, actualizar y eliminar cuentas bancarias.
 * - Mapear el contrato backend -> frontend.
 * - Exponer el contador real de registros asociados (`associated_count`).
 */

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
  associatedCount: number;
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
    associatedCount: Number(data.associated_count ?? 0),
  };
}

export async function listCuentas(params?: { bancoId?: string }): Promise<CuentaBancaria[]> {
  const q: any = {};
  if (params?.bancoId) q.banco_id = params.bancoId;

  try {
    const resp = await api.get(BASE_URL, { params: q });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    return rows.map(mapCuentaRead);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] listCuentas FAIL',
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
    const resp = await api.get(`${BASE_URL}/${id}`);
    return mapCuentaRead(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] getCuenta FAIL',
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
      console.error(
        '[cuentasApi] updateCuenta FAIL',
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
    await api.delete(`${BASE_URL}/${id}`);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        '[cuentasApi] deleteCuenta FAIL',
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