// mobile_app/services/reinicioApi.ts
// -----------------------------------------------------------------------------
// Servicio unificado "reinicioApi":
// - Endpoints bajo /api/v1/reinicio (según reinicio_router.py)
// - Previews (sin insertar):
//     * GET /mes/preview
//     * GET /cierre/preview   -> "si cerráramos ahora el mes indicado"
// - Acciones (persistentes):
//     * POST /mes/ejecutar    -> usa QUERY PARAMS (FastAPI Query), no body
//     * POST /cierre/ejecutar -> NUEVO: inserta cabecera + detalle (SQL puro backend)
//
// COMPATIBILIDAD IMPORTANTE:
// - Tu UI ya usa reinicioApi.postGenerarCierre() y postGenerarYReiniciar().
// - Se mantienen, sin romper.
// - Para el cierre "nuevo" recomendado: reinicioApi.postCierreEjecutar({anio, mes})
// -----------------------------------------------------------------------------

import { api } from './api';
import { cierreMensualApi, type CierreMensual } from './cierreMensualApi';

// -----------------------------
// Tipos (alineados con backend mostrado)
// -----------------------------

export type ReinicioMesEligibility = {
  gastos_pendientes: number;
  ingresos_pendientes: number;
  can_reiniciar: boolean;
};

// backend: PresupuestoCotidianosTotalResponse(total: float)
export type PresupuestoCotidianosTotalResponse = {
  total: number;
};

// backend: ReinicioMesPreviewResponse
export type ReinicioMesPreview = {
  ventana_1_5_ok: boolean;
  eligibility: ReinicioMesEligibility;
  presupuesto_cotidianos_total: PresupuestoCotidianosTotalResponse;
};

// backend: CierrePreviewOut
export type CierrePreview = {
  anio: number;
  mes: number;
  as_of: string; // ISO datetime
  ingresos_reales: number;
  gastos_reales_total: number;
  resultado_real: number;

  ingresos_esperados?: number | null;
  gastos_esperados_total?: number | null;
  resultado_esperado?: number | null;

  desv_resultado?: number | null;
  desv_ingresos?: number | null;
  desv_gastos_total?: number | null;

  extras?: Record<string, any>;
};

// backend: ReinicioMesExecuteResponse
export type ReinicioMesResult = {
  updated: any;
  summary: {
    Gastos: Record<string, number>;
    Ingresos: Record<string, number>;
  };
};

export type ReiniciarMesRequest = {
  aplicar_promedios?: boolean;
  enforce_window?: boolean;
};

export type GenerarCierreRequest = {
  force?: boolean;
  user_id?: number;
  version?: number;
};

export type GenerarYReiniciarRequest = {
  cierre?: GenerarCierreRequest;
  reinicio?: ReiniciarMesRequest;
};

// ✅ Nuevo: respuesta del POST /reinicio/cierre/ejecutar
export type CierreExecuteResponse = {
  cierre_id: string;
  anio: number;
  mes: number;
  inserted_detalles: number;
  range_start: string;
  range_end: string;
};

// Resultado combinado (útil para tu UI si hace “todo en uno”)
export type GenerarYReiniciarResult = {
  cierre: CierreMensual;
  reinicio: ReinicioMesResult;
};

const BASE = '/api/v1/reinicio';

export const reinicioApi = {
  // --- Eligibility ---
  async fetchMesEligibility(): Promise<ReinicioMesEligibility> {
    const res = await api.get<ReinicioMesEligibility>(`${BASE}/mes/eligibility`);
    return res.data;
  },

  // --- Preview mes (sin insertar) ---
  // OJO: en backend no acepta anio/mes actualmente (según tu código pegado).
  // Dejamos params listos por compatibilidad futura (no rompe).
  async fetchMesPreview(opts?: { anio?: number; mes?: number }): Promise<ReinicioMesPreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<ReinicioMesPreview>(`${BASE}/mes/preview`, { params });
    return res.data;
  },

  // --- Ejecutar reinicio (persistente) ---
  // Backend usa Query params:
  //   POST /mes/ejecutar?aplicar_promedios=...&enforce_window=...
  async postReiniciarMes(opts?: {
    aplicarPromedios?: boolean;
    enforceWindow?: boolean;
  }): Promise<ReinicioMesResult> {
    const params: any = {
      aplicar_promedios: !!opts?.aplicarPromedios,
      enforce_window: !!opts?.enforceWindow,
    };

    // Sin body; FastAPI lo define como Query.
    const res = await api.post<ReinicioMesResult>(`${BASE}/mes/ejecutar`, null, { params });
    return res.data;
  },

  // --- Preview cierre (sin insertar) ---
  async fetchCierrePreview(opts?: { anio?: number; mes?: number }): Promise<CierrePreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<CierrePreview>(`${BASE}/cierre/preview`, { params });
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // ✅ NUEVO: Ejecutar cierre mensual (persistente) en /reinicio
  // ---------------------------------------------------------------------------
  // Inserta cabecera + detalles (SQL puro en backend):
  //   POST /api/v1/reinicio/cierre/ejecutar?anio=YYYY&mes=MM&enforce_window=false
  async postCierreEjecutar(opts?: {
    anio?: number;
    mes?: number;
    enforceWindow?: boolean;
  }): Promise<CierreExecuteResponse> {
    const params: any = {
      enforce_window: !!opts?.enforceWindow,
    };
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.post<CierreExecuteResponse>(`${BASE}/cierre/ejecutar`, null, { params });
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // ✅ COMPATIBILIDAD: postGenerarCierre
  // ---------------------------------------------------------------------------
  // Tu UI lo llama como si existiera bajo /reinicio/cierre/generar.
  // En tu proyecto legacy se usa:
  //   GET /api/v1/cierre_mensual/generar  (cierreMensualApi.generar)
  //
  // Lo mantenemos para no romper otras pantallas.
  async postGenerarCierre(payload?: GenerarCierreRequest): Promise<CierreMensual> {
    const res = await cierreMensualApi.generar({
      force: !!payload?.force,
      userId: payload?.user_id,
      version: payload?.version,
    });
    return res;
  },

  // ---------------------------------------------------------------------------
  // ✅ COMPATIBILIDAD: postGenerarYReiniciar
  // ---------------------------------------------------------------------------
  // Ejecuta dos pasos:
  // 1) Generar cierre (persistente) -> cierreMensualApi.generar (legacy)
  // 2) Reiniciar mes (persistente)  -> POST /reinicio/mes/ejecutar (query params)
  //
  // Devuelve ambos resultados para que la UI tenga visibilidad.
  async postGenerarYReiniciar(payload?: GenerarYReiniciarRequest): Promise<GenerarYReiniciarResult> {
    const cierre = await reinicioApi.postGenerarCierre(payload?.cierre);

    const reinicio = await reinicioApi.postReiniciarMes({
      aplicarPromedios: !!payload?.reinicio?.aplicar_promedios,
      enforceWindow: !!payload?.reinicio?.enforce_window,
    });

    return { cierre, reinicio };
  },
};

// -----------------------------------------------------------------------------
// Compatibilidad (mientras migras imports del resto de la app)
// -----------------------------------------------------------------------------

export async function fetchReinicioMesEligibility(): Promise<ReinicioMesEligibility> {
  return reinicioApi.fetchMesEligibility();
}

export async function postReiniciarMes(opts?: {
  aplicarPromedios?: boolean;
  enforceWindow?: boolean;
}): Promise<ReinicioMesResult> {
  return reinicioApi.postReiniciarMes(opts);
}

// Mantengo esta firma porque tu UI la estaba usando.
// Con backend actual, el total viene en presupuesto_cotidianos_total.total
export async function fetchPresupuestoCotidianosTotal(): Promise<number> {
  const prev = await reinicioApi.fetchMesPreview();
  return Number(prev?.presupuesto_cotidianos_total?.total ?? 0);
}
