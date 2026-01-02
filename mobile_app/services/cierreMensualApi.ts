// mobile_app/services/cierreMensualApi.ts
// -----------------------------------------------------------------------------
// Servicio API para cierres mensuales (GapptoMobile v3)
//
// Usa el cliente axios global (services/api.ts) para:
// - Reutilizar baseURL ya configurada
// - Reutilizar timeout, headers y token Bearer (setAuthToken)
// - Homogeneizar el manejo de errores en toda la app
//
// Endpoints (según /docs y realidad del backend):
// - GET    /api/v1/cierre_mensual/                         -> Listar cierres
// - GET    /api/v1/cierre_mensual/generar                  -> Generar cierre M-1 (persistente)
// - GET    /api/v1/cierre_mensual/{cierre_id}/detalles     -> Detalles por cierre
// - DELETE /api/v1/cierre_mensual/{cierre_id}              -> Eliminar cierre
// - GET    /api/v1/cierre_mensual/kpis                     -> KPIs agregados (cierres+detalles)
// - PATCH  /api/v1/cierre_mensual/{cierre_id}              -> Editar cabecera
// - PATCH  /api/v1/cierre_mensual/detalle/{detalle_id}     -> Editar detalle
//
// Nota importante sobre _debug_snapshot:
// - En tu staging actual devuelve 405 Method Not Allowed.
// - Para no romper UX, debugSnapshot() hace fallback a:
//     GET /api/v1/reinicio/cierre/preview
//   (preview "what-if" del mes, sin persistir).
// -----------------------------------------------------------------------------

import { api } from './api';
import { reinicioApi, type CierrePreview } from './reinicioApi';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export type CierreMensual = {
  id: string;
  anio: number;
  mes: number;
  fecha_cierre: string;
  user_id?: number | null;
  criterio: string;
  version: number;
  liquidez_total: number;

  ingresos_esperados: number;
  ingresos_reales: number;

  gastos_esperados_total: number;
  gastos_reales_total: number;

  resultado_esperado: number;
  resultado_real: number;
  desv_resultado: number;

  // opcionales
  desv_ingresos?: number;
  gastos_gestionables_esperados?: number;
  gastos_gestionables_reales?: number;
  gastos_cotidianos_esperados?: number;
  gastos_cotidianos_reales?: number;
  desv_gestionables?: number;
  desv_cotidianos?: number;
  desv_gastos_total?: number;

  n_recurrentes_ing?: number;
  n_recurrentes_gas?: number;
  n_unicos_ing?: number;
  n_unicos_gas?: number;
  n_cotidianos?: number;
};

export type CierreMensualDetalle = {
  id: string;
  cierre_id: string;
  anio: number;
  mes: number;
  segmento_id: string;
  tipo_detalle: string;
  esperado: number;
  real: number;
  desviacion: number;
  cumplimiento_pct: number;
  n_items: number;
  incluye_kpi: boolean;
  fecha_cierre: string;
  user_id?: number | null;
  segmento_nombre?: string | null;
};

// ✅ Exportado para que CierreKpiScreen lo pueda importar sin error.
export type CierreMensualKpisResponse = {
  limit: number;
  count: number;
  cierres: CierreMensual[];
  detalles: CierreMensualDetalle[];
};

/**
 * ✅ Snapshot (previsualización) del cierre, sin persistir.
 * Defensivo porque el backend puede devolver:
 * - un objeto wrapper {header, detalles, meta}
 * - o directamente la cabecera sin wrapper
 *
 * Además:
 * - si el endpoint _debug_snapshot NO está permitido (405/404),
 *   hacemos fallback a /api/v1/reinicio/cierre/preview y lo adaptamos a {header}.
 */
export type CierreMensualDebugSnapshot = {
  header?: Partial<CierreMensual>;
  detalles?: Partial<CierreMensualDetalle>[];
  meta?: Record<string, any>;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function unwrapError(e: any): string {
  const msg =
    e?.response?.data?.detail ??
    e?.response?.data?.message ??
    e?.message ??
    'Error de red';

  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

/**
 * Devuelve status HTTP si el error viene de axios.
 */
function getHttpStatus(e: any): number | null {
  const s = e?.response?.status;
  return typeof s === 'number' ? s : null;
}

/**
 * Adaptador: convierte el CierrePreview (reinicio/cierre/preview)
 * en un snapshot compatible con UI antigua (header parcial).
 */
function snapshotFromCierrePreview(preview: CierrePreview): CierreMensualDebugSnapshot {
  const header: Partial<CierreMensual> = {
    anio: preview.anio,
    mes: preview.mes,
    ingresos_reales: preview.ingresos_reales,
    gastos_reales_total: preview.gastos_reales_total,
    resultado_real: preview.resultado_real,

    // Campos esperados pueden venir null en preview
    ingresos_esperados: Number(preview.ingresos_esperados ?? 0),
    gastos_esperados_total: Number(preview.gastos_esperados_total ?? 0),
    resultado_esperado: Number(preview.resultado_esperado ?? 0),

    // Desviaciones opcionales
    desv_resultado: Number(preview.desv_resultado ?? 0),
    desv_ingresos: preview.desv_ingresos ?? undefined,
    desv_gastos_total: preview.desv_gastos_total ?? undefined,
  };

  return {
    header,
    meta: {
      source: 'reinicio/cierre/preview',
      as_of: preview.as_of,
      ...(preview.extras ?? {}),
    },
  };
}

// -----------------------------------------------------------------------------
// API
// -----------------------------------------------------------------------------

export const cierreMensualApi = {
  // Listar cierres
  async list(userId?: number) {
    try {
      const params: any = {};
      if (userId != null) params.user_id = userId;

      const res = await api.get<CierreMensual[]>('/api/v1/cierre_mensual/', { params });
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  /**
   * ✅ Previsualización (snapshot) del cierre, sin persistir.
   *
   * Estrategia:
   * 1) Intentar endpoint legacy:
   *      GET /api/v1/cierre_mensual/_debug_snapshot
   *    (en staging actual puede devolver 405).
   * 2) Si 405 o 404:
   *      Fallback a GET /api/v1/reinicio/cierre/preview
   *      y lo adaptamos a { header }.
   *
   * Esto evita que ReinciarCierreScreen "falle" y muestre el warning.
   */
  async debugSnapshot(opts?: { anio?: number; mes?: number; userId?: number; version?: number }) {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;
    if (opts?.userId != null) params.user_id = opts.userId;
    if (opts?.version != null) params.version = opts.version;

    // 1) Intento endpoint legacy
    try {
      const res = await api.get<CierreMensualDebugSnapshot>('/api/v1/cierre_mensual/_debug_snapshot', {
        params,
      });

      // Compatibilidad: si backend devuelve directamente la cabecera (sin wrapper)
      const data: any = res.data ?? null;
      if (data && (data.ingresos_reales != null || data.gastos_reales_total != null)) {
        return { header: data as Partial<CierreMensual> } as CierreMensualDebugSnapshot;
      }

      return data as CierreMensualDebugSnapshot;
    } catch (e: any) {
      const status = getHttpStatus(e);

      // 2) Fallback si el endpoint no está permitido / no existe
      if (status === 405 || status === 404) {
        try {
          const preview = await reinicioApi.fetchCierrePreview({
            anio: opts?.anio,
            mes: opts?.mes,
          });
          return snapshotFromCierrePreview(preview);
        } catch (e2: any) {
          // Si también falla el fallback, devolvemos error real del fallback
          throw new Error(unwrapError(e2));
        }
      }

      // Otros errores: propagamos tal cual
      throw new Error(unwrapError(e));
    }
  },

  // Generar cierre M-1
  async generar(opts?: { force?: boolean; userId?: number; version?: number }) {
    try {
      const params: any = { force: !!opts?.force };
      if (opts?.userId != null) params.user_id = opts.userId;
      if (opts?.version != null) params.version = opts.version;

      const res = await api.get<CierreMensual>('/api/v1/cierre_mensual/generar', { params });
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  // Detalles por cierre
  async detalles(cierreId: string) {
    try {
      const res = await api.get<CierreMensualDetalle[]>(
        `/api/v1/cierre_mensual/${encodeURIComponent(cierreId)}/detalles`
      );
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  // Eliminar cierre
  async delete(cierreId: string) {
    try {
      await api.delete(`/api/v1/cierre_mensual/${encodeURIComponent(cierreId)}`);
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  // PATCH cabecera (edición)
  async update(cierreId: string, patch: Partial<CierreMensual>) {
    try {
      const res = await api.patch<CierreMensual>(
        `/api/v1/cierre_mensual/${encodeURIComponent(cierreId)}`,
        patch
      );
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  // PATCH detalle (edición)
  async updateDetalle(detalleId: string, patch: Partial<CierreMensualDetalle>) {
    try {
      const res = await api.patch<CierreMensualDetalle>(
        `/api/v1/cierre_mensual/detalle/${encodeURIComponent(detalleId)}`,
        patch
      );
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },

  // KPIs agregados (una llamada)
  async kpis(opts?: { limit?: number; userId?: number }) {
    try {
      const params: any = {};
      params.limit = opts?.limit ?? 12;
      if (opts?.userId != null) params.user_id = opts.userId;

      const res = await api.get<CierreMensualKpisResponse>('/api/v1/cierre_mensual/kpis', { params });
      return res.data;
    } catch (e) {
      throw new Error(unwrapError(e));
    }
  },
};

export default cierreMensualApi;
