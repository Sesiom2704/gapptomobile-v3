/**
 * Ruta: mobile_app/services/ubicacionesFlow.ts
 * Versión: 1.0.0
 * Descripción:
 * Helper de flujo jerárquico para ubicaciones.
 *
 * Objetivo:
 * - Centralizar la lógica país -> región -> localidad.
 * - Evitar duplicar esta lógica en AuxEntityFormScreen y LocalidadFormScreen.
 * - Crear solo lo que falte.
 * - Reutilizar registros existentes cuando el backend los devuelva por idempotencia.
 *
 * Reglas:
 * - País: se crea si no hay paisId y hay texto.
 * - Región: se crea si no hay regionId y hay texto + país válido.
 * - Localidad: se crea si no hay localidadId y hay texto + región válida.
 *
 * Nota:
 * - El backend normaliza nombres a MAYÚSCULAS.
 */

import {
  createPais,
  createRegion,
  createLocalidad,
  Pais,
  Region,
  LocalidadWithContext,
} from './ubicacionesApi';

export type UbicacionFlowInput = {
  paisId?: number | null;
  paisNombre?: string | null;

  regionId?: number | null;
  regionNombre?: string | null;

  localidadId?: number | null;
  localidadNombre?: string | null;
};

export type UbicacionFlowResult = {
  paisId: number | null;
  paisNombre: string | null;
  pais?: Pais | null;

  regionId: number | null;
  regionNombre: string | null;
  region?: Region | null;

  localidadId: number | null;
  localidadNombre: string | null;
  localidad?: LocalidadWithContext | null;
};

function cleanText(value?: string | null): string {
  return String(value ?? '').trim();
}

export async function ensurePaisFlow(input: UbicacionFlowInput): Promise<UbicacionFlowResult> {
  const currentPaisId = input.paisId ?? null;
  const currentPaisNombre = cleanText(input.paisNombre);

  if (currentPaisId) {
    return {
      paisId: currentPaisId,
      paisNombre: currentPaisNombre || null,
      pais: null,

      regionId: input.regionId ?? null,
      regionNombre: cleanText(input.regionNombre) || null,
      region: null,

      localidadId: input.localidadId ?? null,
      localidadNombre: cleanText(input.localidadNombre) || null,
      localidad: null,
    };
  }

  if (!currentPaisNombre) {
    return {
      paisId: null,
      paisNombre: null,
      pais: null,

      regionId: input.regionId ?? null,
      regionNombre: cleanText(input.regionNombre) || null,
      region: null,

      localidadId: input.localidadId ?? null,
      localidadNombre: cleanText(input.localidadNombre) || null,
      localidad: null,
    };
  }

  const pais = await createPais({
    nombre: currentPaisNombre,
    codigo_iso: null,
  });

  return {
    paisId: pais.id,
    paisNombre: pais.nombre,
    pais,

    regionId: input.regionId ?? null,
    regionNombre: cleanText(input.regionNombre) || null,
    region: null,

    localidadId: input.localidadId ?? null,
    localidadNombre: cleanText(input.localidadNombre) || null,
    localidad: null,
  };
}

export async function ensureRegionFlow(input: UbicacionFlowInput): Promise<UbicacionFlowResult> {
  const base = await ensurePaisFlow(input);

  const currentRegionId = input.regionId ?? null;
  const currentRegionNombre = cleanText(input.regionNombre);

  if (currentRegionId) {
    return {
      ...base,
      regionId: currentRegionId,
      regionNombre: currentRegionNombre || base.regionNombre,
      region: null,
    };
  }

  if (!currentRegionNombre) {
    return {
      ...base,
      regionId: null,
      regionNombre: null,
      region: null,
    };
  }

  if (!base.paisId) {
    throw new Error('Para crear una región necesitas indicar un país.');
  }

  const region = await createRegion({
    nombre: currentRegionNombre,
    pais_id: base.paisId,
  });

  return {
    ...base,
    paisId: region.pais_id ?? base.paisId,
    paisNombre: region.pais?.nombre ?? base.paisNombre,
    pais: region.pais ?? base.pais ?? null,

    regionId: region.id,
    regionNombre: region.nombre,
    region,
  };
}

export async function ensureLocalidadFlow(input: UbicacionFlowInput): Promise<UbicacionFlowResult> {
  const base = await ensureRegionFlow(input);

  const currentLocalidadId = input.localidadId ?? null;
  const currentLocalidadNombre = cleanText(input.localidadNombre);

  if (currentLocalidadId) {
    return {
      ...base,
      localidadId: currentLocalidadId,
      localidadNombre: currentLocalidadNombre || base.localidadNombre,
      localidad: null,
    };
  }

  if (!currentLocalidadNombre) {
    return {
      ...base,
      localidadId: null,
      localidadNombre: null,
      localidad: null,
    };
  }

  if (!base.regionId) {
    throw new Error('Para crear una localidad necesitas indicar una región.');
  }

  const localidad = await createLocalidad({
    nombre: currentLocalidadNombre,
    region_id: base.regionId,
  });

  return {
    paisId: localidad.region?.pais?.id ?? base.paisId,
    paisNombre: localidad.region?.pais?.nombre ?? base.paisNombre,
    pais: localidad.region?.pais ?? base.pais ?? null,

    regionId: localidad.region?.id ?? base.regionId,
    regionNombre: localidad.region?.nombre ?? base.regionNombre,
    region: localidad.region ?? base.region ?? null,

    localidadId: localidad.id,
    localidadNombre: localidad.nombre,
    localidad,
  };
}

const ubicacionesFlow = {
  ensurePaisFlow,
  ensureRegionFlow,
  ensureLocalidadFlow,
};

export default ubicacionesFlow;