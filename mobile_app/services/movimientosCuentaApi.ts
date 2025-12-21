// services/movimientosCuentaApi.ts
import { api } from './api';
import { parseImporte } from '../utils/format';

// =========================
// Tipos
// =========================

/**
 * Movimiento completo tal y como lo usaremos en el front
 * (mapeando la respuesta del backend MovimientoCuentaRead).
 */
export interface MovimientoCuenta {
  id: string;
  fecha: string; // 'YYYY-MM-DD'
  cuentaOrigenId: string;
  cuentaDestinoId: string;
  importe: number;
  comentarios: string | null;
  userId: number | null;
  createdOn: string | null; // puede venir null del backend

  // Derivados opcionales que puede devolver el backend
  cuentaOrigenNombre?: string | null;
  cuentaDestinoNombre?: string | null;

  // 👉 Campos de traza de liquidez
  saldoOrigenAntes?: number | null;
  saldoOrigenDespues?: number | null;
  saldoDestinoAntes?: number | null;
  saldoDestinoDespues?: number | null;
}

/**
 * Payload que enviará el front al crear un movimiento.
 * El importe viene como string (ej. "200,00") y se parsea antes de mandar.
 */
export interface MovimientoCuentaCreatePayload {
  fecha: string; // 'YYYY-MM-DD'
  cuentaOrigenId: string;
  cuentaDestinoId: string;
  importe: string; // "200,00" ó "200.00"
  comentarios?: string | null;
}

/**
 * Ítems compactos para la tarjeta de "Últimos movimientos de cuentas".
 * Mapea el schema MovimientoCuentaListItem del backend.
 */
export interface MovimientoCuentaListItem {
  id: string;
  fecha: string; // 'YYYY-MM-DD'
  origenNombre: string;
  destinoNombre: string;
  importe: number;
  comentarios: string | null;

  saldoOrigenAntes?: number | null;
  saldoOrigenDespues?: number | null;
  saldoDestinoAntes?: number | null;
  saldoDestinoDespues?: number | null;
}

// =========================
// Constante base
// =========================

const BASE_URL = '/api/v1/movimientos-cuenta';

// =========================
// Helpers de mapeo
// =========================

function mapMovimientoReadToModel(data: any): MovimientoCuenta {
  const toNumOrNull = (v: any): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    id: data.id,
    fecha: data.fecha,
    cuentaOrigenId: data.cuenta_origen_id,
    cuentaDestinoId: data.cuenta_destino_id,
    importe: Number(data.importe),
    comentarios: data.comentarios ?? null,
    userId: data.user_id ?? null,
    createdOn: data.createdon ?? null,

    // Estos campos pueden venir añadidos desde el backend
    cuentaOrigenNombre: data.cuenta_origen_nombre ?? null,
    cuentaDestinoNombre: data.cuenta_destino_nombre ?? null,

    saldoOrigenAntes: toNumOrNull(data.saldo_origen_antes),
    saldoOrigenDespues: toNumOrNull(data.saldo_origen_despues),
    saldoDestinoAntes: toNumOrNull(data.saldo_destino_antes),
    saldoDestinoDespues: toNumOrNull(data.saldo_destino_despues),
  };
}

function mapListItem(data: any): MovimientoCuentaListItem {
  const toNumOrNull = (v: any): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    id: data.id,
    fecha: data.fecha,
    origenNombre: data.origen_nombre,
    destinoNombre: data.destino_nombre,
    importe: Number(data.importe),
    comentarios: data.comentarios ?? null,
    saldoOrigenAntes: toNumOrNull(data.saldo_origen_antes),
    saldoOrigenDespues: toNumOrNull(data.saldo_origen_despues),
    saldoDestinoAntes: toNumOrNull(data.saldo_destino_antes),
    saldoDestinoDespues: toNumOrNull(data.saldo_destino_despues),
  };
}

// =========================
// API pública
// =========================

/**
 * Crear un nuevo movimiento entre cuentas.
 * Actualiza liquidez de origen y destino en el backend.
 */
export async function crearMovimientoCuenta(
  payload: MovimientoCuentaCreatePayload
): Promise<MovimientoCuenta> {
  try {
    const importeNumber = parseImporte(payload.importe);
    if (importeNumber == null || isNaN(importeNumber) || importeNumber <= 0) {
      throw new Error('Importe inválido. Debe ser mayor que cero.');
    }

    const body = {
      fecha: payload.fecha,
      cuenta_origen_id: payload.cuentaOrigenId,
      cuenta_destino_id: payload.cuentaDestinoId,
      importe: importeNumber,
      comentarios: payload.comentarios ?? null,
    };

    console.log('[movimientosCuentaApi] POST crear movimiento ->', body);

    const response = await api.post(BASE_URL, body);
    return mapMovimientoReadToModel(response.data);
  } catch (error: any) {
    // Log detallado del 422 de FastAPI
    if (error?.response) {
      console.log(
        '[movimientosCuentaApi] crearMovimientoCuenta detail ->',
        JSON.stringify(error.response.data, null, 2)
      );
    }

    console.error('[movimientosCuentaApi] Error al crear movimiento', error);
    throw error;
  }
}

/**
 * Ajustar liquidez de una cuenta.
 * - Actualiza cuentas_bancarias.liquidez
 * - Registra un movimiento de ajuste (origen = destino)
 */
export async function ajustarLiquidezCuenta(options: {
  fecha: string; // 'YYYY-MM-DD'
  cuentaId: string;
  nuevoSaldo: string; // texto introducido por el usuario "2.500,00"
  comentarios?: string | null;
}): Promise<MovimientoCuenta> {
  try {
    const nuevoSaldoNumber = parseImporte(options.nuevoSaldo);
    if (
      nuevoSaldoNumber == null ||
      isNaN(nuevoSaldoNumber) ||
      nuevoSaldoNumber < 0
    ) {
      throw new Error('Nuevo saldo inválido.');
    }

    const body = {
      fecha: options.fecha,
      cuenta_id: options.cuentaId,
      nuevo_saldo: nuevoSaldoNumber,
      comentarios: options.comentarios ?? null,
    };

    console.log('[movimientosCuentaApi] POST ajuste liquidez ->', body);

    const response = await api.post(`${BASE_URL}/ajuste-liquidez`, body);
    return mapMovimientoReadToModel(response.data);
  } catch (error: any) {
    if (error?.response) {
      console.log(
        '[movimientosCuentaApi] ajustarLiquidezCuenta detail ->',
        JSON.stringify(error.response.data, null, 2)
      );
    }

    console.error('[movimientosCuentaApi] Error al ajustar liquidez', error);
    throw error;
  }
}

/**
 * Obtener últimos movimientos entre cuentas.
 * - limit: nº de movimientos (por defecto 5)
 * - year/month: para filtrar por mes concreto
 * - cuentaId: si queremos solo de una cuenta (origen o destino)
 */
export async function fetchMovimientosCuenta(options?: {
  limit?: number;
  year?: number;
  month?: number;
  cuentaId?: string;
}): Promise<MovimientoCuentaListItem[]> {
  try {
    const { limit = 5, year, month, cuentaId } = options || {};

    const params: any = { limit };

    if (year != null && month != null) {
      params.year = year;
      params.month = month;
    }

    if (cuentaId) {
      params.cuenta_id = cuentaId;
    }

    console.log(
      '[movimientosCuentaApi] GET listar movimientos ->',
      BASE_URL,
      params
    );

    const response = await api.get(BASE_URL, { params });
    const rows = Array.isArray(response.data) ? response.data : [];

    return rows.map(mapListItem);
  } catch (error) {
    console.error(
      '[movimientosCuentaApi] Error al cargar movimientos de cuenta',
      error
    );
    throw error;
  }
}

/**
 * Eliminar movimiento entre cuentas.
 */
export async function eliminarMovimientoCuenta(id: string): Promise<void> {
  try {
    console.log('[movimientosCuentaApi] DELETE movimiento ->', id);
    await api.delete(`${BASE_URL}/${id}`);
  } catch (error) {
    console.error(
      '[movimientosCuentaApi] Error al eliminar movimiento',
      error
    );
    throw error;
  }
}
