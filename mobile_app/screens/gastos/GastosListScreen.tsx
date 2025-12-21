// screens/gastos/GastosListScreen.tsx
import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { Chip } from '../../components/ui/Chip';
import { FilterPill } from '../../components/ui/FilterPill';
import { FilterRow } from '../../components/ui/FilterRow';
import { ExpenseCard } from '../../components/cards/ExpenseCard';

import {
  FiltroGastos,
  Gasto,
  marcarGastoComoPagado,
  eliminarGasto,
  fetchTiposGasto,
  TipoGasto,
  Proveedor,
  fetchProveedores,
} from '../../services/gastosApi';

import {
  GastoCotidiano,
  fetchGastosCotidianos,
  eliminarGastoCotidiano,
} from '../../services/gastosCotidianosApi';

import { TIPOS_COTIDIANO } from '../../constants/gastosCotidianos';
import {
  PERIODICIDAD_OPTIONS,
  type PeriodicidadFiltro,
} from '../../constants/general';
import { EuroformatEuro } from '../../utils/format';
import { colors,spacing } from '../../theme';
import {
  ActionSheet,
  ActionSheetAction,
} from '../../components/modals/ActionSheet';
import { useGastos } from '../../hooks/useGastos';
import { listStyles as styles } from '../../components/list/listStyles';
import screenStyles from '../styles/screenStyles';

// Tipo local que amplía FiltroGastos con 'cotidiano'
type FiltroLista = FiltroGastos | 'cotidiano';

const filtros: { label: string; value: FiltroLista }[] = [
  { label: 'Pendientes', value: 'pendientes' },
  { label: 'Todos', value: 'todos' },
  { label: 'Cotidianos', value: 'cotidiano' },
];

type ActivoFiltro = 'todos' | 'activo' | 'inactivo';
type KpiFiltro = 'todos' | 'si' | 'no';
type FiltroPagado = 'todos' | 'pagado' | 'no_pagado';
type FiltroSegmento = 'todos' | string;
type FiltroTipoGasto = 'todos' | string;
// NUEVO: filtro de quién paga en cotidianos
type FiltroQuienPaga = 'todos' | 'yo' | 'otro';

// ✅ NUEVO: params para “volver” perfecto
type RouteParams = {
  fromHome?: boolean;
  initialFiltro?: 'pendientes' | 'todos' | 'cotidiano';
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string;
};

// Mapa estático: tipo_id -> label (para cotidianos)
const TIPOS_COTIDIANO_LABEL_BY_ID: Record<string, string> =
  TIPOS_COTIDIANO.reduce((acc, t) => {
    acc[t.value] = t.label;
    return acc;
  }, {} as Record<string, string>);

/** Nombre del tipo de gasto cotidiano a partir del registro + constantes */
function getTipoCotidianoNombre(g: GastoCotidiano): string {
  const tipoNombreApi = (g as any).tipo_nombre as string | undefined;
  if (tipoNombreApi && tipoNombreApi.trim() !== '') {
    return tipoNombreApi;
  }

  if (g.tipo_id && TIPOS_COTIDIANO_LABEL_BY_ID[g.tipo_id]) {
    return TIPOS_COTIDIANO_LABEL_BY_ID[g.tipo_id];
  }

  return 'Sin tipo';
}

/** Devuelve la fecha en formato "2 de diciembre de 2025" */
function formatFechaLarga(fecha: string): string {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Icono Ionicons según tipo de gasto cotidiano */
function getIconNameForTipoCotidiano(g: GastoCotidiano): string {
  const label = getTipoCotidianoNombre(g).toUpperCase();

  if (label.includes('COMIDA') || label.includes('SUPERMERC')) {
    return 'cart-outline';
  }
  if (label.includes('RESTAUR')) {
    return 'restaurant-outline';
  }
  if (label.includes('HOTEL')) {
    return 'business-outline';
  }
  if (label.includes('ACTIVIDAD')) {
    return 'walk-outline';
  }
  if (label.includes('TRANSPORTE')) {
    return 'bus-outline';
  }
  if (label.includes('GASOLINA')) {
    return 'car-sport-outline';
  }
  if (label.includes('PEAJE')) {
    return 'car-outline';
  }
  if (label.includes('MANTENIMIENTO')) {
    return 'construct-outline';
  }
  if (label.includes('ELECTRICIDAD')) {
    return 'flash-outline';
  }
  if (label.includes('ROPA')) {
    return 'shirt-outline';
  }

  return 'pricetag-outline';
}

export const GastosListScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  // ============================
  // ✅ PARAMS SEGUROS + “VOLVER” PERFECTO
  // ============================
  const routeHook = useRoute<any>();
  const params: RouteParams = (routeHook?.params ?? route?.params ?? {}) as RouteParams;

  const fromHome: boolean = params.fromHome ?? false;

  const returnToTab = params.returnToTab;
  const returnToScreen = params.returnToScreen;

  const handleBack = useCallback(() => {
    // 1) Si venimos desde una “barra/click” y nos pasaron origen, volvemos exacto
    if (returnToTab && returnToScreen) {
      navigation.navigate(returnToTab, { screen: returnToScreen });
      return;
    }

    // 2) Caso legacy: venimos de Home
    if (fromHome) {
      navigation.navigate('HomeTab');
      return;
    }

    // 3) Back normal
    if (navigation?.canGoBack?.()) navigation.goBack();
  }, [navigation, returnToTab, returnToScreen, fromHome]);

  // Lee el filtro inicial que venga por params (cotidiano/pendientes/todos)
  const initialFiltroParam =
    (params.initialFiltro as FiltroLista | undefined) ?? 'pendientes';

  const [filtro, setFiltro] = useState<FiltroLista>(initialFiltroParam);

  // ======= Estados comunes / gestionables =======
  const [selectedGasto, setSelectedGasto] = useState<Gasto | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filtroActivo, setFiltroActivo] = useState<ActivoFiltro>('todos');
  const [filtroKpi, setFiltroKpi] = useState<KpiFiltro>('todos');
  const [filtroPagado, setFiltroPagado] = useState<FiltroPagado>('todos');
  const [filtroSegmento, setFiltroSegmento] = useState<FiltroSegmento>('todos');
  const [filtroTipoGasto, setFiltroTipoGasto] = useState<FiltroTipoGasto>('todos');
  // Periodicidad (para las pills de PERIODICIDAD_OPTIONS)
  const [filtroPeriodicidad, setFiltroPeriodicidad] =
    useState<PeriodicidadFiltro>('todos');

  // Mostrar/ocultar bloques de filtros (GESTIONABLES)
  const [showPeriodicidadFilter, setShowPeriodicidadFilter] = useState(false);
  const [showSegmentoFilter, setShowSegmentoFilter] = useState(false);
  const [showTiposGastoFilter, setShowTiposGastoFilter] = useState(false);
  const [showEstadoFilter, setShowEstadoFilter] = useState(false);
  const [showActivoFilter, setShowActivoFilter] = useState(false);
  const [showKpiFilter, setShowKpiFilter] = useState(false);

  const [tiposGasto, setTiposGasto] = useState<TipoGasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  const { gastos, loading, error, reload } = useGastos(
    filtro === 'cotidiano' ? 'pendientes' : filtro
  );

  // ======= Estados específicos de cotidianos =======
  const [gastosCotidianos, setGastosCotidianos] = useState<GastoCotidiano[]>([]);
  const [loadingCotidianos, setLoadingCotidianos] = useState(false);
  const [errorCotidianos, setErrorCotidianos] = useState<string | null>(null);

  const [selectedGastoCotidiano, setSelectedGastoCotidiano] =
    useState<GastoCotidiano | null>(null);

  const [filtroTipoCotidiano, setFiltroTipoCotidiano] = useState<string | 'todos'>('todos');

  // NUEVO: filtro de quién paga en cotidianos
  const [filtroQuienPaga, setFiltroQuienPaga] = useState<FiltroQuienPaga>('todos');

  const [fechaDesde, setFechaDesde] = useState<string | null>(null);
  const [fechaHasta, setFechaHasta] = useState<string | null>(null);
  const [showFechaDesdePicker, setShowFechaDesdePicker] = useState(false);
  const [showFechaHastaPicker, setShowFechaHastaPicker] = useState(false);

  // Mostrar/ocultar bloques de filtros (COTIDIANOS)
  const [showTipoCotidianoFilter, setShowTipoCotidianoFilter] = useState(false);
  const [showFechaFilter, setShowFechaFilter] = useState(false);
  const [showQuienPagaFilter, setShowQuienPagaFilter] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [tipoSeleccionadoSheet, setTipoSeleccionadoSheet] = useState<
    'gestionable' | 'cotidiano' | null
  >(null);

  const handleAddGasto = () => {
    navigation.navigate('NuevoGasto');
  };

  const isPendientesGestionables = filtro === 'pendientes';

  // ======= Plegar buscador al salir de la pantalla =======
  useFocusEffect(
    useCallback(() => {
      return () => {
        setBuscadorAbierto(false);
      };
    }, [])
  );

  // ======= Cargar tipos de gasto y proveedores =======
  useEffect(() => {
    const loadTiposYProveedores = async () => {
      try {
        const [tipos, provs] = await Promise.all([fetchTiposGasto(), fetchProveedores()]);
        setTiposGasto(tipos);
        setProveedores(provs);
      } catch (err) {
        console.error('Error al cargar tipos/proveedores', err);
      }
    };
    void loadTiposYProveedores();
  }, []);

  const mapaTiposPorId = useMemo(() => {
    const map = new Map<string, string>();
    tiposGasto.forEach((t) => {
      map.set(t.id, t.nombre);
    });
    return map;
  }, [tiposGasto]);

  const mapaProveedoresPorId = useMemo(() => {
    const map = new Map<string, string>();
    proveedores.forEach((p) => {
      map.set(p.id, p.nombre);
    });
    return map;
  }, [proveedores]);

  // Segmentos disponibles (para filtro por segmento, solo dinámicos)
  const segmentosDisponibles = useMemo(() => {
    const map = new Map<string, string>();
    gastos.forEach((g) => {
      if (g.segmento_id) {
        if (!map.has(g.segmento_id)) {
          map.set(g.segmento_id, g.segmento_nombre || 'Sin segmento');
        }
      }
    });
    return Array.from(map.entries()).map(([id, nombre]) => ({
      id,
      nombre,
    }));
  }, [gastos]);

  // ======= Cargar gastos cotidianos cuando filtro === 'cotidiano' =======
  const cargarGastosCotidianos = async () => {
    setLoadingCotidianos(true);
    try {
      const data = await fetchGastosCotidianos({ pagado: true });
      setGastosCotidianos(data);
      setErrorCotidianos(null);
    } catch (err: any) {
      console.error('Error al cargar gastos cotidianos', err);
      setErrorCotidianos(err?.message ?? 'No se han podido cargar los gastos cotidianos');
    } finally {
      setLoadingCotidianos(false);
    }
  };

  useEffect(() => {
    if (filtro === 'cotidiano') {
      void cargarGastosCotidianos();
    }
  }, [filtro]);

  // ======= Helpers de formato =======

  // Para gestionables: obtener nombre de segmento con fallback
  const getSegmentoNombre = (gasto: Gasto): string => {
    if (gasto.segmento_nombre && gasto.segmento_nombre.trim() !== '') {
      return gasto.segmento_nombre;
    }
    if (gasto.segmento_id && gasto.segmento_id.trim() !== '') {
      return gasto.segmento_id; // fallback técnico por si falla el backend
    }
    return 'Sin segmento';
  };

  // Para gestionables: "Gasto previsto del X al Y" usando rango_pago si existe
  const formatFechaRangoGestionable = (gasto: Gasto): string => {
    if (gasto.rango_pago) {
      const [desdeRaw, hastaRaw] = gasto.rango_pago.split('-').map((p) => p.trim());
      if (desdeRaw && hastaRaw) {
        return `Gasto previsto del ${desdeRaw} al ${hastaRaw}`;
      }
      // fallback si el formato de rango no es correcto
      return `Gasto previsto (${gasto.rango_pago})`;
    }
    const d = new Date(gasto.fecha);
    if (Number.isNaN(d.getTime())) {
      return gasto.fecha;
    }
    return `Gasto previsto el ${d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })}`;
  };

  const formatImporteNegativo = (importe: number): string => {
    // Siempre mostramos el gasto como salida: "- 50,00 €"
    return EuroformatEuro(-Math.abs(importe), 'signed');
  };

  // Para gestionables: segunda línea debe ser el SEGMENTO (nombre)
  const getCategoriaTextoGestionable = (gasto: Gasto): string => {
    return getSegmentoNombre(gasto);
  };

  // ======= Fijar filtros cuando estamos en "Pendientes" =======
  useEffect(() => {
    if (filtro === 'pendientes') {
      // Sólo aplicable en gestionables (no afecta a cotidianos)
      setFiltroActivo('activo');
      setFiltroPagado('no_pagado');
      setFiltroKpi('si');
    } else if (filtro === 'todos') {
      // En "Todos" devolvemos los filtros a estado libre
      setFiltroActivo('todos');
      setFiltroPagado('todos');
      setFiltroKpi('todos');
    }
    // Si filtro === 'cotidiano', no tocamos nada
  }, [filtro]);

  // ======= Filtros LOCALES para gestionables =======
  const gastosFiltrados = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    return gastos.filter((g) => {
      if (term.length > 0) {
        const hayCoincidencia =
          (g.nombre ?? '').toLowerCase().includes(term) ||
          (g.proveedor_nombre ?? '').toLowerCase().includes(term) ||
          (g.segmento_nombre ?? '').toLowerCase().includes(term) ||
          (g.tipo_nombre ?? '').toLowerCase().includes(term) ||
          (g.tienda ?? '').toLowerCase().includes(term);
        if (!hayCoincidencia) return false;
      }

      if (filtroSegmento !== 'todos') {
        if (g.segmento_id !== filtroSegmento) return false;
      }

      if (filtroTipoGasto !== 'todos') {
        if (g.tipo_id !== filtroTipoGasto) return false;
      }

      // Periodicidad
      if (filtroPeriodicidad !== 'todos') {
        const per = (g.periodicidad || '').toUpperCase();
        switch (filtroPeriodicidad) {
          case 'mensual':
            if (per !== 'MENSUAL') return false;
            break;
          case 'trimestral':
            if (per !== 'TRIMESTRAL') return false;
            break;
          case 'semestral':
            if (per !== 'SEMESTRAL') return false;
            break;
          case 'anual':
            if (per !== 'ANUAL') return false;
            break;
          case 'pago_unico':
            if (per !== 'PAGO UNICO') return false;
            break;
        }
      }

      if (filtroActivo === 'activo' && g.activo === false) return false;
      if (filtroActivo === 'inactivo' && g.activo !== false) return false;

      if (filtroPagado === 'pagado' && !g.pagado) return false;
      if (filtroPagado === 'no_pagado' && g.pagado) return false;

      if (filtroKpi !== 'todos') {
        const isKpi = g.kpi === true;
        if (filtroKpi === 'si' && !isKpi) return false;
        if (filtroKpi === 'no' && isKpi) return false;
      }

      return true;
    });
  }, [
    gastos,
    searchText,
    filtroSegmento,
    filtroTipoGasto,
    filtroActivo,
    filtroPagado,
    filtroKpi,
    filtroPeriodicidad,
  ]);

  // ======= Filtros LOCALES para cotidianos =======
  const aplicarFiltrosCotidianos = useMemo(() => {
    return (lista: GastoCotidiano[]): GastoCotidiano[] => {
      const term = searchText.trim().toLowerCase();

      return lista.filter((g) => {
        if (term.length > 0) {
          const proveedorNombre =
            (g as any).proveedor_nombre ??
            (g.proveedor_id ? mapaProveedoresPorId.get(g.proveedor_id) ?? '' : '');
          const tipoNombre = getTipoCotidianoNombre(g);

          const hayCoincidencia =
            proveedorNombre.toLowerCase().includes(term) ||
            tipoNombre.toLowerCase().includes(term) ||
            (g.observaciones ?? '').toLowerCase().includes(term) ||
            (g.localidad ?? '').toLowerCase().includes(term);
          if (!hayCoincidencia) return false;
        }

        if (filtroTipoCotidiano !== 'todos') {
          if (g.tipo_id !== filtroTipoCotidiano) return false;
        }

        // NUEVO: filtro "Quién paga"
        if (filtroQuienPaga !== 'todos') {
          const pagaYo = (g as any).paga_yo as boolean | null | undefined;
          if (filtroQuienPaga === 'yo' && pagaYo === false) return false;
          if (filtroQuienPaga === 'otro' && pagaYo === true) return false;
        }

        if (fechaDesde || fechaHasta) {
          const d = new Date(g.fecha);
          if (!Number.isNaN(d.getTime())) {
            if (fechaDesde) {
              const dDesde = new Date(fechaDesde);
              if (d < dDesde) return false;
            }
            if (fechaHasta) {
              const dHasta = new Date(fechaHasta);
              if (d > dHasta) return false;
            }
          }
        }

        return true;
      });
    };
  }, [
    searchText,
    filtroTipoCotidiano,
    filtroQuienPaga,
    fechaDesde,
    fechaHasta,
    mapaProveedoresPorId,
  ]);

  // ======= Stats para deshabilitar pills sin datos (gestionables) =======
  const statsPagado = useMemo(
    () => ({
      pagado: gastos.filter((g) => g.pagado).length,
      no_pagado: gastos.filter((g) => !g.pagado).length,
      todos: gastos.length,
    }),
    [gastos]
  );

  const statsActivo = useMemo(
    () => ({
      activo: gastos.filter((g) => g.activo !== false).length,
      inactivo: gastos.filter((g) => g.activo === false).length,
      todos: gastos.length,
    }),
    [gastos]
  );

  const statsKpi = useMemo(() => {
    let si = 0;
    let no = 0;
    gastos.forEach((g) => {
      const isKpi = g.kpi === true;
      if (isKpi) si += 1;
      else no += 1;
    });
    return { si, no, todos: gastos.length };
  }, [gastos]);

  // TIPOS DISPONIBLES (gestionables), filtrados por segmento + deshabilitados sin datos
  const tiposDisponiblesGestionables = useMemo(() => {
    // Conteo de gastos por tipo
    const counts: Record<string, number> = {};
    gastos.forEach((g) => {
      if (g.tipo_id) {
        counts[g.tipo_id] = (counts[g.tipo_id] ?? 0) + 1;
      }
    });

    // Filtramos catálogo por segmento (si hay filtroSegmento)
    const tiposFiltradosPorSegmento = tiposGasto.filter((t) => {
      if (filtroSegmento === 'todos') return true;
      return t.segmento_id === filtroSegmento;
    });

    return tiposFiltradosPorSegmento.map((t) => ({
      id: t.id,
      nombre: t.nombre || t.id,
      tieneGastos: (counts[t.id] ?? 0) > 0,
    }));
  }, [gastos, tiposGasto, filtroSegmento]);

  // Stats para tipos cotidianos (para deshabilitar cuando no haya datos)
  const statsTiposCotidiano = useMemo(() => {
    const counts: Record<string, number> = {};
    gastosCotidianos.forEach((g) => {
      if (g.tipo_id) {
        counts[g.tipo_id] = (counts[g.tipo_id] ?? 0) + 1;
      }
    });
    return counts;
  }, [gastosCotidianos]);

  // ======= Refresh (pull-to-refresh) =======
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (filtro === 'cotidiano') {
        await cargarGastosCotidianos();
      } else {
        await reload();
      }
    } catch (err) {
      console.error('Error al refrescar gastos', err);
    } finally {
      setRefreshing(false);
    }
  };

  // ======= Helpers de marcado como pagado con confirmación =======
  const handleMarcarComoPagadoGestionable = async (gasto: Gasto) => {
    try {
      await marcarGastoComoPagado(gasto.id);
      await reload();
    } catch (err) {
      console.error('Error al marcar como pagado', err);
      Alert.alert('Error', 'No se ha podido marcar el gasto como pagado.');
    }
  };

  const confirmarMarcarPagadoGestionable = (gasto: Gasto) => {
    Alert.alert(
      'Marcar como pagado',
      `¿Quieres marcar el gasto "${gasto.nombre}" como pagado?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Marcar como pagado',
          style: 'default',
          onPress: () => {
            void handleMarcarComoPagadoGestionable(gasto);
          },
        },
      ]
    );
  };

  const handleMarcarComoPagadoCotidiano = async (gasto: GastoCotidiano) => {
    try {
      await marcarGastoComoPagado(gasto.id);
      await cargarGastosCotidianos();
    } catch (err) {
      console.error('Error al marcar gasto cotidiano como pagado', err);
      Alert.alert('Error', 'No se ha podido marcar el gasto cotidiano como pagado.');
    }
  };

  const confirmarMarcarPagadoCotidiano = (gasto: GastoCotidiano) => {
    Alert.alert('Marcar como pagado', '¿Quieres marcar este gasto cotidiano como pagado?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Marcar como pagado',
        style: 'default',
        onPress: () => {
          void handleMarcarComoPagadoCotidiano(gasto);
        },
      },
    ]);
  };

  // ======= ActionSheet helpers =======
  const abrirMenuGestionable = (gasto: Gasto) => {
    setSelectedGasto(gasto);
    setTipoSeleccionadoSheet('gestionable');
    setSheetVisible(true);
  };

  const abrirMenuCotidiano = (gasto: GastoCotidiano) => {
    setSelectedGastoCotidiano(gasto);
    setTipoSeleccionadoSheet('cotidiano');
    setSheetVisible(true);
  };

  const getActionsForGastoGestionable = (gasto: Gasto | null): ActionSheetAction[] => {
    if (!gasto) return [];
    const acciones: ActionSheetAction[] = [];

    const verde = colors.actionSuccess;
    const rojo = colors.actionDanger;
    const amarillo = colors.actionWarning;
    const gris = colors.actionNeutral;
    const azul = colors.actionInfo;

    if (!gasto.pagado) {
      acciones.push({
        label: 'Marcar como pagado',
        onPress: () => {
          setSheetVisible(false);
          confirmarMarcarPagadoGestionable(gasto);
        },
        iconName: 'checkmark-circle-outline',
        color: verde,
      });
    }

    acciones.push({
      label: 'Editar gasto',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('GastoGestionableForm', { gasto });
      },
      iconName: 'create-outline',
      color: amarillo,
    });

    acciones.push({
      label: 'Duplicar gasto',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('GastoGestionableForm', {
          gasto,
          duplicate: true,
        });
      },
      iconName: 'copy-outline',
      color: azul,
    });

    acciones.push({
      label: 'Ver detalle',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('GastoGestionableForm', {
          gasto,
          readOnly: true,
        });
      },
      iconName: 'information-circle-outline',
      color: gris,
    });

    acciones.push({
      label: 'Eliminar gasto',
      onPress: () => {
        Alert.alert('Eliminar gasto', '¿Seguro que quieres eliminar este gasto?', [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: async () => {
              try {
                await eliminarGasto(gasto.id);
                setSheetVisible(false);
                await reload();
              } catch (err) {
                console.error('Error al eliminar gasto', err);
                Alert.alert('Error', 'No se ha podido eliminar el gasto. Inténtalo de nuevo.');
              }
            },
          },
        ]);
      },
      iconName: 'trash-outline',
      color: rojo,
      destructive: true,
    });

    return acciones;
  };

  const getActionsForGastoCotidiano = (gasto: GastoCotidiano | null): ActionSheetAction[] => {
    if (!gasto) return [];
    const acciones: ActionSheetAction[] = [];

    const rojo = '#b91c1c';
    const amarillo = '#eab308';
    const gris = '#4b5563';

    acciones.push({
      label: 'Editar gasto',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('GastoCotidianoForm', { gasto });
      },
      iconName: 'create-outline',
      color: amarillo,
    });

    acciones.push({
      label: 'Ver detalle',
      onPress: () => {
        setSheetVisible(false);
        navigation.navigate('GastoCotidianoForm', {
          gasto,
          readOnly: true,
        });
      },
      iconName: 'information-circle-outline',
      color: gris,
    });

    acciones.push({
      label: 'Eliminar gasto',
      onPress: () => {
        Alert.alert('Eliminar gasto', '¿Seguro que quieres eliminar este gasto cotidiano?', [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: async () => {
              try {
                await eliminarGastoCotidiano(gasto.id);
                setSheetVisible(false);
                await cargarGastosCotidianos();
              } catch (err) {
                console.error('Error al eliminar gasto cotidiano', err);
                Alert.alert(
                  'Error',
                  'No se ha podido eliminar el gasto cotidiano. Inténtalo de nuevo.'
                );
              }
            },
          },
        ]);
      },
      iconName: 'trash-outline',
      color: rojo,
      destructive: true,
    });

    return acciones;
  };

  const accionesSheet: ActionSheetAction[] =
    tipoSeleccionadoSheet === 'gestionable'
      ? getActionsForGastoGestionable(selectedGasto)
      : getActionsForGastoCotidiano(selectedGastoCotidiano);

  // ======= Buscador avanzado: GESTIONABLES =======
  const renderBuscadorGestionable = () => {
  // Reglas de “bloqueo” cuando estamos en Pendientes
  const disableByPendientes = isPendientesGestionables;

  // Flags de datos (para deshabilitar pills sin resultados)
  const hasPagadoData = statsPagado.pagado > 0;
  const hasNoPagadoData = statsPagado.no_pagado > 0;
  const hasAnyPagadoData = statsPagado.todos > 0;

  const hasActivoData = statsActivo.activo > 0;
  const hasInactivoData = statsActivo.inactivo > 0;
  const hasAnyActivoData = statsActivo.todos > 0;

  const hasKpiSiData = statsKpi.si > 0;
  const hasKpiNoData = statsKpi.no > 0;
  const hasAnyKpiData = statsKpi.todos > 0;

  return (
    <View style={styles.searchPanel}>
      {/* BUSCAR TEXTO (NO PLEGABLE) */}
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
          placeholder="Nombre, proveedor, segmento, tipo…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {/* PERIODICIDAD (PLEGABLE) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
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
              onPress={() => setFiltroPeriodicidad('todos')}
              style={styles.filterPill}
            />
          </View>

          {PERIODICIDAD_OPTIONS.map((opt) => {
            const selected = filtroPeriodicidad === opt.value;
            return (
              <View key={opt.value} style={styles.pillWrapper}>
                <FilterPill
                  label={opt.label}
                  selected={selected}
                  onPress={() => setFiltroPeriodicidad(selected ? 'todos' : opt.value)}
                  style={styles.filterPill}
                />
              </View>
            );
          })}
        </View>
      )}

      {/* SEGMENTO (PLEGABLE) */}
      {segmentosDisponibles.length > 0 && (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 12,
            }}
          >
            <Text style={styles.searchLabel}>Segmento</Text>
            <TouchableOpacity
              onPress={() => setShowSegmentoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showSegmentoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showSegmentoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showSegmentoFilter && (
            <View style={styles.pillsRowWrap}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={filtroSegmento === 'todos'}
                  onPress={() => setFiltroSegmento('todos')}
                  style={styles.filterPill}
                />
              </View>

              {segmentosDisponibles.map((seg) => {
                const selected = filtroSegmento === seg.id;
                return (
                  <View style={styles.pillWrapper} key={seg.id}>
                    <FilterPill
                      label={seg.nombre}
                      selected={selected}
                      onPress={() => setFiltroSegmento(seg.id)}
                      style={styles.filterPill}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* TIPO DE GASTO (PLEGABLE) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <Text style={styles.searchLabel}>Tipo de gasto</Text>
        <TouchableOpacity
          onPress={() => setShowTiposGastoFilter((prev) => !prev)}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Ionicons
            name={showTiposGastoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
            size={16}
            color={colors.textSecondary}
            style={{ marginRight: 4 }}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {showTiposGastoFilter ? 'Ocultar' : 'Mostrar'}
          </Text>
        </TouchableOpacity>
      </View>

      {showTiposGastoFilter && (
        <View style={styles.pillsRowWrap}>
          <View style={styles.pillWrapper}>
            <FilterPill
              label="Todos"
              selected={filtroTipoGasto === 'todos'}
              onPress={() => setFiltroTipoGasto('todos')}
              style={styles.filterPill}
            />
          </View>

          {tiposDisponiblesGestionables.map((t) => {
            const selected = filtroTipoGasto === t.id;
            const disabled = !t.tieneGastos;

            return (
              <View style={styles.pillWrapper} key={t.id}>
                <FilterPill
                  label={t.nombre}
                  selected={selected}
                  disabled={disabled}
                  onPress={() =>
                    setFiltroTipoGasto(selected ? 'todos' : (t.id as FiltroTipoGasto))
                  }
                  style={styles.filterPill}
                />
              </View>
            );
          })}
        </View>
      )}

      {/* ESTADO (PAGADO) PLEGABLE */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
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
              selected={filtroPagado === 'todos'}
              disabled={disableByPendientes || !hasAnyPagadoData}
              onPress={() => setFiltroPagado('todos')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="Pagado"
              selected={filtroPagado === 'pagado'}
              disabled={disableByPendientes || !hasPagadoData}
              onPress={() => setFiltroPagado('pagado')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="No pagado"
              selected={filtroPagado === 'no_pagado'}
              disabled={disableByPendientes || !hasNoPagadoData}
              onPress={() => setFiltroPagado('no_pagado')}
              style={styles.filterPill}
            />
          </View>
        </View>
      )}

      {/* ACTIVO (PLEGABLE) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <Text style={styles.searchLabel}>Activo</Text>
        <TouchableOpacity
          onPress={() => setShowActivoFilter((prev) => !prev)}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Ionicons
            name={showActivoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
            size={16}
            color={colors.textSecondary}
            style={{ marginRight: 4 }}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {showActivoFilter ? 'Ocultar' : 'Mostrar'}
          </Text>
        </TouchableOpacity>
      </View>

      {showActivoFilter && (
        <View style={styles.pillsRow}>
          <View style={styles.pillWrapper}>
            <FilterPill
              label="Todos"
              selected={filtroActivo === 'todos'}
              disabled={disableByPendientes || !hasAnyActivoData}
              onPress={() => setFiltroActivo('todos')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="Solo activos"
              selected={filtroActivo === 'activo'}
              disabled={disableByPendientes || !hasActivoData}
              onPress={() => setFiltroActivo('activo')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="Solo inactivos"
              selected={filtroActivo === 'inactivo'}
              disabled={disableByPendientes || !hasInactivoData}
              onPress={() => setFiltroActivo('inactivo')}
              style={styles.filterPill}
            />
          </View>
        </View>
      )}

      {/* KPI (PLEGABLE) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
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
              disabled={disableByPendientes || !hasAnyKpiData}
              onPress={() => setFiltroKpi('todos')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="KPI sí"
              selected={filtroKpi === 'si'}
              disabled={disableByPendientes || !hasKpiSiData}
              onPress={() => setFiltroKpi('si')}
              style={styles.filterPill}
            />
          </View>

          <View style={styles.pillWrapper}>
            <FilterPill
              label="KPI no"
              selected={filtroKpi === 'no'}
              disabled={disableByPendientes || !hasKpiNoData}
              onPress={() => setFiltroKpi('no')}
              style={styles.filterPill}
            />
          </View>
        </View>
      )}
    </View>
  );
};


  // ======= Buscador avanzado: COTIDIANOS =======
  const renderBuscadorCotidiano = () => {
    return (
      <View style={styles.searchPanel}>
        {/* BUSCAR TEXTO (NO PLEGABLE) */}
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
            placeholder="Proveedor, tipo, notas, localidad…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        {/* TIPO (PLEGABLE) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          <Text style={styles.searchLabel}>Tipo</Text>
          <TouchableOpacity
            onPress={() => setShowTipoCotidianoFilter((prev) => !prev)}
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons
              name={showTipoCotidianoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
              size={16}
              color={colors.textSecondary}
              style={{ marginRight: 4 }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {showTipoCotidianoFilter ? 'Ocultar' : 'Mostrar'}
            </Text>
          </TouchableOpacity>
        </View>

        {showTipoCotidianoFilter && (
          <View style={styles.pillsRowWrap}>
            <View style={styles.pillWrapper}>
              <FilterPill
                label="Todos"
                selected={filtroTipoCotidiano === 'todos'}
                onPress={() => setFiltroTipoCotidiano('todos')}
                style={styles.filterPill}
              />
            </View>

            {TIPOS_COTIDIANO.map((t) => {
              const selected = filtroTipoCotidiano === t.value;
              const count = statsTiposCotidiano[t.value] ?? 0;

              return (
                <View style={styles.pillWrapper} key={t.value}>
                  <FilterPill
                    label={t.label}
                    selected={selected}
                    disabled={count === 0}
                    onPress={() => setFiltroTipoCotidiano(selected ? 'todos' : t.value)}
                    style={styles.filterPill}
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* FECHA (PLEGABLE) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          <Text style={styles.searchLabel}>Fecha</Text>
          <TouchableOpacity
            onPress={() => setShowFechaFilter((prev) => !prev)}
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons
              name={showFechaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
              size={16}
              color={colors.textSecondary}
              style={{ marginRight: 4 }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {showFechaFilter ? 'Ocultar' : 'Mostrar'}
            </Text>
          </TouchableOpacity>
        </View>

        {showFechaFilter && (
          <View style={styles.dateFilterRow}>
            <View style={styles.dateButtonsContainer}>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowFechaDesdePicker(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.dateButtonText}>
                  {fechaDesde ? `Desde: ${formatFechaLarga(fechaDesde)}` : 'Desde'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowFechaHastaPicker(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.dateButtonText}>
                  {fechaHasta ? `Hasta: ${formatFechaLarga(fechaHasta)}` : 'Hasta'}
                </Text>
              </TouchableOpacity>
            </View>

            {(fechaDesde || fechaHasta) && (
              <TouchableOpacity
                style={styles.clearDateButton}
                onPress={() => {
                  setFechaDesde(null);
                  setFechaHasta(null);
                }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {showFechaDesdePicker && (
          <DateTimePicker
            value={fechaDesde ? new Date(fechaDesde) : new Date()}
            mode="date"
            display="default"
            onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
              setShowFechaDesdePicker(false);
              if (event.type === 'set' && selectedDate) {
                setFechaDesde(selectedDate.toISOString().slice(0, 10));
              }
            }}
          />
        )}

        {showFechaHastaPicker && (
          <DateTimePicker
            value={fechaHasta ? new Date(fechaHasta) : new Date()}
            mode="date"
            display="default"
            onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
              setShowFechaHastaPicker(false);
              if (event.type === 'set' && selectedDate) {
                setFechaHasta(selectedDate.toISOString().slice(0, 10));
              }
            }}
          />
        )}

        {/* QUIÉN PAGA (PLEGABLE) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          <Text style={styles.searchLabel}>Quién paga</Text>
          <TouchableOpacity
            onPress={() => setShowQuienPagaFilter((prev) => !prev)}
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons
              name={showQuienPagaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
              size={16}
              color={colors.textSecondary}
              style={{ marginRight: 4 }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {showQuienPagaFilter ? 'Ocultar' : 'Mostrar'}
            </Text>
          </TouchableOpacity>
        </View>

        {showQuienPagaFilter && (
          <View style={styles.pillsRow}>
            <View style={styles.pillWrapper}>
              <FilterPill
                label="Todos"
                selected={filtroQuienPaga === 'todos'}
                onPress={() => setFiltroQuienPaga('todos')}
                style={styles.filterPill}
              />
            </View>

            <View style={styles.pillWrapper}>
              <FilterPill
                label="Pagado por mí"
                selected={filtroQuienPaga === 'yo'}
                onPress={() => setFiltroQuienPaga('yo')}
                style={styles.filterPill}
              />
            </View>

            <View style={styles.pillWrapper}>
              <FilterPill
                label="Lo paga otro"
                selected={filtroQuienPaga === 'otro'}
                onPress={() => setFiltroQuienPaga('otro')}
                style={styles.filterPill}
              />
            </View>
          </View>
        )}
      </View>
    );
  };

  // ======= Contenido principal (lista) =======
  const renderContenido = () => {
    if (filtro === 'cotidiano') {
      if (loadingCotidianos) {
        return (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando gastos cotidianos…</Text>
          </View>
        );
      }

      if (errorCotidianos) {
        return (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{errorCotidianos}</Text>
          </View>
        );
      }

      const listaFiltrada = aplicarFiltrosCotidianos(gastosCotidianos);

      // Ordenar de más reciente a más antiguo
      const listaOrdenada = [...listaFiltrada].sort((a, b) => {
        const ta = new Date(a.fecha).getTime();
        const tb = new Date(b.fecha).getTime();
        if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
        return tb - ta; // descendente
      });

      if (listaOrdenada.length === 0) {
        return (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              No hay gastos cotidianos que coincidan con el filtro.
            </Text>
          </View>
        );
      }

      return (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {listaOrdenada.map((g) => {
            const titulo = (() => {
              const nombreApi = (g as any).proveedor_nombre as string | undefined;
              if (nombreApi && nombreApi.trim() !== '') return nombreApi;
              if (g.proveedor_id) {
                const nombre = mapaProveedoresPorId.get(g.proveedor_id);
                if (nombre) return nombre;
              }
              return 'Sin proveedor';
            })();

            const categoria = getTipoCotidianoNombre(g);
            const iconNameOverride = getIconNameForTipoCotidiano(g);

            return (
              <ExpenseCard
                key={g.id}
                // 1ª línea: proveedor
                title={titulo}
                // 2ª línea: tipo de gasto cotidiano
                category={categoria}
                // 3ª línea: fecha larga
                dateLabel={formatFechaLarga(g.fecha)}
                amountLabel={formatImporteNegativo(g.importe)}
                segmentoId="COTIDIANO"
                inactive={false}
                iconNameOverride={iconNameOverride}
                onOptionsPress={() => abrirMenuCotidiano(g)}
                onPress={() =>
                  navigation.navigate('GastoCotidianoForm', {
                    gasto: g,
                    readOnly: true,
                  })
                }
                actionIconName={g.pagado ? 'checkmark-done-outline' : 'cash-outline'}
                onActionPress={g.pagado ? undefined : () => confirmarMarcarPagadoCotidiano(g)}
              />
            );
          })}
        </ScrollView>
      );
    }

    // ===== Gestionables =====
    if (loading && gastos.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando gastos…</Text>
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

    const lista = gastosFiltrados;

    if (lista.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No hay gastos que coincidan con el filtro.</Text>
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
        {lista.map((gasto) => (
          <ExpenseCard
            key={gasto.id}
            // 1ª línea: nombre del gasto
            title={gasto.nombre}
            // 2ª línea: segmento (nombre)
            category={getCategoriaTextoGestionable(gasto)}
            // 3ª línea: "Gasto previsto del X al Y" o fecha
            dateLabel={formatFechaRangoGestionable(gasto)}
            amountLabel={formatImporteNegativo(gasto.importe)}
            segmentoId={gasto.segmento_id}
            inactive={gasto.activo === false}
            onOptionsPress={() => abrirMenuGestionable(gasto)}
            // Tap = ver detalle
            onPress={() =>
              navigation.navigate('GastoGestionableForm', {
                gasto,
                readOnly: true,
              })
            }
            // Botón billete con confirmación
            actionIconName={gasto.pagado ? 'checkmark-done-outline' : 'cash-outline'}
            onActionPress={
              gasto.pagado ? undefined : () => confirmarMarcarPagadoGestionable(gasto)
            }
          />
        ))}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Gastos"
        subtitle="Muestra todos tus gastos. Desde la parte de gastos gestionables como los del día a día."
        showBack
        onBackPress={handleBack}
        onAddPress={handleAddGasto}
      />

      <View style={styles.screen}>
        <View style={screenStyles.topArea}>
          <FilterRow columns={3} gap={spacing.sm}>
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
                {filtro === 'cotidiano' ? renderBuscadorCotidiano() : renderBuscadorGestionable()}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.bottomArea}>{renderContenido()}</View>

        <ActionSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          title="Acciones sobre el gasto"
          actions={accionesSheet}
        />
      </View>
    </>
  );
};

export default GastosListScreen;
