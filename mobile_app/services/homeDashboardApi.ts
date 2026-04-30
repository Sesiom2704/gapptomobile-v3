/**
 * Ruta: mobile_app/services/homeDashboardApi.ts
 * Versión: 1.9.1
 * Descripción:
 * Servicio de construcción del dashboard Home.
 *
 * Mantiene compatibilidad con el panel actual y añade soporte para participación:
 * - Propiedades: valor_mercado, inversión, NOI y equity ponderados por participacion_pct.
 * - Liquidez: saldo de cuentas ponderado por participacion_pct.
 * - Endeudamiento: se espera ya ponderado desde backend.
 * - Ingresos/gastos gestionables: se espera ya ponderado desde monthly-summary.
 *
 * Regla funcional:
 * - Los importes mostrados en Home son métricas personales ponderadas.
 * - Las acciones reales de pagar/cobrar siguen moviendo el 100% del importe operativo.
 */

import { getMonthlySummary } from './analyticsApi';
import { fetchBalanceMes } from './balanceApi';
import { fetchGastosCotidianos } from './gastosCotidianosApi';
import { fetchMovimientosMes } from './movimientosApi';
import { api } from './api';

export type HomeDashboardResponse = {
  year: number;
  month: number;

  liquidezTotal: number;
  saldoPrevistoFinMes: number;

  ingresosMes: number;
  gastosMes: number;
  ahorroMes: number;
  ingresosMesTotalIncluyendoExtras?: number;

  ingresosPresupuestados: number;
  gestionablesPresupuestados: number;
  cotidianosPresupuestados: number;
  totalGastoPresupuestado: number;

  gestionablesConsumidos: number;
  cotidianosConsumidos: number;
  totalGastoConsumido: number;

  extrasIngresosMes: number;
  extrasGastosMes: number;
  extrasNetoMes: number;

  ingresosPresupuestadosOriginal: number;
  gestionablesPresupuestadosOriginal: number;
  cotidianosPresupuestadosOriginal: number;
  totalGastoPresupuestadoOriginal: number;

  ingresosOmitidosMes: number;
  gestionablesOmitidosMes: number;
  cotidianosOmitidosMes: number;
  totalGastoOmitidoMes: number;

  gestionablesReal: number;
  cotidianosReal: number;
  totalGastoReal: number;

  gestionablesPresupuestado: number;
  cotidianosPresupuestado: number;

  ingresosPendientesTotal: number;
  gastosPendientesTotal: number;
  gastosGestionablesPendientesTotal: number;
  gastosCotidianosPendientesTotal: number;

  ultimosMovimientos: Array<{
    id: string;
    fecha: string;
    descripcion: string;
    tipo: 'GASTO_GESTIONABLE' | 'GASTO_COTIDIANO' | 'INGRESO';
    es_ingreso: boolean;
    importe: number;
  }>;

  patrimonioPropiedadesCount: number;
  patrimonioValorMercadoTotal: number;
  patrimonioNoiTotal: number;
  patrimonioEquityTotal: number;
  patrimonioRentabilidadBrutaMediaPct: number | null;
  patrimonioNoiSobreVmPct: number | null;
  patrimonioLtvAproxPct: number | null;
  patrimonioNoiMensual: number;

  patrimonioValorInversionesTotal: number;
  inversionesActivasCount: number;
  inversionesRoiEsperadoMedioPct: number | null;
  inversionesIrrEsperadaMediaPct: number | null;

  patrimonioTotal: number;

  endeudamientoTotalDeuda: number;
  endeudamientoPct: number | null;
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

function numOrNull(x: any): number | null {
  const v = typeof x === 'number' ? x : x == null ? null : Number(x);
  return v == null || Number.isNaN(v) ? null : v;
}

function round2(x: number): number {
  return Number((Number.isFinite(x) ? x : 0).toFixed(2));
}

/**
 * Convierte participación a factor multiplicador.
 *
 * Compatibilidad:
 * - 100 -> 1
 * - 50  -> 0.5
 * - 1   -> 1
 * - 0.5 -> 0.5
 */
function participationFactor(value: unknown): number {
  const raw = numOrNull(value);

  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 1;

  const factor = raw > 1 ? raw / 100 : raw;

  if (!Number.isFinite(factor) || factor <= 0) return 1;
  if (factor > 1) return 1;

  return factor;
}

async function sumGastosCotidianosMes(year: number, month: number): Promise<number> {
  const limit = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    const page = await fetchGastosCotidianos({ year, month, limit, offset });
    if (!page.length) break;

    total += page.reduce((acc, g) => acc + (g.pagado ? g.importe ?? 0 : 0), 0);

    if (page.length < limit) break;
    offset += limit;
  }

  return total;
}

type PatrimonioRow = {
  id: string;
  activo?: boolean | null;
  participacion_pct?: number | string | null;
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
          params: {
            year,
            mode: 'LAST_12',
            annualize: false,
            basis: 'total',
          },
        })
        .then((x) => x.data)
        .catch(() => null);

      const [compra, kpis] = await Promise.all([compraPromise, kpisPromise]);
      return { patrimonio: p, compra, kpis };
    })
  );

  let valorMercadoTotal = 0;
  let totalInversionTotal = 0;
  let noiTotal = 0;

  let wSum = 0;
  let wPct = 0;

  for (const it of enriched) {
    const factor = participationFactor(it.patrimonio?.participacion_pct);

    const vm = (numOrNull(it.compra?.valor_mercado) ?? 0) * factor;
    const inv = (numOrNull(it.compra?.total_inversion) ?? 0) * factor;

    valorMercadoTotal += vm;
    totalInversionTotal += inv;

    const noi = (numOrNull(it.kpis?.noi) ?? 0) * factor;
    noiTotal += noi;

    const baseRaw = numOrNull(it.kpis?.valor_base);
    const bruto = numOrNull(it.kpis?.rendimiento_bruto_pct);
    const base = baseRaw == null ? null : baseRaw * factor;

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
    valorMercadoTotal: round2(valorMercadoTotal),
    noiTotal: round2(noiTotal),
    equityTotal: round2(equityTotal),
    rentabilidadBrutaMediaPct: rentabilidadBrutaMediaPct == null ? null : round2(rentabilidadBrutaMediaPct),
    noiSobreVmPct: noiSobreVmPct == null ? null : round2(noiSobreVmPct),
    ltvAproxPct: ltvAproxPct == null ? null : round2(ltvAproxPct),
    noiMensual: round2(noiMensual),
  };
}

type InversionHomeRow = {
  id: string;
  estado?: string | null;
  aporte_estimado?: number | null;
  aporte_final?: number | null;
  roi_esperado_pct?: number | null;
  irr_esperada_pct?: number | null;
};

async function fetchInversionesSummaryForHome(): Promise<{
  valorInversionesTotal: number;
  inversionesActivasCount: number;
  roiEsperadoMedioPct: number | null;
  irrEsperadaMediaPct: number | null;
}> {
  const r = await api.get<InversionHomeRow[]>(`/api/v1/inversiones`, {
    params: { estado: 'ACTIVA' },
  });

  const rows = Array.isArray(r.data) ? r.data : [];

  let valorInversionesTotal = 0;

  let roiSum = 0;
  let roiCount = 0;

  let irrSum = 0;
  let irrCount = 0;

  for (const inv of rows) {
    const aporteFinal = numOrNull(inv?.aporte_final);
    const aporteEstimado = numOrNull(inv?.aporte_estimado);

    const base =
      aporteFinal != null && aporteFinal > 0
        ? aporteFinal
        : aporteEstimado != null && aporteEstimado > 0
          ? aporteEstimado
          : 0;

    valorInversionesTotal += base;

    const roi = numOrNull(inv?.roi_esperado_pct);
    if (roi != null) {
      roiSum += roi;
      roiCount += 1;
    }

    const irr = numOrNull(inv?.irr_esperada_pct);
    if (irr != null) {
      irrSum += irr;
      irrCount += 1;
    }
  }

  return {
    valorInversionesTotal: round2(valorInversionesTotal),
    inversionesActivasCount: rows.length,
    roiEsperadoMedioPct: roiCount > 0 ? round2(roiSum / roiCount) : null,
    irrEsperadaMediaPct: irrCount > 0 ? round2(irrSum / irrCount) : null,
  };
}

type EndeudamientoSummaryOut = {
  total_deuda?: number | string | null;
  totalDeuda?: number | string | null;
};

async function fetchEndeudamientoSummaryForHome(): Promise<{ totalDeuda: number }> {
  const r = await api.get<EndeudamientoSummaryOut>(`/api/v1/analytics/endeudamiento/summary`);
  const total = pickNumber(r.data, ['total_deuda', 'totalDeuda'], 0);
  return { totalDeuda: total };
}

function calcLiquidezActualPonderada(balance: any): number {
  const cuentas = Array.isArray(balance?.saldos_cuentas) ? balance.saldos_cuentas : [];

  if (!cuentas.length) {
    return n(balance?.liquidez_actual_total);
  }

  return round2(
    cuentas.reduce((acc: number, c: any) => {
      const saldo = n(c?.fin);
      const factor = participationFactor(c?.participacion_pct ?? 100);
      return acc + saldo * factor;
    }, 0)
  );
}

function calcLiquidezPrevistaPonderada(balance: any): number {
  const cuentas = Array.isArray(balance?.saldos_cuentas) ? balance.saldos_cuentas : [];

  if (!cuentas.length) {
    return n(balance?.liquidez_prevista_total);
  }

  return round2(
    cuentas.reduce((acc: number, c: any) => {
      const fin = n(c?.fin);
      const ingresosPend = n(c?.ingresos_pendientes);
      const gastosPend = n(c?.gastos_gestionables_pendientes) + n(c?.gastos_cotidianos_pendientes);
      const factor = participationFactor(c?.participacion_pct ?? 100);

      return acc + (fin - gastosPend + ingresosPend) * factor;
    }, 0)
  );
}

export async function fetchHomeDashboard(params: { year: number; month: number }): Promise<HomeDashboardResponse> {
  const { year, month } = params;

  const [
    summary,
    balance,
    totalCotidianos,
    movimientosMes,
    patrimonioSummary,
    inversionesSummary,
    endeudamientoSummary,
  ] = await Promise.all([
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
    fetchInversionesSummaryForHome().catch(() => ({
      valorInversionesTotal: 0,
      inversionesActivasCount: 0,
      roiEsperadoMedioPct: null,
      irrEsperadaMediaPct: null,
    })),
    fetchEndeudamientoSummaryForHome().catch(() => ({ totalDeuda: 0 })),
  ]);

  const ingresosRecurrentesMes = n((summary as any)?.detalle_ingresos?.recurrentes);
  const extrasIngresosMes = n((summary as any)?.detalle_ingresos?.extraordinarios);

  const ingresosMes = ingresosRecurrentesMes;
  const ingresosMesTotalIncluyendoExtras = ingresosRecurrentesMes + extrasIngresosMes;

  const gastosMes = n((summary as any)?.general?.gastos_mes);
  const ahorroMes = n((summary as any)?.general?.ahorro_mes);

  const gestionablesConsumidos = n((summary as any)?.detalle_gastos?.recurrentes);
  const extrasGastosMes = n((summary as any)?.detalle_gastos?.extraordinarios);

  // Se mantiene el comportamiento actual:
  // cotidianos salen de gastos_cotidianos y no se ponderan por vivienda.
  const cotidianosConsumidos = n(totalCotidianos);

  const totalGastoConsumido = gestionablesConsumidos + cotidianosConsumidos + extrasGastosMes;
  const extrasNetoMes = extrasIngresosMes - extrasGastosMes;

  const pres = (summary as any)?.presupuestos ?? {};

  const ingresosPresupuestados = pickNumber(pres, ['ingresos_presupuesto'], 0);
  const gestionablesPresupuestados = pickNumber(pres, ['gestionables_presupuesto'], 0);
  const cotidianosPresupuestados = pickNumber(pres, ['cotidianos_presupuesto'], 0);
  const totalGastoPresupuestado = pickNumber(pres, ['gasto_total_presupuesto'], 0);

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

  const ingresosOmitidosRaw = pickNumber(
    pres,
    ['ingresos_omitidos_mes', 'ingresos_omitidos', 'ingresos_omitidos_total'],
    NaN
  );
  const gestionablesOmitidosRaw = pickNumber(
    pres,
    ['gestionables_omitidos_mes', 'gestionables_omitidos', 'gestionables_omitidos_total'],
    NaN
  );
  const cotidianosOmitidosRaw = pickNumber(
    pres,
    ['cotidianos_omitidos_mes', 'cotidianos_omitidos', 'cotidianos_omitidos_total'],
    NaN
  );
  const totalGastoOmitidosRaw = pickNumber(
    pres,
    ['gasto_total_omitido_mes', 'gasto_total_omitido', 'gasto_total_omitido_total'],
    NaN
  );

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

  const gestionablesReal = gestionablesConsumidos;
  const cotidianosReal = cotidianosConsumidos;
  const totalGastoReal = totalGastoConsumido;

  const gestionablesPresupuestado = gestionablesPresupuestados;
  const cotidianosPresupuestado = cotidianosPresupuestados;

  const liquidezTotal = calcLiquidezActualPonderada(balance);
  const saldoPrevistoFinMes = calcLiquidezPrevistaPonderada(balance);

  const endeudamientoTotalDeuda = round2(n(endeudamientoSummary?.totalDeuda));

  const patrimonioBruto = n(patrimonioSummary?.valorMercadoTotal);
  const patrimonioValorInversionesTotal = n(inversionesSummary?.valorInversionesTotal);

  const patrimonioTotal = round2(
    patrimonioBruto +
      patrimonioValorInversionesTotal +
      liquidezTotal -
      endeudamientoTotalDeuda
  );

  const endeudamientoPct =
    patrimonioBruto > 0 ? round2((endeudamientoTotalDeuda / patrimonioBruto) * 100) : null;

  return {
    year,
    month,

    liquidezTotal,
    saldoPrevistoFinMes,

    ingresosMes,
    gastosMes,
    ahorroMes,
    ingresosMesTotalIncluyendoExtras,

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

    patrimonioValorInversionesTotal,
    inversionesActivasCount: inversionesSummary.inversionesActivasCount,
    inversionesRoiEsperadoMedioPct: inversionesSummary.roiEsperadoMedioPct,
    inversionesIrrEsperadaMediaPct: inversionesSummary.irrEsperadaMediaPct,

    patrimonioTotal,

    endeudamientoTotalDeuda,
    endeudamientoPct,
  };
}