// mobile_app/services/homeDashboardApi.ts
// -----------------------------------------------------------------------------
// Objetivo del cambio (sin romper nada):
// - Mantener contrato actual del HomeDashboard (legacy incluido).
// - Añadir KPIs agregados de Patrimonio para Home:
//   - Rentabilidad bruta media
//   - Equity total
//   - Cantidad de propiedades
//   - Valor mercado total
//   - NOI total
// - NO se crean nuevos services: la llamada se integra aquí.
// - Defensivo: si el endpoint no existe / falla, no rompe Home (devuelve 0/NULL).
// -----------------------------------------------------------------------------

import { getMonthlySummary } from './analyticsApi';
import { fetchBalanceMes } from './balanceApi';
import { fetchGastosCotidianos } from './gastosCotidianosApi';
import { fetchMovimientosMes } from './movimientosApi';
import { api } from './api';

// ----------------------------
// Tipos: Patrimonio Summary
// ----------------------------
// Endpoint esperado (backend):
//   GET /api/v1/analytics/patrimonio/summary?year=YYYY
// Debe devolver KPIs agregados del usuario autenticado (por token).
export type PatrimonioSummaryResponse = {
  year: number;

  propiedades_count: number;
  valor_mercado_total: number;

  // NOI total (según derivadas backend)
  noi_total: number;

  // % (puede ser null si no hay datos suficientes)
  rentabilidad_bruta_media_pct: number | null;

  // Equity total (según definición backend)
  equity_total: number;

  // Opcional (trazabilidad)
  equity_basis?: string | null;

  // Opcionales (si en futuro incluyes préstamos)
  deuda_total?: number | null;
  ltv_pct?: number | null;
};

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

  // ---------------------------------------------------------------------------
  // NUEVO: Patrimonio (para tarjeta Home)
  // ---------------------------------------------------------------------------
  patrimonioPropiedadesCount: number;
  patrimonioValorMercadoTotal: number;
  patrimonioNoiTotal: number;
  patrimonioRentabilidadBrutaMediaPct: number | null;
  patrimonioEquityTotal: number;

  // Opcionales (si backend lo expone)
  patrimonioDeudaTotal?: number | null;
  patrimonioLtvPct?: number | null;
};

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// -----------------------------------------------------------------------------
// Suma de gastos cotidianos pagados en el mes (paginado, lógica actual intacta)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// NUEVO: Fetch agregado de patrimonio (integrado en este mismo fichero)
// - Defensivo: lo usamos dentro de Promise.all con .catch(() => null)
// -----------------------------------------------------------------------------
async function fetchPatrimonioSummary(year: number): Promise<PatrimonioSummaryResponse> {
  const r = await api.get<PatrimonioSummaryResponse>(`/api/v1/analytics/patrimonio/summary`, {
    params: { year },
  });
  return r.data;
}

export async function fetchHomeDashboard(params: {
  year: number;
  month: number;
}): Promise<HomeDashboardResponse> {
  const { year, month } = params;

  // ---------------------------------------------------------------------------
  // Añadimos patrimonioSummary al Promise.all.
  // Importante: catch defensivo para NO romper Home si backend no lo tiene.
  // ---------------------------------------------------------------------------
  const [summary, balance, totalCotidianos, movimientosMes, patrimonioSummary] = await Promise.all([
    getMonthlySummary({ year, month }),
    fetchBalanceMes({ year, month }),
    sumGastosCotidianosMes(year, month),
    fetchMovimientosMes(year, month),
    fetchPatrimonioSummary(year).catch(() => null),
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

  // -----------------------
  // Actividad reciente
  // -----------------------
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
  // ALIAS para MainTabs (legacy)
  // -----------------------
  const gestionablesReal = gestionablesConsumidos;
  const cotidianosReal = cotidianosConsumidos;
  const totalGastoReal = totalGastoConsumido;

  const gestionablesPresupuestado = gestionablesPresupuestados;
  const cotidianosPresupuestado = cotidianosPresupuestados;

  // ---------------------------------------------------------------------------
  // NUEVO: KPIs Patrimonio (defensivo)
  // ---------------------------------------------------------------------------
  const patrimonioPropiedadesCount = patrimonioSummary?.propiedades_count ?? 0;
  const patrimonioValorMercadoTotal = patrimonioSummary?.valor_mercado_total ?? 0;
  const patrimonioNoiTotal = patrimonioSummary?.noi_total ?? 0;
  const patrimonioRentabilidadBrutaMediaPct = patrimonioSummary?.rentabilidad_bruta_media_pct ?? null;
  const patrimonioEquityTotal = patrimonioSummary?.equity_total ?? 0;

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

    // Patrimonio (Home)
    patrimonioPropiedadesCount,
    patrimonioValorMercadoTotal,
    patrimonioNoiTotal,
    patrimonioRentabilidadBrutaMediaPct,
    patrimonioEquityTotal,

    // Opcionales (si backend lo expone)
    patrimonioDeudaTotal: patrimonioSummary?.deuda_total ?? null,
    patrimonioLtvPct: patrimonioSummary?.ltv_pct ?? null,
  };
}
