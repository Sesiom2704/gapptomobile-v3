/**
 * Ruta: mobile_app/services/balanceApi.ts
 * Versión: 1.9.1
 * Descripción:
 * Servicio de balance mensual de cuentas.
 *
 * Importante:
 * - Los importes inicio/salidas/entradas/fin son importes reales operativos.
 * - La participación NO debe afectar a pagar/cobrar movimientos.
 * - participacion_pct solo se usa para métricas de liquidez ponderada en Home.
 */

import { api } from './api';

export type SaldoCuentaItem = {
  cuenta_id: string;
  anagrama: string;
  inicio: number;
  salidas: number;
  entradas: number;
  fin: number;

  // 100 = cuenta propia completa, 50 = cuenta compartida al 50%.
  participacion_pct?: number;

  gastos_gestionables_pendientes: number;
  gastos_cotidianos_pendientes: number;
  ingresos_pendientes: number;
};

export type BalanceMesResponse = {
  year: number;
  month: number;
  saldos_cuentas: SaldoCuentaItem[];
  liquidez_actual_total: number;
  liquidez_inicio_mes_total: number;
  liquidez_prevista_total: number;
  ingresos_pendientes_total: number;
  gastos_pendientes_total: number;
  ahorro_mes_total: number;

  gastos_ahorro_total?: number;
  ingresos_reintegro_ahorro_total?: number;
};

export async function fetchBalanceMes(params: {
  year: number;
  month: number;
}): Promise<BalanceMesResponse> {
  const response = await api.get('/api/v1/balance/mes-cuentas', { params });
  return response.data;
}