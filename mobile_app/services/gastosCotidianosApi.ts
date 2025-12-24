// services/gastosCotidianosApi.ts
import axios from 'axios';
import { api } from './api';
import { parseImporte } from '../utils/format';

// Reutilizamos tipos y helpers comunes (ahora desde utilsApi)
import {
  TipoGasto,
  Proveedor,
  Cuenta,
  Vivienda,
  fetchTiposGasto,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
} from './utilsApi';

// Endpoints de backend para COTIDIANOS (v3)
const ENDPOINT_GASTOS_COTIDIANOS = '/api/v1/gastos-cotidianos/';

// ========================
// Tipos específicos
// ========================

/**
 * Respuesta del backend:
 * - Algunos endpoints pueden devolver el objeto directo.
 * - POST/PUT (según tu router) devuelven un "envelope": { message, data }.
 * Para no romper nada, soportamos ambas formas.
 */
type ApiEnvelope<T> = T | { message?: string; data: T };

/**
 * Type guard: detecta si la respuesta viene en envelope {data: ...}
 */
function hasEnvelopeData<T>(obj: any): obj is { message?: string; data: T } {
  return obj && typeof obj === 'object' && 'data' in obj;
}

/**
 * Unwrap seguro: devuelve siempre el "data real" (objeto GastoCotidiano)
 */
function unwrapResponse<T>(payload: ApiEnvelope<T>): T {
  return hasEnvelopeData<T>(payload) ? payload.data : payload;
}

export interface GastoCotidiano {
  id: string;
  fecha: string; // YYYY-MM-DD (en lectura puede venir como string; el backend usa date)
  tipo_id: string;
  proveedor_id?: string | null;
  cuenta_id?: string | null;

  /**
   * KPI / imputación: "mi parte" (en V3 = importe_total / cantidad)
   * En V2 era el valor principal; en V3 el backend lo calcula.
   */
  importe: number;

  /**
   * pagado:
   * - V2: true = lo pago yo; false = lo paga otro
   * - V3 (según reglas acordadas):
   *    tipo_pago=1 => true
   *    tipo_pago=2 => false
   *    tipo_pago=3 => true
   *    tipo_pago=4 => true
   */
  pagado: boolean;

  evento?: string | null;
  observaciones?: string | null;

  // 🔻 Importante:
  // localidad/pais NO son campos del gasto. Están en Proveedor.
  // Si algún día el backend los expone, deberían venir como proveedor_localidad/proveedor_pais
  // o se obtiene en UI desde el Proveedor seleccionado.
  //
  // localidad?: string | null;
  // pais?: string | null;

  precio_litro?: number | null;
  litros?: number | null;
  km?: number | null;

  // ✅ Campos V3 (pueden ser null en históricos V2 si aún no se han rellenado)
  tipo_pago?: number | null;      // 1..4
  importe_total?: number | null;  // total real del ticket
  cantidad?: number | null;       // personas para dividir

  createon?: string | null;
  modifiedon?: string | null;
  inactivatedon?: string | null;

  user_id?: number | string | null;
  user_nombre?: string | null;

  [key: string]: any;
}

/**
 * Payload que rellenará el formulario de GASTO COTIDIANO.
 *
 * Compatibilidad:
 * - V2: manda (importe, pagado) como antes.
 * - V3: manda (tipoPago, importeTotal, cantidad) y NO necesita mandar importe ni pagado.
 */
export interface CrearGastoCotidianoPayload {
  fecha: string; // YYYY-MM-DD
  tipoId: string;
  proveedorId?: string | null;
  cuentaId?: string | null;

  // ====== V2 (legacy) ======
  importe?: string; // texto del input (V2). En V3 puede omitirse.
  pagado?: boolean; // V2: true = lo pago yo. En V3 lo fuerza el backend.

  // ====== V3 (nuevo) ======
  // 1. Solo, 2. Invitado, 3. A medias, 4. Entre varios
  tipoPago?: 1 | 2 | 3 | 4;

  // Total del ticket (texto del input)
  importeTotal?: string;

  // Entre cuántos se reparte (en tipo 3 se autocompleta a 2; en tipo 4 se pide)
  cantidad?: number | string;

  // Contexto
  evento?: string | null;
  observaciones?: string | null;

  // 🔻 Importante:
  // localidad/pais NO se envían al backend como parte del gasto.
  // Es info del proveedor. Si el usuario quiere cambiarla, debe editar el proveedor.
  //
  // localidad?: string | null;
  // pais?: string | null;

  // Gasolina (inputs tipo texto en front)
  precioLitro?: string;
  litros?: string;
  km?: string;

  // Permite campos extra sin romper nada
  [key: string]: any;
}

// Filtros para el listado de cotidianos
export interface FiltrosGastoCotidiano {
  month?: number; // 1..12
  year?: number; // >= 2000
  pagado?: boolean; // true / false
  tipoId?: string; // se mapeará a tipo_id
  search?: string; // se mapeará a q

  // ✅ Esto sí se mantiene: son filtros para el listado,
  // el backend los interpreta filtrando por Proveedor.
  localidad?: string;
  pais?: string;

  limit?: number;
  offset?: number;
}

// ========================
// Utilidades internas
// ========================

function parseCantidad(val: number | string | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.trunc(val) : null;
  const t = String(val).trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Normaliza y valida el payload antes de enviarlo al backend.
 *
 * - V3: envía tipo_pago, importe_total, cantidad (sin importe/pagado).
 * - V2: envía importe + pagado.
 *
 * Nota: localidad/pais NO se envían en body (son del proveedor).
 */
function normalizarPayloadGastoCotidiano(payload: CrearGastoCotidianoPayload) {
  const isV3 =
    payload.tipoPago !== undefined ||
    payload.importeTotal !== undefined ||
    payload.cantidad !== undefined;

  // -------------------------
  // Parsing opcional de gasolina (texto -> número)
  // -------------------------
  const precioLitroNum =
    payload.precioLitro && payload.precioLitro.trim() !== ''
      ? parseImporte(payload.precioLitro)
      : null;

  const litrosNum =
    payload.litros && payload.litros.trim() !== ''
      ? parseImporte(payload.litros)
      : null;

  const kmNum =
    payload.km && payload.km.trim() !== ''
      ? Number(payload.km.replace(',', '.'))
      : null;

  // -------------------------
  // Campos comunes (V2 y V3)
  // -------------------------
  const baseBody: Record<string, any> = {
    // id lo genera el backend
    fecha: payload.fecha,
    tipo_id: payload.tipoId,
    proveedor_id: payload.proveedorId ?? null,
    cuenta_id: payload.cuentaId ?? null,

    evento: payload.evento ? payload.evento.trim().toUpperCase() : null,
    // OBSERVACIONES se deja tal cual (puede tener minúsculas)
    observaciones: payload.observaciones?.trim() ?? null,

    // gasolina
    precio_litro: precioLitroNum,
    litros: litrosNum,
    km: kmNum,
  };

  // -------------------------
  // MODO V3
  // -------------------------
  if (isV3) {
    const tipoPago = payload.tipoPago;

    if (!tipoPago) {
      throw new Error(
        "Modo V3: 'tipoPago' es obligatorio (1=Solo, 2=Invitado, 3=A medias, 4=Entre varios)."
      );
    }

    if (!payload.importeTotal || payload.importeTotal.trim() === '') {
      throw new Error("Modo V3: 'importeTotal' es obligatorio.");
    }

    const importeTotalNum = parseImporte(payload.importeTotal);
    if (importeTotalNum === null || Number.isNaN(importeTotalNum) || importeTotalNum <= 0) {
      throw new Error("Modo V3: 'importeTotal' debe ser un número > 0.");
    }

    // Cantidad efectiva según reglas
    let cantidadEfectiva: number | null = null;

    if (tipoPago === 1 || tipoPago === 2) {
      cantidadEfectiva = 1;
    } else if (tipoPago === 3) {
      cantidadEfectiva = 2;
    } else if (tipoPago === 4) {
      cantidadEfectiva = parseCantidad(payload.cantidad);
      if (!cantidadEfectiva || cantidadEfectiva < 3) {
        throw new Error("Modo V3: para tipoPago=4, 'cantidad' debe ser un entero >= 3.");
      }
    }

    if (!cantidadEfectiva || cantidadEfectiva <= 0) {
      throw new Error("Modo V3: 'cantidad' inválida.");
    }

    // ✅ Regla de negocio: importe = importe_total / cantidad
    const importeParte = importeTotalNum / cantidadEfectiva;

    // ✅ Regla de pagado (quién paga):
    // 1=Pagado por mí -> pagado=true
    // 2=Invitado      -> pagado=false
    // 3=A pachas       -> pagado=true
    // 4=Entre varios   -> pagado=true
    const pagadoCalc = tipoPago !== 2;

    return {
      ...baseBody,
      tipo_pago: tipoPago,
      importe_total: importeTotalNum,
      cantidad: cantidadEfectiva,

      // ✅ Compatibilidad con backend/schema actual:
      // Aunque en V3 "conceptualmente" se derive, el backend hoy lo exige y además lo usa para ajustar contenedor/liquidez.
      importe: importeParte,
      pagado: pagadoCalc,
    };

  }

  // -------------------------
  // MODO V2 (compatibilidad)
  // -------------------------
  const importeNum = payload.importe ? parseImporte(payload.importe) : null;
  const safeImporte = importeNum ?? 0;
  const importeVal = Number.isNaN(safeImporte) ? 0 : safeImporte;

    return {
      ...baseBody,
      importe: importeVal,
      pagado: !!payload.pagado,
    };
}

// ========================
// LISTADO
// ========================

export async function fetchGastosCotidianos(
  filtros: FiltrosGastoCotidiano = {}
): Promise<GastoCotidiano[]> {
  const {
    month,
    year,
    pagado,
    tipoId,
    search,
    localidad,
    pais,
    limit,
    offset,
  } = filtros;

  const params: Record<string, any> = {};

  if (typeof month === 'number') params.month = month;
  if (typeof year === 'number') params.year = year;
  if (typeof pagado === 'boolean') params.pagado = pagado;
  if (tipoId) params.tipo_id = tipoId;
  if (search) params.q = search;

  // ✅ Filtros de listado: siguen existiendo y los interpreta el backend por Proveedor
  if (localidad) params.localidad = localidad;
  if (pais) params.pais = pais;

  if (typeof limit === 'number') params.limit = limit;
  if (typeof offset === 'number') params.offset = offset;

  try {
    console.log(
      '[gastosCotidianosApi] GET gastos cotidianos ->',
      ENDPOINT_GASTOS_COTIDIANOS,
      'params:',
      params
    );
    const res = await api.get<GastoCotidiano[]>(ENDPOINT_GASTOS_COTIDIANOS, {
      params,
    });
    return res.data ?? [];
  } catch (err) {
    console.error(
      '[gastosCotidianosApi] Error cargando gastos cotidianos',
      axios.isAxiosError(err) ? err.response?.data : err
    );
    throw err;
  }
}

// ========================
// CRUD GASTO COTIDIANO
// ========================

export async function crearGastoCotidiano(
  payload: CrearGastoCotidianoPayload
): Promise<GastoCotidiano> {
  const body = normalizarPayloadGastoCotidiano(payload);

  console.log(
    '[gastosCotidianosApi] POST crear gasto cotidiano ->',
    ENDPOINT_GASTOS_COTIDIANOS,
    body
  );

  const res = await api.post<ApiEnvelope<GastoCotidiano>>(ENDPOINT_GASTOS_COTIDIANOS, body);
  return unwrapResponse<GastoCotidiano>(res.data);
}

export async function obtenerGastoCotidiano(
  id: string
): Promise<GastoCotidiano> {
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;
  console.log('[gastosCotidianosApi] GET gasto cotidiano ->', url);

  const res = await api.get<GastoCotidiano>(url);
  return res.data;
}

export async function actualizarGastoCotidiano(
  id: string,
  payload: CrearGastoCotidianoPayload
): Promise<GastoCotidiano> {
  const body = normalizarPayloadGastoCotidiano(payload);
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;

  console.log(
    '[gastosCotidianosApi] PUT actualizar gasto cotidiano ->',
    url,
    body
  );

  const res = await api.put<ApiEnvelope<GastoCotidiano>>(url, body);
  return unwrapResponse<GastoCotidiano>(res.data);
}

export async function eliminarGastoCotidiano(id: string): Promise<void> {
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;
  console.log('[gastosCotidianosApi] DELETE gasto cotidiano ->', url);
  await api.delete(url);
}

// ========================
// Sugerir cuenta (opcional)
// ========================

export async function sugerirCuentaParaGastoCotidiano(
  tipoId: string,
  importe: number
): Promise<Cuenta | null> {
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}sugerir_cuenta`;

  // Nota: el backend sólo usa tipo_id; mantenemos 'importe' por compatibilidad
  const params = { tipo_id: tipoId, importe };

  try {
    console.log(
      '[gastosCotidianosApi] GET sugerir_cuenta ->',
      url,
      'params:',
      params
    );
    const res = await api.get<Cuenta | null>(url, { params });
    return res.data ?? null;
  } catch (err) {
    console.error(
      '[gastosCotidianosApi] Error en sugerir_cuenta',
      axios.isAxiosError(err) ? err.response?.data : err
    );
    throw err;
  }
}

// ========================
// Reexport de helpers comunes
// ========================

export {
  fetchTiposGasto,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
  TipoGasto,
  Proveedor,
  Cuenta,
  Vivienda,
};
