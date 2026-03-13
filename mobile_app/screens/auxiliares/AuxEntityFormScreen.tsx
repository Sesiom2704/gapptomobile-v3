/**
 * Ruta: mobile_app/screens/auxiliares/AuxEntityFormScreen.tsx
 * Versión: 2.3.2
 * Descripción:
 * Formulario genérico para creación y edición de auxiliares y proveedores.
 *
 * Ajustes:
 * - El botón "Relaciones" se mantiene en el footer.
 * - El bloque con el detalle de relaciones se renderiza al final del formulario.
 * - Se ocultan las relaciones con count = 0.
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
  TipoSubsegmentoProveedorItem,
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

type RelationCountItem = {
  key: string;
  label: string;
  count: number;
};

type SimpleAuxItem = {
  id: string;
  nombre: string;
  associated_count?: number;
  relation_counts?: RelationCountItem[];
  [k: string]: any;
};

type DirtySnapshot = {
  mode: 'proveedor' | 'aux';

  nombre: string;

  ramaId: string;
  subsegmentoId: string;
  localidad: string;
  comunidad: string;
  pais: string;
  cif: string;
  telefono: string;
  email: string;
  direccion: string;
  codigoPostal: string;
  personaContacto: string;
  observaciones: string;
  ambitoServicio: string;
  aceptaUrgencias: string;
  activo: string;

  ramaGastoId: string;
  segmentoGastoId: string;
  ramaIngresoId: string;
  subsegmentoRamaId: string;
};

const NOOP = () => {};

export const AuxEntityFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const auxType: string = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const editingProveedor: Proveedor | undefined = route?.params?.editingProveedor;
  const editingItem: SimpleAuxItem | undefined = route?.params?.editingItem;

  const isProveedor = auxType === 'proveedor';
  const isTipoGasto = auxType === 'tipo_gasto';
  const isTipoIngreso = auxType === 'tipo_ingreso';
  const isTipoRamaProveedor = auxType === 'tipo_ramas_proveedores';
  const isSubsegmentoProveedor = auxType === 'tipo_subsegmento_proveedor';

  const isEditMode = !!(editingProveedor || editingItem);

  const returnTo: string | undefined = route?.params?.returnTo;
  const returnKey: string | undefined = route?.params?.returnKey;
  const returnRouteKey: string | undefined = route?.params?.returnRouteKey;

  const [showRelations, setShowRelations] = useState(false);

  const [nombre, setNombre] = useState('');

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

  const [subsegmentoRamaId, setSubsegmentoRamaId] = useState<string | null>(
    route?.params?.defaultRamaId ?? null
  );
  const [subsegmentoRamasProveedor, setSubsegmentoRamasProveedor] = useState<RamaProveedor[]>([]);
  const [busquedaSubsegmentoRama, setBusquedaSubsegmentoRama] = useState('');

  const [ramaId, setRamaId] = useState<string | null>(route?.params?.defaultRamaId ?? null);
  const [ramaNombre, setRamaNombre] = useState<string | null>(null);

  const [subsegmentoId, setSubsegmentoId] = useState<string | null>(null);
  const [subsegmentoOptions, setSubsegmentoOptions] = useState<TipoSubsegmentoProveedorItem[]>([]);
  const [busquedaSubsegmento, setBusquedaSubsegmento] = useState('');

  const [localidad, setLocalidad] = useState('');
  const [comunidad, setComunidad] = useState('');
  const [pais, setPais] = useState('');
  const [localidadId, setLocalidadId] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [paisId, setPaisId] = useState<number | null>(null);

  const [cif, setCif] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [direccion, setDireccion] = useState('');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [personaContacto, setPersonaContacto] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [ambitoServicio, setAmbitoServicio] = useState('');
  const [aceptaUrgencias, setAceptaUrgencias] = useState<boolean>(false);
  const [activo, setActivo] = useState<boolean>(true);

  const [creatingLocalidad, setCreatingLocalidad] = useState(false);
  const [creatingRegion, setCreatingRegion] = useState(false);
  const [creatingPais, setCreatingPais] = useState(false);

  const [newLocalidadText, setNewLocalidadText] = useState('');
  const [newRegionText, setNewRegionText] = useState('');
  const [newPaisText, setNewPaisText] = useState('');

  const [ramaOptions, setRamaOptions] = useState<RamaProveedor[]>([]);
  const [localidadOptions, setLocalidadOptions] = useState<LocalidadWithContext[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);

  const [loadingRamas, setLoadingRamas] = useState(false);
  const [loadingSubsegmentos, setLoadingSubsegmentos] = useState(false);
  const [loadingLocalidades, setLoadingLocalidades] = useState(false);
  const [loadingRegiones, setLoadingRegiones] = useState(false);
  const [loadingPaises, setLoadingPaises] = useState(false);

  const [busquedaRamaProveedor, setBusquedaRamaProveedor] = useState('');
  const [busquedaLocalidad, setBusquedaLocalidad] = useState('');
  const [busquedaRegion, setBusquedaRegion] = useState('');
  const [busquedaPais, setBusquedaPais] = useState('');

  const ramaBloqueada = origin === 'cotidianos' && !!ramaId;

  const relationItems = useMemo<RelationCountItem[]>(() => {
    let raw: RelationCountItem[] = [];

    if (isProveedor && editingProveedor) {
      raw = Array.isArray((editingProveedor as any).relation_counts)
        ? ((editingProveedor as any).relation_counts as RelationCountItem[])
        : [];
    } else if (!isProveedor && editingItem) {
      raw = Array.isArray((editingItem as any).relation_counts)
        ? ((editingItem as any).relation_counts as RelationCountItem[])
        : [];
    }

    return raw.filter((rel) => Number(rel?.count ?? 0) > 0);
  }, [isProveedor, editingProveedor, editingItem]);

  const associatedCount = useMemo<number>(() => {
    if (relationItems.length > 0) {
      return relationItems.reduce((acc, x) => acc + Number(x.count ?? 0), 0);
    }

    if (isProveedor && editingProveedor) {
      return Number((editingProveedor as any).associated_count ?? 0);
    }

    if (!isProveedor && editingItem) {
      return Number((editingItem as any).associated_count ?? 0);
    }

    return 0;
  }, [isProveedor, editingProveedor, editingItem, relationItems]);

  const hasRelationsInfo = isEditMode && relationItems.length > 0;

  const findOwningNavigatorByRouteKey = (nav: any, targetRouteKey: string) => {
    let current = nav;
    while (current) {
      try {
        const state = current.getState?.();
        const routes = state?.routes ?? [];
        const found = routes.some((r: any) => r?.key === targetRouteKey);
        if (found) return current;
      } catch {}
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

    if (returnRouteKey) {
      const ownerNav = findOwningNavigatorByRouteKey(navigation, returnRouteKey);
      if (ownerNav) {
        try {
          ownerNav.dispatch({
            ...(CommonActions.setParams({ auxResult }) as any),
            source: returnRouteKey,
          });
          return;
        } catch {}
      }
    }

    if (returnTo) {
      try {
        const parent = navigation.getParent?.();
        const nav = parent ?? navigation;
        nav.navigate({ name: returnTo, params: { auxResult }, merge: true });
      } catch {}
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
      for (const item of prev) merged.set(item.id, item);
      for (const item of regionMap.values()) merged.set(item.id, item);
      return Array.from(merged.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    });

    setPaisOptions((prev) => {
      const merged = new Map<number, PaisOption>();
      for (const item of prev) merged.set(item.id, item);
      for (const item of paisMap.values()) merged.set(item.id, item);
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

  const ensureSubsegmentosProveedorLoaded = async (ramaFiltro?: string | null) => {
    try {
      setLoadingSubsegmentos(true);
      const data = await listAux<TipoSubsegmentoProveedorItem>(
        'tipo_subsegmento_proveedor',
        ramaFiltro ? { rama_id: ramaFiltro } : undefined
      );
      setSubsegmentoOptions(data ?? []);
    } catch (err) {
      console.error('[AuxEntityForm] Error cargando subsegmentos proveedor', err);
      Alert.alert('Error', 'No se han podido cargar los subsegmentos del proveedor.');
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
    if (!isEditMode || !editingProveedor) return;

    setNombre(editingProveedor.nombre ?? '');
    setRamaId(editingProveedor.rama_id ?? null);
    setRamaNombre(editingProveedor.rama_rel?.nombre ?? null);

    setLocalidad(editingProveedor.localidad ?? '');
    setComunidad(editingProveedor.comunidad ?? '');
    setPais(editingProveedor.pais ?? '');
    setLocalidadId((editingProveedor as any).localidad_id ?? null);

    setCif(((editingProveedor as any)?.cif ?? '') as string);
    setTelefono(((editingProveedor as any)?.telefono ?? '') as string);
    setEmail(((editingProveedor as any)?.email ?? '') as string);
    setDireccion(((editingProveedor as any)?.direccion ?? '') as string);
    setCodigoPostal(((editingProveedor as any)?.codigo_postal ?? '') as string);
    setPersonaContacto(((editingProveedor as any)?.persona_contacto ?? '') as string);
    setObservaciones(((editingProveedor as any)?.observaciones ?? '') as string);
    setAmbitoServicio(((editingProveedor as any)?.ambito_servicio ?? '') as string);
    setAceptaUrgencias(Boolean((editingProveedor as any)?.acepta_urgencias ?? false));
    setActivo((editingProveedor as any)?.activo !== false);
    setSubsegmentoId(((editingProveedor as any)?.subsegmento_id ?? null) as string | null);

    const locRel = (editingProveedor as any).localidad_rel;
    if (locRel) {
      setRegionId(locRel.region?.id ?? null);
      setPaisId(locRel.region?.pais?.id ?? null);
    }
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
      setSubsegmentoRamaId(editingItem.rama_id ?? null);
    }
  }, [isProveedor, editingItem, isTipoGasto, isTipoIngreso, isSubsegmentoProveedor]);

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
          const rp = await listRamasProveedores();
          setSubsegmentoRamasProveedor(rp ?? []);

          if (route?.params?.defaultRamaId && !editingItem?.rama_id) {
            setSubsegmentoRamaId(route.params.defaultRamaId);
          }
        }
      } catch (e) {
        console.error('[AuxEntityForm] Error cargando catálogos auxiliares', e);
        Alert.alert('Error', 'No se han podido cargar los catálogos necesarios.');
      }
    };

    void loadCatalogs();
  }, [isTipoGasto, isTipoIngreso, isSubsegmentoProveedor, route?.params?.defaultRamaId, editingItem?.rama_id]);

  useEffect(() => {
    if (!isProveedor) return;
    void ensureRamasProveedorLoaded();
  }, [isProveedor]);

  useEffect(() => {
    if (!isProveedor) return;
    void ensureSubsegmentosProveedorLoaded(ramaId ?? null);
  }, [isProveedor, ramaId]);

  useEffect(() => {
    if (!isProveedor) return;
    if (!ramaId) return;

    if (ramaBloqueada && busquedaRamaProveedor !== '') setBusquedaRamaProveedor('');

    if (ramaNombre) return;

    const found = ramaOptions.find((r) => r.id === ramaId);
    if (found?.nombre) {
      setRamaNombre(found.nombre);
      return;
    }

    void ensureRamasProveedorLoaded();
  }, [isProveedor, ramaId, ramaNombre, ramaOptions, ramaBloqueada, busquedaRamaProveedor]);

  useEffect(() => {
    const auxResult = route?.params?.auxResult;
    if (!auxResult) return;

    try {
      navigation.setParams?.({ auxResult: undefined });
    } catch {}

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
      return;
    }

    if (auxResult?.type === 'tipo_ramas_proveedores' && auxResult?.item) {
      const nuevaRama = auxResult.item as RamaProveedor;

      setRamaOptions((prev) => {
        const exists = prev.some((x) => x.id === nuevaRama.id);
        if (exists) {
          return prev.map((x) => (x.id === nuevaRama.id ? nuevaRama : x));
        }
        return [nuevaRama, ...prev];
      });

      setRamaId(nuevaRama.id);
      setRamaNombre(nuevaRama.nombre);
      setSubsegmentoId(null);
      setBusquedaRamaProveedor('');
      setBusquedaSubsegmento('');

      return;
    }

    if (auxResult?.type === 'tipo_subsegmento_proveedor' && auxResult?.item) {
      const nuevoSubsegmento = auxResult.item as TipoSubsegmentoProveedorItem;

      setSubsegmentoOptions((prev) => {
        const exists = prev.some((x) => x.id === nuevoSubsegmento.id);
        if (exists) {
          return prev.map((x) => (x.id === nuevoSubsegmento.id ? nuevoSubsegmento : x));
        }
        return [nuevoSubsegmento, ...prev];
      });

      if (nuevoSubsegmento.rama_id) {
        setRamaId(nuevoSubsegmento.rama_id);
        const ramaEncontrada = ramaOptions.find((r) => r.id === nuevoSubsegmento.rama_id);
        if (ramaEncontrada?.nombre) {
          setRamaNombre(ramaEncontrada.nombre);
        }
      }

      setSubsegmentoId(nuevoSubsegmento.id);
      setBusquedaSubsegmento('');

      void ensureSubsegmentosProveedorLoaded(nuevoSubsegmento.rama_id ?? ramaId ?? null);
    }
  }, [route?.params?.auxResult, isProveedor, navigation, ramaOptions, ramaId]);

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

  const subsegmentosProveedorFiltrados = useMemo(() => {
    const term = busquedaSubsegmento.trim().toLowerCase();

    let base = subsegmentoOptions ?? [];

    if (ramaId) {
      base = base.filter((s) => (s.rama_id ?? null) === ramaId);
    }

    if (!term) return base.slice(0, 50);

    return base
      .filter((s) => (s.nombre ?? '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [subsegmentoOptions, busquedaSubsegmento, ramaId]);

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

  const subsegmentoRamasFiltradas = useMemo(() => {
    const term = busquedaSubsegmentoRama.trim().toLowerCase();
    if (!term) return subsegmentoRamasProveedor;
    return subsegmentoRamasProveedor.filter((r) => (r.nombre ?? '').toLowerCase().includes(term));
  }, [subsegmentoRamasProveedor, busquedaSubsegmentoRama]);

  const clearRama = () => {
    if (ramaBloqueada) return;
    setRamaId(null);
    setRamaNombre(null);
    setSubsegmentoId(null);
    setBusquedaSubsegmento('');
  };

  const clearSubsegmento = () => {
    setSubsegmentoId(null);
    setBusquedaSubsegmento('');
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

  const handleNuevaRamaProveedor = () => {
    navigation.push('AuxEntityForm', {
      auxType: 'tipo_ramas_proveedores',
      origin,
      returnRouteKey: route?.key,
    });
  };

  const handleNuevoSubsegmentoProveedor = () => {
    if (!ramaId) {
      Alert.alert('Campo requerido', 'Debes seleccionar antes una rama de proveedor.');
      return;
    }

    navigation.push('AuxEntityForm', {
      auxType: 'tipo_subsegmento_proveedor',
      origin,
      returnRouteKey: route?.key,
      defaultRamaId: ramaId,
    });
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

  const normalize = (v: any) => String(v ?? '').trim();

  const isValidEmail = (value: string): boolean => {
    const v = value.trim();
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  };

  const isValidTelefono = (value: string): boolean => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return true;
    return digits.length >= 9 && digits.length <= 15;
  };

  const isValidCodigoPostalES = (value: string): boolean => {
    const v = value.trim();
    if (!v) return true;
    return /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(v);
  };

  const isValidCifEspanaFlexible = (value: string): boolean => {
    const raw = value.trim().toUpperCase();
    if (!raw) return true;

    const cleaned = raw.replace(/[\s-]/g, '');
    return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(cleaned);
  };

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
        payload = {
          nombre: nombreFinal,
          rama_id: subsegmentoRamaId ?? route?.params?.defaultRamaId ?? null,
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

  const handleSave = async () => {
    if (!isProveedor) {
      await handleSaveGenericAux();
      return;
    }

    const nombreFinal = nombre.trim();
    if (!nombreFinal) {
      Alert.alert('Campo requerido', 'Debes indicar un nombre.');
      return;
    }

    if (!ramaId) {
      Alert.alert('Campo requerido', 'Debes seleccionar una rama.');
      return;
    }

    if (!isValidCifEspanaFlexible(cif)) {
      Alert.alert('Formato inválido', 'El CIF no tiene un formato español válido.');
      return;
    }

    if (!isValidTelefono(telefono)) {
      Alert.alert('Formato inválido', 'El teléfono no tiene un formato válido.');
      return;
    }

    if (!isValidEmail(email)) {
      Alert.alert('Formato inválido', 'El email no tiene un formato válido.');
      return;
    }

    if (!isValidCodigoPostalES(codigoPostal)) {
      Alert.alert('Formato inválido', 'El código postal debe ser español y tener 5 dígitos.');
      return;
    }

    try {
      const hasLocalidadText =
        (creatingLocalidad ? newLocalidadText : localidad).trim().length > 0;

      const finalLocalidadId = hasLocalidadText
        ? await ensureLocalidadCreatedIfNeeded()
        : null;

      const payloadForBackend = {
        nombre: nombreFinal,
        rama_id: ramaId,
        localidad_id: finalLocalidadId,
        localidad: (localidad || null) as string | null,
        comunidad: (comunidad || null) as string | null,
        pais: (pais || null) as string | null,
        cif: (cif || null) as string | null,
        telefono: (telefono || null) as string | null,
        email: (email || null) as string | null,
        direccion: (direccion || null) as string | null,
        codigo_postal: (codigoPostal || null) as string | null,
        persona_contacto: (personaContacto || null) as string | null,
        observaciones: (observaciones || null) as string | null,
        ambito_servicio: (ambitoServicio || null) as string | null,
        acepta_urgencias: aceptaUrgencias,
        activo,
        subsegmento_id: subsegmentoId,
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
        ramaId,
        localidadId: finalLocalidadId,
        localidadTexto: payloadForBackend.localidad,
        comunidadTexto: payloadForBackend.comunidad,
        paisTexto: payloadForBackend.pais,
        cif: payloadForBackend.cif,
        telefono: payloadForBackend.telefono,
        email: payloadForBackend.email,
        direccion: payloadForBackend.direccion,
        codigoPostal: payloadForBackend.codigo_postal,
        personaContacto: payloadForBackend.persona_contacto,
        observaciones: payloadForBackend.observaciones,
        ambitoServicio: payloadForBackend.ambito_servicio,
        aceptaUrgencias: payloadForBackend.acepta_urgencias,
        activo: payloadForBackend.activo,
        subsegmentoId: payloadForBackend.subsegmento_id,
        subsegmento: null,
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

        console.error('[AuxEntityForm] Error al guardar proveedor', {
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
            'Revisa los campos requeridos y el formato de CIF, email, teléfono o código postal.'
          );
          return;
        }
      } else {
        console.error('[AuxEntityForm] Error al guardar proveedor (non-axios)', err);
      }

      Alert.alert('Error', 'No se ha podido guardar el registro.');
    }
  };

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

  const initialSnapshot = useMemo<DirtySnapshot>(() => {
    if (isProveedor) {
      if (editingProveedor) {
        return {
          mode: 'proveedor',
          nombre: normalize(editingProveedor.nombre),
          ramaId: normalize(editingProveedor.rama_id),
          subsegmentoId: normalize((editingProveedor as any)?.subsegmento_id),
          localidad: normalize(editingProveedor.localidad),
          comunidad: normalize(editingProveedor.comunidad),
          pais: normalize(editingProveedor.pais),
          cif: normalize((editingProveedor as any)?.cif),
          telefono: normalize((editingProveedor as any)?.telefono),
          email: normalize((editingProveedor as any)?.email),
          direccion: normalize((editingProveedor as any)?.direccion),
          codigoPostal: normalize((editingProveedor as any)?.codigo_postal),
          personaContacto: normalize((editingProveedor as any)?.persona_contacto),
          observaciones: normalize((editingProveedor as any)?.observaciones),
          ambitoServicio: normalize((editingProveedor as any)?.ambito_servicio),
          aceptaUrgencias: String(Boolean((editingProveedor as any)?.acepta_urgencias ?? false)),
          activo: String((editingProveedor as any)?.activo !== false),
          ramaGastoId: '',
          segmentoGastoId: '',
          ramaIngresoId: '',
          subsegmentoRamaId: '',
        };
      }

      return {
        mode: 'proveedor',
        nombre: '',
        ramaId: ramaBloqueada ? '' : normalize(ramaId),
        subsegmentoId: '',
        localidad: '',
        comunidad: '',
        pais: '',
        cif: '',
        telefono: '',
        email: '',
        direccion: '',
        codigoPostal: '',
        personaContacto: '',
        observaciones: '',
        ambitoServicio: '',
        aceptaUrgencias: 'false',
        activo: 'true',
        ramaGastoId: '',
        segmentoGastoId: '',
        ramaIngresoId: '',
        subsegmentoRamaId: '',
      };
    }

    if (editingItem) {
      return {
        mode: 'aux',
        nombre: normalize(editingItem.nombre),
        ramaId: '',
        subsegmentoId: '',
        localidad: '',
        comunidad: '',
        pais: '',
        cif: '',
        telefono: '',
        email: '',
        direccion: '',
        codigoPostal: '',
        personaContacto: '',
        observaciones: '',
        ambitoServicio: '',
        aceptaUrgencias: '',
        activo: '',
        ramaGastoId: normalize((editingItem as any).rama_id),
        segmentoGastoId: normalize((editingItem as any).segmento_id),
        ramaIngresoId: normalize((editingItem as any).rama_id),
        subsegmentoRamaId: normalize((editingItem as any).rama_id),
      };
    }

    return {
      mode: 'aux',
      nombre: '',
      ramaId: '',
      subsegmentoId: '',
      localidad: '',
      comunidad: '',
      pais: '',
      cif: '',
      telefono: '',
      email: '',
      direccion: '',
      codigoPostal: '',
      personaContacto: '',
      observaciones: '',
      ambitoServicio: '',
      aceptaUrgencias: '',
      activo: '',
      ramaGastoId: '',
      segmentoGastoId: '',
      ramaIngresoId: '',
      subsegmentoRamaId: '',
    };
  }, [isProveedor, editingProveedor, editingItem, ramaBloqueada, ramaId]);

  const isDirty = useMemo(() => {
    if (isProveedor) {
      const current = {
        nombre: normalize(nombre),
        ramaId: ramaBloqueada ? '' : normalize(ramaId),
        subsegmentoId: normalize(subsegmentoId),
        localidad: normalize(creatingLocalidad ? newLocalidadText : localidad),
        comunidad: normalize(creatingRegion ? newRegionText : comunidad),
        pais: normalize(creatingPais ? newPaisText : pais),
        cif: normalize(cif),
        telefono: normalize(telefono),
        email: normalize(email),
        direccion: normalize(direccion),
        codigoPostal: normalize(codigoPostal),
        personaContacto: normalize(personaContacto),
        observaciones: normalize(observaciones),
        ambitoServicio: normalize(ambitoServicio),
        aceptaUrgencias: String(Boolean(aceptaUrgencias)),
        activo: String(Boolean(activo)),
      };

      return (
        current.nombre !== initialSnapshot.nombre ||
        current.ramaId !== initialSnapshot.ramaId ||
        current.subsegmentoId !== initialSnapshot.subsegmentoId ||
        current.localidad !== initialSnapshot.localidad ||
        current.comunidad !== initialSnapshot.comunidad ||
        current.pais !== initialSnapshot.pais ||
        current.cif !== initialSnapshot.cif ||
        current.telefono !== initialSnapshot.telefono ||
        current.email !== initialSnapshot.email ||
        current.direccion !== initialSnapshot.direccion ||
        current.codigoPostal !== initialSnapshot.codigoPostal ||
        current.personaContacto !== initialSnapshot.personaContacto ||
        current.observaciones !== initialSnapshot.observaciones ||
        current.ambitoServicio !== initialSnapshot.ambitoServicio ||
        current.aceptaUrgencias !== initialSnapshot.aceptaUrgencias ||
        current.activo !== initialSnapshot.activo
      );
    }

    const current = {
      nombre: normalize(nombre),
      ramaGastoId: normalize(ramaGastoId),
      segmentoGastoId: normalize(segmentoGastoId),
      ramaIngresoId: normalize(ramaIngresoId),
      subsegmentoRamaId: normalize(subsegmentoRamaId),
    };

    return (
      current.nombre !== initialSnapshot.nombre ||
      current.ramaGastoId !== initialSnapshot.ramaGastoId ||
      current.segmentoGastoId !== initialSnapshot.segmentoGastoId ||
      current.ramaIngresoId !== initialSnapshot.ramaIngresoId ||
      current.subsegmentoRamaId !== initialSnapshot.subsegmentoRamaId
    );
  }, [
    isProveedor,
    nombre,
    ramaId,
    ramaBloqueada,
    subsegmentoId,
    localidad,
    comunidad,
    pais,
    cif,
    telefono,
    email,
    direccion,
    codigoPostal,
    personaContacto,
    observaciones,
    ambitoServicio,
    aceptaUrgencias,
    activo,
    creatingLocalidad,
    creatingRegion,
    creatingPais,
    newLocalidadText,
    newRegionText,
    newPaisText,
    ramaGastoId,
    segmentoGastoId,
    ramaIngresoId,
    subsegmentoRamaId,
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
      : auxType === 'tipo_ramas_proveedores'
      ? isEditMode
        ? 'Editar rama de proveedor'
        : 'Nueva rama de proveedor'
      : auxType === 'tipo_subsegmento_proveedor'
      ? isEditMode
        ? 'Editar subsegmento de proveedor'
        : 'Nuevo subsegmento de proveedor'
      : isEditMode
      ? 'Editar registro'
      : 'Nuevo registro';

  const selectedRama = useMemo(() => {
    if (!ramaId) return null;
    const found = ramaOptions.find((r) => r.id === ramaId);
    if (found) return found;
    if (ramaNombre) return ({ id: ramaId, nombre: ramaNombre } as any);
    return null;
  }, [ramaId, ramaNombre, ramaOptions]);

  const selectedSubsegmento = useMemo(() => {
    if (!subsegmentoId) return null;
    return subsegmentoOptions.find((s) => s.id === subsegmentoId) ?? null;
  }, [subsegmentoId, subsegmentoOptions]);

  const selectedRamaIngreso = useMemo(() => {
    if (!ramaIngresoId) return null;
    return ramasIngreso.find((r) => r.id === ramaIngresoId) ?? null;
  }, [ramaIngresoId, ramasIngreso]);

  const selectedSubsegmentoRama = useMemo(() => {
    if (!subsegmentoRamaId) return null;
    return subsegmentoRamasProveedor.find((r) => r.id === subsegmentoRamaId) ?? null;
  }, [subsegmentoRamaId, subsegmentoRamasProveedor]);

  return (
    <FormScreen
      title={title}
      onBackPress={handleBackPress}
      loading={false}
      footer={
        <View style={styles.bottomActions}>
          {hasRelationsInfo ? (
            <TouchableOpacity
              style={ui.relationsButton}
              onPress={() => setShowRelations((prev) => !prev)}
            >
              <Ionicons
                name={showRelations ? 'layers' : 'layers-outline'}
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 8 }}
              />
              <Text style={ui.relationsButtonText}>
                {showRelations ? 'Ocultar relaciones' : `Relaciones (${associatedCount})`}
              </Text>
            </TouchableOpacity>
          ) : null}

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
      {!isProveedor ? (
        <>
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

          <FormSection
            title={
              isTipoGasto
                ? 'Configuración tipo de gasto'
                : isTipoIngreso
                ? 'Configuración tipo de ingreso'
                : isSubsegmentoProveedor
                ? 'Configuración subsegmento de proveedor'
                : isTipoRamaProveedor
                ? 'Configuración rama de proveedor'
                : 'Configuración'
            }
          >
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
                    onChangeQuery={setBusquedaRamaGasto}
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
                    onChangeQuery={setBusquedaSegmentoGasto}
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
                  onChangeQuery={setBusquedaRamaIngreso}
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
                  label="Rama de proveedor (opcional)"
                  onAddPress={NOOP}
                  addAccessibilityLabel="Añadir (no aplica)"
                  disabled={false}
                  selected={selectedSubsegmentoRama}
                  selectedLabel={(x) => x.nombre}
                  onClear={() => setSubsegmentoRamaId(null)}
                  query={busquedaSubsegmentoRama}
                  onChangeQuery={setBusquedaSubsegmentoRama}
                  placeholder="Escribe para buscar rama de proveedor"
                  options={subsegmentoRamasFiltradas}
                  optionKey={(x) => x.id}
                  optionLabel={(x) => x.nombre}
                  onSelect={(x) => {
                    setSubsegmentoRamaId(x.id);
                    setBusquedaSubsegmentoRama('');
                  }}
                  emptyText="No hay ramas de proveedor que coincidan con la búsqueda."
                />
              </View>
            ) : (
              <Text style={styles.helperText}>Completa el nombre y guarda.</Text>
            )}
          </FormSection>
        </>
      ) : (
        <>
          <FormSection title="Datos básicos">
            <View style={styles.field}>
              <Text style={styles.label}>Nombre</Text>
              <TextInput
                style={[styles.input, nombre.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Nombre..."
                value={nombre}
                onChangeText={setNombre}
              />
            </View>

            <View style={styles.field}>
              <InlineSearchSelect<RamaProveedor>
                label="Rama proveedor"
                onAddPress={handleNuevaRamaProveedor}
                addAccessibilityLabel="Crear rama proveedor"
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
                  setSubsegmentoId(null);
                  setBusquedaRamaProveedor('');
                }}
                emptyText="No hay ramas que coincidan con la búsqueda."
              />

              {loadingRamas ? <Text style={styles.helperText}>Cargando ramas...</Text> : null}
            </View>

            <View style={styles.field}>
              <InlineSearchSelect<TipoSubsegmentoProveedorItem>
                label="Subsegmento proveedor"
                onAddPress={handleNuevoSubsegmentoProveedor}
                addAccessibilityLabel="Crear subsegmento proveedor"
                disabled={!ramaId}
                selected={selectedSubsegmento}
                selectedLabel={(x) => x.nombre}
                onClear={clearSubsegmento}
                query={busquedaSubsegmento}
                onChangeQuery={(v) => {
                  setBusquedaSubsegmento(v);
                  void ensureSubsegmentosProveedorLoaded(ramaId ?? null);
                }}
                placeholder={ramaId ? 'Escribe para buscar subsegmento' : 'Selecciona antes una rama'}
                options={subsegmentosProveedorFiltrados}
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
              <Text style={styles.label}>Persona de contacto (opcional)</Text>
              <TextInput
                style={[styles.input, personaContacto.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Nombre de contacto..."
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

                  <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: 10 }}>
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
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Dirección (opcional)</Text>
              <TextInput
                style={[styles.input, direccion.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Dirección..."
                value={direccion}
                onChangeText={setDireccion}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Código postal (opcional)</Text>
              <TextInput
                style={[styles.input, codigoPostal.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. 28001"
                value={codigoPostal}
                onChangeText={setCodigoPostal}
                keyboardType="number-pad"
              />
            </View>
          </FormSection>

          <FormSection title="Contacto y fiscal">
            <View style={styles.field}>
              <Text style={styles.label}>CIF (opcional)</Text>
              <TextInput
                style={[styles.input, cif.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. B12345678"
                value={cif}
                onChangeText={setCif}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Teléfono (opcional)</Text>
              <TextInput
                style={[styles.input, telefono.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. 600123123"
                value={telefono}
                onChangeText={setTelefono}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email (opcional)</Text>
              <TextInput
                style={[styles.input, email.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. contacto@proveedor.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </FormSection>

          <FormSection title="Operativa">
            <View style={ui.inlineFieldsRow}>
              <View style={[styles.field, ui.inlineFieldHalf]}>
                <Text style={styles.label}>Activo</Text>
                <View style={ui.booleanRow}>
                  <View style={ui.booleanItem}>
                    <PillButton
                      label="Sí"
                      selected={activo === true}
                      onPress={() => setActivo(true)}
                      size="sm"
                    />
                  </View>
                  <View style={ui.booleanItem}>
                    <PillButton
                      label="No"
                      selected={activo === false}
                      onPress={() => setActivo(false)}
                      size="sm"
                    />
                  </View>
                </View>
              </View>

              <View style={[styles.field, ui.inlineFieldHalf]}>
                <Text style={styles.label}>Acepta urgencias</Text>
                <View style={ui.booleanRow}>
                  <View style={ui.booleanItem}>
                    <PillButton
                      label="Sí"
                      selected={aceptaUrgencias === true}
                      onPress={() => setAceptaUrgencias(true)}
                      size="sm"
                    />
                  </View>
                  <View style={ui.booleanItem}>
                    <PillButton
                      label="No"
                      selected={aceptaUrgencias === false}
                      onPress={() => setAceptaUrgencias(false)}
                      size="sm"
                    />
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Ámbito de servicio (opcional)</Text>
              <TextInput
                style={[styles.input, ambitoServicio.trim() !== '' ? styles.inputFilled : null]}
                placeholder="Ej. MADRID CAPITAL"
                value={ambitoServicio}
                onChangeText={setAmbitoServicio}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Observaciones (opcional)</Text>
              <TextInput
                style={[
                  styles.input,
                  ui.inputMultiline,
                  observaciones.trim() !== '' ? styles.inputFilled : null,
                ]}
                placeholder="Notas internas..."
                value={observaciones}
                onChangeText={setObservaciones}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </FormSection>
        </>
      )}

      {hasRelationsInfo && showRelations ? (
        <FormSection title={`Relaciones (${associatedCount} registros)`}>
          {relationItems.length > 0 ? (
            relationItems.map((rel) => (
              <View key={rel.key} style={ui.relationRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.relationLabel}>{rel.label}</Text>
                  <Text style={ui.relationKey}>{rel.key}</Text>
                </View>

                <View style={ui.relationCountBadge}>
                  <Text style={ui.relationCountText}>{rel.count}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.helperText}>No hay detalle de relaciones disponible.</Text>
          )}
        </FormSection>
      ) : null}
    </FormScreen>
  );
};

export default AuxEntityFormScreen;

const ui = StyleSheet.create({
  inputMultiline: {
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
  },
  inlineFieldsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  inlineFieldHalf: {
    flex: 1,
  },
  booleanRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  booleanItem: {
    minWidth: 72,
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
  relationsButton: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface ?? '#FFFFFF',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  relationsButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  relationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  relationLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  relationKey: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  relationCountBadge: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relationCountText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
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
});