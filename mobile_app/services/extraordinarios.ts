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

  // ---- extras para navegación a forms (opcionales) ----
  periodicidad?: string | null;

  // gasto
  tipo_id?: string | null;
  segmento_id?: string | null;
  proveedor_id?: string | null;
  cuenta_id?: string | null;
  referencia_vivienda_id?: string | null;
  fecha?: string | null; // ISO date
  rango_pago?: string | null;
  comentarios?: string | null;
  importe_cuota?: number | null;
  cuotas?: number | null;

  // ingreso
  rango_cobro?: string | null;
  fecha_inicio?: string | null; // ISO date
}

export interface ExtraordinariosResponseDto {
  year: number;
  month: number; // 1-12

  total_gastos: number; // gastos extraordinarios
  total_ingresos: number; // ingresos extraordinarios

  // NUEVO
  total_gastos_omitidos: number;
  gastos_omitidos: ExtraordinarioItemDto[];

  // Balance solicitado:
  // ingresos + gastos_omitidos - gastos_extraordinarios
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