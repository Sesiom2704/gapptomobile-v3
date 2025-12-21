// constants/finance.ts

/**
 * Rangos de pago estandarizados, reutilizables en:
 * - Formularios de gastos
 * - Formularios de ingresos
 * - Filtros de listados
 */
export const RANGOS_PAGO = [
  '1-3',
  '4-7',
  '8-11',
  '12-15',
  '16-19',
  '20-23',
  '24-27',
  '28-31',
] as const;

export type RangoPago = (typeof RANGOS_PAGO)[number];

/**
 * Periodicidades estándar del sistema.
 * Único origen de la verdad para:
 * - Formularios (select de periodicidad)
 * - Filtros (chips de periodicidad)
 */
export const PERIODICIDADES = [
  'MENSUAL',
  'TRIMESTRAL',
  'SEMESTRAL',
  'ANUAL',
  'PAGO UNICO',
] as const;

export type Periodicidad = (typeof PERIODICIDADES)[number];
