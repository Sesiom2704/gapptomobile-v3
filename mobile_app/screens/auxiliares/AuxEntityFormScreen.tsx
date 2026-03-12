// mobile_app/screens/auxiliares/AuxEntityFormScreen.tsx

/**
 * Ruta: mobile_app/screens/auxiliares/AuxEntityFormScreen.tsx
 * Versión: 1.4.0
 * Descripción:
 * Formulario unificado para creación y edición de entidades auxiliares.
 *
 * Responsabilidades:
 * - Soportar creación/edición de auxiliares genéricos:
 *   * tipo_gasto
 *   * tipo_ingreso
 *   * tipo_ramas_ingreso
 *   * tipo_ramas_gasto
 *   * tipo_ramas_proveedores
 *   * tipo_segmento_gasto
 *   * tipo_subsegmento_proveedor
 * - Soportar creación/edición completa de proveedores.
 * - Mantener retorno robusto al formulario origen mediante auxResult.
 * - Mantener confirmación de salida si hay cambios sin guardar.
 *
 * Mejoras incluidas:
 * - Proveedor ampliado con todos los campos editables del ORM:
 *   * cif
 *   * telefono
 *   * email
 *   * subsegmento_id
 *   * direccion
 *   * codigo_postal
 *   * persona_contacto
 *   * activo
 *   * observaciones
 *   * acepta_urgencias
 *   * ambito_servicio
 * - Soporte para el nuevo auxiliar `tipo_subsegmento_proveedor`.
 * - Validación razonable de CIF español.
 * - Validación de formato de email.
 * - Uso exclusivo de estilos/componentes compatibles con tu proyecto actual.
 *
 * Nota:
 * - El backend sigue siendo la fuente de verdad final de validaciones de negocio.
 * - Este formulario aplica validaciones UX previas para mejorar la experiencia.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';

import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { SelectedInlineValue } from '../../components/ui/SelectedInlineValue';
import { PillButton } from '../../components/ui/PillButton';

import { colors, spacing, radius } from '../../theme';

import {
  createProveedorFromAuxForm,
  updateProveedor,
  deleteProveedor,
  Proveedor,
} from '../../services/proveedoresApi';

import {
  listLocalidades,
  createPais,
  createRegion,
  createLocalidad,
  listPaises,
  listRegiones,
  LocalidadWithContext,
  Pais as PaisApi,
  Region as RegionApi,
} from '../../services/ubicacionesApi';

import { listRamasProveedores, RamaProveedor } from '../../services/ramasProveedoresApi';

import {
  createAux,
  updateAux,
  deleteAux,
  listAux,
  AuxEntity,
} from '../../services/auxiliaresApi';

type Props = {
  navigation: any;
  route: any;
};

type Origin = 'config' | 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';

type RegionOption = {
  id: number;
  nombre: string;
  paisId: number | null;
  paisNombre: string | null;
};

type PaisOption = {
  id: number;
  nombre: string;
};

type SimpleAuxItem = {
  id: string;
  nombre: string;
  [k: string]: any;
};

type DirtySnapshot = {
  mode: 'proveedor' | 'aux';

  // Común
  nombre: string;

  // Proveedor
  ramaId: string;
  localidad: string;
  comunidad: string;
  pais: string;
  cif: string;
  telefono: string;
  email: string;
  subsegmentoId: string;
  direccion: string;
  codigoPostal: string;
  personaContacto: string;
  observaciones: string;
  ambitoServicio: string;
  activo: string;
  aceptaUrgencias: string;

  // Auxiliares
  ramaGastoId: string;
  segmentoGastoId: string;
  ramaIngresoId: string;
  ramaProveedorId: string;
};

const NOOP = () => {};

function normalize(v: any): string {
  return String(v ?? '').trim();
}

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  const v = email.trim();
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Validación razonable de CIF español.
 * Acepta formatos tipo:
 * - B12345678
 * - A58818501
 * - Q5000001I
 */
function isValidSpanishCif(cif: string): boolean {
  const raw = cif.trim().toUpperCase();
  if (!raw) return true;

  const clean = raw.replace(/[\s-]/g, '');
  if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(clean)) {
    return false;
  }

  const letter = clean[0];
  const body = clean.slice(1, 8);
  const control = clean[8];

  let sumEven = 0;
  let sumOdd = 0;

  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[i]);

    // Posiciones 1,3,5,7 del cuerpo (índices 0,2,4,6): multiplicar por 2 y sumar dígitos
    if (i % 2 === 0) {
      const prod = digit * 2;
      sumOdd += Math.floor(prod / 10) + (prod % 10);
    } else {
      sumEven += digit;
    }
  }

  const total = sumEven + sumOdd;
  const unit = total % 10;
  const numericControl = unit === 0 ? 0 : 10 - unit;
  const alphaControl = 'JABCDEFGHI'[numericControl];

  const mustBeLetter = ['P', 'Q', 'R', 'S', 'N', 'W'].includes(letter);
  const mustBeNumber = ['A', 'B', 'E', 'H'].includes(letter);

  if (mustBeLetter) return control === alphaControl;
  if (mustBeNumber) return control === String(numericControl);

  return control === String(numericControl) || control === alphaControl;
}

export const AuxEntityFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const auxType: string = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const editingProveedor: Proveedor | undefined = route?.params?.editingProveedor;
  const editingItem: SimpleAuxItem | undefined = route?.params?.editingItem;

  const isProveedor = auxType === 'proveedor';
  const isTipoGasto = auxType === 'tipo_gasto';
  const isTipoIngreso = auxType === 'tipo_ingreso';
  const isRamaIngreso = auxType === 'tipo_ramas_ingreso';
  const isRamaGasto = auxType === 'tipo_ramas_gasto';
  const isRamaProveedor = auxType === 'tipo_ramas_proveedores';
  const isSegmentoGasto = auxType === 'tipo_segmento_gasto';
  const isSubsegmentoProveedor = auxType === 'tipo_subsegmento_proveedor';

  const isEditMode = !!(editingProveedor || editingItem);

  // Compat legacy
  const returnTo: string | undefined = route?.params?.returnTo;
  const returnKey: string | undefined = route?.params?.returnKey;
  const returnRouteKey: string | undefined = route?.params?.returnRouteKey;

  // ===========================================================================
  // ESTADO COMÚN
  // ===========================================================================
  const [nombre, setNombre] = useState('');

  // ===========================================================================
  // ESTADO AUXILIARES
  // ===========================================================================
  const [ramaGastoId, setRamaGastoId] = useState<string | null>(null);
  const [segmentoGastoId, setSegmentoGastoId] = useState<string | null>(
    route?.params?.defaultSegmentoId ?? null
  );

  const [ramasGasto, setRamasGasto] = useState<Array<{ id: string; nombre: string }>>([]);
  const [segmentosGasto, setSegmentosGasto] = useState<Array<{ id: string; nombre: string }>>([]);

  const [busquedaRamaGasto, setBusquedaRamaGasto] = useState('');
  const [busquedaSegmentoGasto, setBusquedaSegmentoGasto] = useState('');

  const [ramaIngresoId, setRamaIngresoId] = useState<string | null>(null);
  const [ramasIngreso, setRamasIngreso] = useState<Array<{ id: string; nombre: string }>>([]);
  const [busquedaRamaIngreso, setBusquedaRamaIngreso] = useState('');

  const [ramaProveedorAuxId, setRamaProveedorAuxId] = useState<string | null>(null);
  const [busquedaRamaProveedorAux, setBusquedaRamaProveedorAux] = useState('');

  // ===========================================================================
  // ESTADO PROVEEDOR
  // ===========================================================================
  const [ramaId, setRamaId] = useState<string | null>(route?.params?.defaultRamaId ?? null);
  const [ramaNombre, setRamaNombre] = useState<string | null>(null);

  const [localidad, setLocalidad] = useState('');
  const [comunidad, setComunidad] = useState('');
  const [pais, setPais] = useState('');
  const [localidadId, setLocalidadId] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [paisId, setPaisId] = useState<number | null>(null);

  const [cif, setCif] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [subsegmentoId, setSubsegmentoId] = useState<string | null>(null);
  const [direccion, setDireccion] = useState('');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [personaContacto, setPersonaContacto] = useState('');
  const [activo, setActivo] = useState<boolean>(true);
  const [observaciones, setObservaciones] = useState('');
  const [aceptaUrgencias, setAceptaUrgencias] = useState<boolean>(false);
  const [ambitoServicio, setAmbitoServicio] = useState('');

  const [subsegmentoOptions, setSubsegmentoOptions] = useState<Array<{ id: string; nombre: string; rama_id?: string | null }>>([]);
  const [busquedaSubsegmento, setBusquedaSubsegmento] = useState('');

  // Fallback inline ubicaciones
  const [creatingLocalidad, setCreatingLocalidad] = useState(false);
  const [creatingRegion, setCreatingRegion] = useState(false);
  const [creatingPais, setCreatingPais] = useState(false);

  const [newLocalidadText, setNewLocalidadText] = useState('');
  const [newRegionText, setNewRegionText] = useState('');
  const [newPaisText, setNewPaisText] = useState('');

  // Catálogos proveedor/ubicación
  const [ramaOptions, setRamaOptions] = useState<RamaProveedor[]>([]);
  const [localidadOptions, setLocalidadOptions] = useState<LocalidadWithContext[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);

  const [loadingRamas, setLoadingRamas] = useState(false);
  const [loadingLocalidades, setLoadingLocalidades] = useState(false);
  const [loadingRegiones, setLoadingRegiones] = useState(false);
  const [loadingPaises, setLoadingPaises] = useState(false);
  const [loadingSubsegmentos, setLoadingSubsegmentos] = useState(false);

  const [busquedaRamaProveedor, setBusquedaRamaProveedor] = useState('');
  const [busquedaLocalidad, setBusquedaLocalidad] = useState('');
  const [busquedaRegion, setBusquedaRegion] = useState('');
  const [busquedaPais, setBusquedaPais] = useState('');

  const ramaBloqueada = origin === 'cotidianos' && !!ramaId;

  // ===========================================================================
  // HELPERS NAVEGACIÓN RETORNO
  // ===========================================================================
  const findOwningNavigatorByRouteKey = (nav: any, targetRouteKey: string) => {
    let current = nav;

    while (current) {
      try {
        const state = current.getState?.();
        const routes = state?.routes ?? [];
        const found = routes.some((r: any) => r?.key === targetRouteKey);
        if (found) return current;
      } catch {
        // no-op
      }

      current = current.getParent?.() ?? null;
    }

    return null;
  };

  const sendResult = (result: {
    type: string;
    item: any;
    key?: string | null;
    mode: 'created' | 'updated';
  }) => {
    const auxResult = {
      type: result.type,
      item: result.item,
      key: result.key ?? null,
      returnKey: result.key ?? null,
      origin,
      mode: result.mode,
    };

    console.log('[AuxEntityForm][sendResult] sending auxResult=', auxResult);
    console.log('[AuxEntityForm][sendResult] returnRouteKey=', returnRouteKey, 'returnTo=', returnTo);

    if (returnRouteKey) {
      const ownerNav = findOwningNavigatorByRouteKey(navigation, returnRouteKey);
      console.log('[AuxEntityForm][sendResult] ownerNav found=', !!ownerNav);

      if (ownerNav) {
        try {
          ownerNav.dispatch({
            ...(CommonActions.setParams({ auxResult }) as any),
            source: returnRouteKey,
          });
          console.log('[AuxEntityForm][sendResult] dispatched setParams to source=', returnRouteKey);
          return;
        } catch (e) {
          console.log('[AuxEntityForm][sendResult] dispatch failed, fallback to returnTo', e);
        }
      }
    }

    if (returnTo) {
      try {
        const parent = navigation.getParent?.();
        const nav = parent ?? navigation;
        nav.navigate({ name: returnTo, params: { auxResult }, merge: true });
        console.log('[AuxEntityForm][sendResult] navigated to returnTo with merge=', returnTo);
      } catch (e) {
        console.log('[AuxEntityForm][sendResult] returnTo navigation failed', e);
      }
    }
  };

  const sendResultAndClose = (result: {
    type: string;
    item: any;
    key?: string | null;
    mode: 'created' | 'updated';
  }) => {
    sendResult(result);
    if (navigation.canGoBack?.()) navigation.goBack();
  };

  // ===========================================================================
  // RETORNO DESDE LocalidadForm
  // ===========================================================================
  useEffect(() => {
    const auxResult = route?.params?.auxResult;
    if (!auxResult) return;

    try {
      navigation.setParams?.({ auxResult: undefined });
    } catch {
      // no-op
    }

    if (!isProveedor) return;

    if (auxResult?.type === 'localidad' && auxResult?.item) {
      const loc: LocalidadWithContext = auxResult.item;

      setLocalidadId(loc.id);
      setLocalidad(loc.nombre);

      const regionNombre = loc.region?.nombre ?? '';
      const paisNombre = loc.region?.pais?.nombre ?? '';

      setRegionId(loc.region?.id ?? null);
      setPaisId(loc.region?.pais?.id ?? null);

      setComunidad(regionNombre);
      setPais(paisNombre);

      setCreatingLocalidad(false);
      setNewLocalidadText('');
      setCreatingRegion(false);
      setNewRegionText('');
      setCreatingPais(false);
      setNewPaisText('');

      setBusquedaLocalidad('');
      setBusquedaRegion('');
      setBusquedaPais('');

      setLocalidadOptions((prev) => {
        const exists = prev.some((x) => x.id === loc.id);
        if (exists) return prev;
        return [loc, ...prev].slice(0, 800);
      });

      buildRegionAndPaisOptionsFromLocalidades([loc]);
    }
  }, [route?.params?.auxResult, isProveedor, navigation]);

  // ===========================================================================
  // INICIALIZACIÓN EN EDICIÓN
  // ===========================================================================
  useEffect(() => {
    if (!isProveedor) return;
    if (!isEditMode || !editingProveedor) return;

    setNombre(editingProveedor.nombre ?? '');
    setRamaId(editingProveedor.rama_id ?? null);
    setRamaNombre(editingProveedor.rama_rel?.nombre ?? null);

    setLocalidad(editingProveedor.localidad ?? '');
    setComunidad((editingProveedor as any).comunidad ?? '');
    setPais(editingProveedor.pais ?? '');
    setLocalidadId((editingProveedor as any).localidad_id ?? null);

    const locRel = (editingProveedor as any).localidad_rel;
    if (locRel) {
      setRegionId(locRel.region?.id ?? null);
      setPaisId(locRel.region?.pais?.id ?? null);
    }

    setCif((editingProveedor as any).cif ?? '');
    setTelefono((editingProveedor as any).telefono ?? '');
    setEmail((editingProveedor as any).email ?? '');
    setSubsegmentoId((editingProveedor as any).subsegmento_id ?? null);
    setDireccion((editingProveedor as any).direccion ?? '');
    setCodigoPostal((editingProveedor as any).codigo_postal ?? '');
    setPersonaContacto((editingProveedor as any).persona_contacto ?? '');
    setActivo((editingProveedor as any).activo ?? true);
    setObservaciones((editingProveedor as any).observaciones ?? '');
    setAceptaUrgencias((editingProveedor as any).acepta_urgencias ?? false);
    setAmbitoServicio((editingProveedor as any).ambito_servicio ?? '');
  }, [isProveedor, isEditMode, editingProveedor]);

  useEffect(() => {
    if (isProveedor) return;
    if (!editingItem) return;

    setNombre(editingItem.nombre ?? '');

    if (isTipoGasto) {
      setRamaGastoId(editingItem.rama_id ?? null);
      setSegmentoGastoId(editingItem.segmento_id ?? null);
    }

    if (isTipoIngreso) {
      setRamaIngresoId(editingItem.rama_id ?? null);
    }

    if (isSubsegmentoProveedor) {
      setRamaProveedorAuxId(editingItem.rama_id ?? null);
    }
  }, [isProveedor, editingItem, isTipoGasto, isTipoIngreso, isSubsegmentoProveedor]);

  // ===========================================================================
  // CARGA DE CATÁLOGOS AUXILIARES
  // ===========================================================================
  useEffect(() => {
    const loadCatalogs = async () => {
      try {
        if (isTipoGasto) {
          const [rg, sg] = await Promise.all([
            listAux<{ id: string; nombre: string }>('tipo_ramas_gasto'),
            listAux<{ id: string; nombre: string }>('tipo_segmento_gasto'),
          ]);

          setRamasGasto(rg ?? []);
          setSegmentosGasto(sg ?? []);
        }

        if (isTipoIngreso) {
          const ri = await listAux<{ id: string; nombre: string }>('tipo_ramas_ingreso');
          setRamasIngreso(ri ?? []);
        }

        if (isSubsegmentoProveedor) {
          const rp = await listAux<{ id: string; nombre: string }>('tipo_ramas_proveedores');
          setRamaOptions(rp as RamaProveedor[]);
        }
      } catch (e) {
        console.error('[AuxEntityForm] Error cargando catálogos auxiliares', e);
        Alert.alert('Error', 'No se han podido cargar los catálogos necesarios.');
      }
    };

    void loadCatalogs();
  }, [isTipoGasto, isTipoIngreso, isSubsegmentoProveedor]);

  // ===========================================================================
  // CARGA DE RAMAS / SUBSEGMENTOS / UBICACIONES
  // ===========================================================================
  const buildRegionAndPaisOptionsFromLocalidades = (locs: LocalidadWithContext[]) => {
    const regionMap = new Map<number, RegionOption>();
    const paisMap = new Map<number, PaisOption>();

    for (const loc of locs) {
      const region = loc.region;
      if (region) {
        if (!regionMap.has(region.id)) {
          regionMap.set(region.id, {
            id: region.id,
            nombre: region.nombre,
            paisId: region.pais?.id ?? null,
            paisNombre: region.pais?.nombre ?? null,
          });
        }

        const p = region.pais;
        if (p && !paisMap.has(p.id)) {
          paisMap.set(p.id, { id: p.id, nombre: p.nombre });
        }
      }
    }

    setRegionOptions((prev) => {
      const merged = new Map<number, RegionOption>();
      for (const r of prev) merged.set(r.id, r);
      for (const r of regionMap.values()) merged.set(r.id, r);
      return Array.from(merged.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    });

    setPaisOptions((prev) => {
      const merged = new Map<number, PaisOption>();
      for (const p of prev) merged.set(p.id, p);
      for (const p of paisMap.values()) merged.set(p.id, p);
      return Array.from(merged.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    });
  };

  const ensureRamasProveedorLoaded = async () => {
    if (ramaOptions.length > 0) return;

    try {
      setLoadingRamas(true);
      const ramas = await listRamasProveedores();
      setRamaOptions(ramas);
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando ramas proveedor', err);
      Alert.alert('Error', 'No se han podido cargar las ramas de proveedor.');
    } finally {
      setLoadingRamas(false);
    }
  };

  const ensureSubsegmentosLoaded = async () => {
    if (subsegmentoOptions.length > 0) return;

    try {
      setLoadingSubsegmentos(true);
      const data = await listAux<{ id: string; nombre: string; rama_id?: string | null }>(
        'tipo_subsegmento_proveedor'
      );
      setSubsegmentoOptions(data ?? []);
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando subsegmentos proveedor', err);
      Alert.alert('Error', 'No se han podido cargar los subsegmentos de proveedor.');
    } finally {
      setLoadingSubsegmentos(false);
    }
  };

  const ensureLocalidadesLoaded = async () => {
    if (localidadOptions.length > 0) return;

    try {
      setLoadingLocalidades(true);
      const locs = await listLocalidades({ limit: 400 });
      setLocalidadOptions(locs ?? []);
      buildRegionAndPaisOptionsFromLocalidades(locs ?? []);
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando localidades', err);
      Alert.alert('Error', 'No se han podido cargar las localidades.');
    } finally {
      setLoadingLocalidades(false);
    }
  };

  const ensureRegionesLoaded = async () => {
    if (regionOptions.length > 0) return;

    try {
      setLoadingRegiones(true);
      const data = await listRegiones({ limit: 800 });
      setRegionOptions(
        (data ?? [])
          .map((r: RegionApi) => ({
            id: r.id,
            nombre: r.nombre,
            paisId: r.pais_id ?? null,
            paisNombre: r.pais?.nombre ?? null,
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando regiones', err);
      Alert.alert('Error', 'No se han podido cargar las regiones.');
    } finally {
      setLoadingRegiones(false);
    }
  };

  const ensurePaisesLoaded = async () => {
    if (paisOptions.length > 0) return;

    try {
      setLoadingPaises(true);
      const data = await listPaises({ limit: 400 });
      setPaisOptions(
        (data ?? [])
          .map((p: PaisApi) => ({ id: p.id, nombre: p.nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando países', err);
      Alert.alert('Error', 'No se han podido cargar los países.');
    } finally {
      setLoadingPaises(false);
    }
  };

  useEffect(() => {
    if (!isProveedor) return;
    void ensureRamasProveedorLoaded();
    void ensureSubsegmentosLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProveedor]);

  useEffect(() => {
    if (!isProveedor) return;
    if (!ramaId) return;

    if (ramaBloqueada && busquedaRamaProveedor !== '') {
      setBusquedaRamaProveedor('');
    }

    if (ramaNombre) return;

    const found = ramaOptions.find((r) => r.id === ramaId);
    if (found?.nombre) {
      setRamaNombre(found.nombre);
      return;
    }

    void ensureRamasProveedorLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProveedor, ramaId, ramaNombre, ramaOptions, ramaBloqueada]);

  // ===========================================================================
  // FILTRADOS INLINE SEARCH
  // ===========================================================================
  const ramasProveedorFiltradas = useMemo(() => {
    if (ramaBloqueada && ramaId) {
      return ramaOptions.filter((r) => r.id === ramaId);
    }

    const term = busquedaRamaProveedor.trim().toLowerCase();
    if (!term) return ramaOptions.slice(0, 50);

    return ramaOptions
      .filter((r) => (r.nombre ?? '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [ramaOptions, busquedaRamaProveedor, ramaBloqueada, ramaId]);

  const localidadesFiltradas = useMemo(() => {
    const term = busquedaLocalidad.trim().toLowerCase();
    if (!term) return localidadOptions;

    return localidadOptions.filter((l) => (l.nombre ?? '').toLowerCase().includes(term));
  }, [localidadOptions, busquedaLocalidad]);

  const regionesFiltradas = useMemo(() => {
    const term = busquedaRegion.trim().toLowerCase();
    const base = !term
      ? regionOptions
      : regionOptions.filter((r) => r.nombre.toLowerCase().includes(term));

    if (!paisId) return base;

    const samePais = base.filter((r) => r.paisId === paisId);
    return samePais.length ? samePais : base;
  }, [regionOptions, busquedaRegion, paisId]);

  const paisesFiltrados = useMemo(() => {
    const term = busquedaPais.trim().toLowerCase();
    if (!term) return paisOptions;

    return paisOptions.filter((p) => (p.nombre ?? '').toLowerCase().includes(term));
  }, [paisOptions, busquedaPais]);

  const ramasGastoFiltradas = useMemo(() => {
    const term = busquedaRamaGasto.trim().toLowerCase();
    if (!term) return ramasGasto;

    return ramasGasto.filter((r) => (r.nombre ?? '').toLowerCase().includes(term));
  }, [ramasGasto, busquedaRamaGasto]);

  const segmentosGastoFiltrados = useMemo(() => {
    const term = busquedaSegmentoGasto.trim().toLowerCase();
    if (!term) return segmentosGasto;

    return segmentosGasto.filter((s) => (s.nombre ?? '').toLowerCase().includes(term));
  }, [segmentosGasto, busquedaSegmentoGasto]);

  const ramasIngresoFiltradas = useMemo(() => {
    const term = busquedaRamaIngreso.trim().toLowerCase();
    if (!term) return ramasIngreso;

    return ramasIngreso.filter((r) => (r.nombre ?? '').toLowerCase().includes(term));
  }, [ramasIngreso, busquedaRamaIngreso]);

  const ramasProveedorAuxFiltradas = useMemo(() => {
    const term = busquedaRamaProveedorAux.trim().toLowerCase();
    if (!term) return ramaOptions;

    return ramaOptions.filter((r) => (r.nombre ?? '').toLowerCase().includes(term));
  }, [ramaOptions, busquedaRamaProveedorAux]);

  const subsegmentosFiltrados = useMemo(() => {
    const term = busquedaSubsegmento.trim().toLowerCase();

    let base = subsegmentoOptions;
    if (ramaId) {
      const sameRama = base.filter((s) => (s.rama_id ?? null) === ramaId);
      if (sameRama.length > 0) {
        base = sameRama;
      }
    }

    if (!term) return base;
    return base.filter((s) => (s.nombre ?? '').toLowerCase().includes(term));
  }, [subsegmentoOptions, busquedaSubsegmento, ramaId]);

  // ===========================================================================
  // SELECTED MEMOS
  // ===========================================================================
  const selectedRama = useMemo(() => {
    if (!ramaId) return null;

    const found = ramaOptions.find((r) => r.id === ramaId);
    if (found) return found;

    if (ramaNombre) return ({ id: ramaId, nombre: ramaNombre } as any);
    return null;
  }, [ramaId, ramaNombre, ramaOptions]);

  const selectedRamaIngreso = useMemo(() => {
    if (!ramaIngresoId) return null;
    return ramasIngreso.find((r) => r.id === ramaIngresoId) ?? null;
  }, [ramaIngresoId, ramasIngreso]);

  const selectedRamaProveedorAux = useMemo(() => {
    if (!ramaProveedorAuxId) return null;
    return ramaOptions.find((r) => r.id === ramaProveedorAuxId) ?? null;
  }, [ramaProveedorAuxId, ramaOptions]);

  const selectedSubsegmento = useMemo(() => {
    if (!subsegmentoId) return null;
    return subsegmentoOptions.find((s) => s.id === subsegmentoId) ?? null;
  }, [subsegmentoId, subsegmentoOptions]);

  // ===========================================================================
  // ACTIONS CLEAR
  // ===========================================================================
  const clearRama = () => {
    if (ramaBloqueada) return;
    setRamaId(null);
    setRamaNombre(null);
  };

  const clearLocalidad = () => {
    setLocalidadId(null);
    setLocalidad('');
  };

  const clearRegion = () => {
    setRegionId(null);
    setComunidad('');
  };

  const clearPais = () => {
    setPaisId(null);
    setPais('');
  };

  const clearSubsegmento = () => {
    setSubsegmentoId(null);
    setBusquedaSubsegmento('');
  };

  // ===========================================================================
  // NUEVA LOCALIDAD / CREACIÓN INLINE
  // ===========================================================================
  const handleNuevaLocalidad = async () => {
    try {
      navigation.navigate('LocalidadForm', {
        returnRouteKey: route?.key,
        initialSearch: localidad || '',
      });
      return;
    } catch (e) {
      console.warn('[AuxEntityForm] navigate(LocalidadForm) falló, usando fallback inline', e);
    }

    setCreatingLocalidad(true);
    setNewLocalidadText('');
    setLocalidadId(null);
    setLocalidad('');

    await ensureRegionesLoaded();
    await ensurePaisesLoaded();
  };

  const handleSelectLocalidad = (loc: LocalidadWithContext) => {
    setCreatingLocalidad(false);
    setNewLocalidadText('');

    setLocalidadId(loc.id);
    setLocalidad(loc.nombre);

    const regionNombre = loc.region?.nombre ?? '';
    const paisNombre = loc.region?.pais?.nombre ?? '';

    setRegionId(loc.region?.id ?? null);
    setPaisId(loc.region?.pais?.id ?? null);
    setComunidad(regionNombre);
    setPais(paisNombre);

    setBusquedaLocalidad('');
    setBusquedaRegion('');
    setBusquedaPais('');
  };

  const handleSelectRegion = (r: RegionOption) => {
    setCreatingRegion(false);
    setNewRegionText('');

    setRegionId(r.id);
    setComunidad(r.nombre);

    if (r.paisId && r.paisNombre) {
      setPaisId(r.paisId);
      setPais(r.paisNombre);
    }

    setBusquedaRegion('');
  };

  const handleSelectPais = (p: PaisOption) => {
    setCreatingPais(false);
    setNewPaisText('');

    setPaisId(p.id);
    setPais(p.nombre);

    if (regionId && regionOptions.length) {
      const r = regionOptions.find((x) => x.id === regionId);
      if (r?.paisId && r.paisId !== p.id) {
        setRegionId(null);
        setComunidad('');
        setLocalidadId(null);
        setLocalidad('');
      }
    }

    setBusquedaPais('');
  };

  const ensurePaisCreatedIfNeeded = async (): Promise<number | null> => {
    if (paisId) return paisId;

    const nombrePais = (creatingPais ? newPaisText : pais).trim();
    if (!nombrePais) return null;

    const creado = await createPais({ nombre: nombrePais, codigo_iso: null });
    setPaisId(creado.id);
    setPais(creado.nombre);
    setCreatingPais(false);
    setNewPaisText('');

    setPaisOptions((prev) => {
      const m = new Map<number, PaisOption>();
      for (const x of prev) m.set(x.id, x);
      m.set(creado.id, { id: creado.id, nombre: creado.nombre });
      return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    });

    return creado.id;
  };

  const ensureRegionCreatedIfNeeded = async (): Promise<number | null> => {
    if (regionId) return regionId;

    const nombreRegion = (creatingRegion ? newRegionText : comunidad).trim();
    if (!nombreRegion) return null;

    const pid = await ensurePaisCreatedIfNeeded();
    if (!pid) {
      Alert.alert('Campo requerido', 'Para crear una región debes indicar un país.');
      return null;
    }

    const creado = await createRegion({ nombre: nombreRegion, pais_id: pid });
    setRegionId(creado.id);
    setComunidad(creado.nombre);
    setPaisId(creado.pais_id);
    if ((creado as any)?.pais?.nombre) setPais((creado as any).pais.nombre);

    setCreatingRegion(false);
    setNewRegionText('');

    setRegionOptions((prev) => {
      const m = new Map<number, RegionOption>();
      for (const x of prev) m.set(x.id, x);
      m.set(creado.id, {
        id: creado.id,
        nombre: creado.nombre,
        paisId: creado.pais_id ?? null,
        paisNombre: (creado as any)?.pais?.nombre ?? null,
      });
      return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    });

    return creado.id;
  };

  const ensureLocalidadCreatedIfNeeded = async (): Promise<number | null> => {
    if (localidadId) return localidadId;

    const nombreLoc = (creatingLocalidad ? newLocalidadText : localidad).trim();
    if (!nombreLoc) return null;

    const rid = await ensureRegionCreatedIfNeeded();
    if (!rid) {
      Alert.alert('Campo requerido', 'Para crear una localidad debes indicar una región.');
      return null;
    }

    const creado = await createLocalidad({ nombre: nombreLoc, region_id: rid });

    setLocalidadId(creado.id);
    setLocalidad(creado.nombre);

    const regionNombre = (creado as any)?.region?.nombre ?? '';
    const paisNombre = (creado as any)?.region?.pais?.nombre ?? '';
    setRegionId((creado as any)?.region?.id ?? rid);
    setComunidad(regionNombre);
    setPaisId((creado as any)?.region?.pais?.id ?? paisId ?? null);
    setPais(paisNombre);

    setCreatingLocalidad(false);
    setNewLocalidadText('');

    setLocalidadOptions((prev) => {
      const exists = prev.some((x) => x.id === creado.id);
      if (exists) return prev;
      return [creado, ...prev].slice(0, 800);
    });
    buildRegionAndPaisOptionsFromLocalidades([creado]);

    return creado.id;
  };

  const confirmNewPais = async () => {
    const v = newPaisText.trim();
    if (!v) {
      Alert.alert('Campo requerido', 'Debes escribir un país.');
      return;
    }

    try {
      await ensurePaisCreatedIfNeeded();
    } catch (err) {
      console.error('[AuxEntityForm] Error creando país', err);
      Alert.alert('Error', 'No se ha podido crear el país.');
    }
  };

  const confirmNewRegion = async () => {
    const v = newRegionText.trim();
    if (!v) {
      Alert.alert('Campo requerido', 'Debes escribir una comunidad / región.');
      return;
    }

    try {
      await ensureRegionCreatedIfNeeded();
    } catch (err) {
      console.error('[AuxEntityForm] Error creando región', err);
      Alert.alert('Error', 'No se ha podido crear la región.');
    }
  };

  const confirmNewLocalidad = async () => {
    const v = newLocalidadText.trim();
    if (!v) {
      Alert.alert('Campo requerido', 'Debes escribir una localidad.');
      return;
    }

    try {
      await ensureLocalidadCreatedIfNeeded();
    } catch (err) {
      console.error('[AuxEntityForm] Error creando localidad', err);
      Alert.alert('Error', 'No se ha podido crear la localidad.');
    }
  };

  // ===========================================================================
  // VALIDACIÓN PROVEEDOR
  // ===========================================================================
  const validateProveedorBeforeSave = (): boolean => {
    const nombreFinal = nombre.trim();

    if (!nombreFinal) {
      Alert.alert('Campo requerido', 'Debes indicar un nombre.');
      return false;
    }

    if (!ramaId) {
      Alert.alert('Campo requerido', 'Debes seleccionar una rama.');
      return false;
    }

    if (!isValidSpanishCif(cif)) {
      Alert.alert('CIF inválido', 'El CIF no tiene un formato válido para España.');
      return false;
    }

    if (!isValidEmail(email)) {
      Alert.alert('Email inválido', 'Revisa el formato del correo electrónico.');
      return false;
    }

    return true;
  };

  // ===========================================================================
  // GUARDAR AUX GENÉRICO
  // ===========================================================================
  const handleSaveGenericAux = async () => {
    const nombreFinal = nombre.trim();

    if (!nombreFinal) {
      Alert.alert('Campo requerido', 'Debes indicar un nombre.');
      return;
    }

    try {
      const entity = auxType as AuxEntity;
      let payload: any = { nombre: nombreFinal };

      if (isTipoGasto) {
        if (!ramaGastoId) {
          Alert.alert('Campo requerido', 'Debes seleccionar una rama de gasto.');
          return;
        }
        if (!segmentoGastoId) {
          Alert.alert('Campo requerido', 'Debes seleccionar un segmento de gasto.');
          return;
        }

        payload = {
          nombre: nombreFinal,
          rama_id: ramaGastoId,
          segmento_id: segmentoGastoId,
        };
      }

      if (isTipoIngreso) {
        if (!ramaIngresoId) {
          Alert.alert('Campo requerido', 'Debes seleccionar una rama de ingreso.');
          return;
        }

        payload = {
          nombre: nombreFinal,
          rama_id: ramaIngresoId,
        };
      }

      if (isSubsegmentoProveedor) {
        if (!ramaProveedorAuxId) {
          Alert.alert('Campo requerido', 'Debes seleccionar una rama de proveedor.');
          return;
        }

        payload = {
          nombre: nombreFinal,
          rama_id: ramaProveedorAuxId,
        };
      }

      let result: any;

      if (isEditMode && editingItem?.id) {
        result = await updateAux(entity, editingItem.id, payload);
        sendResultAndClose({
          type: auxType,
          item: result,
          key: returnKey ?? null,
          mode: 'updated',
        });
        return;
      }

      result = await createAux(entity, payload);
      sendResultAndClose({
        type: auxType,
        item: result,
        key: returnKey ?? null,
        mode: 'created',
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      if (status === 400 && typeof detail === 'string') {
        Alert.alert('No se ha podido guardar', detail);
        return;
      }

      if (status === 422 && typeof detail === 'string') {
        Alert.alert('Datos inválidos', detail);
        return;
      }

      console.error('[AuxEntityForm] Error guardando auxiliar', err);
      Alert.alert('Error', 'No se ha podido guardar el registro.');
    }
  };

  // ===========================================================================
  // GUARDAR PROVEEDOR
  // ===========================================================================
  const handleSave = async () => {
    if (!isProveedor) {
      await handleSaveGenericAux();
      return;
    }

    if (!validateProveedorBeforeSave()) return;

    const nombreFinal = nombre.trim();

    try {
      const hasLocalidadText =
        (creatingLocalidad ? newLocalidadText : localidad).trim().length > 0;

      const finalLocalidadId = hasLocalidadText
        ? await ensureLocalidadCreatedIfNeeded()
        : null;

      const payloadForBackend = {
        nombre: nombreFinal,
        rama_id: ramaId!,
        localidad_id: finalLocalidadId,
        localidad: (localidad || null) as string | null,
        comunidad: (comunidad || null) as string | null,
        pais: (pais || null) as string | null,

        cif: (cif.trim() || null) as string | null,
        telefono: (telefono.trim() || null) as string | null,
        email: (normalizeEmail(email) || null) as string | null,
        subsegmento_id: (subsegmentoId || null) as string | null,
        subsegmento: (
          selectedSubsegmento?.nombre?.trim() ||
          null
        ) as string | null,
        direccion: (direccion.trim() || null) as string | null,
        codigo_postal: (codigoPostal.trim() || null) as string | null,
        persona_contacto: (personaContacto.trim() || null) as string | null,
        activo,
        observaciones: (observaciones.trim() || null) as string | null,
        acepta_urgencias: aceptaUrgencias,
        ambito_servicio: (ambitoServicio.trim() || null) as string | null,
      };

      if (isEditMode && editingProveedor) {
        const actualizado = await updateProveedor(editingProveedor.id, payloadForBackend as any);
        sendResultAndClose({
          type: auxType,
          item: actualizado,
          key: returnKey ?? null,
          mode: 'updated',
        });
        return;
      }

      const creado = await createProveedorFromAuxForm({
        nombre: nombreFinal,
        ramaId: ramaId!,
        localidadId: finalLocalidadId,
        localidadTexto: payloadForBackend.localidad,
        comunidadTexto: payloadForBackend.comunidad,
        paisTexto: payloadForBackend.pais,
        cif: payloadForBackend.cif,
        telefono: payloadForBackend.telefono,
        email: payloadForBackend.email,
        subsegmentoId: payloadForBackend.subsegmento_id,
        subsegmento: payloadForBackend.subsegmento,
        direccion: payloadForBackend.direccion,
        codigoPostal: payloadForBackend.codigo_postal,
        personaContacto: payloadForBackend.persona_contacto,
        activo: payloadForBackend.activo,
        observaciones: payloadForBackend.observaciones,
        aceptaUrgencias: payloadForBackend.acepta_urgencias,
        ambitoServicio: payloadForBackend.ambito_servicio,
      });

      sendResultAndClose({
        type: auxType,
        item: creado,
        key: returnKey ?? null,
        mode: 'created',
      });
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const data = err.response?.data;
        const detail = (data as any)?.detail;

        console.error('[AuxEntityForm] Error al guardar (axios)', {
          status,
          data,
          message: err.message,
        });

        if (status === 400 && typeof detail === 'string') {
          Alert.alert('No se ha podido guardar', detail);
          return;
        }

        if (status === 422) {
          Alert.alert(
            'Datos inválidos',
            'Revisa los campos requeridos y el formato de CIF/email.'
          );
          return;
        }
      } else {
        console.error('[AuxEntityForm] Error al guardar (non-axios)', err);
      }

      Alert.alert('Error', 'No se ha podido guardar el registro.');
    }
  };

  // ===========================================================================
  // ELIMINAR
  // ===========================================================================
  const handleDelete = () => {
    if (!isEditMode) return;

    if (!isProveedor) {
      if (!editingItem?.id) return;

      Alert.alert(
        'Eliminar registro',
        `¿Seguro que quieres eliminar "${editingItem.nombre}"? Esta acción no se puede deshacer.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteAux(auxType as AuxEntity, editingItem.id);
                navigation.goBack();
              } catch (err) {
                console.error('[AuxEntityForm] Error al eliminar auxiliar', err);
                Alert.alert('Error', 'No se ha podido eliminar el registro.');
              }
            },
          },
        ]
      );
      return;
    }

    if (!editingProveedor) return;

    Alert.alert(
      'Eliminar proveedor',
      `¿Seguro que quieres eliminar "${editingProveedor.nombre}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProveedor(editingProveedor.id);
              navigation.goBack();
            } catch (err) {
              console.error('[AuxEntityForm] Error al eliminar proveedor', err);
              Alert.alert('Error', 'No se ha podido eliminar el proveedor.');
            }
          },
        },
      ]
    );
  };

  // ===========================================================================
  // DIRTY CHECK
  // ===========================================================================
  const initialSnapshot = useMemo<DirtySnapshot>(() => {
    if (isProveedor) {
      if (editingProveedor) {
        return {
          mode: 'proveedor',
          nombre: normalize(editingProveedor.nombre),
          ramaId: normalize(editingProveedor.rama_id),
          localidad: normalize(editingProveedor.localidad),
          comunidad: normalize((editingProveedor as any).comunidad),
          pais: normalize(editingProveedor.pais),
          cif: normalize((editingProveedor as any).cif),
          telefono: normalize((editingProveedor as any).telefono),
          email: normalize((editingProveedor as any).email),
          subsegmentoId: normalize((editingProveedor as any).subsegmento_id),
          direccion: normalize((editingProveedor as any).direccion),
          codigoPostal: normalize((editingProveedor as any).codigo_postal),
          personaContacto: normalize((editingProveedor as any).persona_contacto),
          observaciones: normalize((editingProveedor as any).observaciones),
          ambitoServicio: normalize((editingProveedor as any).ambito_servicio),
          activo: String((editingProveedor as any).activo ?? true),
          aceptaUrgencias: String((editingProveedor as any).acepta_urgencias ?? false),

          ramaGastoId: '',
          segmentoGastoId: '',
          ramaIngresoId: '',
          ramaProveedorId: '',
        };
      }

      return {
        mode: 'proveedor',
        nombre: '',
        ramaId: ramaBloqueada ? '' : normalize(ramaId),
        localidad: '',
        comunidad: '',
        pais: '',
        cif: '',
        telefono: '',
        email: '',
        subsegmentoId: '',
        direccion: '',
        codigoPostal: '',
        personaContacto: '',
        observaciones: '',
        ambitoServicio: '',
        activo: 'true',
        aceptaUrgencias: 'false',

        ramaGastoId: '',
        segmentoGastoId: '',
        ramaIngresoId: '',
        ramaProveedorId: '',
      };
    }

    if (editingItem) {
      return {
        mode: 'aux',
        nombre: normalize(editingItem.nombre),

        ramaId: '',
        localidad: '',
        comunidad: '',
        pais: '',
        cif: '',
        telefono: '',
        email: '',
        subsegmentoId: '',
        direccion: '',
        codigoPostal: '',
        personaContacto: '',
        observaciones: '',
        ambitoServicio: '',
        activo: '',
        aceptaUrgencias: '',

        ramaGastoId: normalize((editingItem as any).rama_id),
        segmentoGastoId: normalize((editingItem as any).segmento_id),
        ramaIngresoId: normalize((editingItem as any).rama_id),
        ramaProveedorId: normalize((editingItem as any).rama_id),
      };
    }

    return {
      mode: 'aux',
      nombre: '',

      ramaId: '',
      localidad: '',
      comunidad: '',
      pais: '',
      cif: '',
      telefono: '',
      email: '',
      subsegmentoId: '',
      direccion: '',
      codigoPostal: '',
      personaContacto: '',
      observaciones: '',
      ambitoServicio: '',
      activo: '',
      aceptaUrgencias: '',

      ramaGastoId: '',
      segmentoGastoId: '',
      ramaIngresoId: '',
      ramaProveedorId: '',
    };
  }, [isProveedor, editingProveedor, editingItem, ramaBloqueada, ramaId]);

  const isDirty = useMemo(() => {
    if (isProveedor) {
      const current = {
        nombre: normalize(nombre),
        ramaId: ramaBloqueada ? '' : normalize(ramaId),
        localidad: normalize(creatingLocalidad ? newLocalidadText : localidad),
        comunidad: normalize(creatingRegion ? newRegionText : comunidad),
        pais: normalize(creatingPais ? newPaisText : pais),
        cif: normalize(cif),
        telefono: normalize(telefono),
        email: normalize(normalizeEmail(email)),
        subsegmentoId: normalize(subsegmentoId),
        direccion: normalize(direccion),
        codigoPostal: normalize(codigoPostal),
        personaContacto: normalize(personaContacto),
        observaciones: normalize(observaciones),
        ambitoServicio: normalize(ambitoServicio),
        activo: String(activo),
        aceptaUrgencias: String(aceptaUrgencias),
      };

      return (
        current.nombre !== initialSnapshot.nombre ||
        current.ramaId !== initialSnapshot.ramaId ||
        current.localidad !== initialSnapshot.localidad ||
        current.comunidad !== initialSnapshot.comunidad ||
        current.pais !== initialSnapshot.pais ||
        current.cif !== initialSnapshot.cif ||
        current.telefono !== initialSnapshot.telefono ||
        current.email !== initialSnapshot.email ||
        current.subsegmentoId !== initialSnapshot.subsegmentoId ||
        current.direccion !== initialSnapshot.direccion ||
        current.codigoPostal !== initialSnapshot.codigoPostal ||
        current.personaContacto !== initialSnapshot.personaContacto ||
        current.observaciones !== initialSnapshot.observaciones ||
        current.ambitoServicio !== initialSnapshot.ambitoServicio ||
        current.activo !== initialSnapshot.activo ||
        current.aceptaUrgencias !== initialSnapshot.aceptaUrgencias
      );
    }

    const current = {
      nombre: normalize(nombre),
      ramaGastoId: normalize(ramaGastoId),
      segmentoGastoId: normalize(segmentoGastoId),
      ramaIngresoId: normalize(ramaIngresoId),
      ramaProveedorId: normalize(ramaProveedorAuxId),
    };

    return (
      current.nombre !== initialSnapshot.nombre ||
      current.ramaGastoId !== initialSnapshot.ramaGastoId ||
      current.segmentoGastoId !== initialSnapshot.segmentoGastoId ||
      current.ramaIngresoId !== initialSnapshot.ramaIngresoId ||
      current.ramaProveedorId !== initialSnapshot.ramaProveedorId
    );
  }, [
    isProveedor,
    nombre,
    ramaId,
    ramaBloqueada,
    localidad,
    comunidad,
    pais,
    cif,
    telefono,
    email,
    subsegmentoId,
    direccion,
    codigoPostal,
    personaContacto,
    observaciones,
    ambitoServicio,
    activo,
    aceptaUrgencias,
    creatingLocalidad,
    creatingRegion,
    creatingPais,
    newLocalidadText,
    newRegionText,
    newPaisText,
    ramaGastoId,
    segmentoGastoId,
    ramaIngresoId,
    ramaProveedorAuxId,
    initialSnapshot,
  ]);

  const handleBackPress = () => {
    if (!isDirty) {
      navigation.goBack();
      return;
    }

    Alert.alert(
      'Salir del formulario',
      'Si sales del formulario perderás los datos no guardados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // ===========================================================================
  // TÍTULO
  // ===========================================================================
  const title =
    auxType === 'proveedor'
      ? isEditMode
        ? 'Editar proveedor'
        : 'Nuevo proveedor'
      : auxType === 'tipo_gasto'
      ? isEditMode
        ? 'Editar tipo de gasto'
        : 'Nuevo tipo de gasto'
      : auxType === 'tipo_ingreso'
      ? isEditMode
        ? 'Editar tipo de ingreso'
        : 'Nuevo tipo de ingreso'
      : auxType === 'tipo_ramas_ingreso'
      ? isEditMode
        ? 'Editar rama de ingreso'
        : 'Nueva rama de ingreso'
      : auxType === 'tipo_ramas_gasto'
      ? isEditMode
        ? 'Editar rama de gasto'
        : 'Nueva rama de gasto'
      : auxType === 'tipo_ramas_proveedores'
      ? isEditMode
        ? 'Editar rama de proveedor'
        : 'Nueva rama de proveedor'
      : auxType === 'tipo_segmento_gasto'
      ? isEditMode
        ? 'Editar segmento de gasto'
        : 'Nuevo segmento de gasto'
      : auxType === 'tipo_subsegmento_proveedor'
      ? isEditMode
        ? 'Editar subsegmento de proveedor'
        : 'Nuevo subsegmento de proveedor'
      : isEditMode
      ? 'Editar registro'
      : 'Nuevo registro';

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <FormScreen
      title={title}
      onBackPress={handleBackPress}
      loading={false}
      footer={
        <View style={styles.bottomActions}>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Ionicons name="save-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>{isEditMode ? 'Guardar cambios' : 'Guardar'}</Text>
          </TouchableOpacity>

          {isEditMode ? (
            <TouchableOpacity style={ui.deleteButton} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={ui.deleteButtonText}>Eliminar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    >
      <FormSection title="Datos">
        <View style={styles.field}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={[styles.input, nombre.trim() !== '' ? styles.inputFilled : null]}
            placeholder="Nombre..."
            value={nombre}
            onChangeText={setNombre}
          />
        </View>
      </FormSection>

      {!isProveedor ? (
        <FormSection title="Configuración">
          {isTipoGasto ? (
            <>
              <View style={styles.field}>
                <InlineSearchSelect<{ id: string; nombre: string }>
                  label="Rama de gasto"
                  onAddPress={NOOP}
                  addAccessibilityLabel="Añadir (no aplica)"
                  disabled={false}
                  selected={ramaGastoId ? ramasGasto.find((x) => x.id === ramaGastoId) ?? null : null}
                  selectedLabel={(x) => x.nombre}
                  onClear={() => setRamaGastoId(null)}
                  query={busquedaRamaGasto}
                  onChangeQuery={(v) => setBusquedaRamaGasto(v)}
                  placeholder="Escribe para buscar rama"
                  options={ramasGastoFiltradas}
                  optionKey={(x) => x.id}
                  optionLabel={(x) => x.nombre}
                  onSelect={(x) => {
                    setRamaGastoId(x.id);
                    setBusquedaRamaGasto('');
                  }}
                  emptyText="No hay ramas que coincidan con la búsqueda."
                />
              </View>

              <View style={styles.field}>
                <InlineSearchSelect<{ id: string; nombre: string }>
                  label="Segmento"
                  onAddPress={NOOP}
                  addAccessibilityLabel="Añadir (no aplica)"
                  disabled={false}
                  selected={
                    segmentoGastoId
                      ? segmentosGasto.find((x) => x.id === segmentoGastoId) ?? null
                      : null
                  }
                  selectedLabel={(x) => x.nombre}
                  onClear={() => setSegmentoGastoId(null)}
                  query={busquedaSegmentoGasto}
                  onChangeQuery={(v) => setBusquedaSegmentoGasto(v)}
                  placeholder="Escribe para buscar segmento"
                  options={segmentosGastoFiltrados}
                  optionKey={(x) => x.id}
                  optionLabel={(x) => x.nombre}
                  onSelect={(x) => {
                    setSegmentoGastoId(x.id);
                    setBusquedaSegmentoGasto('');
                  }}
                  emptyText="No hay segmentos que coincidan con la búsqueda."
                />
              </View>
            </>
          ) : isTipoIngreso ? (
            <View style={styles.field}>
              <InlineSearchSelect<{ id: string; nombre: string }>
                label="Rama de ingreso"
                onAddPress={NOOP}
                addAccessibilityLabel="Añadir (no aplica)"
                disabled={false}
                selected={selectedRamaIngreso}
                selectedLabel={(x) => x.nombre}
                onClear={() => setRamaIngresoId(null)}
                query={busquedaRamaIngreso}
                onChangeQuery={(v) => setBusquedaRamaIngreso(v)}
                placeholder="Escribe para buscar rama de ingreso"
                options={ramasIngresoFiltradas}
                optionKey={(x) => x.id}
                optionLabel={(x) => x.nombre}
                onSelect={(x) => {
                  setRamaIngresoId(x.id);
                  setBusquedaRamaIngreso('');
                }}
                emptyText="No hay ramas de ingreso que coincidan con la búsqueda."
              />
            </View>
          ) : isSubsegmentoProveedor ? (
            <View style={styles.field}>
              <InlineSearchSelect<RamaProveedor>
                label="Rama de proveedor"
                onAddPress={NOOP}
                addAccessibilityLabel="Añadir (no aplica)"
                disabled={false}
                selected={selectedRamaProveedorAux}
                selectedLabel={(x) => x.nombre}
                onClear={() => setRamaProveedorAuxId(null)}
                query={busquedaRamaProveedorAux}
                onChangeQuery={(v) => setBusquedaRamaProveedorAux(v)}
                placeholder="Escribe para buscar rama"
                options={ramasProveedorAuxFiltradas}
                optionKey={(x) => x.id}
                optionLabel={(x) => x.nombre}
                onSelect={(x) => {
                  setRamaProveedorAuxId(x.id);
                  setBusquedaRamaProveedorAux('');
                }}
                emptyText="No hay ramas que coincidan con la búsqueda."
              />
            </View>
          ) : (
            <Text style={styles.helperText}>Completa el nombre y guarda.</Text>
          )}
        </FormSection>
      ) : (
        <>
          <FormSection title="Proveedor">
            <View style={styles.field}>
              <InlineSearchSelect<RamaProveedor>
                label="Rama proveedor"
                onAddPress={NOOP}
                addAccessibilityLabel="Añadir (no aplica)"
                disabled={ramaBloqueada}
                selected={selectedRama}
                selectedLabel={(r) => r.nombre}
                onClear={ramaBloqueada ? NOOP : clearRama}
                query={ramaBloqueada ? '' : busquedaRamaProveedor}
                onChangeQuery={(v) => {
                  if (ramaBloqueada) return;
                  setBusquedaRamaProveedor(v);
                  void ensureRamasProveedorLoaded();
                }}
                placeholder="Escribe para buscar rama"
                options={ramasProveedorFiltradas}
                optionKey={(r) => r.id}
                optionLabel={(r) => r.nombre}
                onSelect={(r) => {
                  if (ramaBloqueada) return;
                  setRamaId(r.id);
                  setRamaNombre(r.nombre);
                  setBusquedaRamaProveedor('');
                }}
                emptyText="No hay ramas que coincidan con la búsqueda."
              />

              {loadingRamas ? <Text style={styles.helperText}>Cargando ramas...</Text> : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>CIF</Text>
              <TextInput
                style={[styles.input, cif.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. B12345678"
                value={cif}
                onChangeText={(v) => setCif(v.toUpperCase())}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.fieldRowTwoCols}>
              <View style={styles.col}>
                <Text style={styles.label}>Teléfono</Text>
                <TextInput
                  style={[styles.input, telefono.trim() !== '' ? styles.inputFilled : null]}
                  placeholder="Ej. 600123123"
                  value={telefono}
                  onChangeText={setTelefono}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.col}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[styles.input, email.trim() !== '' ? styles.inputFilled : null]}
                  placeholder="correo@dominio.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.field}>
              <InlineSearchSelect<{ id: string; nombre: string; rama_id?: string | null }>
                label="Subsegmento"
                onAddPress={NOOP}
                addAccessibilityLabel="Añadir (no aplica)"
                disabled={false}
                selected={selectedSubsegmento}
                selectedLabel={(x) => x.nombre}
                onClear={clearSubsegmento}
                query={busquedaSubsegmento}
                onChangeQuery={(v) => {
                  setBusquedaSubsegmento(v);
                  void ensureSubsegmentosLoaded();
                }}
                placeholder="Escribe para buscar subsegmento"
                options={subsegmentosFiltrados}
                optionKey={(x) => x.id}
                optionLabel={(x) => x.nombre}
                onSelect={(x) => {
                  setSubsegmentoId(x.id);
                  setBusquedaSubsegmento('');
                }}
                emptyText="No hay subsegmentos que coincidan con la búsqueda."
              />

              {loadingSubsegmentos ? (
                <Text style={styles.helperText}>Cargando subsegmentos...</Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Persona de contacto</Text>
              <TextInput
                style={[styles.input, personaContacto.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Nombre de contacto"
                value={personaContacto}
                onChangeText={setPersonaContacto}
              />
            </View>
          </FormSection>

          <FormSection title="Ubicación">
            <View style={styles.field}>
              <InlineSearchSelect<LocalidadWithContext>
                label="Localidad"
                onAddPress={handleNuevaLocalidad}
                addAccessibilityLabel="Crear localidad"
                disabled={false}
                selected={localidadId && localidad ? ({ id: localidadId, nombre: localidad } as any) : null}
                selectedLabel={(l: any) => l.nombre ?? localidad}
                onClear={clearLocalidad}
                query={busquedaLocalidad}
                onChangeQuery={(v) => {
                  setBusquedaLocalidad(v);
                  void ensureLocalidadesLoaded();
                }}
                placeholder="Escribe para buscar localidad"
                options={localidadesFiltradas}
                optionKey={(l) => String(l.id)}
                optionLabel={(l) => {
                  const r = l.region?.nombre ? ` · ${l.region.nombre}` : '';
                  const p = l.region?.pais?.nombre ? ` (${l.region.pais.nombre})` : '';
                  return `${l.nombre}${r}${p}`;
                }}
                onSelect={(l) => handleSelectLocalidad(l)}
                emptyText="No hay localidades que coincidan con la búsqueda."
              />

              {loadingLocalidades ? <Text style={styles.helperText}>Cargando localidades...</Text> : null}

              {creatingLocalidad ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.helperText}>
                    Fallback inline: crea una localidad aquí si no se pudo abrir LocalidadForm.
                  </Text>

                  <TextInput
                    style={[styles.input, newLocalidadText.trim() !== '' ? styles.inputFilled : null]}
                    placeholder="Escribe nueva localidad..."
                    value={newLocalidadText}
                    onChangeText={setNewLocalidadText}
                  />

                  <View style={ui.inlineActionsRow}>
                    <TouchableOpacity style={ui.inlinePrimaryBtn} onPress={confirmNewLocalidad}>
                      <Text style={ui.inlinePrimaryText}>Crear localidad</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={ui.inlineSecondaryBtn}
                      onPress={() => {
                        setCreatingLocalidad(false);
                        setNewLocalidadText('');
                      }}
                    >
                      <Text style={ui.inlineSecondaryText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.field}>
              <InlineSearchSelect<RegionOption>
                label="Comunidad / Región"
                onAddPress={async () => {
                  setCreatingRegion(true);
                  setNewRegionText('');
                  setRegionId(null);
                  setComunidad('');
                  await ensurePaisesLoaded();
                }}
                addAccessibilityLabel="Crear región"
                disabled={false}
                selected={
                  regionId && comunidad
                    ? ({
                        id: regionId,
                        nombre: comunidad,
                        paisId: paisId ?? null,
                        paisNombre: pais || null,
                      } as any)
                    : null
                }
                selectedLabel={(r) => r.nombre}
                onClear={clearRegion}
                query={busquedaRegion}
                onChangeQuery={(v) => {
                  setBusquedaRegion(v);
                  void ensureRegionesLoaded();
                }}
                placeholder="Escribe para buscar región"
                options={regionesFiltradas}
                optionKey={(r) => String(r.id)}
                optionLabel={(r) => `${r.nombre}${r.paisNombre ? ` (${r.paisNombre})` : ''}`}
                onSelect={(r) => handleSelectRegion(r)}
                emptyText="No hay regiones que coincidan con la búsqueda."
              />

              {loadingRegiones ? <Text style={styles.helperText}>Cargando regiones...</Text> : null}

              {creatingRegion ? (
                <View style={{ marginTop: spacing.sm }}>
                  <SelectedInlineValue
                    value="Creando nueva región (inline)"
                    leftIconName="layers-outline"
                    onClear={() => {
                      setCreatingRegion(false);
                      setNewRegionText('');
                    }}
                  />

                  <TextInput
                    style={[styles.input, newRegionText.trim() !== '' ? styles.inputFilled : null]}
                    placeholder="Nombre de la región..."
                    value={newRegionText}
                    onChangeText={setNewRegionText}
                  />

                  <Text style={[styles.helperText, { marginTop: spacing.xs }]}>
                    Para crear una región necesitas indicar un país.
                  </Text>

                  <View style={ui.inlineActionsRow}>
                    <TouchableOpacity style={ui.inlinePrimaryBtn} onPress={confirmNewRegion}>
                      <Text style={ui.inlinePrimaryText}>Crear región</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={ui.inlineSecondaryBtn}
                      onPress={() => {
                        setCreatingRegion(false);
                        setNewRegionText('');
                      }}
                    >
                      <Text style={ui.inlineSecondaryText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.field}>
              <InlineSearchSelect<PaisOption>
                label="País"
                onAddPress={() => {
                  setCreatingPais(true);
                  setNewPaisText('');
                  setPaisId(null);
                  setPais('');
                }}
                addAccessibilityLabel="Crear país"
                disabled={false}
                selected={paisId && pais ? ({ id: paisId, nombre: pais } as any) : null}
                selectedLabel={(p) => p.nombre}
                onClear={clearPais}
                query={busquedaPais}
                onChangeQuery={(v) => {
                  setBusquedaPais(v);
                  void ensurePaisesLoaded();
                }}
                placeholder="Escribe para buscar país"
                options={paisesFiltrados}
                optionKey={(p) => String(p.id)}
                optionLabel={(p) => p.nombre}
                onSelect={(p) => handleSelectPais(p)}
                emptyText="No hay países que coincidan con la búsqueda."
              />

              {loadingPaises ? <Text style={styles.helperText}>Cargando países...</Text> : null}

              {creatingPais ? (
                <View style={{ marginTop: spacing.sm }}>
                  <SelectedInlineValue
                    value="Creando nuevo país (inline)"
                    leftIconName="flag-outline"
                    onClear={() => {
                      setCreatingPais(false);
                      setNewPaisText('');
                    }}
                  />

                  <TextInput
                    style={[styles.input, newPaisText.trim() !== '' ? styles.inputFilled : null]}
                    placeholder="Nombre del país..."
                    value={newPaisText}
                    onChangeText={setNewPaisText}
                  />

                  <View style={ui.inlineActionsRow}>
                    <TouchableOpacity style={ui.inlinePrimaryBtn} onPress={confirmNewPais}>
                      <Text style={ui.inlinePrimaryText}>Crear país</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={ui.inlineSecondaryBtn}
                      onPress={() => {
                        setCreatingPais(false);
                        setNewPaisText('');
                      }}
                    >
                      <Text style={ui.inlineSecondaryText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Dirección</Text>
              <TextInput
                style={[styles.input, direccion.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Dirección completa"
                value={direccion}
                onChangeText={setDireccion}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Código postal</Text>
              <TextInput
                style={[styles.input, codigoPostal.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. 28001"
                value={codigoPostal}
                onChangeText={setCodigoPostal}
                keyboardType="number-pad"
              />
            </View>
          </FormSection>

          <FormSection title="Configuración adicional">
            <View style={styles.field}>
              <Text style={styles.label}>Ámbito de servicio</Text>
              <TextInput
                style={[styles.input, ambitoServicio.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. local, provincial, nacional..."
                value={ambitoServicio}
                onChangeText={setAmbitoServicio}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Estado</Text>
              <View style={styles.segmentosRow}>
                <View style={styles.segmentoWrapper}>
                  <PillButton
                    label="Activo"
                    selected={activo}
                    onPress={() => setActivo(true)}
                  />
                </View>
                <View style={styles.segmentoWrapper}>
                  <PillButton
                    label="Inactivo"
                    selected={!activo}
                    onPress={() => setActivo(false)}
                  />
                </View>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Acepta urgencias</Text>
              <View style={styles.segmentosRow}>
                <View style={styles.segmentoWrapper}>
                  <PillButton
                    label="Sí"
                    selected={aceptaUrgencias}
                    onPress={() => setAceptaUrgencias(true)}
                  />
                </View>
                <View style={styles.segmentoWrapper}>
                  <PillButton
                    label="No"
                    selected={!aceptaUrgencias}
                    onPress={() => setAceptaUrgencias(false)}
                  />
                </View>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Observaciones</Text>
              <TextInput
                style={[
                  styles.input,
                  observaciones.trim() !== '' ? styles.inputFilled : null,
                  ui.multilineInput,
                ]}
                placeholder="Añade observaciones del proveedor..."
                value={observaciones}
                onChangeText={setObservaciones}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            <Text style={styles.helperText}>
              Con nombre, rama y localidad es suficiente para el alta mínima. El resto de campos son ampliaciones del perfil del proveedor.
            </Text>
          </FormSection>
        </>
      )}
    </FormScreen>
  );
};

export default AuxEntityFormScreen;

const ui = StyleSheet.create({
  inlineActionsRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: 10,
  },
  inlinePrimaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  inlinePrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inlineSecondaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  inlineSecondaryText: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  deleteButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
  },
});