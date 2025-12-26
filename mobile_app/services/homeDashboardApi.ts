// mobile_app/services/homeDashboardApi.ts
//
// Objetivo del cambio (sin crear un service nuevo):
// - Mantener el HomeDashboard tal cual.
// - Añadir un bloque "Patrimonio" calculado con la MISMA lógica que el Ranking:
//   - KPIs por propiedad desde /api/v1/analytics/patrimonios/{id}/kpis
//   - Valor mercado / inversión desde /api/v1/patrimonios/{id}/compra
// - Agregar a nivel usuario (activos):
//   - rentabilidadBrutaMediaPct (ponderada por valor_base)
//   - noiTotal (anual, annualize=true)
//   - valorMercadoTotal
//   - equityTotal = Σ(valor_mercado) − Σ(total_inversion)
//   - indicadores extra "pro":
//       * noiSobreVmPct = NOI / Valor Mercado
//       * ltvAproxPct   = Total Inversión / Valor Mercado  (aprox, no es deuda real)
//
// Nota importante:
// - NO usamos /api/v1/analytics/patrimonio/summary porque en tu entorno daba 404.
// - Si alguna propiedad no tiene compra/kpis, se agrega de forma defensiva (no rompe).

import { getMonthlySummary } from './analyticsApi';
import { fetchBalanceMes } from './balanceApi';
import { fetchGastosCotidianos } from './gastosCotidianosApi';
import { fetchMovimientosMes } from './movimientosApi';
import { api } from './api';

export type HomeDashboardResponse = {
  year: number;
  month: number;

  // Header
  liquidezTotal: number;
  saldoPrevistoFinMes: number;

  // Reales (mes)
  ingresosMes: number;
  gastosMes: number;
  ahorroMes: number;

  // --- NOMBRES NUEVOS (base) ---
  ingresosPresupuestados: number;
  gestionablesPresupuestados: number;
  cotidianosPresupuestados: number;
  totalGastoPresupuestado: number;

  gestionablesConsumidos: number; // ✅ SOLO recurrentes (excluye PAGO UNICO)
  cotidianosConsumidos: number;
  totalGastoConsumido: number;    // ✅ incluye extras gastos

  extrasIngresosMes: number; // ingresos PAGO UNICO cobrados en el mes
  extrasGastosMes: number;   // gastos gestionables PAGO UNICO pagados en el mes
  extrasNetoMes: number;     // extrasIngresosMes - extrasGastosMes

  // --- ALIAS LEGACY (para que MainTabs no rompa) ---
  gestionablesReal: number;
  cotidianosReal: number;
  totalGastoReal: number;

  gestionablesPresupuestado: number;
  cotidianosPresupuestado: number;

  // Pendientes (balance)
  ingresosPendientesTotal: number;
  gastosPendientesTotal: number;
  gastosGestionablesPendientesTotal: number;
  gastosCotidianosPendientesTotal: number;

  // Actividad reciente
  ultimosMovimientos: Array<{
    id: string;
    fecha: string;
    descripcion: string;
    tipo: 'GASTO_GESTIONABLE' | 'GASTO_COTIDIANO' | 'INGRESO';
    es_ingreso: boolean;
    importe: number;
  }>;

  // -----------------------
  // NUEVO: Resumen Patrimonio (para Home)
  // -----------------------
  patrimonioPropiedadesCount: number;
  patrimonioValorMercadoTotal: number;
  patrimonioNoiTotal: number; // anual (annualize=true)
  patrimonioEquityTotal: number;
  patrimonioRentabilidadBrutaMediaPct: number | null; // % (ponderada). null si no hay base

  // Extras "pro"
  patrimonioNoiSobreVmPct: number | null; // NOI / VM * 100
  patrimonioLtvAproxPct: number | null;   // Inversión / VM * 100 (aprox)
  patrimonioNoiMensual: number;           // NOI / 12
};

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Suma de cotidianos pagados (paginado).
 */
async function sumGastosCotidianosMes(year: number, month: number): Promise<number> {
  const limit = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    const page = await fetchGastosCotidianos({ year, month, limit, offset });
    if (!page.length) break;

    // ✅ Solo pagados
    total += page.reduce((acc, g) => acc + (g.pagado ? (g.importe ?? 0) : 0), 0);

    if (page.length < limit) break;
    offset += limit;
  }

  return total;
}

// -----------------------
// Tipos mínimos para patrimonio
// -----------------------
type PatrimonioRow = {
  id: string;
  activo?: boolean | null;
};

type PatrimonioCompraOut = {
  patrimonio_id: string;
  total_inversion?: number | null;
  valor_mercado?: number | null;
  valor_mercado_fecha?: string | null;
};

type PatrimonioKpisOut = {
  valor_base?: number | null;
  noi?: number | null;
  rendimiento_bruto_pct?: number | null;
};

// Helpers defensivos
function numOrNull(x: any): number | null {
  const v = typeof x === 'number' ? x : x == null ? null : Number(x);
  return v == null || Number.isNaN(v) ? null : v;
}

function isActive(p: PatrimonioRow): boolean {
  return p.activo !== false; // por defecto true si viene null/undefined
}

/**
 * Carga resumen de patrimonio para HOME usando:
 * - /api/v1/patrimonios
 * - /api/v1/patrimonios/{id}/compra
 * - /api/v1/analytics/patrimonios/{id}/kpis
 */
async function fetchPatrimonioSummaryForHome(year: number): Promise<{
  propiedadesCount: number;
  valorMercadoTotal: number;
  noiTotal: number;
  equityTotal: number;
  rentabilidadBrutaMediaPct: number | null;

  noiSobreVmPct: number | null;
  ltvAproxPct: number | null;
  noiMensual: number;
}> {
  // 1) Listado patrimonios
  const rProps = await api.get<PatrimonioRow[]>(`/api/v1/patrimonios`);
  const activos = (rProps.data ?? []).filter(isActive);

  if (activos.length === 0) {
    return {
      propiedadesCount: 0,
      valorMercadoTotal: 0,
      noiTotal: 0,
      equityTotal: 0,
      rentabilidadBrutaMediaPct: null,
      noiSobreVmPct: null,
      ltvAproxPct: null,
      noiMensual: 0,
    };
  }

  // 2) Enriquecemos cada propiedad con compra y kpis (en paralelo)
  const enriched = await Promise.all(
    activos.map(async (p) => {
      const pid = encodeURIComponent(p.id);

      const compraPromise = api
        .get<PatrimonioCompraOut | null>(`/api/v1/patrimonios/${pid}/compra`)
        .then((x) => x.data)
        .catch(() => null);

      const kpisPromise = api
        .get<PatrimonioKpisOut>(`/api/v1/analytics/patrimonios/${pid}/kpis`, {
          params: { year, annualize: true, basis: 'total' },
        })
        .then((x) => x.data)
        .catch(() => null);

      const [compra, kpis] = await Promise.all([compraPromise, kpisPromise]);
      return { compra, kpis };
    })
  );

  // 3) Agregados
  let valorMercadoTotal = 0;
  let totalInversionTotal = 0;
  let noiTotal = 0;

  // rentabilidad bruta media ponderada por valor_base
  let wSum = 0; // SUM(valor_base)
  let wPct = 0; // SUM(rendimiento_bruto_pct * valor_base)

  for (const it of enriched) {
    const vm = numOrNull(it.compra?.valor_mercado) ?? 0;
    const inv = numOrNull(it.compra?.total_inversion) ?? 0;

    valorMercadoTotal += vm;
    totalInversionTotal += inv;

    const noi = numOrNull(it.kpis?.noi) ?? 0;
    noiTotal += noi;

    const base = numOrNull(it.kpis?.valor_base);
    const bruto = numOrNull(it.kpis?.rendimiento_bruto_pct);

    if (base != null && base > 0 && bruto != null) {
      wSum += base;
      wPct += bruto * base;
    }
  }

  const equityTotal = valorMercadoTotal - totalInversionTotal;
  const rentabilidadBrutaMediaPct = wSum > 0 ? wPct / wSum : null;

  const noiSobreVmPct = valorMercadoTotal > 0 ? (noiTotal / valorMercadoTotal) * 100 : null;

  // “LTV aprox” (realmente: inversión/valor mercado). Útil como indicador rápido, pero no es deuda.
  const ltvAproxPct = valorMercadoTotal > 0 ? (totalInversionTotal / valorMercadoTotal) * 100 : null;

  const noiMensual = noiTotal / 12;

  return {
    propiedadesCount: activos.length,
    valorMercadoTotal: Number(valorMercadoTotal.toFixed(2)),
    noiTotal: Number(noiTotal.toFixed(2)),
    equityTotal: Number(equityTotal.toFixed(2)),
    rentabilidadBrutaMediaPct: rentabilidadBrutaMediaPct == null ? null : Number(rentabilidadBrutaMediaPct.toFixed(2)),
    noiSobreVmPct: noiSobreVmPct == null ? null : Number(noiSobreVmPct.toFixed(2)),
    ltvAproxPct: ltvAproxPct == null ? null : Number(ltvAproxPct.toFixed(2)),
    noiMensual: Number(noiMensual.toFixed(2)),
  };
}

export async function fetchHomeDashboard(params: {
  year: number;
  month: number;
}): Promise<HomeDashboardResponse> {
  const { year, month } = params;

  const [summary, balance, totalCotidianos, movimientosMes, patrimonioSummary] = await Promise.all([
    getMonthlySummary({ year, month }),
    fetchBalanceMes({ year, month }),
    sumGastosCotidianosMes(year, month),
    fetchMovimientosMes(year, month),

    // ✅ Patrimonio (si falla, no rompemos Home)
    fetchPatrimonioSummaryForHome(year).catch(() => ({
      propiedadesCount: 0,
      valorMercadoTotal: 0,
      noiTotal: 0,
      equityTotal: 0,
      rentabilidadBrutaMediaPct: null,
      noiSobreVmPct: null,
      ltvAproxPct: null,
      noiMensual: 0,
    })),
  ]);

  // -----------------------
  // REALES (corregidos)
  // -----------------------
  const ingresosRecurrentesMes = n((summary as any)?.detalle_ingresos?.recurrentes);
  const extrasIngresosMes = n((summary as any)?.detalle_ingresos?.extraordinarios);
  const ingresosMes = ingresosRecurrentesMes + extrasIngresosMes;

  const gastosMes = n((summary as any)?.general?.gastos_mes);
  const ahorroMes = n((summary as any)?.general?.ahorro_mes);

  // ✅ Gestionables (barra 3): SOLO recurrentes (periodicidad <> PAGO UNICO)
  const gestionablesConsumidos = n((summary as any)?.detalle_gastos?.recurrentes);

  // ✅ Extras gastos (barra 5): SOLO PAGO UNICO
  const extrasGastosMes = n((summary as any)?.detalle_gastos?.extraordinarios);

  // ✅ Cotidianos consumidos pagados (barra 4)
  const cotidianosConsumidos = n(totalCotidianos);

  // ✅ Total gasto consumido (barra 1): gestionables recurrentes + cotidianos + extras gastos
  const totalGastoConsumido = gestionablesConsumidos + cotidianosConsumidos + extrasGastosMes;

  // ✅ Neto extras
  const extrasNetoMes = extrasIngresosMes - extrasGastosMes;

  // -----------------------
  // PRESUPUESTOS (backend)
  // -----------------------
  const ingresosPresupuestados = n((summary as any)?.presupuestos?.ingresos_presupuesto);
  const gestionablesPresupuestados = n((summary as any)?.presupuestos?.gestionables_presupuesto);
  const cotidianosPresupuestados = n((summary as any)?.presupuestos?.cotidianos_presupuesto);
  const totalGastoPresupuestado = n((summary as any)?.presupuestos?.gasto_total_presupuesto);

  // -----------------------
  // PENDIENTES (balance)
  // -----------------------
  const cuentas = (balance as any)?.saldos_cuentas ?? [];

  const gastosGestionablesPendientesTotal = cuentas.reduce(
    (acc: number, c: any) => acc + n(c.gastos_gestionables_pendientes),
    0
  );
  const gastosCotidianosPendientesTotal = cuentas.reduce(
    (acc: number, c: any) => acc + n(c.gastos_cotidianos_pendientes),
    0
  );

  const ingresosPendientesTotal = n((balance as any)?.ingresos_pendientes_total);
  const gastosPendientesTotal = n((balance as any)?.gastos_pendientes_total);

  const ultimosMovimientos = (((movimientosMes as any)?.movimientos ?? []) as any[])
    .slice(0, 5)
    .map((m: any) => ({
      id: m.id,
      fecha: m.fecha,
      descripcion: m.descripcion,
      tipo: m.tipo,
      es_ingreso: m.es_ingreso,
      importe: m.importe,
    }));

  // -----------------------
  // ALIAS para MainTabs
  // -----------------------
  const gestionablesReal = gestionablesConsumidos;
  const cotidianosReal = cotidianosConsumidos;
  const totalGastoReal = totalGastoConsumido;

  const gestionablesPresupuestado = gestionablesPresupuestados;
  const cotidianosPresupuestado = cotidianosPresupuestados;

  return {
    year,
    month,

    liquidezTotal: n((balance as any)?.liquidez_actual_total),
    saldoPrevistoFinMes: n((balance as any)?.liquidez_prevista_total),

    ingresosMes,
    gastosMes,
    ahorroMes,

    ingresosPresupuestados,
    gestionablesPresupuestados,
    cotidianosPresupuestados,
    totalGastoPresupuestado,

    gestionablesConsumidos,
    cotidianosConsumidos,
    totalGastoConsumido,

    extrasIngresosMes,
    extrasGastosMes,
    extrasNetoMes,

    gestionablesReal,
    cotidianosReal,
    totalGastoReal,
    gestionablesPresupuestado,
    cotidianosPresupuestado,

    ingresosPendientesTotal,
    gastosPendientesTotal,
    gastosGestionablesPendientesTotal,
    gastosCotidianosPendientesTotal,

    ultimosMovimientos,

    // -----------------------
    // Patrimonio para Home
    // -----------------------
    patrimonioPropiedadesCount: patrimonioSummary.propiedadesCount,
    patrimonioValorMercadoTotal: patrimonioSummary.valorMercadoTotal,
    patrimonioNoiTotal: patrimonioSummary.noiTotal,
    patrimonioEquityTotal: patrimonioSummary.equityTotal,
    patrimonioRentabilidadBrutaMediaPct: patrimonioSummary.rentabilidadBrutaMediaPct,

    patrimonioNoiSobreVmPct: patrimonioSummary.noiSobreVmPct,
    patrimonioLtvAproxPct: patrimonioSummary.ltvAproxPct,
    patrimonioNoiMensual: patrimonioSummary.noiMensual,
  };
}
