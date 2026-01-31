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

// =====================================================
// ✅ FLAG (actívalo/desactívalo sin tocar lógica)
// =====================================================
export const DEBUG_GASTOS_COTIDIANOS_V3 = true;

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
type ApiEnvelope<T> = T | { message?: string; data: T; alerts?: any };

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
  fecha: string; // YYYY-MM-DD
  tipo_id: string;
  proveedor_id?: string | null;
  cuenta_id?: string | null;

  /**
   * KPI / imputación:
   * En v3: "mi parte" (referencia) = puede ser derivado (importe_total/cantidad)
   * pero ahora permitimos que el front lo envíe si el usuario lo edita.
   */
  importe: number;

  /**
   * pagado:
   * true  = afecta a mi liquidez (lo pago yo)
   * false = no afecta a mi liquidez (me invitan / paga otro)
   */
  pagado: boolean;

  evento?: string | null;
  observaciones?: string | null;

  precio_litro?: number | null;
  litros?: number | null;
  km?: number | null;

  // ✅ Campos V3
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
 * - V3: manda (tipoPago, importeTotal, cantidad) y, si aplica,
 *       también puede mandar (importe, pagado) si el usuario edita su parte
 *       o marca participo NO.
 */
export interface CrearGastoCotidianoPayload {
  fecha: string; // YYYY-MM-DD
  tipoId: string;
  proveedorId?: string | null;
  cuentaId?: string | null;

  // ====== V2 (legacy) ======
  importe?: string; // texto del input: en V3 lo usaremos como "mi parte" si viene informado
  pagado?: boolean; // en V3 lo usaremos si viene informado

  // ====== V3 (nuevo) ======
  tipoPago?: 1 | 2 | 3 | 4;
  importeTotal?: string;
  cantidad?: number | string;

  evento?: string | null;
  observaciones?: string | null;

  // Gasolina (inputs tipo texto en front)
  precioLitro?: string;
  litros?: string;
  km?: string;

  [key: string]: any;
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
 * Cambios clave:
 * - En V3, si el formulario envía 'pagado' e 'importe' (mi parte),
 *   el normalizador los respeta. Ya NO los fuerza por tipoPago.
 * - TipoPago=2 (INVITADO) permite cantidad >= 1.
 * - Si pagado=false, forzamos cuenta_id=null.
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
        "Modo V3: 'tipoPago' es obligatorio (1=Solo, 2=Invitado, 3=A pachas, 4=Entre varios)."
      );
    }

    if (!payload.importeTotal || payload.importeTotal.trim() === '') {
      throw new Error("Modo V3: 'importeTotal' es obligatorio.");
    }

    const importeTotalNum = parseImporte(payload.importeTotal);
    if (importeTotalNum === null || Number.isNaN(importeTotalNum) || importeTotalNum <= 0) {
      throw new Error("Modo V3: 'importeTotal' debe ser un número > 0.");
    }

    // Cantidad efectiva según reglas:
    // - tipoPago=1 => cantidad=1
    // - tipoPago=2 => cantidad >= 1 (editable)
    // - tipoPago=3 => cantidad=2
    // - tipoPago=4 => cantidad >= 3
    let cantidadEfectiva: number | null = null;

    if (tipoPago === 1) {
      cantidadEfectiva = 1;
    } else if (tipoPago === 2) {
      const c = parseCantidad(payload.cantidad);
      cantidadEfectiva = c && c >= 1 ? c : 1;
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

    // -------------------------
    // "importe" (mi parte) en V3
    // -------------------------
    // Si el formulario envía payload.importe lo respetamos (caso edición manual).
    // Si no viene, derivamos por defecto: importe_total / cantidad.
    let importeParteNum: number;

    if (payload.importe !== undefined && String(payload.importe).trim() !== '') {
      const parsed = parseImporte(String(payload.importe));
      if (parsed === null || Number.isNaN(parsed) || parsed < 0) {
        throw new Error("Modo V3: 'importe' (mi parte) debe ser un número >= 0.");
      }
      importeParteNum = parsed;
    } else {
      importeParteNum = importeTotalNum / cantidadEfectiva;
    }

    // -------------------------
    // "pagado" en V3
    // -------------------------
    // - tipoPago=1 => pagado=true
    // - tipoPago=2 => pagado=false
    // - tipoPago=3/4 => si viene, se respeta; si no, por defecto true
    let pagadoFinal: boolean;

    if (tipoPago === 1) pagadoFinal = true;
    else if (tipoPago === 2) pagadoFinal = false;
    else if (typeof payload.pagado === 'boolean') pagadoFinal = payload.pagado;
    else pagadoFinal = true;

    // Coherencia: si no está pagado, no debe haber cuenta_id
    const cuentaIdFinal = pagadoFinal ? (payload.cuentaId ?? null) : null;

    return {
      ...baseBody,
      cuenta_id: cuentaIdFinal,

      tipo_pago: tipoPago,
      importe_total: importeTotalNum,
      cantidad: cantidadEfectiva,

      // Compatibilidad backend/schema: el backend lo usa para contenedor/liquidez
      importe: importeParteNum,
      pagado: pagadoFinal,
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
  filtros: any = {}
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

  if (localidad) params.localidad = localidad;
  if (pais) params.pais = pais;

  if (typeof limit === 'number') params.limit = limit;
  if (typeof offset === 'number') params.offset = offset;

  try {
    if (DEBUG_GASTOS_COTIDIANOS_V3) {
      console.log('[gastosCotidianosApi] GET gastos cotidianos ->', ENDPOINT_GASTOS_COTIDIANOS, 'params:', params);
    }
    const res = await api.get<GastoCotidiano[]>(ENDPOINT_GASTOS_COTIDIANOS, { params });
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

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] POST crear gasto cotidiano ->', ENDPOINT_GASTOS_COTIDIANOS, body);
  }

  const res = await api.post<ApiEnvelope<GastoCotidiano>>(ENDPOINT_GASTOS_COTIDIANOS, body);

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] POST response raw ->', res.data);
  }

  const unwrapped = unwrapResponse<GastoCotidiano>(res.data);

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] POST response unwrapped ->', unwrapped);
  }

  return unwrapped;
}

export async function obtenerGastoCotidiano(id: string): Promise<GastoCotidiano> {
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] GET gasto cotidiano ->', url);
  }

  const res = await api.get<GastoCotidiano>(url);

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] GET gasto cotidiano response ->', res.data);
  }

  return res.data;
}

export async function actualizarGastoCotidiano(
  id: string,
  payload: CrearGastoCotidianoPayload
): Promise<GastoCotidiano> {
  const body = normalizarPayloadGastoCotidiano(payload);
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] PUT actualizar gasto cotidiano ->', url, body);
  }

  const res = await api.put<ApiEnvelope<GastoCotidiano>>(url, body);

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] PUT response raw ->', res.data);
  }

  const unwrapped = unwrapResponse<GastoCotidiano>(res.data);

  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] PUT response unwrapped ->', unwrapped);
  }

  return unwrapped;
}

export async function eliminarGastoCotidiano(id: string): Promise<void> {
  const url = `${ENDPOINT_GASTOS_COTIDIANOS}${id}`;
  if (DEBUG_GASTOS_COTIDIANOS_V3) {
    console.log('[gastosCotidianosApi] DELETE gasto cotidiano ->', url);
  }
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
  const params = { tipo_id: tipoId, importe };

  try {
    if (DEBUG_GASTOS_COTIDIANOS_V3) {
      console.log('[gastosCotidianosApi] GET sugerir_cuenta ->', url, 'params:', params);
    }
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
