// mobile_app/services/homeDashboardApi.ts
import { getMonthlySummary } from './analyticsApi';
import { fetchBalanceMes } from './balanceApi';
import { fetchGastosCotidianos } from './gastosCotidianosApi';
import { fetchMovimientosMes } from './movimientosApi';

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
};

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

async function sumGastosCotidianosMes(year: number, month: number): Promise<number> {
  const limit = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    const page = await fetchGastosCotidianos({ year, month, limit, offset });
    if (!page.length) break;

    // ✅ Solo pagados (si no, se te mete el "no_pagados" y sube a 723,42)
    total += page.reduce((acc, g) => acc + (g.pagado ? (g.importe ?? 0) : 0), 0);

    if (page.length < limit) break;
    offset += limit;
  }

  return total;
}

export async function fetchHomeDashboard(params: {
  year: number;
  month: number;
}): Promise<HomeDashboardResponse> {
  const { year, month } = params;

  const [summary, balance, totalCotidianos, movimientosMes] = await Promise.all([
    getMonthlySummary({ year, month }),
    fetchBalanceMes({ year, month }),
    sumGastosCotidianosMes(year, month),
    fetchMovimientosMes(year, month),
  ]);

  // -----------------------
  // REALES (corregidos)
  // -----------------------
  const ingresosRecurrentesMes = n(summary?.detalle_ingresos?.recurrentes);
  const extrasIngresosMes = n(summary?.detalle_ingresos?.extraordinarios);
  const ingresosMes = ingresosRecurrentesMes + extrasIngresosMes;

  const gastosMes = n(summary?.general?.gastos_mes);
  const ahorroMes = n(summary?.general?.ahorro_mes);

  // ✅ Gestionables (barra 3): SOLO recurrentes (periodicidad <> PAGO UNICO)
  const gestionablesConsumidos = n(summary?.detalle_gastos?.recurrentes);

  // ✅ Extras gastos (barra 5): SOLO PAGO UNICO
  const extrasGastosMes = n(summary?.detalle_gastos?.extraordinarios);

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
  };
}
