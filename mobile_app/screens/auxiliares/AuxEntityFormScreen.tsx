/**
 * Archivo: mobile_app/screens/auxiliares/AuxEntityFormScreen.tsx
 *
 * Objetivo:
 *   - Que Rama proveedor, Localidad, Comunidad/Región y País usen el MISMO patrón de desplegable
 *     que "Proveedor" en GastoCotidiano/Gestionable: InlineSearchSelect.
 *
 * Nota técnica (por tus errores TS):
 *   - InlineSearchSelect requiere onAddPress y onClear OBLIGATORIOS.
 *   - Por tanto, SIEMPRE pasamos:
 *       - onAddPress: no-op cuando no aplique
 *       - onClear: no-op cuando esté bloqueado (ramaBloqueada), o clear real cuando aplique
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';

import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { SelectedInlineValue } from '../../components/ui/SelectedInlineValue';

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

import { createAux, updateAux, deleteAux, listAux, AuxEntity } from '../../services/auxiliaresApi';

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

type PaisOption = { id: number; nombre: string };

type SimpleAuxItem = { id: string; nombre: string; [k: string]: any };

const NOOP = () => {};

export const AuxEntityFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const auxType: string = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const editingProveedor: Proveedor | undefined = route?.params?.editingProveedor;
  const editingItem: SimpleAuxItem | undefined = route?.params?.editingItem;

  const isProveedor = auxType === 'proveedor';
  const isTipoGasto = auxType === 'tipo_gasto';

  const isEditMode = !!(editingProveedor || editingItem);

  // Compat legacy
  const returnTo: string | undefined = route?.params?.returnTo;
  const returnKey: string | undefined = route?.params?.returnKey;

  // Preferente: route.key del origin screen (robusto)
  const returnRouteKey: string | undefined = route?.params?.returnRouteKey;

  // ---- Estado común ----
  const [nombre, setNombre] = useState('');

  // =========================
  // AUX (NO proveedor)
  // =========================
  const [ramaGastoId, setRamaGastoId] = useState<string | null>(null);
  const [segmentoGastoId, setSegmentoGastoId] = useState<string | null>(
    route?.params?.defaultSegmentoId ?? null
  );

  const [ramasGasto, setRamasGasto] = useState<Array<{ id: string; nombre: string }>>([]);
  const [segmentosGasto, setSegmentosGasto] = useState<Array<{ id: string; nombre: string }>>([]);

  const [busquedaRamaGasto, setBusquedaRamaGasto] = useState('');
  const [busquedaSegmentoGasto, setBusquedaSegmentoGasto] = useState('');

  // =========================
  // PROVEEDOR
  // =========================
  const [ramaId, setRamaId] = useState<string | null>(route?.params?.defaultRamaId ?? null);
  const [ramaNombre, setRamaNombre] = useState<string | null>(null);

  const [localidad, setLocalidad] = useState('');
  const [comunidad, setComunidad] = useState('');
  const [pais, setPais] = useState('');
  const [localidadId, setLocalidadId] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [paisId, setPaisId] = useState<number | null>(null);

  // Fallback inline
  const [creatingLocalidad, setCreatingLocalidad] = useState(false);
  const [creatingRegion, setCreatingRegion] = useState(false);
  const [creatingPais, setCreatingPais] = useState(false);

  const [newLocalidadText, setNewLocalidadText] = useState('');
  const [newRegionText, setNewRegionText] = useState('');
  const [newPaisText, setNewPaisText] = useState('');

  // Catálogos
  const [ramaOptions, setRamaOptions] = useState<RamaProveedor[]>([]);
  const [localidadOptions, setLocalidadOptions] = useState<LocalidadWithContext[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);

  const [loadingRamas, setLoadingRamas] = useState(false);
  const [loadingLocalidades, setLoadingLocalidades] = useState(false);
  const [loadingRegiones, setLoadingRegiones] = useState(false);
  const [loadingPaises, setLoadingPaises] = useState(false);

  const [busquedaRamaProveedor, setBusquedaRamaProveedor] = useState('');
  const [busquedaLocalidad, setBusquedaLocalidad] = useState('');
  const [busquedaRegion, setBusquedaRegion] = useState('');
  const [busquedaPais, setBusquedaPais] = useState('');

  const ramaBloqueada = origin === 'cotidianos' && !!ramaId;

  // =============================================================================
  // SEND RESULT (robusto)
  // =============================================================================
  const findOwningNavigatorByRouteKey = (nav: any, targetRouteKey: string) => {
    let current = nav;
    while (current) {
      try {
        const state = current.getState?.();
        const routes = state?.routes ?? [];
        const found = routes.some((r: any) => r?.key === targetRouteKey);
        if (found) return current;
      } catch {
        // ignore
      }
      current = current.getParent?.() ?? null;
    }
    return null;
  };

  const sendResult = (result: { type: string; item: any; key?: string | null; mode: 'created' | 'updated' }) => {
    const auxResult = {
      type: result.type,
      item: result.item,
      key: result.key ?? null,
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
        } catch {
          // fallback
        }
      }
    }

    if (returnTo) {
      try {
        const parent = navigation.getParent?.();
        const nav = parent ?? navigation;
        nav.navigate({ name: returnTo, params: { auxResult }, merge: true });
      } catch {
        // ignore
      }
    }
  };

  const sendResultAndClose = (result: { type: string; item: any; key?: string | null; mode: 'created' | 'updated' }) => {
    sendResult(result);
    if (navigation.canGoBack?.()) navigation.goBack();
  };

  // =============================================================================
  // Integrar retorno desde LocalidadFormScreen
  // =============================================================================
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
    }
  }, [route?.params?.auxResult, isProveedor, navigation]);

  // =========================
  // Inicializar en edición
  // =========================
  useEffect(() => {
    if (!isProveedor) return;
    if (isEditMode && editingProveedor) {
      setNombre(editingProveedor.nombre ?? '');
      setRamaId(editingProveedor.rama_id ?? null);
      setRamaNombre(editingProveedor.rama_rel?.nombre ?? null);

      setLocalidad(editingProveedor.localidad ?? '');
      setComunidad(editingProveedor.comunidad ?? '');
      setPais(editingProveedor.pais ?? '');
      setLocalidadId(editingProveedor.localidad_id ?? null);

      const locRel = editingProveedor.localidad_rel;
      if (locRel) {
        setRegionId(locRel.region?.id ?? null);
        setPaisId(locRel.region?.pais?.id ?? null);
      }
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
  }, [isProveedor, editingItem, isTipoGasto]);

  // =========================
  // Cargar catálogos para tipo_gasto
  // =========================
  useEffect(() => {
    const loadCatalogs = async () => {
      if (!isTipoGasto) return;

      try {
        const [rg, sg] = await Promise.all([
          listAux<{ id: string; nombre: string }>('tipo_ramas_gasto'),
          listAux<{ id: string; nombre: string }>('tipo_segmento_gasto'),
        ]);

        setRamasGasto(rg ?? []);
        setSegmentosGasto(sg ?? []);
      } catch (e) {
        console.error('[AuxEntityForm] Error cargando ramas/segmentos gasto', e);
        Alert.alert('Error', 'No se han podido cargar ramas/segmentos de gasto.');
      }
    };

    void loadCatalogs();
  }, [isTipoGasto]);

  // =========================
  // Precargar ramas proveedor para que el listado aparezca al abrir el selector
  // =========================
  useEffect(() => {
    if (!isProveedor) return;
    void ensureRamasProveedorLoaded();
  }, [isProveedor]);


  // =========================
  // Cargas catálogo proveedor/ubicaciones
  // =========================
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
        if (p && !paisMap.has(p.id)) paisMap.set(p.id, { id: p.id, nombre: p.nombre });
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

  // =========================
  // Filtrados (InlineSearchSelect)
  // =========================
  const ramasProveedorFiltradas = useMemo(() => {
    const term = busquedaRamaProveedor.trim().toLowerCase();
    if (!term) return ramaOptions.slice(0, 50); // top 50 sin búsqueda
    return ramaOptions.filter((r) => (r.nombre ?? '').toLowerCase().includes(term)).slice(0, 50);
  }, [ramaOptions, busquedaRamaProveedor]);

  const localidadesFiltradas = useMemo(() => {
    const term = busquedaLocalidad.trim().toLowerCase();
    if (!term) return localidadOptions;
    return localidadOptions.filter((l) => (l.nombre ?? '').toLowerCase().includes(term));
  }, [localidadOptions, busquedaLocalidad]);

  const regionesFiltradas = useMemo(() => {
    const term = busquedaRegion.trim().toLowerCase();
    const base = !term ? regionOptions : regionOptions.filter((r) => r.nombre.toLowerCase().includes(term));
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

  // =========================
  // Clears / selects
  // =========================
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

  // =========================
  // Creación real en BBDD (fallback inline)
  // =========================
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

  // =========================
  // Guardar (switch proveedor / genérico)
  // =========================
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
        payload = { nombre: nombreFinal, rama_id: ramaGastoId, segmento_id: segmentoGastoId };
      }

      let result: any;
      if (isEditMode && editingItem?.id) {
        result = await updateAux(entity, editingItem.id, payload);
        sendResultAndClose({ type: auxType, item: result, key: returnKey ?? null, mode: 'updated' });
        return;
      }

      result = await createAux(entity, payload);
      sendResultAndClose({ type: auxType, item: result, key: returnKey ?? null, mode: 'created' });
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      if (status === 400 && typeof detail === 'string') {
        Alert.alert('No se ha podido guardar', detail);
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

    try {
      const hasLocalidadText = (creatingLocalidad ? newLocalidadText : localidad).trim().length > 0;
      const finalLocalidadId = hasLocalidadText ? await ensureLocalidadCreatedIfNeeded() : null;

      const payloadCommon = {
        nombre: nombreFinal,
        rama_id: ramaId ?? undefined,
        localidad_id: finalLocalidadId ?? undefined,
        localidad: (localidad || null) as string | null,
        comunidad: (comunidad || null) as string | null,
        pais: (pais || null) as string | null,
      };

      if (isEditMode && editingProveedor) {
        const actualizado = await updateProveedor(editingProveedor.id, payloadCommon as any);
        sendResultAndClose({ type: auxType, item: actualizado, key: returnKey ?? null, mode: 'updated' });
        return;
      }

      const creado = await createProveedorFromAuxForm({
        nombre: nombreFinal,
        ramaId,
        localidadId: finalLocalidadId,
        localidadTexto: payloadCommon.localidad,
        comunidadTexto: payloadCommon.comunidad,
        paisTexto: payloadCommon.pais,
      });

      sendResultAndClose({ type: auxType, item: creado, key: returnKey ?? null, mode: 'created' });
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      console.error('[AuxEntityForm] Error al guardar', { status, data: err?.response?.data });

      if (status === 400 && typeof detail === 'string') {
        Alert.alert('No se ha podido guardar', detail);
        return;
      }

      Alert.alert('Error', 'No se ha podido guardar el registro.');
    }
  };

  // =========================
  // Eliminar
  // =========================
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

  const title =
    auxType === 'proveedor'
      ? isEditMode
        ? 'Editar proveedor'
        : 'Nuevo proveedor'
      : isTipoGasto
      ? isEditMode
        ? 'Editar tipo de gasto'
        : 'Nuevo tipo de gasto'
      : isEditMode
      ? 'Editar registro'
      : 'Nuevo registro';

  // =============================================================================
  // RENDER
  // =============================================================================
  return (
    <FormScreen
      title={title}
      onBackPress={() => navigation.goBack()}
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
        <FormSection title={isTipoGasto ? 'Configuración tipo de gasto' : 'Configuración'}>
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
                  selected={segmentoGastoId ? segmentosGasto.find((x) => x.id === segmentoGastoId) ?? null : null}
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
                selected={ramaId && ramaNombre ? ({ id: ramaId, nombre: ramaNombre } as any) : null}
                selectedLabel={(r) => r.nombre}
                onClear={ramaBloqueada ? NOOP : clearRama}
                query={busquedaRamaProveedor}
                onChangeQuery={(v) => {
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
                    ? ({ id: regionId, nombre: comunidad, paisId: paisId ?? null, paisNombre: pais || null } as any)
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
                    Para crear una región necesitas indicar un país (abajo).
                  </Text>

                  <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: 10 }}>
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

                  <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: 10 }}>
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

            <Text style={styles.helperText}>
              Nota: si creas localidad/región/país desde aquí, se guardará en el catálogo y quedará disponible para otros formularios.
            </Text>
          </FormSection>
        </>
      )}
    </FormScreen>
  );
};

export default AuxEntityFormScreen;

const ui = StyleSheet.create({
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
});
