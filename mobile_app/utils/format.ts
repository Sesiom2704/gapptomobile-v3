/**
 * Archivo: mobile_app/utils/format.ts
 * Versión: 3.1.0
 *
 * Responsabilidad:
 * - Utilidades de formato numérico y de fechas para frontend.
 *
 * Mejoras incluidas:
 * 1) Nueva utilidad reutilizable para fecha + hora:
 *    - formatDateTimeShort(...)
 *    - salida: dd/MM/yy, HH:mm
 *
 * 2) Se mantiene compatibilidad con:
 *    - parseImporte
 *    - EuroformatEuro
 *    - formatFechaCorta
 *    - appendMonthYearSuffix
 */

// =======================
// Tipos
// =======================
export type EuroFormatModeType = 'normal' | 'signed' | 'plus' | 'minus';

// =======================
// Helpers internos
// =======================

/**
 * Fuerza formato ES con:
 *  - separador miles: "."
 *  - separador decimal: ","
 *  - 2 decimales fijos
 *
 * NO añade signo ni " €". Solo devuelve algo tipo "5.705,21"
 */
function formatNumberSpanishFixed(value: number): string {
  const abs = Math.abs(value);
  const [intPart, decPartRaw] = abs.toFixed(2).split('.');
  const intWithDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decPart = decPartRaw ?? '00';
  return `${intWithDots},${decPart}`;
}

/**
 * Convierte strings de importe a número JS.
 *
 * Soporta formatos tipo:
 *  - "1.234,56"
 *  - "1234,56"
 *  - "1234.56"
 *  - "  1 234,56 €"
 *
 * Devuelve:
 *  - number si es válido
 *  - null si el valor no se puede interpretar como número
 */
export function parseEuroToNumber(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    return value;
  }

  const raw = value.trim();
  if (!raw) return null;

  // Quitamos espacios
  let normalized = raw.replace(/\s/g, '');

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');

  let decimalSep: ',' | '.' | null = null;

  if (lastComma === -1 && lastDot === -1) {
    const n = Number(normalized);
    return Number.isNaN(n) ? null : n;
  } else if (lastComma > lastDot) {
    decimalSep = ',';
  } else {
    decimalSep = '.';
  }

  if (decimalSep === ',') {
    normalized = normalized.replace(/\./g, '');
    normalized = normalized.replace(',', '.');
  } else if (decimalSep === '.') {
    normalized = normalized.replace(/,/g, '');
  }

  const num = Number(normalized);
  return Number.isNaN(num) ? null : num;
}

/**
 * Alias compatible, por si en algún sitio usas este nombre.
 */
export function parseImporte(value?: string): number | null {
  if (!value) return null;
  return parseEuroToNumber(value);
}

// =======================
// Formateador principal €
// =======================

/**
 * Formatea un valor numérico a euros siguiendo modos:
 *
 * - 'normal': respeta signo del número
 * - 'signed': signo explícito
 * - 'plus': siempre prefijo "+"
 * - 'minus': siempre prefijo "-"
 */
export function EuroformatEuro(
  value: number | string | null | undefined,
  mode: EuroFormatModeType = 'normal'
): string {
  if (value === null || value === undefined || value === '') {
    return '0,00 €';
  }

  const num =
    typeof value === 'string' ? parseEuroToNumber(value) : Number(value);

  if (num === null || Number.isNaN(num)) {
    return '0,00 €';
  }

  const isNegative = num < 0;
  const base = formatNumberSpanishFixed(
    mode === 'plus' || mode === 'minus' ? Math.abs(num) : num
  );

  let prefix = '';

  switch (mode) {
    case 'normal':
      prefix = isNegative ? '-' : '';
      break;
    case 'signed':
      prefix = num > 0 ? '+' : num < 0 ? '-' : '';
      break;
    case 'plus':
      prefix = '+';
      break;
    case 'minus':
      prefix = '-';
      break;
  }

  return `${prefix}${base} €`;
}

// =======================
// Fechas
// =======================

function buildSafeDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Caso YYYY-MM-DD sin hora: se fuerza local para evitar desplazamientos raros
  const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, y, m, d] = isoDateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date;

  // Intento adicional para "dd/mm/yyyy"
  const esDateOnly = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (esDateOnly) {
    const [, d, m, y] = esDateOnly;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Formatea una fecha en ISO ("YYYY-MM-DD" o "YYYY-MM-DDTHH:mm:ss...")
 * a formato corto "DD/MM/YYYY".
 */
export function formatFechaCorta(
  value: string | Date | null | undefined
): string {
  if (!value) return '';

  const date = buildSafeDate(value);
  if (!date) return typeof value === 'string' ? value : '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return `${day}/${month}/${year}`;
}

/**
 * Formatea fecha y hora en formato corto:
 * - dd/MM/yy, HH:mm
 *
 * Ejemplo:
 * - 2026-03-09T14:35:00Z -> 09/03/26, 15:35   (según huso del dispositivo)
 * - 2026-03-09 14:35:00  -> 09/03/26, 14:35   (si el parser del entorno lo interpreta local)
 *
 * Uso recomendado:
 * - campos readonly de formularios
 * - metadatos de createon / modifiedon / ultimo cobro
 */
export function formatDateTimeShort(
  value: string | Date | null | undefined
): string {
  if (!value) return '';

  const date = buildSafeDate(value);
  if (!date) return typeof value === 'string' ? value : '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year2 = String(date.getFullYear() % 100).padStart(2, '0');

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year2}, ${hours}:${minutes}`;
}

/**
 * Añade (o reemplaza) un sufijo final " - M/YY" (mes/año) a un texto.
 * - Evita concatenación: "ABC - 12/25" -> "ABC - 7/26"
 * - El mes se deja sin padding como pediste.
 */
export function appendMonthYearSuffix(base: string, now: Date = new Date()): string {
  const cleanBase = (base || '').trim();

  const withoutSuffix = cleanBase.replace(/\s*-\s*\d{1,2}\/\d{2}\s*$/i, '').trim();

  const mm = String(now.getMonth() + 1);
  const yy = String(now.getFullYear() % 100).padStart(2, '0');

  return `${withoutSuffix} - ${mm}/${yy}`.trim();
}