// mobile_app/services/reinicioApi.ts
// -----------------------------------------------------------------------------
// Servicio unificado "reinicioApi":
// - Endpoints bajo /api/v1/reinicio
// - Previews (sin insertar):
//     * GET /mes/preview
//     * GET /cierre/preview   -> "si cerráramos ahora el mes M"
// - Acciones (persistentes):
//     * POST /mes/ejecutar
//     * POST /cierre/generar
//     * POST /generar_y_reiniciar
// -----------------------------------------------------------------------------

import { api } from './api';

// -----------------------------
// Tipos (alineados con backend/schemas/reinicio.py)
// -----------------------------

export type ReinicioMesEligibility = {
  gastos_pendientes: number;
  ingresos_pendientes: number;
  can_reiniciar: boolean;
};

export type PresupuestoContenedorItem = {
  id?: string | null;
  label: string;
  presupuesto: number;
};

export type ReinicioMesPreview = {
  anio: number;
  mes: number;
  eligibility: ReinicioMesEligibility;
  presupuesto_total: number;
  contenedores: PresupuestoContenedorItem[];
};

export type CierrePreview = {
  anio: number;
  mes: number;
  as_of: string; // ISO date YYYY-MM-DD (o timestamp si lo defines así)

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

export type ReinicioMesResult = {
  updated: any;
  summary: {
    Gastos: Record<string, number>;
    Ingresos: Record<string, number>;
  };
};

export type ReiniciarMesRequest = {
  aplicar_promedios?: boolean;
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

// -----------------------------
// Endpoints
// -----------------------------

const BASE = '/api/v1/reinicio';

export const reinicioApi = {
  // --- Eligibility (migrado desde gastos) ---
  async fetchMesEligibility(): Promise<ReinicioMesEligibility> {
    const res = await api.get<ReinicioMesEligibility>(`${BASE}/mes/eligibility`);
    return res.data;
  },

  // --- Preview mes (sin insertar) ---
  async fetchMesPreview(opts?: { anio?: number; mes?: number }): Promise<ReinicioMesPreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<ReinicioMesPreview>(`${BASE}/mes/preview`, { params });
    return res.data;
  },

  // --- Ejecutar reinicio (persistente) ---
  async postReiniciarMes(opts?: { aplicarPromedios?: boolean }): Promise<ReinicioMesResult> {
    const body = { aplicar_promedios: !!opts?.aplicarPromedios };
    const res = await api.post<ReinicioMesResult>(`${BASE}/mes/ejecutar`, body);
    return res.data;
  },

  // --- Preview cierre (MES ACTUAL M) (sin insertar) ---
  // "Si cerráramos ahora el mes M"
  async fetchCierrePreview(opts?: { anio?: number; mes?: number }): Promise<CierrePreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<CierrePreview>(`${BASE}/cierre/preview`, { params });
    return res.data;
  },

  // --- Generar cierre (persistente) ---
  async postGenerarCierre(payload?: GenerarCierreRequest): Promise<any> {
    const body = {
      force: !!payload?.force,
      user_id: payload?.user_id ?? undefined,
      version: payload?.version ?? undefined,
    };
    const res = await api.post<any>(`${BASE}/cierre/generar`, body);
    return res.data;
  },

  // --- Generar + reiniciar (persistente) ---
  async postGenerarYReiniciar(payload?: GenerarYReiniciarRequest): Promise<any> {
    const body = {
      cierre: {
        force: !!payload?.cierre?.force,
        user_id: payload?.cierre?.user_id ?? undefined,
        version: payload?.cierre?.version ?? undefined,
      },
      reinicio: {
        aplicar_promedios: !!payload?.reinicio?.aplicar_promedios,
      },
    };
    const res = await api.post<any>(`${BASE}/generar_y_reiniciar`, body);
    return res.data;
  },
};

// -----------------------------------------------------------------------------
// Compatibilidad (mientras migras imports del resto de la app)
// -----------------------------------------------------------------------------

export async function fetchReinicioMesEligibility(): Promise<ReinicioMesEligibility> {
  return reinicioApi.fetchMesEligibility();
}

export async function postReiniciarMes(opts?: { aplicarPromedios?: boolean }): Promise<ReinicioMesResult> {
  return reinicioApi.postReiniciarMes(opts);
}

// Mantengo esta firma porque tu UI la estaba usando.
// Si ya migras a fetchMesPreview, puedes dejar de usarla.
export async function fetchPresupuestoCotidianosTotal(): Promise<number> {
  const prev = await reinicioApi.fetchMesPreview();
  return Number(prev?.presupuesto_total ?? 0);
}
