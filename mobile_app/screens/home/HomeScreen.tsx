// mobile_app/screens/home/HomeScreen.tsx
// -----------------------------------------------------------------------------
// Home UI (pantalla de mostrar) separada de la navegación.
// Mantiene funcionalidad existente sin romper navegación.
//
// CAMBIOS (Moises):
// - Barras presupuesto en 3 estados (Real/Pagado, Omitido, Pendiente).
// - Mostrar "Cumplimiento de movimientos %" en el texto de cada barra.
// - Corregir typing TS para width: "xx%" (DimensionValue).
// - Mantener tarjetas, navegación e InfoModal sin pérdidas.
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
  DimensionValue,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../theme/colors';
import { panelStyles } from '../../components/panels/panelStyles';

import { useHomeDashboard } from '../../hooks/useHomeDashboard';
import { EuroformatEuro } from '../../utils/format';

// ✅ Sistema reusable de info “i”
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

// --------------------
// Helpers (los que estaban en MainTabs)
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
  const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);

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
// INFO TEXTOS HOME
// --------------------

const HOME_INFO: Record<string, string> = {
  resumen_rapido:
    'Tarjetas de acceso rápido a indicadores clave del mes: liquidez, ingresos cobrados y gastos (gestionables y cotidianos).',
  acciones_rapidas:
    'Accesos directos para crear movimientos sin navegar por menús: gasto extra, gasto cotidiano e ingreso extra.',
  presupuesto_mensual:
    'Comparación entre real y presupuesto. Cada barra muestra cuánto llevas consumido/cobrado frente a lo previsto (incluyendo omitidos/pending).',
  actividad_reciente:
    'Últimos movimientos registrados. Útil para validar que lo reciente está bien categorizado y fechado.',
  patrimonio: 'Resumen de tus propiedades: valor de mercado, NOI anual, equity y métricas derivadas.',
  liquidez_total:
    'Liquidez total: saldo actual agregado de cuentas. Pulsar te lleva a Balance para ver el detalle.',
  total_gasto: 'Total gasto: barra agregada del gasto del mes. Pulsar te lleva a Análisis día a día.',

  // ✅ nuevos: de dónde salen los indicadores
  noi_vm:
    'NOI/VM: se calcula como (NOI anual) / (Valor de mercado). Refleja la rentabilidad anual aproximada sobre el valor actual.',
  ltv_aprox:
    'LTV aprox: se estima como (Inversión total) / (Valor de mercado). Es una aproximación del nivel de apalancamiento.',

  // ✅ tarjeta "Gastos cotidianos / Consumidos este mes"
  cotidianos_consumidos_mes:
    'Gastos cotidianos consumidos este mes: suma de los movimientos clasificados como gasto cotidiano dentro del mes actual. Pulsando la tarjeta accedes a "Día a día análisis".',
};

// --------------------
// ✅ Barra 3 estados (Real/Pagado, Omitido, Pendiente)
// --------------------

type Segments = {
  realPct: number; // % del plan original que está “real/pagado”
  omittedPct: number; // % del plan original omitido
  pendingPct: number; // % del plan original pendiente
  moneyPct: number; // real/plan
  movimientosPct: number; // (real+omitido)/plan
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function calcSegments(real: number, omitted: number, planned: number): Segments {
  const plan = planned > 0 ? planned : 0;

  if (plan <= 0) {
    return { realPct: 0, omittedPct: 0, pendingPct: 0, moneyPct: 0, movimientosPct: 0 };
  }

  const realClamped = Math.max(0, real);
  const omittedClamped = Math.max(0, omitted);

  const moneyPct = clamp01(realClamped / plan);
  const movimientosPct = clamp01((realClamped + omittedClamped) / plan);

  // segmentos del “plan original”
  let realPct = moneyPct * 100;
  let omittedPct = clamp01(omittedClamped / plan) * 100;

  // pendiente = lo que falta para completar el plan con (real + omitido)
  let pendingPct = 100 - (realPct + omittedPct);
  if (pendingPct < 0) pendingPct = 0;

  // Ajuste defensivo (por redondeos)
  const sum = realPct + omittedPct + pendingPct;
  if (sum > 100) {
    const exceso = sum - 100;
    // Quitamos el exceso del pending primero (lo más razonable visualmente)
    pendingPct = Math.max(0, pendingPct - exceso);
  }

  return { realPct, omittedPct, pendingPct, moneyPct, movimientosPct };
}

function formatPctEs(x: number) {
  // 2 decimales con coma
  return `${(x * 100).toFixed(2).replace('.', ',')}%`;
}

const SegmentedProgressBar: React.FC<{
  realPct: number;
  omittedPct: number;
  pendingPct: number;
  realColor: string;
  omittedColor: string;
  pendingColor: string;
}> = ({ realPct, omittedPct, pendingPct, realColor, omittedColor, pendingColor }) => {
  const wReal: DimensionValue = `${Math.max(0, Math.min(100, realPct))}%`;
  const wOmitted: DimensionValue = `${Math.max(0, Math.min(100, omittedPct))}%`;
  const wPending: DimensionValue = `${Math.max(0, Math.min(100, pendingPct))}%`;

  return (
    <View style={styles.progressBarBackground}>
      {/* Contenedor en fila: 3 segmentos */}
      <View style={styles.segmentRow}>
        <View style={[styles.segmentBase, { width: wReal, backgroundColor: realColor }]} />
        <View style={[styles.segmentBase, { width: wOmitted, backgroundColor: omittedColor }]} />
        <View style={[styles.segmentBase, { width: wPending, backgroundColor: pendingColor }]} />
      </View>
    </View>
  );
};

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
              {saldoPrevisto == null ? '–' : hideAmounts ? masked : EuroformatEuro(saldoPrevisto, 'signed')}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

// --------------------
// PANTALLA HOME
// --------------------

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { year, month, data, loading, refreshing, error, refresh } = useHomeDashboard();

  const monthLabel = useMemo(() => getMonthLabelES(month, year), [month, year]);

  const [hideAmounts, setHideAmounts] = useState(false);
  const masked = '***********';

  const info = useInfoModal();

  const fmtMoney = (value: number | null | undefined, mode: any) => {
    if (value == null) return '–';
    return hideAmounts ? masked : EuroformatEuro(value, mode);
  };

  const fmtPct = (value: number | null | undefined) => {
    if (value == null) return '—';
    return hideAmounts ? masked : `${value.toFixed(2)}%`;
  };

  // --------------------
  // Navegación (igual que tenías)
  // --------------------

  const goGastoExtra = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastoGestionableForm',
      params: { preset: 'extra', returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  const goCotidiano = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastoCotidianoForm',
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
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
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  const goVerPropiedades = () => {
    navigation.navigate('PatrimonyTab', { screen: 'PropiedadesStack' });
  };

  const goLiquidezToBalance = () => {
    navigation.navigate('MonthTab', {
      screen: 'MonthBalanceScreen',
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  const goBarTotalGasto = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'DayToDayAnalysisScreen',
      params: { fromHome: true, returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
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
      initialFiltro: 'cotidiano',
      screen: 'MonthExtraordinariosScreen',
      params: { returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  // ✅ tarjeta "Gastos cotidianos / Consumidos este mes"
  const goCotidianosConsumidosToDiaADia = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'DayToDayAnalysisScreen',
      params: { fromHome: true, returnToTab: 'HomeTab', returnToScreen: 'HomeScreen' },
    });
  };

  // --------------------
  // Datos
  // --------------------

  const liquidezTotal = data?.liquidezTotal ?? null;
  const ingresosMes = data?.ingresosMes ?? null;
  const gastosGestionablesMes = data?.gestionablesReal ?? null;
  const gastosCotidianosMes = data?.cotidianosReal ?? null;

  // Barras (real + plan)
  const totalGastoActual = data?.totalGastoReal ?? 0;
  const totalGastoPlanOriginal = data?.totalGastoPresupuestadoOriginal ?? data?.totalGastoPresupuestado ?? 0;
  const totalGastoOmitido = data?.totalGastoOmitidoMes ?? 0;

  const ingresosRecibidos = data?.ingresosMes ?? 0;
  const ingresosPlanOriginal = data?.ingresosPresupuestadosOriginal ?? data?.ingresosPresupuestados ?? 0;
  const ingresosOmitidos = data?.ingresosOmitidosMes ?? 0;

  const gestionablesPagados = data?.gestionablesReal ?? 0;
  const gestionablesPlanOriginal =
    data?.gestionablesPresupuestadosOriginal ?? data?.gestionablesPresupuestado ?? data?.gestionablesPresupuestados ?? 0;
  const gestionablesOmitidos = data?.gestionablesOmitidosMes ?? 0;

  const cotidianosConsumidos = data?.cotidianosReal ?? 0;
  const cotidianosPlanOriginal =
    data?.cotidianosPresupuestadosOriginal ?? data?.cotidianosPresupuestado ?? data?.cotidianosPresupuestados ?? 0;
  const cotidianosOmitidos = data?.cotidianosOmitidosMes ?? 0;

  // Patrimonio (Home)
  const patPropsCount = data?.patrimonioPropiedadesCount ?? 0;
  const patValorMercadoTotal = data?.patrimonioValorMercadoTotal ?? null;
  const patNoiTotal = data?.patrimonioNoiTotal ?? null;
  const patEquityTotal = data?.patrimonioEquityTotal ?? null;
  const patBrutoMedioPct = data?.patrimonioRentabilidadBrutaMediaPct ?? null;

  // Indicadores
  const patNoiSobreVmPct = data?.patrimonioNoiSobreVmPct ?? null;
  const patLtvAproxPct = data?.patrimonioLtvAproxPct ?? null;

  // --------------------
  // Colores barras 3 estados
  // --------------------
  // Real: ingresos (verde), gastos (rojo suave)
  const REAL_INCOME = colors.success;
  const REAL_EXPENSE_SOFT = 'rgba(220, 38, 38, 0.50)'; // rojo menos intenso
  const OMITTED = 'rgba(245, 158, 11, 0.50)'; // naranja (omitido)
  const PENDING = 'rgba(107, 114, 128, 0.20)'; // gris (pendiente)

  // --------------------
  // Helpers para texto de barra
  // --------------------
  const formatBudgetValue = (opts: {
    real: number;
    planned: number;
    omitted: number;
    mode: any;
  }) => {
    const { real, planned, omitted, mode } = opts;

    const seg = calcSegments(real, omitted, planned);

    // En modo oculto: ocultamos importes y % también
    if (hideAmounts) {
      return `${masked} / ${masked} · Cumplimiento mov. ${masked}`;
    }

    const realLabel = EuroformatEuro(real, mode);
    const planLabel = EuroformatEuro(planned, mode);
    const movPctLabel = formatPctEs(seg.movimientosPct);

    return `${realLabel} / ${planLabel} · Cumplimiento mov. ${movPctLabel}`;
  };

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

          {/* ===================== RESUMEN RÁPIDO ===================== */}
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.summaryLabel}>Liquidez total</Text>
                    <TouchableOpacity
                      onPress={() => info.open('Liquidez total', HOME_INFO.liquidez_total)}
                      style={{ paddingHorizontal: 2, paddingVertical: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel="Información sobre liquidez total"
                    >
                      <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.summaryValue}>{fmtMoney(liquidezTotal, 'normal')}</Text>
                  <Text style={styles.summaryDelta}>Saldo actual entre cuentas</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.summaryTopCard}>
                <View style={styles.summaryIconCircle}>
                  <Ionicons name="arrow-down-circle-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.summaryTextBlock}>
                  <Text style={styles.summaryLabel}>Ingresos del mes</Text>
                  <Text style={styles.summaryValue}>{fmtMoney(ingresosMes, 'plus')}</Text>
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
                  <Text style={styles.summaryValue}>{fmtMoney(gastosGestionablesMes, 'minus')}</Text>
                  <Text style={styles.summaryDelta}>Pagados este mes</Text>
                </View>
              </View>

              {/* ✅ Tarjeta pulsable + info */}
              <TouchableOpacity
                style={styles.summaryCardSmall}
                onPress={goCotidianosConsumidosToDiaADia}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Ver análisis día a día de gastos cotidianos consumidos"
              >
                <View style={styles.summaryIconCircleSmall}>
                  <Ionicons name="fast-food-outline" size={20} color={colors.primary} />
                </View>

                <View style={styles.summaryTextBlockSmall}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.summaryLabel}>Gastos cotidianos</Text>
                    <TouchableOpacity
                      onPress={() =>
                        info.open('Gastos cotidianos consumidos', HOME_INFO.cotidianos_consumidos_mes)
                      }
                      style={{ paddingHorizontal: 2, paddingVertical: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel="Información sobre gastos cotidianos consumidos este mes"
                    >
                      <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.summaryValue}>{fmtMoney(gastosCotidianosMes, 'minus')}</Text>
                  <Text style={styles.summaryDelta}>Consumidos este mes</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ===================== ACCIONES RÁPIDAS ===================== */}
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
              <TouchableOpacity style={styles.secondaryActionTall} onPress={goGastoExtra} activeOpacity={0.9}>
                <Ionicons name="add-outline" size={26} color={colors.primary} />
                <Text style={styles.secondaryActionTextTall}>Añadir gasto extra</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.primaryActionTall} onPress={goCotidiano} activeOpacity={0.9}>
                <Ionicons name="fast-food-outline" size={26} color="#fff" />
                <Text style={styles.primaryActionTextTall}>Añadir cotidiano</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryActionTall} onPress={goIngresoExtra} activeOpacity={0.9}>
                <Ionicons name="cash-outline" size={26} color={colors.primary} />
                <Text style={styles.secondaryActionTextTall}>Añadir ingreso extra</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ===================== PRESUPUESTO MENSUAL ===================== */}
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

                <TouchableOpacity
                  onPress={() => info.open('Total gasto', HOME_INFO.total_gasto)}
                  style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel="Información sobre Total gasto"
                >
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* ========== TOTAL GASTO (3 estados) ========== */}
              <TouchableOpacity style={styles.budgetRowPressable} onPress={goBarTotalGasto} activeOpacity={0.85}>
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Total gasto</Text>
                    <Text style={styles.budgetRowValue}>
                      {formatBudgetValue({
                        real: totalGastoActual,
                        planned: totalGastoPlanOriginal,
                        omitted: totalGastoOmitido,
                        mode: 'minus',
                      })}
                    </Text>
                  </View>

                  {(() => {
                    const seg = calcSegments(totalGastoActual, totalGastoOmitido, totalGastoPlanOriginal);
                    return (
                      <SegmentedProgressBar
                        realPct={seg.realPct}
                        omittedPct={seg.omittedPct}
                        pendingPct={seg.pendingPct}
                        realColor={REAL_EXPENSE_SOFT}
                        omittedColor={OMITTED}
                        pendingColor={PENDING}
                      />
                    );
                  })()}
                </View>
              </TouchableOpacity>

              {/* ========== INGRESOS (3 estados) ========== */}
              <TouchableOpacity style={styles.budgetRowPressable} onPress={goBarIngresos} activeOpacity={0.85}>
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Ingresos</Text>
                    <Text style={styles.budgetRowValue}>
                      {formatBudgetValue({
                        real: ingresosRecibidos,
                        planned: ingresosPlanOriginal,
                        omitted: ingresosOmitidos,
                        mode: 'plus',
                      })}
                    </Text>
                  </View>

                  {(() => {
                    const seg = calcSegments(ingresosRecibidos, ingresosOmitidos, ingresosPlanOriginal);
                    return (
                      <SegmentedProgressBar
                        realPct={seg.realPct}
                        omittedPct={seg.omittedPct}
                        pendingPct={seg.pendingPct}
                        realColor={REAL_INCOME}
                        omittedColor={OMITTED}
                        pendingColor={PENDING}
                      />
                    );
                  })()}
                </View>
              </TouchableOpacity>

              {/* ========== GESTIONABLES (3 estados) ========== */}
              <TouchableOpacity style={styles.budgetRowPressable} onPress={goBarGestionables} activeOpacity={0.85}>
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Gestionables</Text>
                    <Text style={styles.budgetRowValue}>
                      {formatBudgetValue({
                        real: gestionablesPagados,
                        planned: gestionablesPlanOriginal,
                        omitted: gestionablesOmitidos,
                        mode: 'minus',
                      })}
                    </Text>
                  </View>

                  {(() => {
                    const seg = calcSegments(gestionablesPagados, gestionablesOmitidos, gestionablesPlanOriginal);
                    return (
                      <SegmentedProgressBar
                        realPct={seg.realPct}
                        omittedPct={seg.omittedPct}
                        pendingPct={seg.pendingPct}
                        realColor={REAL_EXPENSE_SOFT}
                        omittedColor={OMITTED}
                        pendingColor={PENDING}
                      />
                    );
                  })()}
                </View>
              </TouchableOpacity>

              {/* ========== COTIDIANOS (3 estados) ========== */}
              <TouchableOpacity style={styles.budgetRowPressable} onPress={goBarCotidianos} activeOpacity={0.85}>
                <View style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Cotidianos</Text>
                    <Text style={styles.budgetRowValue}>
                      {formatBudgetValue({
                        real: cotidianosConsumidos,
                        planned: cotidianosPlanOriginal,
                        omitted: cotidianosOmitidos,
                        mode: 'minus',
                      })}
                    </Text>
                  </View>

                  {(() => {
                    const seg = calcSegments(cotidianosConsumidos, cotidianosOmitidos, cotidianosPlanOriginal);
                    return (
                      <SegmentedProgressBar
                        realPct={seg.realPct}
                        omittedPct={seg.omittedPct}
                        pendingPct={seg.pendingPct}
                        realColor={REAL_EXPENSE_SOFT}
                        omittedColor={OMITTED}
                        pendingColor={PENDING}
                      />
                    );
                  })()}
                </View>
              </TouchableOpacity>

              {/* ========== EXTRAS (se mantiene igual, con fix TS width) ========== */}
              <TouchableOpacity
                style={[styles.budgetRowPressable, { marginBottom: 0 }]}
                onPress={goBarExtras}
                activeOpacity={0.85}
              >
                <View style={[styles.budgetRow, { marginBottom: 0 }]}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetRowLabel}>Extras</Text>
                    <Text style={styles.budgetRowValue}>
                      Ing {fmtMoney(data?.extrasIngresosMes ?? 0, 'plus')} · Gas {fmtMoney(data?.extrasGastosMes ?? 0, 'minus')}
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

                    const wLeft: DimensionValue = `${leftPct}%`;
                    const wRight: DimensionValue = `${rightPct}%`;

                    return (
                      <View style={styles.extrasBarBg}>
                        <View style={styles.extrasBarCenterLine} />
                        <View style={[styles.extrasBarLeft, { width: wLeft }]} />
                        <View style={[styles.extrasBarRight, { width: wRight }]} />
                      </View>
                    );
                  })()}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>{hideAmounts ? masked : '+2.000 €'}</Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>{hideAmounts ? masked : '0 €'}</Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>{hideAmounts ? masked : '-2.000 €'}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ===================== ACTIVIDAD RECIENTE ===================== */}
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

          {/* ===================== PATRIMONIO ===================== */}
          <View style={[panelStyles.section, { marginBottom: 24 }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="business-outline" size={18} color={colors.primary} />
                <Text style={panelStyles.sectionTitle}>Patrimonio</Text>
              </View>

              <InfoButton align="title" onPress={() => info.open('Patrimonio', HOME_INFO.patrimonio)} />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={panelStyles.cardTitle}>Resumen de propiedades</Text>
                  <Text style={panelStyles.cardSubtitle}>
                    {patPropsCount > 0 ? `${patPropsCount} activa${patPropsCount === 1 ? '' : 's'}` : 'Sin propiedades activas'}
                  </Text>
                </View>

                <Text style={styles.cardChipHighlight}>Equity {fmtMoney(patEquityTotal, 'signed')}</Text>
              </View>

              <View style={styles.patrimonioTopRow}>
                <View style={styles.patrimonioColLeft}>
                  <Text style={panelStyles.cardValue}>{fmtMoney(patValorMercadoTotal, 'normal')}</Text>
                  <Text style={panelStyles.cardSubtitleSmall}>Valor mercado total</Text>
                </View>

                <View style={styles.patrimonioColRight}>
                  <Text style={styles.patrimonioRentLabel}>Rentabilidad bruta media</Text>
                  <Text style={styles.patrimonioRentValue}>{fmtPct(patBrutoMedioPct)}</Text>
                </View>
              </View>

              <View style={styles.patrimonioMetaRow}>
                <View style={styles.patrimonioMetaItem}>
                  <Text style={styles.patrimonioMetaLabel}>NOI total (anual)</Text>
                  <Text style={styles.patrimonioMetaValue}>{fmtMoney(patNoiTotal, 'signed')}</Text>
                </View>

                <View style={styles.patrimonioMetaItemRight}>
                  <Text style={styles.patrimonioMetaLabel}>Indicadores</Text>

                  <View style={styles.indicatorLine}>
                    <Text style={styles.indicatorValue}>NOI/VM: {fmtPct(patNoiSobreVmPct)}</Text>
                    <TouchableOpacity
                      onPress={() => info.open('NOI/VM', HOME_INFO.noi_vm)}
                      style={styles.indicatorInfoBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Información sobre NOI/VM"
                    >
                      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.indicatorLine}>
                    <Text style={styles.indicatorValue}>LTV aprox: {fmtPct(patLtvAproxPct)}</Text>
                    <TouchableOpacity
                      onPress={() => info.open('LTV aprox', HOME_INFO.ltv_aprox)}
                      style={styles.indicatorInfoBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Información sobre LTV aproximado"
                    >
                      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
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

      <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
    </>
  );
};

export default HomeScreen;

// --------------------
// Estilos
// --------------------

const styles = StyleSheet.create({
  homeHeaderSafeArea: { backgroundColor: colors.primarySoft },
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

  headerRightIcons: { flexDirection: 'row', alignItems: 'center', gap: 10 },

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
  headerMonthLarge: { marginTop: 2, fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  homeHello: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  homeSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2, maxWidth: 180 },
  homeSaldoContainer: { alignItems: 'flex-end' },
  homeSaldoLabel: { fontSize: 11, color: colors.textSecondary },
  homeSaldoValue: { marginTop: 2, fontSize: 18, fontWeight: '700', color: colors.primary },
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

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  summaryRowTop: { flexDirection: 'row', gap: 10, marginBottom: 10 },
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
  summaryTextBlock: { flex: 1 },
  summaryRowSmall: { flexDirection: 'row', gap: 10 },
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
  summaryTextBlockSmall: { flex: 1 },
  summaryLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  summaryDelta: { marginTop: 2, fontSize: 11, color: colors.textMuted },

  budgetRowPressable: { borderRadius: 12 },
  budgetRow: { marginBottom: 10 },
  budgetRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  budgetRowLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  budgetRowValue: { fontSize: 11, color: colors.textSecondary },

  // ✅ fondo barra + segmentos (3 estados)
  progressBarBackground: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    height: '100%',
  },
  segmentBase: {
    height: '100%',
  },

  quickActionsRow: { flexDirection: 'row', marginTop: 8, gap: 10, flexWrap: 'nowrap' },
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
  primaryActionTextTall: { marginTop: 6, fontSize: 12, fontWeight: '800', color: '#fff', textAlign: 'center' },
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
  secondaryActionTextTall: { marginTop: 6, fontSize: 12, fontWeight: '800', color: colors.primary, textAlign: 'center' },

  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  activityDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.danger, marginRight: 8 },
  activityDotPositive: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.success, marginRight: 8 },
  activityTextContainer: { flex: 1 },
  activityTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  activitySubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  activityAmountNegative: { fontSize: 13, fontWeight: '700', color: colors.danger, marginLeft: 8 },
  activityAmountPositive: { fontSize: 13, fontWeight: '700', color: colors.success, marginLeft: 8 },

  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardChipHighlight: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  patrimonioTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  patrimonioColLeft: { flex: 1, paddingRight: 8 },
  patrimonioColRight: { flex: 1, alignItems: 'flex-end', paddingLeft: 8 },
  patrimonioRentLabel: { fontSize: 11, color: colors.textSecondary },
  patrimonioRentValue: { fontSize: 20, fontWeight: '700', color: colors.primary, marginTop: 2 },

  patrimonioMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    marginTop: 2,
    gap: 12,
  },
  patrimonioMetaItem: { flex: 1 },
  patrimonioMetaItemRight: { flex: 1, alignItems: 'flex-end' },
  patrimonioMetaLabel: { fontSize: 11, color: colors.textSecondary },
  patrimonioMetaValue: { marginTop: 2, fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  indicatorLine: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  indicatorValue: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  indicatorInfoBtn: { paddingHorizontal: 2, paddingVertical: 2 },

  extrasBarBg: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  extrasBarCenterLine: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, backgroundColor: colors.textSecondary, opacity: 0.4 },
  extrasBarLeft: { position: 'absolute', right: '50%', top: 0, bottom: 0, backgroundColor: colors.success },
  extrasBarRight: { position: 'absolute', left: '50%', top: 0, bottom: 0, backgroundColor: colors.danger },
});
