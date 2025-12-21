// constants/general.ts

/**
 * Número máximo de proveedores que se mostrarán
 * en los desplegables / sugerencias de búsqueda.
 */
export const MAX_PROVEEDORES_SUGERENCIAS = 4;

/**
 * Segmentos estándar del sistema.
 * Los IDs deben coincidir con la tabla TIPO_SEGMENTOS_GASTO de la BD.
 */
export interface SegmentoOption {
  id: string;
  nombre: string;
}

export const SEGMENTOS: SegmentoOption[] = [
  { id: 'AHO-12345', nombre: 'AHORRO' },
  { id: 'FIN-12345', nombre: 'FINANCIACION' },
  { id: 'FOR-12345', nombre: 'FORMACIÓN Y EDUCACIÓN' },
  { id: 'OCI-12345', nombre: 'OCIO Y DISFRUTE' },
  { id: 'VIVI-12345', nombre: 'VIVIENDAS' },
  { id: 'GEST-RESTO', nombre: 'GESTIONABLES (RESTO)' },
  { id: 'COT-12345', nombre: 'COTIDIANOS' },
];

/**
 * ID del segmento que activa la selección de vivienda
 * en el formulario de gasto gestionable.
 */
export const VIVIENDAS_SEGMENTO_ID = 'VIVI-12345';

/**
 * ID del segmento usado para gastos cotidianos.
 * Útil si quieres filtrar tipos/validaciones solo para cotidianos.
 */
export const COTIDIANOS_SEGMENTO_ID = 'COT-12345';

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

/**
 * Filtro de periodicidad usado en listados
 * (incluye la opción "todos").
 */
export type PeriodicidadFiltro =
  | 'todos'
  | 'mensual'
  | 'trimestral'
  | 'semestral'
  | 'anual'
  | 'pago_unico';

/**
 * Opciones estándar para pintar chips/botones de periodicidad
 * en buscadores avanzados.
 */
export const PERIODICIDAD_OPTIONS: {
  value: PeriodicidadFiltro;
  label: string;
}[] = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
  { value: 'pago_unico', label: 'Pago unico' },
];
