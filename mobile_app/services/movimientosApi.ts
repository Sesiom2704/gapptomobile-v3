/**
 * Archivo: services/movimientosApi.ts
 *
 * Responsabilidad:
 *   - Cliente API para consultar los movimientos realizados de un mes concreto.
 *   - Centraliza el tipo de datos usado por la pantalla MovimientosScreen.
 *
 * Maneja:
 *   - Lectura HTTP contra el endpoint /api/v1/balance/mes.
 *   - Parámetros opcionales year/month para navegar entre meses.
 *   - Tipado de movimientos: ingresos, gastos gestionables y gastos cotidianos.
 *
 * Entradas / Salidas:
 *   - fetchMovimientosMes(year?, month?):
 *       - Entrada opcional:
 *           - year: año numérico, por ejemplo 2025
 *           - month: mes numérico 1-12
 *       - Salida:
 *           - Totales del mes.
 *           - Balance.
 *           - Array de movimientos.
 *
 * Dependencias clave:
 *   - api: instancia HTTP centralizada de Axios.
 *
 * Notas importantes:
 *   - cuenta_nombre y banco_nombre deben venir preferiblemente resueltos desde backend.
 *   - Si backend devuelve solo cuenta_id/banco_id, la pantalla no puede inventar el nombre real.
 *   - Para corregir definitivamente cotidianos, el endpoint debe hacer JOIN con cuentas/bancos.
 */

import { api } from './api';

export type MovementKind =
  | 'GASTO_GESTIONABLE'
  | 'GASTO_COTIDIANO'
  | 'INGRESO';

export type MovimientoItem = {
  id: string;
  fecha: string; // ISO date desde el backend

  // Cuenta / banco
  cuenta_id?: string | number | null;
  cuenta_nombre?: string | null;
  banco_id?: string | number | null;
  banco_nombre?: string | null;

  // Datos principales
  descripcion: string;
  tipo: MovementKind;
  es_ingreso: boolean;
  importe: number;
};

export type MovimientosMesResponse = {
  year: number;
  month: number;
  total_ingresos: number;
  total_gastos: number;
  balance: number;
  movimientos: MovimientoItem[];
};

export async function fetchMovimientosMes(
  year?: number,
  month?: number
): Promise<MovimientosMesResponse> {
  const params: Record<string, number> = {};

  if (year) params.year = year;
  if (month) params.month = month;

  const res = await api.get<MovimientosMesResponse>('/api/v1/balance/mes', {
    params,
  });

  return res.data;
}