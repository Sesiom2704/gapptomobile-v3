import { api } from './api';

export type SaldoCuentaItem = {
  cuenta_id: string;
  anagrama: string;
  inicio: number;
  salidas: number;
  entradas: number;
  fin: number;
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
};

export async function fetchBalanceMes(params: {
  year: number;
  month: number;
}): Promise<BalanceMesResponse> {
  const response = await api.get('/api/v1/balance/mes-cuentas', { params });
  return response.data;
}
