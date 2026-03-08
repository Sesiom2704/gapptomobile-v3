// screens/ingresos/IngresoListScreen.tsx
/**
 * Archivo: screens/ingresos/IngresoListScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de ingresos gestionables (pendientes / todos) con navegación a alta/edición/detalle.
 *   - Integración de “Buscador avanzado” con filtros plegables.
 *   - Acciones contextuales por ingreso mediante ActionSheet.
 *
 * Ajustes v3:
 * - Filtro por rama de ingreso en buscador avanzado.
 * - Soporte de rama_id / rama_nombre en búsqueda y render.
 * - Mantiene diseño y comportamiento existentes.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Header from '../../components/layout/Header';
import { Chip } from '../../components/ui/Chip';
import { FilterPill } from '../../components/ui/FilterPill';
import { TwoLineCompactPill } from '../../components/ui/TwoLineCompactPill';
import { ExpenseCard } from '../../components/cards/ExpenseCard';
import FilterRow from '../../components/ui/FilterRow';

import { colors } from '../../theme';
import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import { listStyles as styles } from '../../components/list/listStyles';

import { api } from '../../services/api';
import {
  TipoIngreso,
  fetchTiposIngreso,
  fetchRamasIngreso,
  type RamaIngreso,
  omitirIngresoEsteMes,
  deshacerOmisionIngresoEsteMes,
} from '../../services/ingresosApi';
import { PERIODICIDAD_OPTIONS, type PeriodicidadFiltro } from '../../constants/general';
import { EuroformatEuro } from '../../utils/format';

import { useGastos } from '../../hooks/useGastos';

type Props = {
  navigation: any;
};

type RouteParams = {
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string;
};

type Ingreso = {
  id: string;
  concepto?: string | null;
  importe?: number | null;
  fecha_inicio?: string | null;
  createon?: string | null;
  rango_cobro?: string | null;
  periodicidad?: string | null;

  rama_id?: string | null;
  rama_nombre?: string | null;

  tipo_id?: string | null;
  tipo_nombre?: string | null;
  referencia_vivienda_id?: string | null;

  cuenta_id?: string | null;
  cuenta_nombre?: string | null;

  activo?: boolean | null;
  cobrado?: boolean | null;
  kpi?: boolean | null;
  ingresos_cobrados?: number | null;
  segmento_id?: string | null;
  segmento_nombre?: string | null;

  omitido_este_mes?: boolean | null;
};

type Filtro = 'pendientes' | 'todos';

const filtros: { label: string; value: Filtro }[] = [
  { label: 'Pendientes', value: 'pendientes' },
  { label: 'Todos', value: 'todos' },
];

type TipoFiltro = 'todos' | string;
type RamaFiltro = 'todos' | string;
type EstadoFiltro = 'todos' | 'activos' | 'inactivos';
type PagadoFiltro = 'todos' | 'pagado' | 'no_pagado';
type KpiFiltro = 'todos' | 'kpi_si' | 'kpi_no';
type FiltroOmitido = 'todos' | 'omitidos' | 'no_omitidos';
type FiltroCuentaBancaria = 'todos' | string;

function getNombreTipoIngreso(ing: Ingreso, catalogoTipos: TipoIngreso[]): string {
  const directo = (ing.tipo_nombre ?? '').trim();
  if (directo) return directo;

  const id = (ing.tipo_id ?? '').trim();
  if (id) {
    const found = (catalogoTipos ?? []).find((t) => (t.id ?? '').trim() === id);
    const nombre = (found?.nombre ?? '').trim();
    if (nombre) return nombre;
    return id;
  }

  return 'Ingreso';
}

function getNombreRamaIngreso(ing: Ingreso, catalogoRamas: RamaIngreso[]): string {
  const directo = (ing.rama_nombre ?? '').trim();
  if (directo) return directo;

  const id = (ing.rama_id ?? '').trim();
  if (id) {
    const found = (catalogoRamas ?? []).find((r) => (r.id ?? '').trim() === id);
    const nombre = (found?.nombre ?? '').trim();
    if (nombre) return nombre;
    return id;
  }

  return 'Sin rama';
}

function formatRangoCobroLabel(ing: Ingreso): string {
  const rc = (ing.rango_cobro || '').trim();
  if (!rc) return '';
  const [desdeRaw, hastaRaw] = rc.split('-').map((p) => p.trim());
  if (!desdeRaw || !hastaRaw) return '';
  return `Ingreso previsto del ${desdeRaw} al ${hastaRaw}`;
}

function getCuentaBancariaFromIngreso(ing: Ingreso): { id: string; anagrama: string } | null {
  const anyIng: any = ing as any;

  const rawId =
    anyIng.cuenta_bancaria_id ??
    anyIng.cuenta_id ??
    anyIng.bank_account_id ??
    anyIng.bankAccountId ??
    anyIng.cuentaBancariaId;

  if (rawId === null || rawId === undefined) return null;

  const id = String(rawId).trim();
  if (!id) return null;

  const rawAnagrama =
    anyIng.cuentas_bancarias_anagrama ??
    anyIng.cuenta_bancaria_anagrama ??
    anyIng.cuenta_anagrama ??
    anyIng.bank_account_anagram ??
    anyIng.bankAccountAnagram ??
    anyIng.cuentaBancariaAnagrama;

  const anagrama = (rawAnagrama ? String(rawAnagrama) : '').trim();
  const safeLabel = anagrama || (anyIng.cuenta_nombre ? String(anyIng.cuenta_nombre).trim() : '') || `Cuenta ${id}`;

  return { id, anagrama: safeLabel };
}

export const IngresoListScreen: React.FC<Props> = ({ navigation }) => {
  const route = useRoute<any>();
  const { returnToTab, returnToScreen } = (route.params ?? {}) as RouteParams;

  const handleBack = useCallback(() => {
    if (returnToTab && returnToScreen) {
      navigation.navigate(returnToTab, { screen: returnToScreen });
      return;
    }
    if (navigation?.canGoBack?.()) navigation.goBack();
  }, [navigation, returnToTab, returnToScreen]);

  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [ingresos, setIngresos] = useState<Ingreso[]>([]);
  const [catalogoTipos, setCatalogoTipos] = useState<TipoIngreso[]>([]);
  const [catalogoRamas, setCatalogoRamas] = useState<RamaIngreso[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedIngreso, setSelectedIngreso] = useState<Ingreso | null>(null);

  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filtroPeriodicidad, setFiltroPeriodicidad] = useState<PeriodicidadFiltro>('todos');
  const [filtroTipo, setFiltroTipo] = useState<TipoFiltro>('todos');
  const [filtroRama, setFiltroRama] = useState<RamaFiltro>('todos');
  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>('todos');
  const [filtroPagado, setFiltroPagado] = useState<PagadoFiltro>('todos');
  const [filtroKpi, setFiltroKpi] = useState<KpiFiltro>('todos');
  const [filtroOmitido, setFiltroOmitido] = useState<FiltroOmitido>('todos');
  const [filtroCuentaBancaria, setFiltroCuentaBancaria] =
    useState<FiltroCuentaBancaria>('todos');

  const [showPeriodicidadFilter, setShowPeriodicidadFilter] = useState(false);
  const [showTipoFilter, setShowTipoFilter] = useState(false);
  const [showRamaFilter, setShowRamaFilter] = useState(false);
  const [showEstadoFilter, setShowEstadoFilter] = useState(false);
  const [showPagadoFilter, setShowPagadoFilter] = useState(false);
  const [showKpiFilter, setShowKpiFilter] = useState(false);
  const [showOmitidoFilter, setShowOmitidoFilter] = useState(false);
  const [showCuentaBancariaFilter, setShowCuentaBancariaFilter] = useState(false);

  const closeBuscador = useCallback(() => {
    Keyboard.dismiss();
    setBuscadorAbierto(false);
  }, []);

  const handleAddIngreso = () => {
    navigation.navigate('NuevoIngreso');
  };

  const {
    gastos: gastosPendientes,
    loading: loadingGastosPendientes,
    reload: reloadGastosPendientes,
  } = useGastos('pendientes');
  const gastosPendientesCount = gastosPendientes?.length ?? 0;

  const [ingresosPendientesCountApi, setIngresosPendientesCountApi] = useState<number | null>(
    null
  );
  const [loadingIngresosPendientes, setLoadingIngresosPendientes] = useState(false);

  const fetchIngresosPendientesCount = useCallback(async () => {
    setLoadingIngresosPendientes(true);
    try {
      const resp = await api.get<Ingreso[]>('/api/v1/ingresos/pendientes');
      const list = resp.data ?? [];
      setIngresosPendientesCountApi(Array.isArray(list) ? list.length : 0);
    } catch (e) {
      console.error('[IngresoList] Error cargando ingresos pendientes', e);
      setIngresosPendientesCountApi(null);
    } finally {
      setLoadingIngresosPendientes(false);
    }
  }, []);

  const cargarIngresos = async () => {
    setLoading(true);
    setError(null);

    try {
      let data: Ingreso[] = [];

      if (filtro === 'pendientes') {
        const resp = await api.get<Ingreso[]>('/api/v1/ingresos/pendientes');
        data = resp.data ?? [];
      } else {
        const resp = await api.get<Ingreso[]>('/api/v1/ingresos');
        data = resp.data ?? [];
      }

      const ordenados = [...data].sort((a, b) => {
        const ta = new Date(a.fecha_inicio || a.createon || '').getTime();
        const tb = new Date(b.fecha_inicio || b.createon || '').getTime();
        if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
        return tb - ta;
      });

      setIngresos(ordenados);
    } catch (err) {
      console.error('[IngresoList] Error cargando ingresos', err);
      setError('No se han podido cargar los ingresos. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [tipos, ramas] = await Promise.all([
          fetchTiposIngreso(),
          fetchRamasIngreso(),
        ]);
        setCatalogoTipos(tipos ?? []);
        setCatalogoRamas(ramas ?? []);
      } catch (err) {
        console.error('[IngresoList] Error cargando catálogos de ingresos', err);
      }
    };

    void cargarCatalogos();
  }, []);

  useEffect(() => {
    void cargarIngresos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  const isPendientes = filtro === 'pendientes';

  useEffect(() => {
    if (isPendientes) {
      setFiltroEstado('activos');
      setFiltroPagado('no_pagado');
      setFiltroKpi('kpi_si');
      setFiltroOmitido('no_omitidos');
      setFiltroCuentaBancaria('todos');
    } else {
      setFiltroEstado('todos');
      setFiltroPagado('todos');
      setFiltroKpi('todos');
      setFiltroOmitido('todos');
      setFiltroCuentaBancaria('todos');
    }
  }, [isPendientes]);

  useFocusEffect(
    useCallback(() => {
      void fetchIngresosPendientesCount();
      return () => {
        setBuscadorAbierto(false);
        setSearchText('');
        setFiltroPeriodicidad('todos');
        setFiltroTipo('todos');
        setFiltroRama('todos');
        setFiltroEstado('todos');
        setFiltroPagado('todos');
        setFiltroKpi('todos');
        setFiltroOmitido('todos');
        setFiltroCuentaBancaria('todos');
      };
    }, [fetchIngresosPendientesCount])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await cargarIngresos();
    await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
  };

  const handleCobrar = async (ingreso: Ingreso) => {
    try {
      await api.put(`/api/v1/ingresos/${ingreso.id}/cobrar`);
      await cargarIngresos();
      await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
    } catch (err) {
      console.error('[IngresoList] Error al cobrar ingreso', err);
      Alert.alert('Error', 'No se ha podido marcar el ingreso como cobrado.');
    }
  };

  const confirmarCobrar = (ingreso: Ingreso) => {
    Alert.alert(
      'Marcar como cobrado',
      `¿Quieres marcar el ingreso ${ingreso.concepto || ingreso.id} como cobrado?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Marcar como cobrado', style: 'default', onPress: () => void handleCobrar(ingreso) },
      ]
    );
  };

  const handleOmitirIngreso = async (ingreso: Ingreso) => {
    try {
      await omitirIngresoEsteMes(ingreso.id);
      await cargarIngresos();
      await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
    } catch (err) {
      console.error('[IngresoList] Error al omitir ingreso', err);
      Alert.alert('Error', 'No se ha podido omitir el ingreso.');
    }
  };

  const confirmarOmitirIngreso = (ingreso: Ingreso) => {
    Alert.alert(
      'Omitir este mes',
      `¿Quieres omitir el ingreso "${ingreso.concepto || ingreso.id}" este mes?\n\nNo se marcará como cobrado ni alterará el histórico. Simplemente dejará de aparecer en pendientes.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Omitir', style: 'default', onPress: () => void handleOmitirIngreso(ingreso) },
      ]
    );
  };

  const handleDeshacerOmisionIngreso = async (ingreso: Ingreso) => {
    try {
      await deshacerOmisionIngresoEsteMes(ingreso.id);
      await cargarIngresos();
      await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
    } catch (err) {
      console.error('[IngresoList] Error al deshacer omisión', err);
      Alert.alert('Error', 'No se ha podido deshacer la omisión.');
    }
  };

  const confirmarDeshacerOmisionIngreso = (ingreso: Ingreso) => {
    Alert.alert(
      'Deshacer omisión',
      `¿Quieres volver a incluir "${ingreso.concepto || ingreso.id}" en pendientes este mes?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deshacer omisión',
          style: 'default',
          onPress: () => void handleDeshacerOmisionIngreso(ingreso),
        },
      ]
    );
  };

  const handleEliminar = async (ingreso: Ingreso) => {
    Alert.alert('Eliminar ingreso', `¿Eliminar el ingreso "${ingreso.concepto || ingreso.id}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/v1/ingresos/${ingreso.id}`);
            await cargarIngresos();
            await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
          } catch (err) {
            console.error('[IngresoList] Error al eliminar ingreso', err);
            Alert.alert('Error', 'No se ha podido eliminar el ingreso. Inténtalo de nuevo.');
          }
        },
      },
    ]);
  };

  const abrirMenuIngreso = (ingreso: Ingreso) => {
    setSelectedIngreso(ingreso);
    setSheetVisible(true);
  };

  const getActionsForIngreso = (ingreso: Ingreso | null): ActionSheetAction[] => {
    if (!ingreso) return [];

    const acciones: ActionSheetAction[] = [];

    const verde = colors.actionSuccess ?? '#16a34a';
    const rojo = colors.actionDanger ?? '#b91c1c';
    const amarillo = colors.actionWarning ?? '#eab308';
    const gris = colors.actionNeutral ?? '#4b5563';
    const azul = colors.actionInfo ?? '#2563eb';

    if (!ingreso.cobrado) {
      acciones.push({
        label: 'Marcar como cobrado',
        onPress: async () => {
          try {
            await handleCobrar(ingreso);
          } finally {
            setSheetVisible(false);
          }
        },
        iconName: 'checkmark-circle-outline',
        color: verde,
      });
    }

    if (!ingreso.cobrado) {
      if (ingreso.omitido_este_mes === true) {
        acciones.push({
          label: 'Deshacer omisión',
          onPress: () => {
            setSheetVisible(false);
            confirmarDeshacerOmisionIngreso(ingreso);
          },
          iconName: 'arrow-undo-outline',
          color: azul,
        });
      } else {
        acciones.push({
          label: 'Omitir este mes',
          onPress: () => {
            setSheetVisible(false);
            confirmarOmitirIngreso(ingreso);
          },
          iconName: 'ban-outline',
          color: azul,
        });
      }
    }

    acciones.push({
      label: 'Editar ingreso',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('IngresoForm', { ingreso, mode: 'gestionable' });
      },
      iconName: 'create-outline',
      color: amarillo,
    });

    acciones.push({
      label: 'Duplicar ingreso',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('IngresoForm', { ingreso, duplicate: true, mode: 'gestionable' });
      },
      iconName: 'copy-outline',
      color: azul,
    });

    acciones.push({
      label: 'Ver detalle',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('IngresoForm', { ingreso, readOnly: true });
      },
      iconName: 'information-circle-outline',
      color: gris,
    });

    acciones.push({
      label: 'Eliminar ingreso',
      onPress: () => {
        setSheetVisible(false);
        void handleEliminar(ingreso);
      },
      iconName: 'trash-outline',
      color: rojo,
      destructive: true,
    });

    return acciones;
  };

  const accionesSheet = getActionsForIngreso(selectedIngreso);

  const cuentasBancariasDisponibles = useMemo(() => {
    const map = new Map<string, string>();

    ingresos.forEach((ing) => {
      const cuenta = getCuentaBancariaFromIngreso(ing);
      if (!cuenta) return;

      const key = String(cuenta.id).trim();
      const value = (cuenta.anagrama ?? '').trim() || `Cuenta ${key}`;
      if (key) map.set(key, value);
    });

    return Array.from(map.entries())
      .map(([id, anagrama]) => ({ id, anagrama }))
      .sort((a, b) => a.anagrama.localeCompare(b.anagrama, 'es'));
  }, [ingresos]);

  const periodicidadStats = useMemo<Record<PeriodicidadFiltro, number>>(() => {
    const stats: Record<PeriodicidadFiltro, number> = {
      todos: 0,
      mensual: 0,
      trimestral: 0,
      semestral: 0,
      anual: 0,
      pago_unico: 0,
    };

    ingresos.forEach((ing) => {
      const perRaw = (ing.periodicidad ?? '').toLowerCase().replace(' ', '_');
      if (
        perRaw === 'mensual' ||
        perRaw === 'trimestral' ||
        perRaw === 'semestral' ||
        perRaw === 'anual' ||
        perRaw === 'pago_unico'
      ) {
        stats[perRaw as PeriodicidadFiltro]++;
      }
    });

    return stats;
  }, [ingresos]);

  const statsOmitido = useMemo(() => {
    let omitidos = 0;
    let no_omitidos = 0;

    ingresos.forEach((ing) => {
      if (ing.omitido_este_mes === true) omitidos += 1;
      else no_omitidos += 1;
    });

    return { omitidos, no_omitidos, todos: ingresos.length };
  }, [ingresos]);

  type TipoDisponible = {
    id: string;
    nombre: string;
    tieneIngresos: boolean;
  };

  const tiposDisponibles: TipoDisponible[] = useMemo(() => {
    const idsConIngresos = new Set<string>();
    ingresos.forEach((ing) => {
      if (ing.tipo_id) idsConIngresos.add(ing.tipo_id);
    });

    const resultado: TipoDisponible[] = [];

    catalogoTipos.forEach((t) => {
      const id = t.id;
      if (!id) return;

      const nombre = t.nombre && t.nombre.trim() !== '' ? t.nombre : id;
      const tieneIngresos = idsConIngresos.has(id);

      resultado.push({ id, nombre, tieneIngresos });
      idsConIngresos.delete(id);
    });

    idsConIngresos.forEach((id) => {
      resultado.push({ id, nombre: id, tieneIngresos: true });
    });

    return resultado;
  }, [catalogoTipos, ingresos]);

  type RamaDisponible = {
    id: string;
    nombre: string;
    tieneIngresos: boolean;
  };

  const ramasDisponibles: RamaDisponible[] = useMemo(() => {
    const idsConIngresos = new Set<string>();
    ingresos.forEach((ing) => {
      if (ing.rama_id) idsConIngresos.add(ing.rama_id);
    });

    const resultado: RamaDisponible[] = [];

    catalogoRamas.forEach((r) => {
      const id = r.id;
      if (!id) return;

      const nombre = r.nombre && r.nombre.trim() !== '' ? r.nombre : id;
      const tieneIngresos = idsConIngresos.has(id);

      resultado.push({ id, nombre, tieneIngresos });
      idsConIngresos.delete(id);
    });

    idsConIngresos.forEach((id) => {
      resultado.push({ id, nombre: id, tieneIngresos: true });
    });

    return resultado;
  }, [catalogoRamas, ingresos]);

  const ingresosFiltrados = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    return ingresos.filter((ing) => {
      const tipoNombre = getNombreTipoIngreso(ing, catalogoTipos);
      const ramaNombre = getNombreRamaIngreso(ing, catalogoRamas);

      if (term.length > 0) {
        const hayCoincidencia =
          (ing.concepto ?? '').toLowerCase().includes(term) ||
          (ing.cuenta_nombre ?? '').toLowerCase().includes(term) ||
          tipoNombre.toLowerCase().includes(term) ||
          ramaNombre.toLowerCase().includes(term) ||
          (ing.segmento_nombre ?? '').toLowerCase().includes(term);

        if (!hayCoincidencia) return false;
      }

      if (filtroPeriodicidad !== 'todos') {
        const per = (ing.periodicidad ?? '').toLowerCase().replace(' ', '_');
        if (per !== filtroPeriodicidad) return false;
      }

      if (filtroTipo !== 'todos') {
        if (ing.tipo_id !== filtroTipo) return false;
      }

      if (filtroRama !== 'todos') {
        if (ing.rama_id !== filtroRama) return false;
      }

      if (filtroEstado === 'activos' && ing.activo === false) return false;
      if (filtroEstado === 'inactivos' && ing.activo !== false) return false;

      if (filtroPagado === 'pagado' && !ing.cobrado) return false;
      if (filtroPagado === 'no_pagado' && ing.cobrado) return false;

      if (filtroKpi === 'kpi_si' && !ing.kpi) return false;
      if (filtroKpi === 'kpi_no' && ing.kpi) return false;

      if (filtroOmitido !== 'todos') {
        const isOmitido = ing.omitido_este_mes === true;
        if (filtroOmitido === 'omitidos' && !isOmitido) return false;
        if (filtroOmitido === 'no_omitidos' && isOmitido) return false;
      }

      if (filtroCuentaBancaria !== 'todos') {
        const cuenta = getCuentaBancariaFromIngreso(ing);
        if (!cuenta) return false;
        if (String(cuenta.id).trim() !== String(filtroCuentaBancaria).trim()) return false;
      }

      return true;
    });
  }, [
    ingresos,
    searchText,
    filtroPeriodicidad,
    filtroTipo,
    filtroRama,
    filtroEstado,
    filtroPagado,
    filtroKpi,
    filtroOmitido,
    filtroCuentaBancaria,
    catalogoTipos,
    catalogoRamas,
  ]);

  const isDefaultPendientesIngresosFilters = useMemo(() => {
    const hasSearch = searchText.trim().length > 0;
    const hasPeriodicidad = filtroPeriodicidad !== 'todos';
    const hasTipo = filtroTipo !== 'todos';
    const hasRama = filtroRama !== 'todos';
    const hasCuenta = filtroCuentaBancaria !== 'todos';
    return !(hasSearch || hasPeriodicidad || hasTipo || hasRama || hasCuenta);
  }, [searchText, filtroPeriodicidad, filtroTipo, filtroRama, filtroCuentaBancaria]);

  const goToGastosPendientes = useCallback(() => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastosList',
      params: { initialFiltro: 'pendientes' },
    });
  }, [navigation]);

  const renderEmptyOkState = useCallback(
    (opts: { showButton: boolean; buttonLabel?: string; onPress?: () => void }) => {
      return (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={92} color={colors.primary} />

          <Text
            style={{
              marginTop: 10,
              fontSize: 13,
              color: colors.textSecondary,
              textAlign: 'center',
            }}
          >
            Mes listo para cerrar.
          </Text>

          {opts.showButton && opts.buttonLabel && opts.onPress && (
            <TouchableOpacity
              onPress={opts.onPress}
              style={{
                marginTop: 14,
                backgroundColor: colors.primary,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>{opts.buttonLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
    []
  );

  const renderBuscador = () => {
    const canChangeFixedFilters = !isPendientes;

    const periodicidadHasData = (p: PeriodicidadFiltro) => {
      if (p === 'todos') return ingresos.length > 0;
      return (periodicidadStats[p] ?? 0) > 0;
    };

    const hasOmitidosData = statsOmitido.omitidos > 0;
    const hasNoOmitidosData = statsOmitido.no_omitidos > 0;
    const hasAnyOmitidoData = statsOmitido.todos > 0;
    const hasAnyCuentaBancaria = cuentasBancariasDisponibles.length > 0;
    const hasAnyRama = ramasDisponibles.length > 0;

    return (
      <View style={styles.searchPanel}>
        <Text style={styles.searchLabel}>Buscar</Text>

        <View style={styles.searchRow}>
          <Ionicons
            name="search-outline"
            size={16}
            color={colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Concepto, cuenta, tipo, rama…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        {hasAnyCuentaBancaria && (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 16,
              }}
            >
              <Text style={styles.searchLabel}>Cuenta bancaria</Text>
              <TouchableOpacity
                onPress={() => setShowCuentaBancariaFilter((prev) => !prev)}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons
                  name={showCuentaBancariaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {showCuentaBancariaFilter ? 'Ocultar' : 'Mostrar'}
                </Text>
              </TouchableOpacity>
            </View>

            {showCuentaBancariaFilter && (
              <View style={styles.pillsRowWrap}>
                <View style={styles.pillWrapper}>
                  <TwoLineCompactPill
                    label="Todas"
                    selected={filtroCuentaBancaria === 'todos'}
                    onPress={() => setFiltroCuentaBancaria('todos')}
                    style={styles.filterPill}
                  />
                </View>

                {cuentasBancariasDisponibles.map((c) => {
                  const selected = filtroCuentaBancaria === c.id;
                  return (
                    <View style={styles.pillWrapper} key={c.id}>
                      <TwoLineCompactPill
                        label={c.anagrama}
                        selected={selected}
                        onPress={() => setFiltroCuentaBancaria(selected ? 'todos' : c.id)}
                        style={styles.filterPill}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Periodicidad</Text>
            <TouchableOpacity
              onPress={() => setShowPeriodicidadFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showPeriodicidadFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showPeriodicidadFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showPeriodicidadFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroPeriodicidad === 'todos'}
                  disabled={!periodicidadHasData('todos')}
                  onPress={() => setFiltroPeriodicidad('todos')}
                  style={styles.filterPill}
                />
              </View>

              {PERIODICIDAD_OPTIONS.map((opt) => {
                const selected = filtroPeriodicidad === opt.value;
                const disabled = !periodicidadHasData(opt.value);

                return (
                  <View style={styles.pillWrapper} key={opt.value}>
                    <FilterPill
                      label={opt.label}
                      selected={selected}
                      disabled={disabled}
                      onPress={() => setFiltroPeriodicidad(selected ? 'todos' : opt.value)}
                      style={styles.filterPill}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Rama de ingreso</Text>
            <TouchableOpacity
              onPress={() => setShowRamaFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showRamaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showRamaFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showRamaFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todas"
                  selected={filtroRama === 'todos'}
                  disabled={!hasAnyRama}
                  onPress={() => setFiltroRama('todos')}
                  style={styles.filterPill}
                />
              </View>

              {ramasDisponibles.map((r) => {
                const selected = filtroRama === r.id;
                const disabled = !r.tieneIngresos;

                return (
                  <View style={styles.pillWrapper} key={r.id}>
                    <FilterPill
                      label={r.nombre}
                      selected={selected}
                      disabled={disabled}
                      onPress={() => setFiltroRama(selected ? 'todos' : r.id)}
                      style={styles.filterPill}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Tipo de ingreso</Text>
            <TouchableOpacity
              onPress={() => setShowTipoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showTipoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showTipoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showTipoFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroTipo === 'todos'}
                  disabled={ingresos.length === 0}
                  onPress={() => setFiltroTipo('todos')}
                  style={styles.filterPill}
                />
              </View>

              {tiposDisponibles.map((t) => {
                const selected = filtroTipo === t.id;
                const disabled = !t.tieneIngresos;

                return (
                  <View style={styles.pillWrapper} key={t.id}>
                    <FilterPill
                      label={t.nombre}
                      selected={selected}
                      disabled={disabled}
                      onPress={() => setFiltroTipo(selected ? 'todos' : (t.id as TipoFiltro))}
                      style={styles.filterPill}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Omisión</Text>
            <TouchableOpacity
              onPress={() => setShowOmitidoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showOmitidoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showOmitidoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showOmitidoFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroOmitido === 'todos'}
                  disabled={isPendientes || !hasAnyOmitidoData}
                  onPress={() => setFiltroOmitido('todos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Omitidos"
                  selected={filtroOmitido === 'omitidos'}
                  disabled={isPendientes || !hasOmitidosData}
                  onPress={() => setFiltroOmitido('omitidos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="No omitidos"
                  selected={filtroOmitido === 'no_omitidos'}
                  disabled={isPendientes || !hasNoOmitidosData}
                  onPress={() => setFiltroOmitido('no_omitidos')}
                  style={styles.filterPill}
                />
              </View>
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Estado</Text>
            <TouchableOpacity
              onPress={() => setShowEstadoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showEstadoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showEstadoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showEstadoFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroEstado === 'todos'}
                  disabled={!canChangeFixedFilters && filtroEstado !== 'todos'}
                  onPress={() => setFiltroEstado('todos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Solo activos"
                  selected={filtroEstado === 'activos'}
                  disabled={!canChangeFixedFilters && filtroEstado !== 'activos'}
                  onPress={() => setFiltroEstado('activos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Solo inactivos"
                  selected={filtroEstado === 'inactivos'}
                  disabled={!canChangeFixedFilters && filtroEstado !== 'inactivos'}
                  onPress={() => setFiltroEstado('inactivos')}
                  style={styles.filterPill}
                />
              </View>
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Pagado</Text>
            <TouchableOpacity
              onPress={() => setShowPagadoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showPagadoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showPagadoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showPagadoFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroPagado === 'todos'}
                  disabled={!canChangeFixedFilters && filtroPagado !== 'todos'}
                  onPress={() => setFiltroPagado('todos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Pagado"
                  selected={filtroPagado === 'pagado'}
                  disabled={!canChangeFixedFilters && filtroPagado !== 'pagado'}
                  onPress={() => setFiltroPagado('pagado')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="No pagado"
                  selected={filtroPagado === 'no_pagado'}
                  disabled={!canChangeFixedFilters && filtroPagado !== 'no_pagado'}
                  onPress={() => setFiltroPagado('no_pagado')}
                  style={styles.filterPill}
                />
              </View>
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>KPI</Text>
            <TouchableOpacity
              onPress={() => setShowKpiFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showKpiFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showKpiFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showKpiFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroKpi === 'todos'}
                  disabled={!canChangeFixedFilters && filtroKpi !== 'todos'}
                  onPress={() => setFiltroKpi('todos')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="KPI sí"
                  selected={filtroKpi === 'kpi_si'}
                  disabled={!canChangeFixedFilters && filtroKpi !== 'kpi_si'}
                  onPress={() => setFiltroKpi('kpi_si')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="KPI no"
                  selected={filtroKpi === 'kpi_no'}
                  disabled={!canChangeFixedFilters && filtroKpi !== 'kpi_no'}
                  onPress={() => setFiltroKpi('kpi_no')}
                  style={styles.filterPill}
                />
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  const effectiveIngresosPendientesCount = useMemo(() => {
    if (isPendientes) return ingresos.length;
    return ingresosPendientesCountApi;
  }, [isPendientes, ingresos.length, ingresosPendientesCountApi]);

  const canReiniciarMes = useMemo(() => {
    if (effectiveIngresosPendientesCount == null) return false;
    return gastosPendientesCount === 0 && effectiveIngresosPendientesCount === 0;
  }, [gastosPendientesCount, effectiveIngresosPendientesCount]);

  const goReiniciarMes = useCallback(() => {
    navigation.navigate('MonthTab', {
      screen: 'ReinciarCierreScreen',
      params: {
        returnToTab: 'DayToDayTab',
        returnToScreen: 'IngresosList',
      },
    });
  }, [navigation]);

  const eligibilityLoading = loadingGastosPendientes || loadingIngresosPendientes;

  const renderContenido = () => {
    if (loading && ingresos.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando ingresos…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (ingresosFiltrados.length === 0) {
      const isPendientesView = filtro === 'pendientes';

      if (isPendientesView) {
        const noHayIngresosPendientes = ingresos.length === 0;

        if (isDefaultPendientesIngresosFilters && noHayIngresosPendientes) {
          const gastosPend = gastosPendientesCount;

          if (gastosPend > 0) {
            return renderEmptyOkState({
              showButton: true,
              buttonLabel: `Ver ${gastosPend} gastos pendientes`,
              onPress: goToGastosPendientes,
            });
          }

          return renderEmptyOkState({ showButton: false });
        }
      }

      return (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No hay ingresos que coincidan con el filtro.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onScrollBeginDrag={closeBuscador}
        onTouchStart={() => {
          if (buscadorAbierto) closeBuscador();
        }}
      >
        {ingresosFiltrados.map((ing) => {
          const titulo = ing.concepto || 'SIN CONCEPTO';
          const tipoNombre = getNombreTipoIngreso(ing, catalogoTipos);
          const ramaNombre = getNombreRamaIngreso(ing, catalogoRamas);

          const categoryBase = `${tipoNombre}${ramaNombre ? ` · ${ramaNombre}` : ''}`;
          const category = ing.omitido_este_mes ? `${categoryBase} · OMITIDO` : categoryBase;

          const baseDate = formatRangoCobroLabel(ing);
          const dateLabel = ing.omitido_este_mes ? `${baseDate} · Omitido este mes` : baseDate;

          return (
            <ExpenseCard
              key={ing.id}
              title={titulo}
              category={category}
              dateLabel={dateLabel}
              amountLabel={EuroformatEuro(ing.importe ?? 0, 'plus')}
              segmentoId="INGRESO"
              inactive={ing.activo === false}
              onOptionsPress={() => abrirMenuIngreso(ing)}
              onPress={() => navigation.navigate('IngresoForm', { ingreso: ing, readOnly: true })}
              onActionPress={ing.cobrado ? undefined : () => confirmarCobrar(ing)}
            />
          );
        })}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Ingresos"
        subtitle="Muestra todos tus ingresos gestionables asi como los extraordinarios."
        showBack
        onBackPress={handleBack}
        rightIconName={!eligibilityLoading && canReiniciarMes ? 'calendar-outline' : undefined}
        onRightPress={!eligibilityLoading && canReiniciarMes ? goReiniciarMes : undefined}
        onAddPress={!eligibilityLoading && canReiniciarMes ? undefined : handleAddIngreso}
      />

      <View style={styles.screen}>
        <View style={styles.topArea}>
          <FilterRow columns={2} style={{ marginTop: 8 }}>
            {filtros.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={filtro === f.value}
                onPress={() => setFiltro(f.value)}
                fullWidth
                centerText
              />
            ))}
          </FilterRow>
        </View>

        <View style={styles.middleArea}>
          <TouchableOpacity
            style={styles.searchToggle}
            onPress={() => setBuscadorAbierto((prev) => !prev)}
          >
            <Ionicons
              name={buscadorAbierto ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.searchToggleText}>Buscador avanzado</Text>
          </TouchableOpacity>

          {buscadorAbierto && (
            <View style={{ maxHeight: 320 }}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {renderBuscador()}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.bottomArea}>{renderContenido()}</View>

        <ActionSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          title="Acciones sobre el ingreso"
          actions={accionesSheet}
        />
      </View>
    </>
  );
};

export default IngresoListScreen;