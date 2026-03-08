/**
 * Archivo: mobile_app/screens/ingresos/IngresoFormScreen.tsx
 *
 * Flujo funcional v3:
 * - Primero se selecciona la rama de ingreso.
 * - Después se muestran solo los tipos asociados a esa rama.
 *
 * Ajustes aplicados:
 * 1) UX inmediata al seleccionar rama:
 *    - Se precargan los tipos por rama en segundo plano.
 *    - Si la rama ya está en caché, los tipos aparecen al instante.
 *
 * 2) Viviendas:
 *    - La sección de vivienda se habilita por RAMA (VIVIENDAS),
 *      no por tipo de ingreso.
 *
 * 3) Mantiene toda la lógica actual:
 *    - retorno desde AuxEntityForm
 *    - edición / duplicado / readonly
 *    - protección anti-reset
 *    - create/update
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { commonFormStyles } from '../../components/forms/formStyles';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { InlineAddButton } from '../../components/ui/InlineAddButton';
import { FormDateButton } from '../../components/ui/FormDateButton';

import { colors } from '../../theme';
import { PERIODICIDADES } from '../../constants/finance';
import { RANGOS_PAGO } from '../../constants/general';

import { fetchCuentas, fetchViviendas } from '../../services/utilsApi';
import {
  createIngreso,
  updateIngreso,
  fetchRamasIngreso,
  fetchTiposIngresoPorRama,
  preloadTiposIngresoPorRamas,
  getTiposIngresoPorRamaCache,
  type RamaIngreso,
  type TipoIngresoPorRama,
} from '../../services/ingresosApi';

import {
  EuroformatEuro,
  parseImporte,
  appendMonthYearSuffix,
  formatFechaCorta,
} from '../../utils/format';
import { useResetFormOnFocus } from '../../utils/formsUtils';

// ---- Tipos locales ----
type IngresoMode = 'gestionable' | 'extraordinario';

type TipoIngreso = { id: string; nombre: string; rama_id?: string | null };

type Cuenta = {
  id: string;
  nombre?: string;
  anagrama?: string;
  liquidez?: number | null;
};

type Vivienda = {
  id: string;
  referencia?: string;
  direccion_completa?: string;
};

type Props = {
  navigation: any;
  route: {
    key?: string;
    params?: {
      mode?: IngresoMode;
      ingreso?: any;
      readOnly?: boolean;
      duplicate?: boolean;

      returnToTab?: string;
      returnToScreen?: string;
      returnToParams?: any;

      fromHome?: boolean;
      fromDiaADia?: boolean;

      auxResult?: any;
    };
  };
};

// ===== Debug =====
const DEBUG_AUX = false;

// Return keys “canónicos”
const RETURN_KEY_RAMA_INGRESO = 'ingresos-rama_ingreso';
const RETURN_KEY_TIPO_INGRESO = 'ingresos-tipo_ingreso';

// ---- Helpers ----
function safeJson(obj: any) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function toApiDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateString(value: string | null | undefined): Date {
  if (!value) return new Date();

  const isoParts = value.split('-');
  if (isoParts.length === 3) {
    const [y, m, d] = isoParts;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day);
    }
  }

  const esParts = value.split('/');
  if (esParts.length === 3) {
    const [d, m, y] = esParts;
    const day = Number(d);
    const month = Number(m) - 1;
    const year = Number(y);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day);
    }
  }

  return new Date();
}

function formatDateDisplay(value: string): string {
  const isoParts = value.split('-');
  if (isoParts.length === 3) {
    const [y, m, d] = isoParts;
    return `${d}/${m}/${y}`;
  }
  return value;
}

function getRangoFromDateString(dateStr: string): string {
  const d = parseDateString(dateStr);
  const day = d.getDate();

  if (day >= 1 && day <= 3) return '1-3';
  if (day <= 7) return '4-7';
  if (day <= 11) return '8-11';
  if (day <= 15) return '12-15';
  if (day <= 19) return '16-19';
  if (day <= 23) return '20-23';
  if (day <= 27) return '24-27';
  return '28-31';
}

function normalizePagoUnico(value: string): string {
  const v = (value || '').trim().toUpperCase();
  if (v === 'PAGO UNICO') return 'PAGO UNICO';
  return value;
}

function normalizeTipoIngreso(raw: any): TipoIngreso {
  return {
    id: String(raw?.id ?? ''),
    nombre: String(raw?.nombre ?? ''),
    rama_id: raw?.rama_id != null ? String(raw.rama_id) : null,
  };
}

function normalizeRamaIngreso(raw: any): RamaIngreso {
  return {
    id: String(raw?.id ?? ''),
    nombre: String(raw?.nombre ?? ''),
  };
}

function extractAuxItem(res: any): any | null {
  if (!res) return null;
  if (res.item) return res.item;
  if (res.data) return res.data;
  if (res.created) return res.created;
  if (res.result) return res.result;
  if (res.payload) return res.payload;
  if (res.id != null && res.nombre != null) return res;
  return null;
}

function isAuxTipoIngreso(res: any): boolean {
  if (!res) return false;

  const rk = String(res.returnKey ?? '').trim();
  const k = String(res.key ?? '').trim();
  if (rk === RETURN_KEY_TIPO_INGRESO || k === RETURN_KEY_TIPO_INGRESO) return true;

  const typeRaw = String(res.type ?? res.auxType ?? '').trim().toLowerCase();
  if (typeRaw === 'tipo_ingreso' || typeRaw === 'tipoingreso' || typeRaw === 'tipo-ingreso') return true;

  return false;
}

function isAuxRamaIngreso(res: any): boolean {
  if (!res) return false;

  const rk = String(res.returnKey ?? '').trim();
  const k = String(res.key ?? '').trim();
  if (rk === RETURN_KEY_RAMA_INGRESO || k === RETURN_KEY_RAMA_INGRESO) return true;

  const typeRaw = String(res.type ?? res.auxType ?? '').trim().toLowerCase();
  return (
    typeRaw === 'tipo_ramas_ingreso' ||
    typeRaw === 'tiporamasingreso' ||
    typeRaw === 'tipo-rama-ingreso' ||
    typeRaw === 'rama_ingreso'
  );
}

// ---- Componente ----
const IngresoFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const mode: IngresoMode = route?.params?.mode ?? 'gestionable';
  const duplicate: boolean = route?.params?.duplicate === true;

  const ingresoSource = route?.params?.ingreso ?? null;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const isEdit = !!ingresoSource && !duplicate;
  const ingresoAny = ingresoSource as any;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const fromHome: boolean = route?.params?.fromHome === true;
  const fromDiaADia: boolean = route?.params?.fromDiaADia === true;

  // Catálogos
  const [ramas, setRamas] = useState<RamaIngreso[]>([]);
  const [tipos, setTipos] = useState<TipoIngreso[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  // Form state
  const [concepto, setConcepto] = useState<string>(ingresoSource?.concepto ?? '');

  const [ramaIdState, _setRamaId] = useState<string | null>(
    ingresoSource?.rama_id != null ? String(ingresoSource.rama_id) : null
  );

  const setRamaId = useCallback((v: string | null, reason: string) => {
    if (DEBUG_AUX) console.log('[IngresoForm][STATE] setRamaId ->', v, 'reason=', reason);
    _setRamaId(v != null ? String(v) : null);
  }, []);

  const ramaId = ramaIdState;

  const [tipoIdState, _setTipoId] = useState<string | null>(
    ingresoSource?.tipo_id != null ? String(ingresoSource.tipo_id) : null
  );

  const setTipoId = useCallback((v: string | null, reason: string) => {
    if (DEBUG_AUX) console.log('[IngresoForm][STATE] setTipoId ->', v, 'reason=', reason);
    _setTipoId(v != null ? String(v) : null);
  }, []);

  const tipoId = tipoIdState;

  const [cuentaId, setCuentaId] = useState<string | null>(ingresoSource?.cuenta_id ?? null);
  const [viviendaId, setViviendaId] = useState<string | null>(
    ingresoSource?.referencia_vivienda_id ?? null
  );

  const [importe, setImporte] = useState<string>(
    ingresoSource?.importe != null ? String(ingresoSource.importe) : ''
  );

  const [fechaInicio, setFechaInicio] = useState<string>(() => {
    if (ingresoSource?.fecha_inicio) return ingresoSource.fecha_inicio;
    return toApiDate(new Date());
  });

  const [showDatePicker, setShowDatePicker] = useState(false);

  const [rangoCobro, setRangoCobro] = useState<string>(() => {
    if (ingresoSource?.rango_cobro) return ingresoSource.rango_cobro;
    return getRangoFromDateString(ingresoSource?.fecha_inicio ?? toApiDate(new Date()));
  });

  const [periodicidad, setPeriodicidad] = useState<string>(() => {
    if (ingresoSource?.periodicidad) return ingresoSource.periodicidad;
    return mode === 'extraordinario' ? 'PAGO UNICO' : 'MENSUAL';
  });

  const [activo, setActivo] = useState<boolean>(
    ingresoSource?.activo ?? mode === 'gestionable'
  );
  const [cobrado, setCobrado] = useState<boolean>(ingresoSource?.cobrado ?? false);
  const [kpi, setKpi] = useState<boolean>(ingresoSource?.kpi ?? mode === 'gestionable');

  // Metadatos
  const createOn: string | null = ingresoAny?.createon ?? null;
  const modifiedOn: string | null = ingresoAny?.modifiedon ?? null;
  const inactivatedOn: string | null = ingresoAny?.inactivatedon ?? null;
  const ultimoIngresoOn: string | null = ingresoAny?.ultimo_ingreso_on ?? null;
  const userName: string | null =
    ingresoAny?.user_nombre ?? ingresoAny?.userName ?? ingresoAny?.user_id ?? null;

  // Avanzadas solo edición
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Flags
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Anti-carrera
  const pendingRamaIdRef = useRef<string | null>(null);
  const pendingTipoIdRef = useRef<string | null>(null);
  const skipNextResetRef = useRef<boolean>(false);

  const navigateBack = useCallback(() => {
    if (returnToTab) {
      if (returnToScreen) {
        navigation.navigate(returnToTab, {
          screen: returnToScreen,
          params: returnToParams,
        });
      } else {
        navigation.navigate(returnToTab);
      }
      return;
    }
    if (fromHome) {
      navigation.navigate('HomeTab');
      return;
    }
    void fromDiaADia;
    navigation.goBack();
  }, [navigation, returnToTab, returnToScreen, returnToParams, fromHome, fromDiaADia]);

  const resetFormToNew = useCallback(() => {
    const hoy = toApiDate(new Date());

    setConcepto('');
    setRamaId(null, 'resetFormToNew');
    setTipoId(null, 'resetFormToNew');

    setCuentaId(null);
    setViviendaId(null);

    setImporte('');

    setFechaInicio(hoy);
    setShowDatePicker(false);
    setRangoCobro(getRangoFromDateString(hoy));

    setPeriodicidad(mode === 'extraordinario' ? 'PAGO UNICO' : 'MENSUAL');

    setActivo(mode === 'gestionable');
    setCobrado(false);
    setKpi(mode === 'gestionable');

    setShowAdvanced(false);

    pendingRamaIdRef.current = null;
    pendingTipoIdRef.current = null;
    setTipos([]);
  }, [mode, setRamaId, setTipoId]);

  const safeResetOnFocus = useCallback(() => {
    if (skipNextResetRef.current) {
      if (DEBUG_AUX) console.log('[IngresoForm][RESET] skip reset: skipNextResetRef=true');
      skipNextResetRef.current = false;
      return;
    }

    const res = route?.params?.auxResult;
    if (res) {
      if (DEBUG_AUX) console.log('[IngresoForm][RESET] skip reset: auxResult exists');
      return;
    }

    if (DEBUG_AUX) console.log('[IngresoForm][RESET] reset (no auxResult and no skip token)');
    resetFormToNew();
  }, [route?.params?.auxResult, resetFormToNew]);

  useResetFormOnFocus({
    readOnly,
    isEdit: isEdit || duplicate,
    auxResult: route?.params?.auxResult,
    onReset: safeResetOnFocus,
  });

  useEffect(() => {
    if (!duplicate || !ingresoSource) return;

    const now = new Date();
    const hoy = toApiDate(now);

    setConcepto(appendMonthYearSuffix(ingresoSource.concepto ?? '', now));
    setFechaInicio(hoy);
    setRangoCobro(getRangoFromDateString(hoy));

    const per = normalizePagoUnico(ingresoSource.periodicidad ?? '');
    if (per === 'PAGO UNICO') {
      setCobrado(true);
      setActivo(false);
      setKpi(false);
    }
  }, [duplicate, ingresoSource]);

  /**
   * Carga tipos de una rama.
   * - Si useCacheFirst=true y ya existe en caché, los pinta al instante.
   * - Si no existe, consulta backend y actualiza el estado.
   */
  const loadTiposForRama = useCallback(
    async (
      targetRamaId: string | null,
      options?: {
        preserveTipoId?: string | null;
        useCacheFirst?: boolean;
        forceRefresh?: boolean;
      }
    ) => {
      if (!targetRamaId) {
        setTipos([]);
        return;
      }

      const preserveTipoId = options?.preserveTipoId ?? null;
      const useCacheFirst = options?.useCacheFirst !== false;
      const forceRefresh = options?.forceRefresh === true;

      try {
        if (useCacheFirst) {
          const cached = getTiposIngresoPorRamaCache(targetRamaId);
          if (cached) {
            const tiposNorm = cached.map((t) => normalizeTipoIngreso(t));
            setTipos(tiposNorm);

            if (preserveTipoId) {
              const exists = tiposNorm.some((t) => String(t.id) === String(preserveTipoId));
              if (!exists) {
                setTipoId(null, 'loadTiposForRama-cache-preserveTipoNotFound');
              }
            }

            // Refresco silencioso opcional si se solicita
            if (!forceRefresh) return;
          }
        }

        const tiposRes = await fetchTiposIngresoPorRama(targetRamaId, { forceRefresh });
        const tiposNorm = (tiposRes ?? []).map((t: TipoIngresoPorRama) => normalizeTipoIngreso(t));
        setTipos(tiposNorm);

        if (preserveTipoId) {
          const exists = tiposNorm.some((t) => String(t.id) === String(preserveTipoId));
          if (!exists) {
            setTipoId(null, 'loadTiposForRama-api-preserveTipoNotFound');
          }
        }

        if (DEBUG_AUX) {
          console.log(
            '[IngresoForm][LOAD] tiposByRama=',
            tiposNorm.length,
            'ramaId=',
            targetRamaId,
            'tipoId=',
            tipoId
          );
        }
      } catch (err) {
        console.error('[IngresoForm] Error cargando tipos por rama', err);
        Alert.alert('Error', 'No se pudieron cargar los tipos de ingreso de esa rama.');
      }
    },
    [setTipoId, tipoId]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [ramasRes, cuentasRes, viviendasRes] = await Promise.all([
        fetchRamasIngreso(),
        fetchCuentas(),
        fetchViviendas(),
      ]);

      const ramasNorm = (ramasRes ?? []).map((r: any) => normalizeRamaIngreso(r));
      setRamas(ramasNorm);
      setCuentas(cuentasRes || []);
      setViviendas(viviendasRes || []);

      // ✅ Preload silencioso de tipos por todas las ramas para UX inmediata
      void preloadTiposIngresoPorRamas(ramasNorm.map((r) => r.id));

      const initialRamaId =
        pendingRamaIdRef.current ??
        (ramaId != null ? String(ramaId) : null) ??
        (ingresoSource?.rama_id != null ? String(ingresoSource.rama_id) : null);

      if (initialRamaId) {
        await loadTiposForRama(initialRamaId, {
          preserveTipoId: pendingTipoIdRef.current ?? tipoId ?? ingresoSource?.tipo_id ?? null,
          useCacheFirst: true,
        });
      } else {
        setTipos([]);
      }

      if (DEBUG_AUX) {
        console.log(
          '[IngresoForm][LOAD] ramas=',
          ramasNorm.length,
          'ramaId=',
          ramaId,
          'tipoId=',
          tipoId,
          'pendingRamaId=',
          pendingRamaIdRef.current,
          'pendingTipoId=',
          pendingTipoIdRef.current
        );
      }
    } catch (err) {
      console.error('[IngresoForm] Error cargando catálogos', err);
      Alert.alert('Error', 'No se pudieron cargar ramas, tipos, cuentas o viviendas. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ingresoSource?.rama_id, ingresoSource?.tipo_id, loadTiposForRama, ramaId, tipoId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  // aplica pending de rama cuando catálogo lo contiene
  useEffect(() => {
    const pending = pendingRamaIdRef.current;
    if (!pending) return;

    const exists = ramas.some((r) => String(r.id) === String(pending));
    if (!exists) {
      if (DEBUG_AUX) console.log('[IngresoForm][PENDING] pending rama not in ramas yet:', pending);
      return;
    }

    if (DEBUG_AUX) console.log('[IngresoForm][PENDING] applying pending ramaId=', pending);
    setRamaId(pending, 'applyPendingRamaAfterRamasLoaded');
    pendingRamaIdRef.current = null;
  }, [ramas, setRamaId]);

  // aplica pending de tipo cuando el catálogo ya lo contiene
  useEffect(() => {
    const pending = pendingTipoIdRef.current;
    if (!pending) return;

    const exists = tipos.some((t) => String(t.id) === String(pending));
    if (!exists) {
      if (DEBUG_AUX) console.log('[IngresoForm][PENDING] pending tipo not in tipos yet:', pending);
      return;
    }

    if (DEBUG_AUX) console.log('[IngresoForm][PENDING] applying pending tipoId=', pending);
    setTipoId(pending, 'applyPendingTipoAfterTiposLoaded');
    pendingTipoIdRef.current = null;
  }, [tipos, setTipoId]);

  // Retorno desde AuxEntityForm (rama ingreso / tipo ingreso)
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;

        if (DEBUG_AUX) {
          console.log('[IngresoForm][AUX] ------------------------------');
          console.log('[IngresoForm][AUX] raw=', safeJson(res ?? null));
        }

        if (!res) return;

        try {
          const isRama = isAuxRamaIngreso(res);
          const isTipo = isAuxTipoIngreso(res);

          if (DEBUG_AUX) {
            console.log('[IngresoForm][AUX] isAuxRamaIngreso=', isRama);
            console.log('[IngresoForm][AUX] isAuxTipoIngreso=', isTipo);
          }

          if (!isRama && !isTipo) return;

          const item = extractAuxItem(res);
          if (DEBUG_AUX) console.log('[IngresoForm][AUX] extracted item=', safeJson(item ?? null));

          if (!item?.id) return;

          skipNextResetRef.current = true;

          if (isRama) {
            const newRama = normalizeRamaIngreso(item);
            const newRamaId = String(newRama.id);

            pendingRamaIdRef.current = newRamaId;
            setRamaId(newRamaId, 'auxRamaImmediate');

            setRamas((prev) => {
              const map = new Map<string, RamaIngreso>();
              map.set(newRamaId, newRama);
              for (const r of prev) map.set(String(r.id), r);
              return Array.from(map.values());
            });

            setTipoId(null, 'auxRamaResetTipo');
            pendingTipoIdRef.current = null;

            await loadTiposForRama(newRamaId, { useCacheFirst: true, forceRefresh: true });
            if (!alive) return;

            return;
          }

          if (isTipo) {
            const newTipo = normalizeTipoIngreso(item);
            const newTipoId = String(newTipo.id);
            const newTipoRamaId = newTipo.rama_id != null ? String(newTipo.rama_id) : null;

            if (!newTipoRamaId) {
              console.warn(
                '[IngresoForm][AUX] El tipo creado no trae rama_id; no se puede preseleccionar correctamente.'
              );
              return;
            }

            pendingRamaIdRef.current = newTipoRamaId;
            pendingTipoIdRef.current = newTipoId;

            setRamaId(newTipoRamaId, 'auxTipoSetRama');
            setTipoId(newTipoId, 'auxTipoImmediate');

            await loadTiposForRama(newTipoRamaId, { useCacheFirst: true, forceRefresh: true });
            if (!alive) return;

            setTipos((prev) => {
              const map = new Map<string, TipoIngreso>();
              for (const t of prev) map.set(String(t.id), t);
              map.set(newTipoId, newTipo);
              return Array.from(map.values());
            });

            setTipoId(newTipoId, 'auxTipoAfterMerge');
          }
        } finally {
          navigation.setParams({ auxResult: undefined });
          if (DEBUG_AUX) console.log('[IngresoForm][AUX] cleared auxResult');
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation, loadTiposForRama, setRamaId, setTipoId])
  );

  // Confirmación al salir si dirty
  type Snapshot = {
    concepto: string;
    ramaId: string | null;
    tipoId: string | null;
    cuentaId: string | null;
    viviendaId: string | null;
    importe: string;
    fechaInicio: string;
    rangoCobro: string;
    periodicidad: string;
    activo: boolean;
    cobrado: boolean;
    kpi: boolean;
  };

  const getSnapshot = useCallback((): Snapshot => {
    return {
      concepto,
      ramaId,
      tipoId,
      cuentaId,
      viviendaId,
      importe,
      fechaInicio,
      rangoCobro,
      periodicidad,
      activo,
      cobrado,
      kpi,
    };
  }, [
    concepto,
    ramaId,
    tipoId,
    cuentaId,
    viviendaId,
    importe,
    fechaInicio,
    rangoCobro,
    periodicidad,
    activo,
    cobrado,
    kpi,
  ]);

  const baselineRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    if (loading) return;
    baselineRef.current = getSnapshot();
  }, [loading, getSnapshot]);

  const isDirty = useCallback(() => {
    if (readOnly) return false;
    const base = baselineRef.current;
    if (!base) return false;
    const now = getSnapshot();
    return JSON.stringify(base) !== JSON.stringify(now);
  }, [readOnly, getSnapshot]);

  useEffect(() => {
    if (readOnly) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty()) return;
      e.preventDefault();

      Alert.alert('Salir del formulario', 'Tienes cambios sin guardar. Si sales, se perderán.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: () => {
            resetFormToNew();
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });

    return unsubscribe;
  }, [navigation, readOnly, isDirty, resetFormToNew]);

  const handleBackPress = () => {
    if (!isDirty()) {
      navigateBack();
      return;
    }
    Alert.alert('Salir del formulario', 'Tienes cambios sin guardar. Si sales, se perderán.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: () => {
          resetFormToNew();
          navigateBack();
        },
      },
    ]);
  };

  // UI helpers
  const getCuentaLabel = (cta: Cuenta): string => cta.anagrama || cta.nombre || cta.id;
  const getViviendaLabel = (viv: Vivienda): string => viv.referencia || viv.id;

  const periodicidadesForMode = (): string[] => {
    if (mode === 'extraordinario') return ['PAGO UNICO'];
    return [...PERIODICIDADES];
  };

  const handleOpenDatePicker = () => {
    if (readOnly) return;
    setShowDatePicker(true);
  };

  const handleChangeFecha = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (!selectedDate) return;

    const apiDate = toApiDate(selectedDate);
    setFechaInicio(apiDate);
    setRangoCobro(getRangoFromDateString(apiDate));
  };

  const ramaSeleccionada = ramas.find((r) => String(r.id) === String(ramaId)) || null;
  const tipoSeleccionado = tipos.find((t) => String(t.id) === String(tipoId)) || null;

  // ✅ Regla corregida: la vivienda depende de la RAMA, no del tipo
  const isRamaViviendas = !!ramaSeleccionada && ramaSeleccionada.nombre.toUpperCase().includes('VIVIENDA');

  const handleSelectRama = async (newRamaId: string) => {
    if (readOnly) return;

    const normalizedNewRamaId = String(newRamaId ?? '');
    const sameRama = String(ramaId ?? '') === normalizedNewRamaId;
    if (sameRama) return;

    // 1) selección visual inmediata
    setRamaId(normalizedNewRamaId, 'manualRamaSelect');

    // 2) tipos inmediatos si ya están en caché
    const cached = getTiposIngresoPorRamaCache(normalizedNewRamaId);
    if (cached) {
      const tiposNorm = cached.map((t) => normalizeTipoIngreso(t));
      setTipos(tiposNorm);
    } else {
      setTipos([]);
    }

    // 3) limpiar selección dependiente
    setTipoId(null, 'manualRamaSelect-resetTipo');
    setViviendaId(null);
    pendingTipoIdRef.current = null;

    // 4) asegurar sincronización con backend/caché
    await loadTiposForRama(normalizedNewRamaId, {
      useCacheFirst: true,
    });
  };

  const handleAddRamaIngreso = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'tipo_ramas_ingreso',
      origin: 'ingresos',
      returnKey: RETURN_KEY_RAMA_INGRESO,
      returnRouteKey: route.key,
    });
  };

  const handleAddTipoIngreso = () => {
    if (readOnly) return;

    if (!ramaId) {
      Alert.alert('Campo obligatorio', 'Primero debes seleccionar una rama de ingreso.');
      return;
    }

    if (DEBUG_AUX) {
      console.log(
        '[IngresoForm][NAV] AuxEntityForm auxType=tipo_ingreso returnKey=',
        RETURN_KEY_TIPO_INGRESO,
        'returnRouteKey=',
        route.key,
        'defaultRamaId=',
        ramaId
      );
    }

    navigation.navigate('AuxEntityForm', {
      auxType: 'tipo_ingreso',
      origin: 'ingresos',
      returnKey: RETURN_KEY_TIPO_INGRESO,
      returnRouteKey: route.key,
      defaultRamaId: ramaId,
    });
  };

  const handleSave = async () => {
    if (readOnly) return;

    if (!concepto.trim()) {
      Alert.alert('Campo obligatorio', 'El nombre del ingreso es obligatorio.');
      return;
    }
    if (!ramaId) {
      Alert.alert('Campo obligatorio', 'Selecciona una rama de ingreso.');
      return;
    }
    if (!tipoId) {
      Alert.alert('Campo obligatorio', 'Selecciona un tipo de ingreso.');
      return;
    }
    if (!cuentaId) {
      Alert.alert('Campo obligatorio', 'Selecciona una cuenta de cargo.');
      return;
    }
    if (isRamaViviendas && !viviendaId) {
      Alert.alert('Campo obligatorio', 'Selecciona una vivienda para esta rama de ingreso.');
      return;
    }

    const importeNumber = parseImporte(importe);
    if (importeNumber == null || importeNumber <= 0) {
      Alert.alert('Importe inválido', 'El importe debe ser mayor que 0.');
      return;
    }

    const payload: any = {
      concepto: concepto.trim(),
      importe: importeNumber,
      periodicidad: normalizePagoUnico(periodicidad),
      rango_cobro: (rangoCobro ?? '').trim(),
      fecha_inicio: fechaInicio,
      rama_id: String(ramaId),
      tipo_id: String(tipoId),
      referencia_vivienda_id: isRamaViviendas ? viviendaId : null,
      cuenta_id: String(cuentaId),
      activo,
      cobrado,
      kpi,
    };

    setSaving(true);
    try {
      if (isEdit && ingresoSource?.id) {
        await updateIngreso(ingresoSource.id, payload);
        baselineRef.current = getSnapshot();
        Alert.alert('Ingreso actualizado', 'Los cambios se han guardado correctamente.', [
          { text: 'OK', onPress: navigateBack },
        ]);
      } else {
        await createIngreso(payload);
        baselineRef.current = getSnapshot();
        Alert.alert(
          'Ingreso creado',
          mode === 'extraordinario'
            ? 'Ingreso extraordinario creado correctamente.'
            : 'Ingreso gestionable creado correctamente.',
          [{ text: 'OK', onPress: navigateBack }]
        );
      }
    } catch (err) {
      console.error('[IngresoForm] Error guardando ingreso', err);
      Alert.alert('Error', 'No se pudo guardar el ingreso. Revisa los datos e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = useMemo(
    () => (mode === 'extraordinario' ? 'Ingreso extraordinario' : 'Ingreso gestionable'),
    [mode]
  );

  const headerSubtitle = useMemo(() => {
    if (readOnly) return 'Consulta';
    if (duplicate) return 'Duplicado';
    if (isEdit) return 'Edición';
    return 'Alta nueva';
  }, [readOnly, duplicate, isEdit]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.topArea}>
          <Header
            title={headerTitle}
            subtitle={headerSubtitle}
            showBack
            onBackPress={handleBackPress}
          />
        </View>
        <View style={stylesLocal.loader}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  const canShowAdvancedSection = !!ingresoSource && !duplicate;

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          showBack
          onBackPress={handleBackPress}
        />
      </View>

      <ScrollView
        style={styles.formArea}
        contentContainerStyle={styles.formContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <FormSection title="Datos básicos">
          <View style={styles.field}>
            <Text style={styles.label}>Nombre del ingreso</Text>
            <TextInput
              value={concepto}
              onChangeText={setConcepto}
              placeholder="Ej: NÓMINA EMPRESA X"
              style={[styles.input, concepto.trim() !== '' && styles.inputFilled]}
              editable={!readOnly}
            />
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Rama de ingreso</Text>

              <InlineAddButton
                onPress={handleAddRamaIngreso}
                disabled={readOnly}
                accessibilityLabel="Crear rama de ingreso"
              />
            </View>

            <View style={styles.segmentosRow}>
              {ramas.map((r) => (
                <View key={r.id} style={styles.segmentoWrapper}>
                  <PillButton
                    label={r.nombre}
                    selected={String(ramaId) === String(r.id)}
                    onPress={() => {
                      void handleSelectRama(String(r.id));
                    }}
                  />
                </View>
              ))}
            </View>

            {DEBUG_AUX && (
              <Text style={styles.helperText}>
                DEBUG: ramaId={String(ramaId ?? 'null')} | ramas={ramas.length}
              </Text>
            )}
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Tipo de ingreso</Text>

              <InlineAddButton
                onPress={handleAddTipoIngreso}
                disabled={readOnly || !ramaId}
                accessibilityLabel="Crear tipo de ingreso"
              />
            </View>

            {ramaSeleccionada ? (
              <View style={styles.segmentosRow}>
                {tipos.map((t) => (
                  <View key={t.id} style={styles.segmentoWrapper}>
                    <PillButton
                      label={t.nombre}
                      selected={String(tipoId) === String(t.id)}
                      onPress={() => {
                        if (readOnly) return;
                        setTipoId(String(t.id), 'manualTipoPillSelect');
                      }}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helperText}>
                Primero selecciona una rama para ver los tipos disponibles.
              </Text>
            )}

            {ramaSeleccionada && tipos.length === 0 ? (
              <Text style={styles.helperText}>
                No hay tipos en esta rama todavía. Puedes crear uno con el botón +.
              </Text>
            ) : null}

            {DEBUG_AUX && (
              <Text style={styles.helperText}>
                DEBUG: tipoId={String(tipoId ?? 'null')} | pendingRama=
                {String(pendingRamaIdRef.current ?? 'null')} | pendingTipo=
                {String(pendingTipoIdRef.current ?? 'null')} | tipos={tipos.length}
              </Text>
            )}
          </View>
        </FormSection>

        <FormSection title="Importe y condiciones">
          <View style={styles.field}>
            <Text style={styles.label}>Importe</Text>
            <TextInput
              value={importe}
              onChangeText={setImporte}
              placeholder="Ej. 1.000,00"
              keyboardType="decimal-pad"
              style={[styles.input, styles.amountInputBig, importe.trim() !== '' && styles.inputFilled]}
              editable={!readOnly}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Periodicidad</Text>
            <View style={styles.periodicidadRow}>
              {periodicidadesForMode().map((p) => (
                <View key={p} style={styles.periodicidadPillWrapper}>
                  <PillButton
                    label={p}
                    selected={periodicidad === p}
                    onPress={() => {
                      if (readOnly) return;
                      setPeriodicidad(p);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection title="Vinculaciones">
          {isRamaViviendas && (
            <View style={styles.field}>
              <Text style={styles.label}>Vivienda</Text>
              <View style={styles.accountsRow}>
                {viviendas.map((viv) => (
                  <View key={viv.id} style={styles.accountPillWrapper}>
                    <AccountPill
                      label={getViviendaLabel(viv)}
                      subLabel={viv.direccion_completa ?? ''}
                      selected={viviendaId === viv.id}
                      onPress={() => {
                        if (readOnly) return;
                        setViviendaId(viv.id);
                      }}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Cuenta de cargo</Text>
            <View style={styles.accountsRow}>
              {cuentas.map((cta) => (
                <View key={cta.id} style={styles.accountPillWrapper}>
                  <AccountPill
                    label={getCuentaLabel(cta)}
                    subLabel={cta.liquidez != null ? EuroformatEuro(cta.liquidez, 'normal') : undefined}
                    selected={cuentaId === cta.id}
                    onPress={() => {
                      if (readOnly) return;
                      setCuentaId(cta.id);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection title="Estado y planificación">
          <View style={styles.field}>
            <Text style={styles.label}>Fecha</Text>

            <FormDateButton
              valueText={formatFechaCorta(fechaInicio)}
              onPress={handleOpenDatePicker}
              disabled={readOnly}
            />

            {showDatePicker && !readOnly && (
              <DateTimePicker
                value={parseDateString(fechaInicio)}
                mode="date"
                display="default"
                onChange={handleChangeFecha}
              />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Rango de cobro</Text>
            <View style={styles.rangoRow}>
              {RANGOS_PAGO.map((r) => (
                <View key={r} style={styles.rangoPillWrapper}>
                  <PillButton
                    label={r}
                    selected={rangoCobro === r}
                    onPress={() => {
                      if (readOnly) return;
                      setRangoCobro(r);
                    }}
                  />
                </View>
              ))}
            </View>

            <Text style={styles.helperText}>
              El rango se ajusta automáticamente según la fecha, pero puedes cambiarlo si lo necesitas.
            </Text>
          </View>
        </FormSection>

        {canShowAdvancedSection && (
          <FormSection title="Opciones avanzadas">
            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced((p) => !p)}
            >
              <Ionicons
                name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textSecondary}
              />
              <Text style={styles.advancedToggleText}>
                {showAdvanced ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas'}
              </Text>
            </TouchableOpacity>

            {showAdvanced && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Estado</Text>
                  <View style={styles.segmentosRow}>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Activo"
                        selected={activo}
                        onPress={() => {
                          if (readOnly) return;
                          setActivo((v) => !v);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Cobrado"
                        selected={cobrado}
                        onPress={() => {
                          if (readOnly) return;
                          setCobrado((v) => !v);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="KPI"
                        selected={kpi}
                        onPress={() => {
                          if (readOnly) return;
                          setKpi((v) => !v);
                        }}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Creado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={createOn ? formatDateDisplay(createOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Inactivado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={inactivatedOn ? formatDateDisplay(inactivatedOn) : ''}
                    />
                  </View>
                </View>

                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Último cobro</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={ultimoIngresoOn ? formatDateDisplay(ultimoIngresoOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Modificado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={modifiedOn ? formatDateDisplay(modifiedOn) : ''}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Usuario</Text>
                  <TextInput
                    style={[styles.input, styles.inputAdvanced]}
                    editable={false}
                    value={userName ?? ''}
                  />
                </View>
              </>
            )}
          </FormSection>
        )}

        {!readOnly ? (
          <View style={{ marginTop: 12 }}>
            <FormActionButton
              label={saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear ingreso'}
              onPress={handleSave}
              iconName="save-outline"
              variant="primary"
              disabled={saving}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

export default IngresoFormScreen;

const stylesLocal = {
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
} as const;