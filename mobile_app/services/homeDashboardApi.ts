// mobile_app/services/homeDashboardApi.ts
//
// Objetivo:
// - Mantener HomeDashboard tal cual.
// - Añadir soporte robusto para barras 3 estados (Real/Pagado, Omitido, Pendiente) en Home.
// - Mantener aliases legacy para no romper navegación ni pantallas previas.
// - Mantener bloque Patrimonio.

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

  // Presupuesto “ajustado” (puede excluir omitidos según backend)
  ingresosPresupuestados: number;
  gestionablesPresupuestados: number;
  cotidianosPresupuestados: number;
  totalGastoPresupuestado: number;

  // Consumidos
  gestionablesConsumidos: number; // ✅ recurrentes (excluye PAGO UNICO)
  cotidianosConsumidos: number;
  totalGastoConsumido: number; // ✅ incluye extras gastos

  // Extras (PAGO UNICO)
  extrasIngresosMes: number;
  extrasGastosMes: number;
  extrasNetoMes: number;

  // ✅ NUEVO: Original + Omitidos (para Home 3 estados)
  ingresosPresupuestadosOriginal: number;
  gestionablesPresupuestadosOriginal: number;
  cotidianosPresupuestadosOriginal: number;
  totalGastoPresupuestadoOriginal: number;

  ingresosOmitidosMes: number;
  gestionablesOmitidosMes: number;
  cotidianosOmitidosMes: number;
  totalGastoOmitidoMes: number;

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

  // Patrimonio
  patrimonioPropiedadesCount: number;
  patrimonioValorMercadoTotal: number;
  patrimonioNoiTotal: number;
  patrimonioEquityTotal: number;
  patrimonioRentabilidadBrutaMediaPct: number | null;

  patrimonioNoiSobreVmPct: number | null;
  patrimonioLtvAproxPct: number | null;
  patrimonioNoiMensual: number;
};

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function pickNumber(obj: any, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return fallback;
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

    total += page.reduce((acc, g) => acc + (g.pagado ? (g.importe ?? 0) : 0), 0);

    if (page.length < limit) break;
    offset += limit;
  }

  return total;
}

// -----------------------
// Tipos mínimos para patrimonio
// -----------------------
type PatrimonioRow = { id: string; activo?: boolean | null };

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

function numOrNull(x: any): number | null {
  const v = typeof x === 'number' ? x : x == null ? null : Number(x);
  return v == null || Number.isNaN(v) ? null : v;
}

function isActive(p: PatrimonioRow): boolean {
  return p.activo !== false;
}

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

  const enriched = await Promise.all(
    activos.map(async (p) => {
      const pid = encodeURIComponent(p.id);

      const compraPromise = api
        .get<PatrimonioCompraOut | null>(`/api/v1/patrimonios/${pid}/compra`)
        .then((x) => x.data)
        .catch(() => null);

      const kpisPromise = api
        .get<PatrimonioKpisOut>(`/api/v1/analytics/patrimonios/${pid}/kpis`, {
          params: { year, annualize: false, basis: 'total' },
        })
        .then((x) => x.data)
        .catch(() => null);

      const [compra, kpis] = await Promise.all([compraPromise, kpisPromise]);
      return { compra, kpis };
    })
  );

  let valorMercadoTotal = 0;
  let totalInversionTotal = 0;
  let noiTotal = 0;

  let wSum = 0;
  let wPct = 0;

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

export async function fetchHomeDashboard(params: { year: number; month: number }): Promise<HomeDashboardResponse> {
  const { year, month } = params;

  const [summary, balance, totalCotidianos, movimientosMes, patrimonioSummary] = await Promise.all([
    getMonthlySummary({ year, month }),
    fetchBalanceMes({ year, month }),
    sumGastosCotidianosMes(year, month),
    fetchMovimientosMes(year, month),
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
  // REALES (mes)
  // -----------------------
  const ingresosRecurrentesMes = n((summary as any)?.detalle_ingresos?.recurrentes);
  const extrasIngresosMes = n((summary as any)?.detalle_ingresos?.extraordinarios);
  const ingresosMes = ingresosRecurrentesMes + extrasIngresosMes;

  const gastosMes = n((summary as any)?.general?.gastos_mes);
  const ahorroMes = n((summary as any)?.general?.ahorro_mes);

  const gestionablesConsumidos = n((summary as any)?.detalle_gastos?.recurrentes);
  const extrasGastosMes = n((summary as any)?.detalle_gastos?.extraordinarios);
  const cotidianosConsumidos = n(totalCotidianos);

  const totalGastoConsumido = gestionablesConsumidos + cotidianosConsumidos + extrasGastosMes;
  const extrasNetoMes = extrasIngresosMes - extrasGastosMes;

  // -----------------------
  // PRESUPUESTOS / OMITIDOS (ROBUSTO)
  // -----------------------
  const pres = (summary as any)?.presupuestos ?? {};

  // Ajustados
  const ingresosPresupuestados = pickNumber(pres, ['ingresos_presupuesto'], 0);
  const gestionablesPresupuestados = pickNumber(pres, ['gestionables_presupuesto'], 0);
  const cotidianosPresupuestados = pickNumber(pres, ['cotidianos_presupuesto'], 0);
  const totalGastoPresupuestado = pickNumber(pres, ['gasto_total_presupuesto'], 0);

  // Originales (fallback a ajustados si no vienen)
  const ingresosPresupuestadosOriginal = pickNumber(
    pres,
    ['ingresos_presupuesto_original', 'ingresos_presupuesto_base', 'ingresos_presupuesto'],
    ingresosPresupuestados
  );
  const gestionablesPresupuestadosOriginal = pickNumber(
    pres,
    ['gestionables_presupuesto_original', 'gestionables_presupuesto_base', 'gestionables_presupuesto'],
    gestionablesPresupuestados
  );
  const cotidianosPresupuestadosOriginal = pickNumber(
    pres,
    ['cotidianos_presupuesto_original', 'cotidianos_presupuesto_base', 'cotidianos_presupuesto'],
    cotidianosPresupuestados
  );
  const totalGastoPresupuestadoOriginal = pickNumber(
    pres,
    ['gasto_total_presupuesto_original', 'gasto_total_presupuesto_base', 'gasto_total_presupuesto'],
    totalGastoPresupuestado
  );

  // Omitidos (aceptamos varias keys; si no vienen, derivamos original - ajustado)
  const ingresosOmitidosRaw = pickNumber(pres, ['ingresos_omitidos_mes', 'ingresos_omitidos', 'ingresos_omitidos_total'], NaN);
  const gestionablesOmitidosRaw = pickNumber(pres, ['gestionables_omitidos_mes', 'gestionables_omitidos', 'gestionables_omitidos_total'], NaN);
  const cotidianosOmitidosRaw = pickNumber(pres, ['cotidianos_omitidos_mes', 'cotidianos_omitidos', 'cotidianos_omitidos_total'], NaN);
  const totalGastoOmitidosRaw = pickNumber(pres, ['gasto_total_omitido_mes', 'gasto_total_omitido', 'gasto_total_omitido_total'], NaN);

  const ingresosOmitidosMes = Number.isFinite(ingresosOmitidosRaw)
    ? Math.max(0, ingresosOmitidosRaw)
    : Math.max(0, ingresosPresupuestadosOriginal - ingresosPresupuestados);

  const gestionablesOmitidosMes = Number.isFinite(gestionablesOmitidosRaw)
    ? Math.max(0, gestionablesOmitidosRaw)
    : Math.max(0, gestionablesPresupuestadosOriginal - gestionablesPresupuestados);

  const cotidianosOmitidosMes = Number.isFinite(cotidianosOmitidosRaw)
    ? Math.max(0, cotidianosOmitidosRaw)
    : Math.max(0, cotidianosPresupuestadosOriginal - cotidianosPresupuestados);

  const totalGastoOmitidoMes = Number.isFinite(totalGastoOmitidosRaw)
    ? Math.max(0, totalGastoOmitidosRaw)
    : Math.max(0, totalGastoPresupuestadoOriginal - totalGastoPresupuestado);

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
  // ALIAS legacy
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

    ingresosPresupuestadosOriginal,
    gestionablesPresupuestadosOriginal,
    cotidianosPresupuestadosOriginal,
    totalGastoPresupuestadoOriginal,

    ingresosOmitidosMes,
    gestionablesOmitidosMes,
    cotidianosOmitidosMes,
    totalGastoOmitidoMes,

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
