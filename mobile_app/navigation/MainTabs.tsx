// mobile_app/navigation/MainTabs.tsx
// -----------------------------------------------------------------------------
// Objetivo del cambio (simple y sin romper nada):
// - Mantener tu navegación tal cual.
// - FIXES (fase fixed - MAIN):
//     1) Barra "Cotidianos" -> GastosListScreen con chip "Cotidianos" seleccionado (ya existía el param).
//     2) "Liquidez total" (tarjeta) -> Balance (MonthBalanceScreen).
//     3) Barra "Total gasto" -> Análisis día a día (DayToDayAnalysisScreen).
// - Back/volver: pasamos returnToTab/returnToScreen a destinos para que puedan volver a Home.
// - Botones "i" de información:
//     - En Home: el InfoButton va A LA DERECHA del título (alineado al final del header de sección).
//     - Además, dejamos los "i" contextuales dentro de tarjetas donde ya los tenías (Liquidez total, Presupuesto vs real).
// - NO se elimina ninguna funcionalidad existente.
// -----------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { NavigatorScreenParams, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { panelStyles } from '../components/panels/panelStyles';

import ConfiguracionScreen from '../screens/configuracion/configuracionScreen';
import DiaADiaScreen from '../screens/dia/DiaADiaScreen';
import MesScreen from '../screens/mes/MesScreen';
import ResumenScreen from '../screens/mes/resumenScreen';
import BalanceScreen from '../screens/mes/balanceScreen';
import PatrimonioScreen from '../screens/patrimonio/patrimonioScreen';

import { GastosListScreen } from '../screens/gastos/GastosListScreen';
import { NuevoGastoScreen } from '../screens/gastos/NuevoGastoScreen';
import { GastoCotidianoFormScreen } from '../screens/gastos/GastoCotidianoFormScreen';
import { GastoGestionableFormScreen } from '../screens/gastos/GastoGestionableFormScreen';

import IngresoListScreen from '../screens/ingresos/IngresoListScreen';
import { NuevoIngresoScreen } from '../screens/ingresos/NuevoIngresoScreen';
import IngresoFormScreen from '../screens/ingresos/IngresoFormScreen';

import DayToDayAnalysisScreen from '../screens/dia/DayToDayAnalysisScreen';
import MovimientosScreen from '../screens/dia/MovimientosScreen';
import MovimientosCuentasScreen from '../screens/mes/MovimientosCuentasScreen';
import ExtraordinariosScreen from '../screens/mes/extraordinarios';

import { AuxTablesHomeScreen } from '../screens/auxiliares/AuxTablesHomeScreen';
import { AuxEntityListScreen } from '../screens/auxiliares/AuxEntityListScreen';
import { AuxEntityFormScreen } from '../screens/auxiliares/AuxEntityFormScreen';

import { useHomeDashboard } from '../hooks/useHomeDashboard';
import { EuroformatEuro } from '../utils/format';
import PropiedadesStack from './PropiedadesStack';
import LocalidadFormScreen from '../screens/ubicaciones/LocalidadFormScreen';
import PrestamosStack from './PrestamosStacks';

import CierreListScreen from '../screens/cierres/CierreListScreen';
import CierreDetalleScreen from '../screens/cierres/CierreDetalleScreen';
import CierreKpiScreen from '../screens/cierres/CierreKpiScreen';
import CierreEditScreen from '../screens/cierres/CierreEditScreen';

import { CuentasBancariasListScreen } from '../screens/cuentas/CuentasBancariasListScreen';
import { CuentaBancariaFormScreen } from '../screens/cuentas/CuentaBancariaFormScreen';
import GestionDbScreen from '../screens/bd/gestionDbScreen';
import ReinciarCierreScreen from '../screens/cierres/ReinciarCierreScreen';
import ReiniciarMesScreen from '../screens/cierres/ReiniciarMesScreen';
import ReiniciarMesPreviewScreen from '../screens/cierres/ReiniciarMesPreviewScreen';
import InversionesStack from './InversionesStack'


// ✅ Sistema reusable de info “i”
import { InfoButton, InfoModal, useInfoModal } from '../components/ui/InfoModal';


// --------------------
// Tipos de navegación
// --------------------

export type MainTabsParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  DayToDayTab: NavigatorScreenParams<DayToDayStackParamList>;
  MonthTab: NavigatorScreenParams<MonthStackParamList>;
  PatrimonyTab: NavigatorScreenParams<PatrimonyStackParamList>;
};

export type HomeStackParamList = {
  HomeScreen: undefined;
  SettingsHomeScreen: undefined;

  AuxTablesHome: undefined;
  AuxEntityList:
    | {
        auxType: string;
        origin?: 'config';
      }
    | undefined;
  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;

        returnTo?: string;
        returnKey?: string;

        auxResult?: {
          type: string;
          item: any;
          key?: string | null;
          mode?: 'created' | 'updated';
        };
      }
    | undefined;
  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  CuentasBancariasList: undefined;
  CuentaBancariaForm: undefined;
  DatabaseTools: undefined;
};

export type DayToDayStackParamList = {
  DayToDayHomeScreen: undefined;

  GastosList:
    | {
        initialFiltro?: 'pendientes' | 'todos' | 'cotidiano';
        fromDiaADia?: boolean;
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  IngresosList:
    | {
        fromDiaADia?: boolean;
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  // ✅ ampliamos params para “volver perfecto”
  DayToDayAnalysisScreen:
    | {
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MovimientosScreen: undefined;

  NuevoGasto: undefined;

  GastoGestionableForm:
    | {
        id?: string;
        gasto?: any;
        readOnly?: boolean;
        preset?: 'extra';
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  GastoCotidianoForm:
    | {
        id?: string;
        gasto?: any;
        readOnly?: boolean;
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;
        onCreated?: (item: any) => void;
      }
    | undefined;

  NuevoIngreso:
    | {
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  IngresoForm:
    | {
        ingreso?: Record<string, any>;
        mode?: 'gestionable' | 'extraordinario';
        readOnly?: boolean;
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;
};

export type MonthStackParamList = {
  MonthHomeScreen: undefined;
  MonthResumenScreen: undefined;

  MonthBalanceScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MonthExtraordinariosScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MovimientosScreen: {
    year: number;
    month: number;
    cuentaId: string | null;
  };
  MovimientosCuentasScreen: {
    year: number;
    month: number;
    cuentaId: string | null;
  };

  MesHome: undefined;

  // Cierres
  CierreListScreen: undefined;
  CierreKpiScreen: undefined;
  CierreEditScreen: { cierreId: string } | undefined;

  // IMPORTANTE: tu listado navega pasando { cierreId, cierre }
  CierreDetalleScreen: { cierreId: string; cierre?: any };

  ReinciarCierreScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  ReiniciarMesScreen: { anio: number; mes: number; cierreId: string | null };
  ReiniciarMesPreviewScreen: { anio: number; mes: number };
};

export type PatrimonyStackParamList = {
  PatrimonyHomeScreen: undefined;
  PropiedadesStack: undefined;
  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;

        returnTo?: string;
        returnKey?: string;
        returnRouteKey?: string;

        auxResult?: {
          type: string;
          item: any;
          key?: string | null;
          mode?: 'created' | 'updated';
        };
      }
    | undefined;

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  PrestamosStack: undefined;
  InversionesStack: undefined;
};

// --------------------
// Creación de navegadores
// --------------------

const Tab = createBottomTabNavigator<MainTabsParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const DayToDayStack = createNativeStackNavigator<DayToDayStackParamList>();
const MonthStack = createNativeStackNavigator<MonthStackParamList>();
const PatrimonyStack = createNativeStackNavigator<PatrimonyStackParamList>();

// --------------------
// Helpers
// --------------------

const MONTHS_ES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

function getMonthLabelES(month: number, year: number) {
  const name = MONTHS_ES[Math.max(0, Math.min(11, month - 1))] ?? 'MES';
  return `${name} ${year}`;
}

function safeRatio(n: number, d: number) {
  if (!d || d <= 0) return 0;
  return Math.min(1, Math.max(0, n / d));
}

function formatMovDateTime(raw: string): string {
  if (!raw) return '—';

  const cleaned = raw.replace(' T:', 'T').trim();
  const m = cleaned.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );

  if (m) {
    const [, yyyy, mm, dd, hh = '00', mi = '00', ss = '00'] = m;
    const date = `${dd}-${mm}-${yyyy}`;
    if (hh === '00' && mi === '00' && ss === '00') return date;
    return `${date} ${hh}:${mi}`;
  }

  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');

    const date = `${dd}-${mm}-${yyyy}`;
    if (hh === '00' && mi === '00' && ss === '00') return date;
    return `${date} ${hh}:${mi}`;
  }

  return raw;
}

function getMovimientoTipoLabel(m: any): string {
  if (m?.tipo === 'GASTO_COTIDIANO') {
    return (
      m?.tipo_gasto_nombre ||
      m?.tipoGastoNombre ||
      m?.tipo_nombre ||
      m?.tipoNombre ||
      m?.categoria ||
      'Cotidianos'
    );
  }

  return String(m?.tipo ?? '').replaceAll('_', ' ') || '—';
}

// --------------------
// Header especial para Home
// --------------------

const HomeHeader: React.FC<{
  monthLabel: string;
  saldoPrevisto?: number | null;
  hideAmounts: boolean;
  onToggleHide: () => void;
}> = ({ monthLabel, saldoPrevisto, hideAmounts, onToggleHide }) => {
  const navigation = useNavigation<any>();

  // Cadena fija de máscara (sencillo y visible).
  const masked = '***********';

  return (
    <SafeAreaView style={styles.homeHeaderSafeArea} edges={['top']}>
      <View style={styles.homeHeaderContainer}>
        <View style={styles.homeHeaderTopRow}>
          <View>
            <Text style={styles.headerTitleSmall}>GapptoMobile</Text>
            <Text style={styles.headerMonthLarge}>{monthLabel}</Text>
          </View>

          <View style={styles.headerRightIcons}>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={onToggleHide}
              accessibilityRole="button"
              accessibilityLabel={hideAmounts ? 'Mostrar importes' : 'Ocultar importes'}
            >
              <Ionicons
                name={hideAmounts ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => navigation.navigate('SettingsHomeScreen')}
              accessibilityRole="button"
              accessibilityLabel="Configuración"
            >
              <Ionicons name="settings-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.homeHeaderBottomRow}>
          <View>
            <Text style={styles.homeHello}>Hola MOISÉS</Text>
            <Text style={styles.homeSubtitle}>Resumen rápido de tu mes financiero.</Text>
          </View>

          <View style={styles.homeSaldoContainer}>
            <Text style={styles.homeSaldoLabel}>Saldo fin de mes (estimado)</Text>
            <Text style={styles.homeSaldoValue}>
              {saldoPrevisto == null
                ? '–'
                : hideAmounts
                ? masked
                : EuroformatEuro(saldoPrevisto, 'signed')}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

// --------------------
// INFO TEXTOS HOME (reutilizable)
// --------------------

const HOME_INFO: Record<string, string> = {
  resumen_rapido:
    'Tarjetas de acceso rápido a indicadores clave del mes: liquidez, ingresos cobrados y gastos (gestionables y cotidianos).',
  acciones_rapidas:
    'Accesos directos para crear movimientos sin navegar por menús: gasto extra, gasto cotidiano e ingreso extra.',
  presupuesto_mensual:
    'Comparación entre real y presupuesto. Cada barra muestra cuánto llevas consumido/cobrado frente a lo previsto.',
  actividad_reciente:
    'Últimos movimientos registrados. Útil para validar que lo reciente está bien categorizado y fechado.',
  patrimonio:
    'Resumen de tus propiedades: valor de mercado, NOI anual, equity y métricas derivadas (NOI/VM y LTV aproximado).',
  liquidez_total:
    'Liquidez total: saldo actual agregado de cuentas. Pulsar te lleva a Balance para ver el detalle.',
  total_gasto:
    'Total gasto: barra agregada del gasto del mes. Pulsar te lleva a Análisis día a día.',
};

// --------------------
// PANTALLA HOME
// --------------------

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { year, month, data, loading, refreshing, error, refresh } = useHomeDashboard();

  const monthLabel = useMemo(() => getMonthLabelES(month, year), [month, year]);

  // Estado local para ocultar/mostrar importes en HOME
  const [hideAmounts, setHideAmounts] = useState(false);
  const masked = '***********';

  // ✅ modal de info reutilizable (mismo patrón que ResumenScreen)
  const info = useInfoModal();

  const fmt = (value: number | null | undefined, mode: any) => {
    if (value == null) return '–';
    return hideAmounts ? masked : EuroformatEuro(value, mode);
  };

  const fmtPct = (value: number | null | undefined) => {
    if (value == null) return '—';
    return hideAmounts ? masked : `${value.toFixed(2)}%`;
  };

  const goGastoExtra = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastoGestionableForm',
      params: {
        preset: 'extra',
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  const goCotidiano = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastoCotidianoForm',
      params: {
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  const goIngresoExtra = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'IngresoForm',
      params: { mode: 'extraordinario' },
    });
  };

  const goVerMovimientos = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'MovimientosScreen',
      params: {
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  // ✅ Ahora abrimos el ranking directamente
  const goVerPropiedades = () => {
    navigation.navigate('PatrimonyTab', { screen: 'PropiedadesStack' });
  };

  // -------------------------
  // FIX #2: “Liquidez total” -> Balance
  // -------------------------
  const goLiquidezToBalance = () => {
    navigation.navigate('MonthTab', {
      screen: 'MonthBalanceScreen',
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  // -------------------------
  // FIX #3: “Total gasto” -> Análisis día a día
  // -------------------------
  const goBarTotalGasto = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'DayToDayAnalysisScreen',
      params: {
        fromHome: true,
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  const goBarIngresos = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'IngresosList',
      params: { fromHome: true, returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  const goBarGestionables = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastosList',
      params: {
        initialFiltro: 'pendientes',
        fromHome: true,
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  // FIX #1: barra “Cotidianos” -> GastosList con initialFiltro 'cotidiano'
  const goBarCotidianos = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastosList',
      params: {
        initialFiltro: 'cotidiano',
        fromHome: true,
        returnToTab: 'HomeTab',
        returnToScreen: 'HomeScreen',
      },
    });
  };

  const goBarExtras = () => {
    navigation.navigate('MonthTab', {
      // Nota: mantenemos tu payload como estaba para no romper nada.
      initialFiltro: 'cotidiano',
      screen: 'MonthExtraordinariosScreen',
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  // Datos para tarjetas y barras (HOME)
  const liquidezTotal = data?.liquidezTotal ?? null;
  const ingresosMes = data?.ingresosMes ?? null;

  const gastosGestionablesMes = data?.gestionablesReal ?? null;
  const gastosCotidianosMes = data?.cotidianosReal ?? null;

  // Datos para barras
  const totalGastoActual = data?.totalGastoReal ?? 0;
  const totalGastoPresupuesto = data?.totalGastoPresupuestado ?? 0;

  const ingresosRecibidos = data?.ingresosMes ?? 0;
  const ingresosPrevistos = data?.ingresosPresupuestados ?? 0;

  const gestionablesPagados = data?.gestionablesReal ?? 0;
  const gestionablesPresupuestados = data?.gestionablesPresupuestado ?? 0;

  const cotidianosConsumidos = data?.cotidianosReal ?? 0;
  const cotidianosPresupuestados = data?.cotidianosPresupuestado ?? 0;

  // Patrimonio (Home)
  const patPropsCount = data?.patrimonioPropiedadesCount ?? 0;
  const patValorMercadoTotal = data?.patrimonioValorMercadoTotal ?? null;
  const patNoiTotal = data?.patrimonioNoiTotal ?? null;
  const patEquityTotal = data?.patrimonioEquityTotal ?? null;
  const patBrutoMedioPct = data?.patrimonioRentabilidadBrutaMediaPct ?? null;

  // Extras pro
  const patNoiSobreVmPct = data?.patrimonioNoiSobreVmPct ?? null;
  const patLtvAproxPct = data?.patrimonioLtvAproxPct ?? null;

  return (
    <>
      <View style={panelStyles.screen}>
        <HomeHeader
          monthLabel={monthLabel}
          saldoPrevisto={data?.saldoPrevistoFinMes ?? null}
          hideAmounts={hideAmounts}
          onToggleHide={() => setHideAmounts((v) => !v)}
        />

        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
          {error && (
            <View style={panelStyles.section}>
              <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          {loading && !data && (
            <View style={panelStyles.section}>
              <View style={[panelStyles.card, { alignItems: 'center', paddingVertical: 16 }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ marginTop: 8, fontSize: 12, color: colors.textSecondary }}>
                  Cargando panel...
                </Text>
              </View>
            </View>
          )}

          {/* ============================================================
              RESUMEN RÁPIDO
              - ✅ Cambio: header de sección con icono a la izquierda
                + InfoButton alineado a la derecha (fin de la tarjeta/sección).
             ============================================================ */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Resumen rápido</Text>
              </View>

              <InfoButton
                align="title"
                onPress={() => info.open('Resumen rápido', HOME_INFO.resumen_rapido)}
              />
            </View>

            <View style={styles.summaryRowTop}>
              {/* ✅ FIX #2: Liquidez total pulsable -> Balance */}
              <TouchableOpacity
                style={styles.summaryTopCard}
                onPress={goLiquidezToBalance}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Ver balance de liquidez"
              >
                <View style={styles.summaryIconCircle}>
                  <Ionicons name="wallet-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.summaryTextBlock}>
                  {/* Mantenemos info contextual específico de la tarjeta */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.summaryLabel}>Liquidez total</Text>
                    <TouchableOpacity
                      onPress={() => info.open('Liquidez total', HOME_INFO.liquidez_total)}
                      style={{ paddingHorizontal: 2, paddingVertical: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel="Información sobre liquidez total"
                    >
                      <Ionicons
                        name="information-circle-outline"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.summaryValue}>{fmt(liquidezTotal, 'normal')}</Text>
                  <Text style={styles.summaryDelta}>Saldo actual entre cuentas</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.summaryTopCard}>
                <View style={styles.summaryIconCircle}>
                  <Ionicons name="arrow-down-circle-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.summaryTextBlock}>
                  <Text style={styles.summaryLabel}>Ingresos del mes</Text>
                  <Text style={styles.summaryValue}>{fmt(ingresosMes, 'plus')}</Text>
                  <Text style={styles.summaryDelta}>Cobrado este mes</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryRowSmall}>
              <View style={styles.summaryCardSmall}>
                <View style={styles.summaryIconCircleSmall}>
                  <Ionicons name="file-tray-full-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.summaryTextBlockSmall}>
                  <Text style={styles.summaryLabel}>Gastos gestionables</Text>
                  <Text style={styles.summaryValue}>{fmt(gastosGestionablesMes, 'minus')}</Text>
                  <Text style={styles.summaryDelta}>Pagados este mes</Text>
                </View>
              </View>

              <View style={styles.summaryCardSmall}>
                <View style={styles.summaryIconCircleSmall}>
                  <Ionicons name="fast-food-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.summaryTextBlockSmall}>
                  <Text style={styles.summaryLabel}>Gastos cotidianos</Text>
                  <Text style={styles.summaryValue}>{fmt(gastosCotidianosMes, 'minus')}</Text>
                  <Text style={styles.summaryDelta}>Consumidos este mes</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ============================================================
              ACCIONES RÁPIDAS
              - ✅ Header con icono izquierda + InfoButton derecha
             ============================================================ */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="flash-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Acciones rápidas</Text>
              </View>

              <InfoButton
                align="title"
                onPress={() => info.open('Acciones rápidas', HOME_INFO.acciones_rapidas)}
              />
            </View>

            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={styles.secondaryActionTall}
                onPress={goGastoExtra}
                activeOpacity={0.9}
              >
                <Ionicons name="add-outline" size={26} color={colors.primary} />
                <Text style={styles.secondaryActionTextTall}>Añadir gasto extra</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.primaryActionTall}
                onPress={goCotidiano}
                activeOpacity={0.9}
              >
                <Ionicons name="fast-food-outline" size={26} color="#fff" />
                <Text style={styles.primaryActionTextTall}>Añadir cotidiano</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryActionTall}
                onPress={goIngresoExtra}
                activeOpacity={0.9}
              >
                <Ionicons name="cash-outline" size={26} color={colors.primary} />
                <Text style={styles.secondaryActionTextTall}>Añadir ingreso extra</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ============================================================
              PRESUPUESTO MENSUAL
              - ✅ Header con icono izquierda + InfoButton derecha
             ============================================================ */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Presupuesto mensual</Text>
              </View>

              <InfoButton
                align="title"
                onPress={() => info.open('Presupuesto mensual', HOME_INFO.presupuesto_mensual)}
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={panelStyles.cardTitle}>Presupuesto vs real</Text>

                {/* Info contextual adicional (lo mantenemos) */}
                <TouchableOpacity
                  onPress={() => info.open('Total gasto', HOME_INFO.total_gasto)}
                  style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel="Información sobre Total gasto"
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              {/* ✅ FIX #3: Total gasto -> Análisis día a día */}
              <TouchableOpacity
                style={styles.budgetRowPressable}
                onPress={goBarTotalGasto}
                activeOpacity={0.85}
              >
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Total gasto</Text>
                    <Text style={styles.budgetRowValue}>
                      {fmt(totalGastoActual, 'minus')} / {fmt(totalGastoPresupuesto, 'minus')}
                    </Text>
                  </View>
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${safeRatio(totalGastoActual, totalGastoPresupuesto) * 100}%` } as any,
                      ]}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.budgetRowPressable}
                onPress={goBarIngresos}
                activeOpacity={0.85}
              >
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Ingresos</Text>
                    <Text style={styles.budgetRowValue}>
                      {fmt(ingresosRecibidos, 'plus')} / {fmt(ingresosPrevistos, 'plus')}
                    </Text>
                  </View>
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFillIncome,
                        { width: `${safeRatio(ingresosRecibidos, ingresosPrevistos) * 100}%` } as any,
                      ]}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.budgetRowPressable}
                onPress={goBarGestionables}
                activeOpacity={0.85}
              >
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Gestionables</Text>
                    <Text style={styles.budgetRowValue}>
                      {fmt(gestionablesPagados, 'minus')} / {fmt(gestionablesPresupuestados, 'minus')}
                    </Text>
                  </View>
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${safeRatio(gestionablesPagados, gestionablesPresupuestados) * 100}%` } as any,
                      ]}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.budgetRowPressable}
                onPress={goBarCotidianos}
                activeOpacity={0.85}
              >
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Cotidianos</Text>
                    <Text style={styles.budgetRowValue}>
                      {fmt(cotidianosConsumidos, 'minus')} / {fmt(cotidianosPresupuestados, 'minus')}
                    </Text>
                  </View>
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${safeRatio(cotidianosConsumidos, cotidianosPresupuestados) * 100}%` } as any,
                      ]}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.budgetRowPressable, { marginBottom: 0 }]}
                onPress={goBarExtras}
                activeOpacity={0.85}
              >
                <View style={[styles.budgetRow, { marginBottom: 0 }]}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Extras</Text>
                    <Text style={styles.budgetRowValue}>
                      Ing {fmt(data?.extrasIngresosMes ?? 0, 'plus')} · Gas {fmt(data?.extrasGastosMes ?? 0, 'minus')}
                    </Text>
                  </View>

                  {(() => {
                    const EXTRAS_RANGE = 2000;
                    const extraIngRaw = Math.max(0, Number(data?.extrasIngresosMes ?? 0));
                    const extraGasRaw = Math.max(0, Math.abs(Number(data?.extrasGastosMes ?? 0)));

                    const extraIng = Math.min(EXTRAS_RANGE, extraIngRaw);
                    const extraGas = Math.min(EXTRAS_RANGE, extraGasRaw);

                    const leftPct = (extraIng / EXTRAS_RANGE) * 50;
                    const rightPct = (extraGas / EXTRAS_RANGE) * 50;

                    return (
                      <View style={styles.extrasBarBg}>
                        <View style={styles.extrasBarCenterLine} />
                        <View style={[styles.extrasBarLeft, { width: `${leftPct}%` }]} />
                        <View style={[styles.extrasBarRight, { width: `${rightPct}%` }]} />
                      </View>
                    );
                  })()}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                      {hideAmounts ? masked : '+2.000 €'}
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                      {hideAmounts ? masked : '0 €'}
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                      {hideAmounts ? masked : '-2.000 €'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ============================================================
              ACTIVIDAD RECIENTE
              - ✅ Header con icono izquierda + InfoButton derecha
             ============================================================ */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="time-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Actividad reciente</Text>
              </View>

              <InfoButton
                align="title"
                onPress={() => info.open('Actividad reciente', HOME_INFO.actividad_reciente)}
              />
            </View>

            <View style={panelStyles.card}>
              {(data?.ultimosMovimientos ?? []).slice(0, 4).map((m) => {
                const isIngreso = m.es_ingreso;
                const dotStyle = isIngreso ? styles.activityDotPositive : styles.activityDot;
                const amountStyle = isIngreso ? styles.activityAmountPositive : styles.activityAmountNegative;

                return (
                  <View key={m.id} style={styles.activityRow}>
                    <View style={dotStyle} />
                    <View style={styles.activityTextContainer}>
                      <Text style={styles.activityTitle}>{m.descripcion}</Text>
                      <Text style={styles.activitySubtitle}>
                        {getMovimientoTipoLabel(m as any)} · {formatMovDateTime(m.fecha)}
                      </Text>
                    </View>

                    <Text style={amountStyle}>
                      {hideAmounts ? masked : EuroformatEuro(m.importe, isIngreso ? 'plus' : 'minus')}
                    </Text>
                  </View>
                );
              })}

              {(data?.ultimosMovimientos ?? []).length === 0 && (
                <Text style={[styles.activitySubtitle, { textAlign: 'center', paddingVertical: 8 }]}>
                  No hay movimientos recientes.
                </Text>
              )}

              <TouchableOpacity style={panelStyles.cardButton} onPress={goVerMovimientos}>
                <Text style={panelStyles.cardButtonText}>Ver todos los movimientos</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ============================================================
              PATRIMONIO
              - ✅ Header con icono izquierda + InfoButton derecha
             ============================================================ */}
          <View style={[panelStyles.section, { marginBottom: 24 }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="business-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Patrimonio</Text>
              </View>

              <InfoButton
                align="title"
                onPress={() => info.open('Patrimonio', HOME_INFO.patrimonio)}
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={panelStyles.cardTitle}>Resumen de propiedades</Text>
                  <Text style={panelStyles.cardSubtitle}>
                    {patPropsCount > 0
                      ? `${patPropsCount} activa${patPropsCount === 1 ? '' : 's'}`
                      : 'Sin propiedades activas'}
                  </Text>
                </View>

                {/* Chip: Equity */}
                <Text style={styles.cardChipHighlight}>Equity {fmt(patEquityTotal, 'signed')}</Text>
              </View>

              <View style={styles.patrimonioTopRow}>
                <View style={styles.patrimonioColLeft}>
                  <Text style={panelStyles.cardValue}>{fmt(patValorMercadoTotal, 'normal')}</Text>
                  <Text style={panelStyles.cardSubtitleSmall}>Valor mercado total</Text>
                </View>

                <View style={styles.patrimonioColRight}>
                  <Text style={styles.patrimonioRentLabel}>Rentabilidad bruta media</Text>
                  <Text style={styles.patrimonioRentValue}>{fmtPct(patBrutoMedioPct)}</Text>
                </View>
              </View>

              {/* Segunda fila: NOI total + indicadores PRO */}
              <View style={styles.patrimonioMetaRow}>
                <View style={styles.patrimonioMetaItem}>
                  <Text style={styles.patrimonioMetaLabel}>NOI total (anual)</Text>
                  <Text style={styles.patrimonioMetaValue}>{fmt(patNoiTotal, 'signed')}</Text>
                </View>

                <View style={styles.patrimonioMetaItemRight}>
                  <Text style={styles.patrimonioMetaLabel}>Indicadores</Text>
                  <Text style={styles.patrimonioMetaValueSmall}>
                    NOI/VM {fmtPct(patNoiSobreVmPct)} · LTV aprox {fmtPct(patLtvAproxPct)}
                  </Text>
                </View>
              </View>

              <TouchableOpacity style={panelStyles.cardButton} onPress={goVerPropiedades}>
                <Text style={panelStyles.cardButtonText}>Ver propiedades</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* ✅ Modal estándar info reutilizable */}
      <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
    </>
  );
};

// --------------------
// Stacks por pestaña
// --------------------

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeScreen" component={HomeScreen} />
      <HomeStack.Screen name="SettingsHomeScreen" component={ConfiguracionScreen} />
      <HomeStack.Screen name="AuxTablesHome" component={AuxTablesHomeScreen} />
      <HomeStack.Screen name="AuxEntityList" component={AuxEntityListScreen} />
      <HomeStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <HomeStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />
      <HomeStack.Screen name="CuentasBancariasList" component={CuentasBancariasListScreen} />
      <HomeStack.Screen name="CuentaBancariaForm" component={CuentaBancariaFormScreen} />
      <HomeStack.Screen name="DatabaseTools" component={GestionDbScreen} />
    </HomeStack.Navigator>
  );
}

function DayToDayStackNavigator() {
  return (
    <DayToDayStack.Navigator screenOptions={{ headerShown: false }}>
      <DayToDayStack.Screen name="DayToDayHomeScreen" component={DiaADiaScreen} />
      <DayToDayStack.Screen name="MovimientosScreen" component={MovimientosScreen} />

      <DayToDayStack.Screen name="GastosList" component={GastosListScreen} />
      <DayToDayStack.Screen name="IngresosList" component={IngresoListScreen} />

      <DayToDayStack.Screen name="NuevoGasto" component={NuevoGastoScreen} />
      <DayToDayStack.Screen name="GastoGestionableForm" component={GastoGestionableFormScreen} />
      <DayToDayStack.Screen name="GastoCotidianoForm" component={GastoCotidianoFormScreen} />

      <DayToDayStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <DayToDayStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />

      <DayToDayStack.Screen name="NuevoIngreso" component={NuevoIngresoScreen} />
      <DayToDayStack.Screen name="IngresoForm" component={IngresoFormScreen} />

      <DayToDayStack.Screen name="DayToDayAnalysisScreen" component={DayToDayAnalysisScreen} />
    </DayToDayStack.Navigator>
  );
}

function MonthStackNavigator() {
  return (
    <MonthStack.Navigator screenOptions={{ headerShown: false }}>
      <MonthStack.Screen name="MonthHomeScreen" component={MesScreen} />
      <MonthStack.Screen name="MonthResumenScreen" component={ResumenScreen} />
      <MonthStack.Screen name="MonthBalanceScreen" component={BalanceScreen} />
      <MonthStack.Screen name="MonthExtraordinariosScreen" component={ExtraordinariosScreen} />
      <MonthStack.Screen name="MovimientosScreen" component={MovimientosScreen} />
      <MonthStack.Screen name="MovimientosCuentasScreen" component={MovimientosCuentasScreen} />

      <MonthStack.Screen name="CierreListScreen" component={CierreListScreen} />
      <MonthStack.Screen name="CierreDetalleScreen" component={CierreDetalleScreen} />
      <MonthStack.Screen name="CierreKpiScreen" component={CierreKpiScreen} />
      <MonthStack.Screen name="CierreEditScreen" component={CierreEditScreen} />
      <MonthStack.Screen name="ReinciarCierreScreen" component={ReinciarCierreScreen} />
      <MonthStack.Screen name="ReiniciarMesScreen" component={ReiniciarMesScreen} />
      <MonthStack.Screen name="ReiniciarMesPreviewScreen" component={ReiniciarMesPreviewScreen} />
    </MonthStack.Navigator>
  );
}

function PatrimonyStackNavigator() {
  return (
    <PatrimonyStack.Navigator screenOptions={{ headerShown: false }}>
      <PatrimonyStack.Screen name="PatrimonyHomeScreen" component={PatrimonioScreen} />
      <PatrimonyStack.Screen name="PropiedadesStack" component={PropiedadesStack} />
      <PatrimonyStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <PatrimonyStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />
      <PatrimonyStack.Screen name="PrestamosStack" component={PrestamosStack} />
      <PatrimonyStack.Screen name="InversionesStack" component={InversionesStack} />

    </PatrimonyStack.Navigator>
  );
}

// --------------------
// Bottom Tabs principal
// --------------------

const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: string;

          if (route.name === 'HomeTab') iconName = 'home-outline';
          else if (route.name === 'DayToDayTab') iconName = 'pulse-outline';
          else if (route.name === 'MonthTab') iconName = 'calendar-number-outline';
          else iconName = 'business-outline';

          return <Ionicons name={iconName as any} size={size + 4} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStackNavigator} options={{ title: 'Inicio' }} />

      <Tab.Screen
        name="DayToDayTab"
        component={DayToDayStackNavigator}
        options={{ title: 'Día a día' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('DayToDayTab', { screen: 'DayToDayHomeScreen' });
          },
        })}
      />

      <Tab.Screen name="MonthTab" component={MonthStackNavigator} options={{ title: 'Mes a mes' }} />
      <Tab.Screen
        name="PatrimonyTab"
        component={PatrimonyStackNavigator}
        options={{ title: 'Patrimonio' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabs;

// --------------------
// Estilos específicos de Home
// --------------------

const styles = StyleSheet.create({
  homeHeaderSafeArea: {
    backgroundColor: colors.primarySoft,
  },
  homeHeaderContainer: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  homeHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  } as any,

  headerRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  homeHeaderBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  headerTitleSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  headerMonthLarge: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  homeHello: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  homeSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    maxWidth: 180,
  },
  homeSaldoContainer: {
    alignItems: 'flex-end',
  },
  homeSaldoLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  homeSaldoValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ✅ Header de sección:
  // - Izquierda: icono + título
  // - Derecha: InfoButton pegado al borde derecho
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },

  // Title row dentro de card (ej. Presupuesto vs real)
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  summaryRowTop: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  summaryTopCard: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  summaryTextBlock: {
    flex: 1,
  },
  summaryRowSmall: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCardSmall: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryIconCircleSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  summaryTextBlockSmall: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryDelta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },

  budgetRowPressable: {
    borderRadius: 12,
  },

  budgetRow: {
    marginBottom: 10,
  },
  budgetRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  budgetRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  budgetRowValue: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  progressBarFillIncome: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.success,
  },

  quickActionsRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 10,
    flexWrap: 'nowrap',
  },

  primaryActionTall: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: colors.primary,
    minHeight: 74,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionTextTall: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  secondaryActionTall: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    minHeight: 74,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionTextTall: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.danger,
    marginRight: 8,
  },
  activityDotPositive: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.success,
    marginRight: 8,
  },
  activityTextContainer: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activitySubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  activityAmountNegative: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
    marginLeft: 8,
  },
  activityAmountPositive: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
    marginLeft: 8,
  },

  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  cardChipHighlight: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  patrimonioTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  patrimonioColLeft: {
    flex: 1,
    paddingRight: 8,
  },
  patrimonioColRight: {
    flex: 1,
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  patrimonioRentLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  patrimonioRentValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 2,
  },

  // fila meta (NOI + indicadores)
  patrimonioMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    marginTop: 2,
    gap: 12,
  },
  patrimonioMetaItem: {
    flex: 1,
  },
  patrimonioMetaItemRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  patrimonioMetaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  patrimonioMetaValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  patrimonioMetaValueSmall: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },

  extrasBarBg: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  extrasBarCenterLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.textSecondary,
    opacity: 0.4,
  },
  extrasBarLeft: {
    position: 'absolute',
    right: '50%',
    top: 0,
    bottom: 0,
    backgroundColor: colors.success,
  },
  extrasBarRight: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    backgroundColor: colors.danger,
  },
});
