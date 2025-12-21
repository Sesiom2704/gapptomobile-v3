// mobile_app/services/movimientosApi.ts
import { api } from './api';

export type MovementKind = 'GASTO_GESTIONABLE' | 'GASTO_COTIDIANO' | 'INGRESO';

export type MovimientoItem = {
  id: string;
  fecha: string;          // ISO date desde el backend
  cuenta_id?: string | null;
  cuenta_nombre?: string | null;
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
  const params: any = {};
  if (year) params.year = year;
  if (month) params.month = month;

  // ✅ Ahora el endpoint es /api/v1/balance/mes
  const res = await api.get<MovimientosMesResponse>('/api/v1/balance/mes', {
    params,
  });
  return res.data;
}
