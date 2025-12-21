// mobile_app/services/analyticsApi.ts
import { api } from './api';
import {
  DayToDayAnalysisRequest,
  DayToDayAnalysisResponse,
  MonthlySummaryResponse,
} from '../types/analytics';

// Params para el resumen mensual (si no pasas nada → mes y año actuales)
export type MonthlySummaryRequest = {
  year?: number;
  month?: number;
};

/**
 * Llama al endpoint:
 *   GET /api/v1/analytics/day-to-day
 *
 * Mapea los parámetros de frontend:
 *   - tipoId -> tipo_id (backend)
 *   - resto (fecha, pago, categoria, etc.) se envían tal cual
 */
export async function getDayToDayAnalysis(
  params: DayToDayAnalysisRequest = {},
): Promise<DayToDayAnalysisResponse> {
  const { tipoId, ...rest } = params;

  const response = await api.get<DayToDayAnalysisResponse>(
    '/api/v1/analytics/day-to-day',
    {
      params: {
        ...rest,
        // el backend espera "tipo_id"
        ...(tipoId ? { tipo_id: tipoId } : {}),
      },
    },
  );

  return response.data;
}

/**
 * Llama al endpoint:
 *   GET /api/v1/analytics/monthly-summary
 *
 * Parámetros opcionales:
 *   - year: año (por defecto, año actual en backend)
 *   - month: mes 1-12 (por defecto, mes actual en backend)
 */
export async function getMonthlySummary(
  params: MonthlySummaryRequest = {},
): Promise<MonthlySummaryResponse> {
  const response = await api.get<MonthlySummaryResponse>(
    '/api/v1/analytics/monthly-summary',
    { params },
  );

  return response.data;
}

// (Opcional) export por defecto si quieres importar todo junto
export default {
  getDayToDayAnalysis,
  getMonthlySummary,
};
