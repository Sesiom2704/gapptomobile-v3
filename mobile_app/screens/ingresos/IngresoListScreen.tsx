// screens/ingresos/IngresoListScreen.tsx
/**
 * Archivo: screens/ingresos/IngresoListScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de ingresos gestionables (pendientes / todos) con navegación a alta/edición/detalle.
 *   - Integración de “Buscador avanzado” con filtros plegables (periodicidad, tipo, estado, pagado, KPI).
 *   - Acciones contextuales por ingreso mediante ActionSheet (cobrar, editar, duplicar, ver detalle, eliminar).
 *
 * NUEVO (Reiniciar mes en header):
 *   - En el header (donde estaba el "+") debe aparecer un botón para "Reiniciar mes"
 *     SOLO cuando:
 *       - NO existen gastos pendientes (gestionables), y
 *       - NO existen ingresos pendientes (gestionables)
 *   - Si NO se cumple, se mantiene el "+" legacy (no se pierde funcionalidad).
 *
 * NUEVO (Estado vacío inteligente – cierre mensual):
 * - En IngresosList, cuando estamos en "Pendientes":
 *   1) Si NO hay ingresos pendientes y NO hay gastos pendientes, y además NO hay filtros activos "reales":
 *      - Mostrar icono de check centrado (tamaño medio) en lugar del texto legacy.
 *   2) Si NO hay ingresos pendientes pero SÍ hay gastos pendientes (y NO hay filtros activos "reales"):
 *      - Mostrar el mismo check + botón: "Ver X gastos pendientes" que navega a Gastos pendientes.
 *   3) Si hay ingresos pendientes: se muestra la lista normal.
 *   4) Si la lista está vacía por búsqueda/filtros: se mantiene el mensaje legacy.
 *
 * IMPORTANTE (qué cuenta como "filtros activos reales" en Pendientes):
 * - En "Pendientes" se fuerzan automáticamente: Estado=activos, Pagado=no_pagado, KPI=kpi_si.
 *   Esos NO cuentan como filtros activos reales para el vacío inteligente.
 * - Sí cuentan:
 *   - searchText (búsqueda)
 *   - periodicidad distinta de 'todos'
 *   - tipo distinto de 'todos'
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
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Header from '../../components/layout/Header';
import { Chip } from '../../components/ui/Chip';
import { FilterPill } from '../../components/ui/FilterPill';
import { ExpenseCard } from '../../components/cards/ExpenseCard';
import FilterRow from '../../components/ui/FilterRow';

import { colors } from '../../theme';
import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import { listStyles as styles } from '../../components/list/listStyles';

import { api } from '../../services/api';
import { TipoIngreso, fetchTiposIngreso } from '../../services/ingresosApi';
import { PERIODICIDAD_OPTIONS, type PeriodicidadFiltro } from '../../constants/general';
import { EuroformatEuro } from '../../utils/format';

// ✅ NUEVO: para saber si hay gastos pendientes (gestionables)
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
};

type Filtro = 'pendientes' | 'todos';

const filtros: { label: string; value: Filtro }[] = [
  { label: 'Pendientes', value: 'pendientes' },
  { label: 'Todos', value: 'todos' },
];

type TipoFiltro = 'todos' | string;
type EstadoFiltro = 'todos' | 'activos' | 'inactivos';
type PagadoFiltro = 'todos' | 'pagado' | 'no_pagado';
type KpiFiltro = 'todos' | 'kpi_si' | 'kpi_no';

function getNombreTipoIngreso(
  ing: Ingreso,
  catalogoTipos: TipoIngreso[]
): string {
  // 1) Si el backend ya trae el nombre, lo usamos
  const directo = (ing.tipo_nombre ?? '').trim();
  if (directo) return directo;

  // 2) Si no, resolvemos por catálogo (id -> nombre)
  const id = (ing.tipo_id ?? '').trim();
  if (id) {
    const found = (catalogoTipos ?? []).find((t) => (t.id ?? '').trim() === id);
    const nombre = (found?.nombre ?? '').trim();
    if (nombre) return nombre;

    // 3) Fallback: si no existe en catálogo, al menos mostramos el id
    return id;
  }

  return 'Ingreso';
}


function formatRangoCobroLabel(ing: Ingreso): string {
  const rc = (ing.rango_cobro || '').trim();
  if (!rc) return '';
  const [desdeRaw, hastaRaw] = rc.split('-').map((p) => p.trim());
  if (!desdeRaw || !hastaRaw) return '';
  return `Ingreso previsto del ${desdeRaw} al ${hastaRaw}`;
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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedIngreso, setSelectedIngreso] = useState<Ingreso | null>(null);

  // Buscador avanzado
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filtroPeriodicidad, setFiltroPeriodicidad] = useState<PeriodicidadFiltro>('todos');
  const [filtroTipo, setFiltroTipo] = useState<TipoFiltro>('todos');
  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>('todos');
  const [filtroPagado, setFiltroPagado] = useState<PagadoFiltro>('todos');
  const [filtroKpi, setFiltroKpi] = useState<KpiFiltro>('todos');

  // Bloques plegables
  const [showPeriodicidadFilter, setShowPeriodicidadFilter] = useState(false);
  const [showTipoFilter, setShowTipoFilter] = useState(false);
  const [showEstadoFilter, setShowEstadoFilter] = useState(false);
  const [showPagadoFilter, setShowPagadoFilter] = useState(false);
  const [showKpiFilter, setShowKpiFilter] = useState(false);

  const handleAddIngreso = () => {
    navigation.navigate('NuevoIngreso');
  };

  // ============================
  // ✅ GASTOS PENDIENTES: eligibility reinicio + vacío inteligente
  // ============================
  const {
    gastos: gastosPendientes,
    loading: loadingGastosPendientes,
    reload: reloadGastosPendientes,
  } = useGastos('pendientes');
  const gastosPendientesCount = gastosPendientes?.length ?? 0;

  // ============================
  // ✅ Ingresos pendientes count para eligibility (cuando NO estamos en "pendientes")
  // ============================
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
    const cargarTipos = async () => {
      try {
        const tipos = await fetchTiposIngreso();
        setCatalogoTipos(tipos ?? []);
      } catch (err) {
        console.error('[IngresoList] Error cargando catálogo tipos ingreso', err);
      }
    };

    void cargarTipos();
  }, []);

  useEffect(() => {
    void cargarIngresos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  const isPendientes = filtro === 'pendientes';

  // En pendientes: fijamos estado/pagado/KPI (comportamiento legacy)
  useEffect(() => {
    if (isPendientes) {
      setFiltroEstado('activos');
      setFiltroPagado('no_pagado');
      setFiltroKpi('kpi_si');
    } else {
      setFiltroEstado('todos');
      setFiltroPagado('todos');
      setFiltroKpi('todos');
    }
  }, [isPendientes]);

  // ✅ Al enfocar pantalla: refrescamos counts de eligibility
  useFocusEffect(
    useCallback(() => {
      void fetchIngresosPendientesCount();
      return () => {
        setBuscadorAbierto(false);
        setSearchText('');
        setFiltroPeriodicidad('todos');
        setFiltroTipo('todos');
        setFiltroEstado('todos');
        setFiltroPagado('todos');
        setFiltroKpi('todos');
      };
    }, [fetchIngresosPendientesCount])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await cargarIngresos();

    // ✅ refresco extra: eligibility
    await Promise.all([reloadGastosPendientes(), fetchIngresosPendientesCount()]);
  };

  const handleCobrar = async (ingreso: Ingreso) => {
    try {
      await api.put(`/api/v1/ingresos/${ingreso.id}/cobrar`);
      await cargarIngresos();

      // ✅ tras cambios: refrescamos eligibility
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

            // ✅ tras cambios: refrescamos eligibility
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

    const verde = '#16a34a';
    const rojo = '#b91c1c';
    const amarillo = '#eab308';
    const gris = '#4b5563';
    const azul = '#2563eb';

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

  // Stats periodicidad (para deshabilitar pills sin datos)
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

  // Aplicar filtros locales
  const ingresosFiltrados = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    return ingresos.filter((ing) => {
      if (term.length > 0) {
        const hayCoincidencia =
          (ing.concepto ?? '').toLowerCase().includes(term) ||
          (ing.cuenta_nombre ?? '').toLowerCase().includes(term) ||
          getNombreTipoIngreso(ing, catalogoTipos).toLowerCase().includes(term) ||
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

      if (filtroEstado === 'activos' && ing.activo === false) return false;
      if (filtroEstado === 'inactivos' && ing.activo !== false) return false;

      if (filtroPagado === 'pagado' && !ing.cobrado) return false;
      if (filtroPagado === 'no_pagado' && ing.cobrado) return false;

      if (filtroKpi === 'kpi_si' && !ing.kpi) return false;
      if (filtroKpi === 'kpi_no' && ing.kpi) return false;

      return true;
    });
  }, [ingresos, searchText, filtroPeriodicidad, filtroTipo, filtroEstado, filtroPagado, filtroKpi, catalogoTipos]);

  // =========================================================
  // ✅ VACÍO INTELIGENTE (helpers únicos - sin duplicados)
  // =========================================================

  // "Filtros activos reales" para Pendientes (excluye estado/pagado/kpi porque están forzados)
  const isDefaultPendientesIngresosFilters = useMemo(() => {
    const hasSearch = searchText.trim().length > 0;
    const hasPeriodicidad = filtroPeriodicidad !== 'todos';
    const hasTipo = filtroTipo !== 'todos';
    return !(hasSearch || hasPeriodicidad || hasTipo);
  }, [searchText, filtroPeriodicidad, filtroTipo]);

  // Navegación a Gastos pendientes (ajusta aquí si tu ruta difiere)
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


  // =========================================================
  // Buscador avanzado
  // =========================================================

  const renderBuscador = () => {
    const canChangeFixedFilters = !isPendientes;

    const periodicidadHasData = (p: PeriodicidadFiltro) => {
      if (p === 'todos') return ingresos.length > 0;
      return (periodicidadStats[p] ?? 0) > 0;
    };

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
            placeholder="Concepto, cuenta, tipo…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        {/* PERIODICIDAD (PLEGABLE) */}
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

        {/* TIPO DE INGRESO (PLEGABLE) */}
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

        {/* ESTADO (PLEGABLE) */}
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

        {/* PAGADO (PLEGABLE) */}
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

        {/* KPI (PLEGABLE) */}
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

  // ============================
  // ✅ Regla final: Reiniciar mes
  // ============================
  const effectiveIngresosPendientesCount = useMemo(() => {
    // Si estás en "pendientes", ya estás viendo EXACTAMENTE los pendientes.
    if (isPendientes) return ingresos.length;

    // Si estás en "todos", dependemos del count via API.
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

  // ============================
  // Contenido
  // ============================
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

    // ✅ Estado vacío inteligente + fallback legacy
    if (ingresosFiltrados.length === 0) {
      const isPendientesView = filtro === 'pendientes';

      if (isPendientesView) {
        // En pendientes: ingresos === pendientes
        const noHayIngresosPendientes = ingresos.length === 0;

        // Solo si el vacío NO es por búsqueda/filtros reales
        if (isDefaultPendientesIngresosFilters && noHayIngresosPendientes) {
          const gastosPend = gastosPendientesCount;

          // Caso 2: no hay ingresos pendientes, pero sí gastos pendientes
          if (gastosPend > 0) {
            return renderEmptyOkState({
              showButton: true,
              buttonLabel: `Ver ${gastosPend} gastos pendientes`,
              onPress: goToGastosPendientes,
            });
          }

          // Caso 1: no hay ingresos pendientes ni gastos pendientes
          return renderEmptyOkState({ showButton: false });
        }
      }

      // Vacío por filtros (o no estamos en Pendientes): mantenemos mensaje legacy
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
      >
        {ingresosFiltrados.map((ing) => {
          const titulo = ing.concepto || 'SIN CONCEPTO';
          const category = getNombreTipoIngreso(ing, catalogoTipos);

          return (
            <ExpenseCard
              key={ing.id}
              title={titulo}
              category={category}
              dateLabel={formatRangoCobroLabel(ing)}
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
        /**
         * ✅ Header:
         * - Si se cumplen requisitos: icono de reinicio (calendar-outline).
         * - Si no: mantenemos el "+" legacy.
         */
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
