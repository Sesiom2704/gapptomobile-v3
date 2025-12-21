// utils/format.ts

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
    // No hay separadores, intentamos parsear directamente
    const n = Number(normalized);
    return Number.isNaN(n) ? null : n;
  } else if (lastComma > lastDot) {
    decimalSep = ',';
  } else {
    decimalSep = '.';
  }

  if (decimalSep === ',') {
    // La coma es el decimal -> los puntos son miles
    normalized = normalized.replace(/\./g, ''); // quitamos puntos
    normalized = normalized.replace(',', '.');  // coma -> punto
  } else if (decimalSep === '.') {
    // El punto es el decimal -> las comas son miles
    normalized = normalized.replace(/,/g, '');  // quitamos comas
    // dejamos el punto como está
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
 *   -  1234.5   ->  "1.234,50 €"
 *   - -1234.5   ->  "-1.234,50 €"
 *
 * - 'signed': signo explícito
 *   -  1234.5   ->  "+1.234,50 €"
 *   - -1234.5   ->  "-1.234,50 €"
 *   -  0        ->  "0,00 €"
 *
 * - 'plus': siempre prefijo "+" y valor en absoluto
 *   -  1234.5   ->  "+1.234,50 €"
 *   - -1234.5   ->  "+1.234,50 €"
 *
 * - 'minus': siempre prefijo "-" y valor en absoluto
 *   -  1234.5   ->  "-1.234,50 €"
 *   - -1234.5   ->  "-1.234,50 €"
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

/**
 * Formatea una fecha en ISO ("YYYY-MM-DD" o "YYYY-MM-DDTHH:mm:ss...")
 * a formato corto "DD/MM/YYYY".
 */
export function formatFechaCorta(
  value: string | Date | null | undefined
): string {
  if (!value) return '';

  let iso: string;

  if (value instanceof Date) {
    iso = value.toISOString();
  } else if (typeof value === 'string') {
    iso = value;
  } else {
    return '';
  }

  const [datePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');

  if (!year || !month || !day) {
    return iso;
  }

  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
}

/**
 * Añade (o reemplaza) un sufijo final " - M/YY" (mes/año) a un texto.
 * - Evita concatenación: "ABC - 12/25" -> (en julio 2026) "ABC - 7/26"
 * - El mes se deja sin padding ("7/26" y no "07/26") como pediste.
 */
export function appendMonthYearSuffix(base: string, now: Date = new Date()): string {
  const cleanBase = (base || '').trim();

  // Quita sufijo final tipo " - 12/25" si ya existe
  const withoutSuffix = cleanBase.replace(/\s*-\s*\d{1,2}\/\d{2}\s*$/i, '').trim();

  const mm = String(now.getMonth() + 1); // 1..12 sin 0 delante
  const yy = String(now.getFullYear() % 100).padStart(2, '0');

  return `${withoutSuffix} - ${mm}/${yy}`.trim();
}
