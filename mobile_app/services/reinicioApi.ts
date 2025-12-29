// mobile_app/services/reinicioApi.ts
// -----------------------------------------------------------------------------
// Servicio unificado "reinicioApi":
// - Consolida reinicio de mes, previews y cierre mensual en un único dominio:
//     /api/v1/reinicio/*
//
// NOTA IMPORTANTE:
// - No metas "export function" dentro de un objeto literal. TS lo rompe.
// - Para compatibilidad, reexportamos funciones con nombres legacy
//   (fetchReinicioMesEligibility, fetchPresupuestoCotidianosTotal, postReiniciarMes)
//   para que pantallas antiguas sigan funcionando mientras migras imports.
// -----------------------------------------------------------------------------

import { api } from './api';

// -----------------------------
// Tipos (alineados con backend/app/schemas/reinicio.py)
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
  as_of: string; // ISO date (YYYY-MM-DD)

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
// Endpoints (nuevo dominio /reinicio)
// -----------------------------

const BASE = '/api/v1/reinicio';

export const reinicioApi = {
  // ---------------------------------------------------------
  // MES: eligibility (antes vivía en /api/v1/gastos/reiniciar_mes/eligibility)
  // ---------------------------------------------------------
  async fetchMesEligibility(): Promise<ReinicioMesEligibility> {
    const res = await api.get<ReinicioMesEligibility>(`${BASE}/mes/eligibility`);
    return res.data;
  },

  // ---------------------------------------------------------
  // MES: preview (sin insertar) -> calcula para mes objetivo
  // ---------------------------------------------------------
  async fetchMesPreview(opts?: { anio?: number; mes?: number }): Promise<ReinicioMesPreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<ReinicioMesPreview>(`${BASE}/mes/preview`, { params });
    return res.data;
  },

  // ---------------------------------------------------------
  // MES: ejecutar reinicio (persistente)
  // ---------------------------------------------------------
  async postReiniciarMes(opts?: { aplicarPromedios?: boolean }): Promise<ReinicioMesResult> {
    // Recomendación: el backend acepte body JSON (más limpio que querystring)
    // Body mínimo: { aplicar_promedios: boolean }
    const body = { aplicar_promedios: !!opts?.aplicarPromedios };
    const res = await api.post<ReinicioMesResult>(`${BASE}/mes/ejecutar`, body);
    return res.data;
  },

  // ---------------------------------------------------------
  // CIERRE: preview (sin insertar) -> lo que se insertaría al cerrar ese mes
  // ---------------------------------------------------------
  async fetchCierrePreview(opts?: { anio?: number; mes?: number }): Promise<CierrePreview> {
    const params: any = {};
    if (opts?.anio != null) params.anio = opts.anio;
    if (opts?.mes != null) params.mes = opts.mes;

    const res = await api.get<CierrePreview>(`${BASE}/cierre/preview`, { params });
    return res.data;
  },

  // ---------------------------------------------------------
  // CIERRE: generar (persistente) -> inserta cierre (según regla M-1 o params)
  // ---------------------------------------------------------
  async postGenerarCierre(payload?: GenerarCierreRequest): Promise<any> {
    const body = {
      force: !!payload?.force,
      user_id: payload?.user_id ?? undefined,
      version: payload?.version ?? undefined,
    };
    const res = await api.post<any>(`${BASE}/cierre/generar`, body);
    return res.data;
  },

  // ---------------------------------------------------------
  // CIERRE + REINICIO: operación combinada (persistente)
  // ---------------------------------------------------------
  async postGenerarYReiniciar(payload?: GenerarYReiniciarRequest): Promise<any> {
    const body = {
      cierre: {
        force: !!payload?.cierre?.force,
        user_id: payload?.cierre?.user_id ?? undefined,
        version: payload?.cierre?.version ?? undefined,
      },
      reinicio: {
        // Si no viene, false
        aplicar_promedios: !!payload?.reinicio?.aplicar_promedios,
      },
    };

    const res = await api.post<any>(`${BASE}/generar_y_reiniciar`, body);
    return res.data;
  },

  // ---------------------------------------------------------
  // MES: presupuesto total (si mantienes endpoint separado)
  // Si en backend lo has integrado dentro de /mes/preview, puedes NO usar esto.
  // ---------------------------------------------------------
  async fetchPresupuestoCotidianosTotal(): Promise<number> {
    const res = await api.get<{ total: number }>(`${BASE}/mes/presupuesto_total`);
    return Number(res.data?.total ?? 0);
  },
};

// -----------------------------------------------------------------------------
// Compatibilidad (para no romper pantallas existentes mientras migras imports)
// -----------------------------------------------------------------------------

// Legacy: antes se importaba desde gastosApi.ts
export async function fetchReinicioMesEligibility(): Promise<ReinicioMesEligibility> {
  return reinicioApi.fetchMesEligibility();
}

// Legacy: antes se importaba desde gastosApi.ts
export async function postReiniciarMes(opts?: { aplicarPromedios?: boolean }): Promise<ReinicioMesResult> {
  return reinicioApi.postReiniciarMes(opts);
}

// Legacy: antes se importaba desde gastosApi.ts
export async function fetchPresupuestoCotidianosTotal(): Promise<number> {
  return reinicioApi.fetchPresupuestoCotidianosTotal();
}
