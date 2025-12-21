// mobile_app/services/extraordinariosApi.ts
import axios from 'axios';
import { api } from './api';

const ENDPOINT_EXTRAORDINARIOS = '/api/v1/extraordinarios';

export interface ExtraordinarioItemDto {
  id: string;
  nombre: string;
  categoria_nombre: string | null;
  tipo: 'GASTO' | 'INGRESO';
  importe: number;
  pagado?: boolean | null;
  cobrado?: boolean | null;
  kpi: boolean;
  activo: boolean;
  fecha_referencia: string; // ISO datetime
}

export interface ExtraordinariosResponseDto {
  year: number;
  month: number; // 1-12
  total_gastos: number;
  total_ingresos: number;
  balance: number;
  gastos: ExtraordinarioItemDto[];
  ingresos: ExtraordinarioItemDto[];
}

/**
 * year: año completo (ej. 2025)
 * month: 1-12
 */
export async function fetchExtraordinarios(
  year: number,
  month: number
): Promise<ExtraordinariosResponseDto> {
  const params: Record<string, any> = { year, month };

  try {
    console.log(
      '[extraordinariosApi] GET extraordinarios ->',
      ENDPOINT_EXTRAORDINARIOS,
      'params:',
      params
    );

    const res = await api.get<ExtraordinariosResponseDto>(
      ENDPOINT_EXTRAORDINARIOS,
      { params }
    );

    return res.data;
  } catch (err) {
    console.error(
      '[extraordinariosApi] Error cargando extraordinarios',
      axios.isAxiosError(err) ? err.response?.data : err
    );
    throw err;
  }
}
