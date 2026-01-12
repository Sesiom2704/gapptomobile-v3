// mobile_app/screens/dia/DayToDayKpisScreen.tsx
// -----------------------------------------------------------------------------
// KPIs Día a Día (pantalla “profundización”)
//
// OBJETIVO (actualizado):
// - Reutiliza GET /api/v1/analytics/day-to-day (getDayToDayAnalysis)
// - Muestra KPIs extra + gráficas (7 días, diaria del mes, evolución mensual)
// - Selector de MES (flechas) para consultar meses anteriores (por defecto mes actual)
// - “Ranking por contenedores” arriba: Top 3 + desplegable + TODOS (por defecto)
// - Al seleccionar contenedor: filtra por ese contenedor y muestra subcategorías como botones
// - Elimina filtros de “Contenedores” y “Subgasto” del panel de filtros (pasan al ranking)
// - Todas las gráficas muestran tooltip al tocar punto/barra
//
// AJUSTES (según tu feedback final):
// 1) Flechas mes: solo iconos (sin “mes anterior/siguiente”)
// 2) Filtros: todos los labels en MAYÚSCULAS
// 3) Subcategorías: MAYÚSCULAS, una sola fila (horizontal), botones tamaño igual,
//    y “TODOS” en vez de “Todos los tipos”
// 4) Tooltip:
//    - Se auto-oculta (timeout) y se oculta al empezar a hacer scroll.
//    - En barras: fallback por coordenadas (no dependemos de onDataPointClick typings/eventos).
//
// FIX TIPADO TS (react-native-chart-kit):
// - BarChartProps no expone onDataPointClick en los typings; TypeScript falla.
// - Se usa alias BarChartAny: any (y además se implementa fallback de touch por coordenadas).
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Pressable,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { FilterPill } from '../../components/ui/FilterPill';
import { FilterRow } from '../../components/ui/FilterRow';
import PeriodNavigator from '../../components/ui/PeriodNavigator';
import { analysisStyles } from '../../components/analysis/analysisStyles';

import { getDayToDayAnalysis } from '../../services/analyticsApi';

import {
  DayToDayAnalysisResponse,
  Last7DayItem,
  DailySeriesItem,
  MonthlySeriesItem,
  EvolutionKpis,
} from '../../types/analytics';

// ✅ Info (botón i + modal reutilizable)
import {
  InfoButton,
  InfoModal,
  useInfoModal,
} from '../../components/ui/InfoModal';

// --------------------
// Tipos locales
// --------------------

type PagoFiltro = 'TODOS' | 'YO' | 'OTRO';

type SubtipoOption = {
  id: string | null; // null = todos los tipos de la categoría
  label: string;
};

// Contenedores principales (categorías de análisis)
const CATEGORY_OPTIONS = [
  { key: 'SUPERMERCADOS', label: 'SUPERMERCADOS' },
  { key: 'SUMINISTROS', label: 'SUMINISTROS' },
  { key: 'VEHICULOS', label: 'VEHÍCULOS' },
  { key: 'ROPA', label: 'ROPA' },
  { key: 'RESTAURACION', label: 'RESTAURACIÓN' },
  { key: 'OCIO', label: 'OCIO' },
] as const;

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

// Mapa de subgastos por categoría
// (ajuste: la opción null será "TODOS")
const SUBTIPOS_POR_CATEGORIA: Record<string, SubtipoOption[]> = {
  SUPERMERCADOS: [{ id: null, label: 'TODOS' }],
  SUMINISTROS: [{ id: null, label: 'TODOS' }],
  VEHICULOS: [
    { id: null, label: 'TODOS' },
    { id: 'TIP-GASOLINA-SW1ZQO', label: 'COMBUSTIBLE' },
    { id: 'PEA-TIPOGASTO-7HDY89', label: 'PEAJES' },
    { id: 'MAV-TIPOGASTO-BVC356', label: 'MANTENIMIENTO' },
  ],
  ROPA: [{ id: null, label: 'TODOS' }],
  RESTAURACION: [{ id: null, label: 'TODOS' }],
  OCIO: [
    { id: null, label: 'TODOS' },
    { id: 'TRA-TIPOGASTO-RB133Z', label: 'TRANSPORTE' },
    { id: 'HOS-TIPOGASTO-357FDG', label: 'HOSPEDAJE' },
    { id: 'ACT-TIPOGASTO-2X9H1Q', label: 'ACTIVIDADES' },
  ],
};

// --------------------
// Utilidades
// --------------------

function safeNum(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function fmtCurrency(n: number | undefined | null) {
  const v = typeof n === 'number' ? n : 0;
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} €`;
  }
}

function fmtPct(n: number | undefined | null) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function normalizeLast7(ultimos7: Last7DayItem[]) {
  const labels = ultimos7.map((x) => String(x.label ?? ''));
  const values = ultimos7.map((x) => safeNum(x.importe));
  return { labels, values };
}

function normalizeDailyMonthSeries(items: DailySeriesItem[]) {
  const labels = items.map((x) => String(x.dia));
  const values = items.map((x) => safeNum(x.importe));
  return { labels, values };
}

function normalizeMonthlySeries(items: MonthlySeriesItem[]) {
  const labels = items.map((x) => String(x.month).padStart(2, '0'));
  const values = items.map((x) => safeNum(x.importe));
  const fullLabels = items.map((x) => x.label);
  return { labels, values, fullLabels };
}

// Meses (sin librerías externas)
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function toYYYYMM01(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}
function monthLabelEsUpper(d: Date) {
  try {
    // "enero de 2026" -> "ENERO DE 2026"
    return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d).toUpperCase();
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${m}/${y}`.toUpperCase();
  }
}
function isFutureMonth(d: Date) {
  const now = startOfMonth(new Date());
  const md = startOfMonth(d);
  return md.getTime() > now.getTime();
}

// --------------------
// Tipado route params
// --------------------

type DayToDayKpisRouteParams = {
  fromHome?: boolean;

  pago?: PagoFiltro;
  view?: 'GENERAL' | 'CATEGORIA';
  categoria?: string | null;
  tipoId?: string | null;

  monthsBack?: number;

  returnToTab?: string;
  returnToScreen?: string;
};

// --------------------
// Chart config (base)
// --------------------
const chartConfig: any = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(42, 158, 159, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: colors.primary,
  },
};

// FIX TIPADO: BarChartProps no declara onDataPointClick en typings
const BarChartAny: any = BarChart;

type ChartTooltip = {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  value: number;
};

// --------------------
// Componente principal
// --------------------

export const DayToDayKpisScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const info = useInfoModal();

  const params = (route?.params ?? {}) as DayToDayKpisRouteParams;
  const fromHome = params.fromHome ?? false;

  // Filtros (panel)
  const [selectedView, setSelectedView] = useState<'GENERAL' | 'CATEGORIA'>(
    params.view ?? 'GENERAL'
  );
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [pagoFiltro, setPagoFiltro] = useState<PagoFiltro>(params.pago ?? 'YO');
  const [monthsBack, setMonthsBack] = useState<number>(params.monthsBack ?? 12);

  // Selector mes
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Contenedor / Subtipo
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(
    params.categoria ?? null
  );
  const [selectedSubtipoId, setSelectedSubtipoId] = useState<string | null>(
    params.tipoId ?? null
  );

  // Ranking desplegable
  const [rankingExpanded, setRankingExpanded] = useState(false);

  // Data
  const [data, setData] = useState<DayToDayAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tooltip
  const [chartTip, setChartTip] = useState<ChartTooltip>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    value: 0,
  });

  const tipTimerRef = useRef<any>(null);

  const hideTooltip = useCallback(() => {
    if (tipTimerRef.current) {
      clearTimeout(tipTimerRef.current);
      tipTimerRef.current = null;
    }
    setChartTip((t) => (t.visible ? { ...t, visible: false } : t));
  }, []);

  const showTooltip = useCallback(
    (args: { value: number; x?: number; y?: number; label: string; width: number }) => {
      const { value, x = 0, y = 0, label, width } = args;

      // Toggle: si vuelves a tocar el mismo tooltip, se oculta.
      setChartTip((prev) => {
        const same = prev.visible && prev.label === label && Math.abs(prev.value - value) < 0.0001;
        if (same) return { ...prev, visible: false };

        const tipX = Math.max(8, Math.min(width - 160, Number(x) - 70));
        const tipY = Math.max(8, Number(y) - 52);

        return {
          visible: true,
          x: tipX,
          y: tipY,
          label,
          value: Number.isFinite(value) ? value : 0,
        };
      });

      // Auto-hide (evita “engancharse”)
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      tipTimerRef.current = setTimeout(() => {
        setChartTip((t) => ({ ...t, visible: false }));
        tipTimerRef.current = null;
      }, 2500);
    },
    []
  );

  // Reset subtipo al cambiar contenedor
  useEffect(() => {
    setSelectedSubtipoId(null);
  }, [selectedCategoryKey]);

  // --------------------
  // Carga de datos
  // --------------------
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      hideTooltip();

      const req: any = {
        pago: pagoFiltro,
        monthsBack,
        fecha: toYYYYMM01(selectedMonth),
      };

      if (selectedView === 'CATEGORIA') {
        if (selectedSubtipoId) req.tipoId = selectedSubtipoId;
        else if (selectedCategoryKey) req.categoria = selectedCategoryKey;
      }

      const resp = await getDayToDayAnalysis(req);
      setData(resp);
    } catch (e) {
      console.log('[DayToDayKpisScreen] Error cargando KPIs día a día', e);
      setError('No se han podido cargar los KPIs día a día.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pagoFiltro, selectedView, selectedCategoryKey, selectedSubtipoId, monthsBack, selectedMonth, hideTooltip]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --------------------
  // Derivados
  // --------------------
  const week = data?.week;

  const categoriasMes = data?.categorias_mes ?? [];
  const ultimos7Dias: Last7DayItem[] = data?.ultimos_7_dias ?? [];
  const categoryKpis = data?.category_kpis ?? {};

  const serieDiariaMes: DailySeriesItem[] = (data?.serie_diaria_mes ?? []) as any;
  const serieMensual: MonthlySeriesItem[] = (data?.serie_mensual ?? []) as any;
  const kpisEvolucion: EvolutionKpis | null = (data?.kpis_evolucion ?? null) as any;

  const hasMonthlyCharts = Boolean(serieDiariaMes?.length || serieMensual?.length);

  // Ranking completo: CATEGORY_OPTIONS + importes de backend (0 si no hay)
  const fullCategoryRanking = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; importe: number; porcentaje?: number }>();
    categoriasMes.forEach((c) => {
      byKey.set(c.key, {
        key: c.key,
        label: String(c.label ?? '').toUpperCase(),
        importe: safeNum(c.importe),
        porcentaje: safeNum((c as any).porcentaje),
      });
    });

    const merged = CATEGORY_OPTIONS.map((opt) => {
      const found = byKey.get(opt.key);
      return {
        key: opt.key,
        // UI en MAYÚSCULAS
        label: (found?.label ?? opt.label).toUpperCase(),
        importe: found ? safeNum(found.importe) : 0,
        porcentaje: found ? safeNum(found.porcentaje) : 0,
      };
    });

    merged.sort((a, b) => {
      const diff = safeNum(b.importe) - safeNum(a.importe);
      if (Math.abs(diff) > 0.0001) return diff;
      return String(a.label).localeCompare(String(b.label));
    });

    return merged;
  }, [categoriasMes]);

  const top3Categories = useMemo(() => fullCategoryRanking.slice(0, 3), [fullCategoryRanking]);

  const maxRankImporte = useMemo(() => {
    if (!fullCategoryRanking.length) return 1;
    return Math.max(1, ...fullCategoryRanking.map((c) => safeNum(c.importe)));
  }, [fullCategoryRanking]);

  // Categoría efectiva (solo si hay selección real)
  const effectiveSelectedCategory = useMemo(() => {
    if (!selectedCategoryKey) return null;
    const inOptions = CATEGORY_OPTIONS.find((c) => c.key === selectedCategoryKey);
    if (!inOptions) return null;

    const backend = categoriasMes.find((c) => c.key === selectedCategoryKey);
    const label = (backend?.label ?? inOptions.label ?? '').toString().toUpperCase();

    return {
      key: inOptions.key,
      label,
      importe: backend ? safeNum(backend.importe) : 0,
      porcentaje: backend ? safeNum(backend.porcentaje) : 0,
    };
  }, [selectedCategoryKey, categoriasMes]);

  const subtipoOptions: SubtipoOption[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];
    const raw = SUBTIPOS_POR_CATEGORIA[effectiveSelectedCategory.key] ?? [];
    // Garantía: MAYÚSCULAS
    return raw.map((x) => ({ ...x, label: String(x.label ?? '').toUpperCase() }));
  }, [effectiveSelectedCategory]);

  // KPIs 7 días
  const kpi7d = useMemo(() => {
    const vals = ultimos7Dias.map((d) => safeNum(d.importe));
    const n = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = n ? sum / n : 0;

    const zeroDays = vals.filter((x) => x <= 0).length;

    let maxV = 0;
    let minV = n ? vals[0] : 0;
    let maxIdx = 0;
    let minIdx = 0;

    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v > maxV) {
        maxV = v;
        maxIdx = i;
      }
      if (v < minV) {
        minV = v;
        minIdx = i;
      }
    }

    const variance =
      n > 1 ? vals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / n : 0;
    const std = Math.sqrt(Math.max(0, variance));

    return {
      n,
      sum,
      avg,
      std,
      zeroDays,
      max: { value: maxV, label: ultimos7Dias[maxIdx]?.label ?? '—' },
      min: { value: minV, label: ultimos7Dias[minIdx]?.label ?? '—' },
    };
  }, [ultimos7Dias]);

  // Concentración
  const concentration = useMemo(() => {
    if (!categoriasMes.length) return { top1Pct: 0, top3Pct: 0, top1: null as any };

    const sorted = [...categoriasMes].sort((a, b) => safeNum(b.importe) - safeNum(a.importe));
    const total = sorted.reduce((acc, c) => acc + safeNum(c.importe), 0) || 1;

    const top1 = sorted[0];
    const top1Pct = (safeNum(top1?.importe) / total) * 100;

    const top3Sum = sorted.slice(0, 3).reduce((acc, c) => acc + safeNum(c.importe), 0);
    const top3Pct = (top3Sum / total) * 100;

    return { top1Pct, top3Pct, top1 };
  }, [categoriasMes]);

  // Series charts
  const { labels: labels7, values: values7 } = useMemo(
    () => normalizeLast7(ultimos7Dias),
    [ultimos7Dias]
  );

  const { labels: labelsMonthDays, values: valuesMonthDays } = useMemo(() => {
    if (!serieDiariaMes?.length) return { labels: [], values: [] };
    return normalizeDailyMonthSeries(serieDiariaMes);
  }, [serieDiariaMes]);

  const { labels: labelsMonths, values: valuesMonths, fullLabels: fullMonthLabels } = useMemo(() => {
    if (!serieMensual?.length) return { labels: [], values: [], fullLabels: [] as string[] };
    return normalizeMonthlySeries(serieMensual);
  }, [serieMensual]);

  // Sizing chart
  const width = Dimensions.get('window').width;
  const chartWidth = Math.max(360, width - 24);
  const chartHeight = 220;

  const monthlyChartWidth = Math.max(chartWidth, labelsMonths.length * 36);

  // KPIs contenedor
  const selectedCategoryKpis = useMemo(() => {
    if (!effectiveSelectedCategory) return null;
    return categoryKpis[effectiveSelectedCategory.key] ?? null;
  }, [effectiveSelectedCategory, categoryKpis]);

  // --------------------
  // Section header
  // --------------------
  const SectionHeader = ({
    title,
    onInfo,
  }: {
    title: string;
    onInfo: () => void;
  }) => {
    return (
      <View style={styles.sectionHeaderRow}>
        <Text style={panelStyles.sectionTitle}>{title}</Text>
        <InfoButton align="title" onPress={onInfo} />
      </View>
    );
  };

  // --------------------
  // Acciones selector contenedor
  // --------------------
  const selectAllContainers = useCallback(() => {
    setSelectedCategoryKey(null);
    setSelectedSubtipoId(null);
    setSelectedView('GENERAL');
  }, []);

  const selectContainer = useCallback((key: string) => {
    setSelectedCategoryKey(key);
    setSelectedSubtipoId(null);
    setSelectedView('CATEGORIA');
  }, []);

  // --------------------
  // Fallback tap en barras por coordenadas
  // (garantiza tooltip aunque BarChart no emita onDataPointClick)
  // --------------------
  const onMonthlyChartTap = useCallback(
    (evt: GestureResponderEvent) => {
      if (!labelsMonths.length) return;

      const { locationX, locationY } = evt.nativeEvent;

      // Área útil aproximada: usamos todo el ancho del chart.
      // Índice proporcional (robusto y suficiente para uso “tap para ver importe”)
      const n = labelsMonths.length;
      const x = Math.max(0, Math.min(monthlyChartWidth, locationX));
      const idx = Math.max(0, Math.min(n - 1, Math.floor((x / monthlyChartWidth) * n)));

      const val = valuesMonths[idx] ?? 0;
      const full = fullMonthLabels[idx] ?? labelsMonths[idx] ?? '';

      showTooltip({
        value: Number(val ?? 0),
        x: locationX,
        y: locationY,
        label: full ? `MES ${String(full).toUpperCase()}` : 'MES',
        width: monthlyChartWidth,
      });
    },
    [labelsMonths.length, monthlyChartWidth, valuesMonths, fullMonthLabels, labelsMonths, showTooltip]
  );

  // --------------------
  // Render
  // --------------------
  return (
    <>
      <Header
        title="KPIs día a día"
        subtitle="Evolución y métricas avanzadas para profundizar en tus gastos cotidianos."
        showBack
        onBackPress={() => {
          // Volver SIEMPRE a DayToDayAnalysisScreen
          navigation.navigate('DayToDayTab', {
            screen: 'DayToDayAnalysisScreen',
            params: {
              fromHome,
              returnToTab: params.returnToTab,
              returnToScreen: params.returnToScreen,
            },
          });
        }}
      />

      <View style={panelStyles.screen}>
        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          onScrollBeginDrag={hideTooltip}
          keyboardShouldPersistTaps="handled"
        >
          {/* Selector MES (solo flechas) */}
          <View style={panelStyles.section}>
            <View style={panelStyles.card}>
              <PeriodNavigator
                label={monthLabelEsUpper(selectedMonth)}
                hint="Se aplica a ranking, concentración y serie diaria del mes."
                onPrev={() => setSelectedMonth((prev) => addMonths(prev, -1))}
                onNext={() => setSelectedMonth((prev) => addMonths(prev, +1))}
                disablePrev={false}
                disableNext={isFutureMonth(addMonths(selectedMonth, 1))}
              />
            </View>
          </View>


          {/* FILTROS (DESPLEGABLE) — sin Contenedores/Subgasto */}
          <View style={panelStyles.section}>
            <TouchableOpacity
              style={analysisStyles.filterToggle}
              onPress={() => setFiltrosAbiertos((prev) => !prev)}
              activeOpacity={0.85}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name={filtrosAbiertos ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 8 }}
                />
                <Text style={analysisStyles.filterToggleText}>
                  {filtrosAbiertos ? 'OCULTAR FILTROS' : 'MOSTRAR FILTROS'}
                </Text>
              </View>
            </TouchableOpacity>

            {filtrosAbiertos && (
              <View style={analysisStyles.filterContent}>
                <Text style={analysisStyles.filterLabel}>MODO</Text>
                <FilterRow columns={2}>
                  {(['GENERAL', 'CATEGORIA'] as const).map((vista) => (
                    <FilterPill
                      key={vista}
                      label={vista === 'GENERAL' ? 'GENERAL' : 'POR CONTENEDOR'}
                      selected={selectedView === vista}
                      onPress={() => setSelectedView(vista)}
                    />
                  ))}
                </FilterRow>

                <Text style={analysisStyles.filterHelper}>
                  EN “GENERAL” VES KPIS GLOBALES. EN “POR CONTENEDOR” PROFUNDIZAS EN UN CONTENEDOR (Y OPCIONALMENTE UN
                  SUBGASTO) DESDE EL RANKING SUPERIOR.
                </Text>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>QUIÉN PAGA</Text>
                  <FilterRow columns={3}>
                    <FilterPill label="TODOS" selected={pagoFiltro === 'TODOS'} onPress={() => setPagoFiltro('TODOS')} />
                    <FilterPill label="PAGADOS POR MI" selected={pagoFiltro === 'YO'} onPress={() => setPagoFiltro('YO')} />
                    <FilterPill label="LO PAGA OTRO" selected={pagoFiltro === 'OTRO'} onPress={() => setPagoFiltro('OTRO')} />
                  </FilterRow>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>VENTANA EVOLUCIÓN (MESES)</Text>
                  <FilterRow columns={3}>
                    {[6, 12, 18].map((m) => (
                      <FilterPill key={m} label={`${m}M`} selected={monthsBack === m} onPress={() => setMonthsBack(m)} />
                    ))}
                  </FilterRow>
                  <Text style={analysisStyles.filterHelper}>
                    AFECTA A LA EVOLUCIÓN MENSUAL (SERIE DE MESES Y KPIS DE TENDENCIA).
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Error */}
          {error && (
            <View style={panelStyles.section}>
              <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          {/* Loader */}
          {loading && !data && (
            <View style={panelStyles.section}>
              <View style={[panelStyles.card, { alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ marginTop: 8, fontSize: 12, color: colors.textSecondary }}>
                  CARGANDO KPIS...
                </Text>
              </View>
            </View>
          )}

          {/* CONTENIDO */}
          {data && (
            <>
              {/* Ranking / Selector contenedor (ARRIBA) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="RANKING POR CONTENEDORES (MES)"
                  onInfo={() =>
                    info.open(
                      'RANKING POR CONTENEDORES',
                      'SELECTOR PRINCIPAL DE CONTENEDOR. POR DEFECTO “TODOS”. SE MUESTRA TOP 3 Y PUEDES DESPLEGAR PARA VER TODOS (INCLUYENDO LOS QUE NO TIENEN GASTO). AL SELECCIONAR UN CONTENEDOR, APARECEN DEBAJO SUS SUBCATEGORÍAS COMO BOTONES.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.rankHeaderRow}>
                    <Text style={analysisStyles.cardSubtitle}>
                      {(rankingExpanded ? 'TODOS LOS CONTENEDORES' : 'TOP 3 CONTENEDORES')}
                    </Text>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setRankingExpanded((p) => !p)}
                      style={styles.rankExpandBtn}
                    >
                      <Text style={styles.rankExpandText}>
                        {rankingExpanded ? 'VER MENOS' : 'VER TODOS'}
                      </Text>
                      <Ionicons
                        name={rankingExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>

                  {(rankingExpanded ? fullCategoryRanking : top3Categories).map((cat) => {
                    const pct = maxRankImporte ? (safeNum(cat.importe) / maxRankImporte) * 100 : 0;
                    const isSelected = selectedView === 'CATEGORIA' && cat.key === selectedCategoryKey;

                    return (
                      <TouchableOpacity
                        key={cat.key}
                        activeOpacity={0.85}
                        onPress={() => selectContainer(cat.key)}
                        style={[styles.rankRow, isSelected && styles.rankRowSelected]}
                      >
                        <View style={styles.rankLeft}>
                          <View style={[styles.rankDot, isSelected && styles.rankDotSelected]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.rankLabel, isSelected && styles.rankLabelSelected]}>
                              {cat.label}
                            </Text>
                            <Text style={styles.rankSub}>{fmtCurrency(cat.importe)}</Text>
                          </View>
                        </View>

                        <View style={styles.rankRight}>
                          <Text style={[styles.rankValue, isSelected && styles.rankValueSelected]}>
                            {safeNum(cat.porcentaje) ? `${safeNum(cat.porcentaje).toFixed(1)}%` : '—'}
                          </Text>
                          <View style={styles.rankBarBg}>
                            <View style={[styles.rankBarFill, { width: `${Math.min(100, pct)}%` }]} />
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}

                  {/* TODOS */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={selectAllContainers}
                    style={[
                      styles.allRow,
                      selectedView === 'GENERAL' && !selectedCategoryKey ? styles.allRowSelected : null,
                    ]}
                  >
                    <View style={styles.allLeft}>
                      <Ionicons
                        name={selectedView === 'GENERAL' && !selectedCategoryKey ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={selectedView === 'GENERAL' && !selectedCategoryKey ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.allLabel,
                          selectedView === 'GENERAL' && !selectedCategoryKey ? styles.allLabelSelected : null,
                        ]}
                      >
                        TODOS
                      </Text>
                    </View>
                    <Text style={styles.allHint}>SIN FILTRO DE CONTENEDOR</Text>
                  </TouchableOpacity>

                  {/* Subcategorías (una sola fila, botones iguales) */}
                  {selectedView === 'CATEGORIA' && effectiveSelectedCategory && (
                    <View style={{ marginTop: 12 }}>
                      <View style={styles.subHeaderRow}>
                        <Text style={styles.subTitle}>
                          SUBCATEGORÍAS · {effectiveSelectedCategory.label}
                        </Text>

                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() =>
                            info.open(
                              'SUBCATEGORÍAS (SUBGASTO)',
                              'REFINA EL CONTENEDOR SELECCIONADO. SI ELIGES “TODOS”, SE CALCULA SOBRE EL CONTENEDOR COMPLETO.'
                            )
                          }
                          style={styles.subInfoBtn}
                        >
                          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                          <Text style={styles.subInfoText}>QUÉ ES</Text>
                        </TouchableOpacity>
                      </View>

                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.subRow}>
                          {subtipoOptions.map((opt) => {
                            const selected = selectedSubtipoId === opt.id;
                            return (
                              <TouchableOpacity
                                key={opt.id ?? 'ALL'}
                                activeOpacity={0.85}
                                style={[styles.subPill, selected && styles.subPillSelected]}
                                onPress={() => setSelectedSubtipoId(opt.id)}
                              >
                                <Text style={[styles.subPillText, selected && styles.subPillTextSelected]}>
                                  {opt.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>

                      <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                        TOCA UNA SUBCATEGORÍA PARA FILTRAR. “TODOS” INCLUYE EL CONTENEDOR COMPLETO.
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Resumen avanzado */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="RESUMEN AVANZADO"
                  onInfo={() =>
                    info.open(
                      'RESUMEN AVANZADO',
                      'KPIS ADICIONALES PARA ENTENDER EL “RITMO” Y LA ESTABILIDAD DE TU GASTO: MEDIAS, MÁXIMOS/MÍNIMOS Y CONCENTRACIÓN POR CATEGORÍAS.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.summaryRow}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'MEDIA DIARIA (7 DÍAS)',
                          'PROMEDIO DEL GASTO DIARIO EN LOS ÚLTIMOS 7 DÍAS. ÚTIL PARA COMPARAR TU RITMO DE GASTO SEMANA A SEMANA.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>MEDIA DIARIA (7D)</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.avg)}</Text>
                        <Text style={styles.kpiCardHint}>PROMEDIO</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'VOLATILIDAD (7 DÍAS)',
                          'MIDE CUÁNTO “OSCILA” TU GASTO DÍA A DÍA. CUANTO MÁS ALTA, MÁS IRREGULAR ESTÁ SIENDO TU SEMANA.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="pulse-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>VOLATILIDAD (7D)</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.std)}</Text>
                        <Text style={styles.kpiCardHint}>DESV. ESTÁNDAR</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.summaryRow, { marginTop: 10 }]}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'DÍA MÁS ALTO (7 DÍAS)',
                          'EL DÍA CON MAYOR GASTO EN LOS ÚLTIMOS 7 DÍAS. SIRVE PARA IDENTIFICAR “PICOS”.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="trending-up-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>DÍA MÁS ALTO</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.max.value)}</Text>
                        <Text style={styles.kpiCardHint}>{String(kpi7d.max.label ?? '—').toUpperCase()}</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'DÍAS SIN GASTO (7 DÍAS)',
                          'NÚMERO DE DÍAS EN LOS ÚLTIMOS 7 EN LOS QUE NO HUBO GASTO COTIDIANO.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>DÍAS SIN GASTO</Text>
                        <Text style={styles.kpiCardValue}>{kpi7d.zeroDays}</Text>
                        <Text style={styles.kpiCardHint}>ÚLTIMOS 7 DÍAS</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.readingCard, { marginTop: 12 }]}>
                    <Text style={styles.readingTitle}>LECTURA RÁPIDA</Text>

                    <Text style={styles.readingText}>
                      RITMO SEMANAL ACTUAL:{' '}
                      <Text style={styles.readingStrong}>{fmtCurrency(week?.total_semana ?? 0)}</Text>
                      {week?.limite_semana ? (
                        <>
                          {' '}DE <Text style={styles.readingStrong}>{fmtCurrency(week.limite_semana)}</Text>
                          {' '}(
                          {fmtPct(
                            ((safeNum(week.total_semana) / Math.max(1, safeNum(week.limite_semana))) * 100) || 0
                          )}
                          )
                        </>
                      ) : (
                        <> (SIN LÍMITE SEMANAL CONFIGURADO)</>
                      )}
                      .
                    </Text>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.readingInlineInfo}
                      onPress={() =>
                        info.open(
                          'LECTURA RÁPIDA',
                          'COMPARA EL GASTO SEMANAL ACUMULADO CON EL LÍMITE SEMANAL (SI EXISTE).'
                        )
                      }
                    >
                      <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                      <Text style={styles.readingInlineInfoText}>QUÉ SIGNIFICA</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Concentración */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="CONCENTRACIÓN DEL GASTO (MES)"
                  onInfo={() =>
                    info.open(
                      'CONCENTRACIÓN DEL GASTO (MES)',
                      'INDICA CUÁNTO DEL GASTO DEL MES SE CONCENTRA EN POCAS CATEGORÍAS.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {categoriasMes.length ? (
                    <>
                      <View style={styles.concentrationRow}>
                        <View style={styles.concentrationCell}>
                          <Text style={styles.concentrationLabel}>TOP 1 CATEGORÍA</Text>
                          <Text style={styles.concentrationValue}>{fmtPct(concentration.top1Pct)}</Text>
                          <Text style={styles.concentrationHint}>
                            {String(concentration.top1?.label ?? '—').toUpperCase()}
                          </Text>
                        </View>

                        <View style={styles.concentrationCell}>
                          <Text style={styles.concentrationLabel}>TOP 3 CATEGORÍAS</Text>
                          <Text style={styles.concentrationValue}>{fmtPct(concentration.top3Pct)}</Text>
                          <Text style={styles.concentrationHint}>PESO CONJUNTO (TOP 3)</Text>
                        </View>
                      </View>

                      <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                        CONSEJO: SI TOP 1 SUPERA ~35–40% DE FORMA RECURRENTE, REVISA ESE CONTENEDOR.
                      </Text>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>AÚN NO HAY GASTOS EN EL MES.</Text>
                  )}
                </View>
              </View>

              {/* Evolución 7 días */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="EVOLUCIÓN (ÚLTIMOS 7 DÍAS)"
                  onInfo={() =>
                    info.open(
                      'EVOLUCIÓN (7 DÍAS)',
                      'SERIE DIARIA DEL GASTO COTIDIANO (ÚLTIMOS 7 DÍAS). TOCA UN PUNTO PARA VER EL IMPORTE.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <Text style={panelStyles.cardTitle}>
                    {selectedView === 'CATEGORIA' && effectiveSelectedCategory
                      ? `TENDENCIA · ${effectiveSelectedCategory.label}`
                      : 'TENDENCIA GLOBAL'}
                  </Text>
                  <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                    TOCA UN PUNTO PARA VER EL IMPORTE.
                  </Text>

                  <View style={{ marginTop: 10 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ position: 'relative' }}>
                        <LineChart
                          data={{ labels: labels7, datasets: [{ data: values7 }] }}
                          width={chartWidth}
                          height={chartHeight}
                          chartConfig={chartConfig}
                          bezier
                          style={{ borderRadius: 14 }}
                          withInnerLines={false}
                          withOuterLines={false}
                          yAxisLabel=""
                          yAxisSuffix=""
                          onDataPointClick={(dp: any) => {
                            const idx = Number(dp?.index ?? 0);
                            const lab = String(labels7[idx] ?? '').toUpperCase();
                            const val = Number(dp?.value ?? 0);

                            showTooltip({
                              value: val,
                              x: Number(dp?.x ?? 0),
                              y: Number(dp?.y ?? 0),
                              label: lab || 'DÍA',
                              width: chartWidth,
                            });
                          }}
                        />

                        {chartTip.visible && (
                          <View style={[styles.tooltip, { left: chartTip.x, top: chartTip.y }]}>
                            <View style={styles.tooltipTopRow}>
                              <Text style={styles.tooltipLabel}>{chartTip.label}</Text>
                              <Pressable onPress={hideTooltip} hitSlop={8}>
                                <Ionicons name="close" size={14} color={colors.textSecondary} />
                              </Pressable>
                            </View>
                            <Text style={styles.tooltipValue}>{fmtCurrency(chartTip.value)}</Text>
                          </View>
                        )}
                      </View>
                    </ScrollView>
                  </View>
                </View>
              </View>

              {/* Evolución diaria del mes */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="EVOLUCIÓN DIARIA DEL MES"
                  onInfo={() =>
                    info.open(
                      'EVOLUCIÓN DIARIA DEL MES',
                      'SERIE DIARIA COMPLETA DEL MES. TOCA UN PUNTO PARA VER EL IMPORTE.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {serieDiariaMes?.length ? (
                    <>
                      <Text style={panelStyles.cardTitle}>
                        {selectedView === 'CATEGORIA' && effectiveSelectedCategory
                          ? `MES · ${effectiveSelectedCategory.label}`
                          : 'MES · GLOBAL'}
                      </Text>

                      <View style={{ marginTop: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={{ position: 'relative' }}>
                            <LineChart
                              data={{ labels: labelsMonthDays, datasets: [{ data: valuesMonthDays }] }}
                              width={Math.max(chartWidth, labelsMonthDays.length * 18)}
                              height={chartHeight}
                              chartConfig={chartConfig}
                              style={{ borderRadius: 14 }}
                              withInnerLines={false}
                              withOuterLines={false}
                              yAxisLabel=""
                              yAxisSuffix=""
                              onDataPointClick={(dp: any) => {
                                const idx = Number(dp?.index ?? 0);
                                const dayLab = String(labelsMonthDays[idx] ?? '').toUpperCase();
                                const val = Number(dp?.value ?? 0);

                                showTooltip({
                                  value: val,
                                  x: Number(dp?.x ?? 0),
                                  y: Number(dp?.y ?? 0),
                                  label: dayLab ? `DÍA ${dayLab}` : 'DÍA',
                                  width: Math.max(chartWidth, labelsMonthDays.length * 18),
                                });
                              }}
                            />

                            {chartTip.visible && (
                              <View style={[styles.tooltip, { left: chartTip.x, top: chartTip.y }]}>
                                <View style={styles.tooltipTopRow}>
                                  <Text style={styles.tooltipLabel}>{chartTip.label}</Text>
                                  <Pressable onPress={hideTooltip} hitSlop={8}>
                                    <Ionicons name="close" size={14} color={colors.textSecondary} />
                                  </Pressable>
                                </View>
                                <Text style={styles.tooltipValue}>{fmtCurrency(chartTip.value)}</Text>
                              </View>
                            )}
                          </View>
                        </ScrollView>
                      </View>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>
                      ESTE BACKEND AÚN NO DEVUELVE SERIE DIARIA DEL MES (SERIE_DIARIA_MES) O NO HAY DATOS.
                    </Text>
                  )}
                </View>
              </View>

              {/* Evolución mensual */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title={`EVOLUCIÓN MENSUAL (${monthsBack} MESES)`}
                  onInfo={() =>
                    info.open(
                      'EVOLUCIÓN MENSUAL',
                      'SERIE MENSUAL PARA VER TENDENCIA Y ESTACIONALIDAD. TOCA UNA BARRA PARA VER EL IMPORTE.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {serieMensual?.length ? (
                    <>
                      {kpisEvolucion ? (
                        <>
                          <View style={styles.evoRow}>
                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() =>
                                info.open(
                                  'VARIACIÓN VS MES ANTERIOR',
                                  'DIFERENCIA DEL MES ACTUAL RESPECTO AL MES ANTERIOR (IMPORTE Y PORCENTAJE).'
                                )
                              }
                            >
                              <Text style={styles.evoLabel}>MOM</Text>
                              <Text style={styles.evoValue}>{fmtCurrency(kpisEvolucion.variacion_mes_abs)}</Text>
                              <Text
                                style={[
                                  styles.evoHint,
                                  safeNum(kpisEvolucion.variacion_mes_abs) >= 0 ? styles.varUp : styles.varDown,
                                ]}
                              >
                                {fmtPct(kpisEvolucion.variacion_mes_pct)}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() => info.open('MEDIA 3 MESES', 'MEDIA DE GASTO DE LOS ÚLTIMOS 3 MESES.')}
                            >
                              <Text style={styles.evoLabel}>MEDIA 3M</Text>
                              <Text style={styles.evoValue}>{fmtCurrency(kpisEvolucion.media_3m)}</Text>
                              <Text style={styles.evoHint}>BASE 3 MESES</Text>
                            </TouchableOpacity>
                          </View>

                          <View style={[styles.evoRow, { marginTop: 10 }]}>
                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() => info.open('MEDIA 6 MESES', 'MEDIA DE GASTO DE LOS ÚLTIMOS 6 MESES.')}
                            >
                              <Text style={styles.evoLabel}>MEDIA 6M</Text>
                              <Text style={styles.evoValue}>{fmtCurrency(kpisEvolucion.media_6m)}</Text>
                              <Text style={styles.evoHint}>BASE 6 MESES</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() => info.open('TENDENCIA', 'INDICADOR CUALITATIVO CALCULADO POR BACKEND.')}
                            >
                              <Text style={styles.evoLabel}>TENDENCIA</Text>
                              <Text style={styles.evoValue}>{String(kpisEvolucion.tendencia ?? '').toUpperCase()}</Text>
                              <Text style={styles.evoHint} numberOfLines={2}>
                                {String(kpisEvolucion.tendencia_detalle ?? '').toUpperCase()}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <Text style={[panelStyles.cardSubtitle, { marginBottom: 10 }]}>
                          KPIS DE EVOLUCIÓN NO DISPONIBLES (KPIS_EVOLUCION).
                        </Text>
                      )}

                      <Text style={[panelStyles.cardTitle, { marginTop: 12 }]}>SERIE MENSUAL</Text>
                      <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                        TOCA UNA BARRA PARA VER EL IMPORTE.
                      </Text>

                      <View style={{ marginTop: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={{ position: 'relative' }}>
                            {/* Captura tap por coordenadas (fallback robusto) */}
                            <View
                              onStartShouldSetResponder={() => true}
                              onResponderRelease={onMonthlyChartTap}
                            >
                              <BarChartAny
                                data={{
                                  labels: labelsMonths,
                                  datasets: [{ data: valuesMonths }],
                                }}
                                width={monthlyChartWidth}
                                height={260}
                                chartConfig={chartConfig}
                                style={{ borderRadius: 14 }}
                                fromZero
                                withInnerLines={false}
                                yAxisLabel=""
                                yAxisSuffix=""
                                showValuesOnTopOfBars={false}
                                // Si en runtime se dispara, perfecto. Si no, el fallback de arriba lo cubre.
                                onDataPointClick={(dp: any) => {
                                  const idx = Number(dp?.index ?? 0);
                                  const val = Number(dp?.value ?? 0);
                                  const full = fullMonthLabels[idx] ?? labelsMonths[idx] ?? '';

                                  showTooltip({
                                    value: val,
                                    x: Number(dp?.x ?? 0),
                                    y: Number(dp?.y ?? 0),
                                    label: full ? `MES ${String(full).toUpperCase()}` : 'MES',
                                    width: monthlyChartWidth,
                                  });
                                }}
                              />
                            </View>

                            {chartTip.visible && (
                              <View style={[styles.tooltip, { left: chartTip.x, top: chartTip.y }]}>
                                <View style={styles.tooltipTopRow}>
                                  <Text style={styles.tooltipLabel}>{chartTip.label}</Text>
                                  <Pressable onPress={hideTooltip} hitSlop={8}>
                                    <Ionicons name="close" size={14} color={colors.textSecondary} />
                                  </Pressable>
                                </View>
                                <Text style={styles.tooltipValue}>{fmtCurrency(chartTip.value)}</Text>
                              </View>
                            )}
                          </View>
                        </ScrollView>

                        <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                          RANGO: {(fullMonthLabels[0] ?? '—').toUpperCase()} → {(fullMonthLabels[fullMonthLabels.length - 1] ?? '—').toUpperCase()}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>
                      ESTE BACKEND AÚN NO DEVUELVE SERIE MENSUAL (SERIE_MENSUAL) O NO HAY DATOS.
                    </Text>
                  )}
                </View>
              </View>

              {/* KPIs contenedor */}
              {selectedView === 'CATEGORIA' && effectiveSelectedCategory && (
                <View style={[panelStyles.section, { marginBottom: 24 }]}>
                  <SectionHeader
                    title={`KPIS DEL CONTENEDOR · ${effectiveSelectedCategory.label}`}
                    onInfo={() =>
                      info.open(
                        'KPIS DEL CONTENEDOR',
                        'RESUMEN COMPACTO DEL CONTENEDOR SELECCIONADO: TICKETS, TICKET MEDIO, PESO SOBRE EL TOTAL Y VARIACIÓN VS MES ANTERIOR.'
                      )
                    }
                  />

                  <View style={panelStyles.card}>
                    {selectedCategoryKpis ? (
                      <>
                        <View style={styles.kpiGrid}>
                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() => info.open('TICKETS', 'NÚMERO DE COMPRAS (TICKETS) REGISTRADAS EN EL MES.')}
                          >
                            <Text style={analysisStyles.kpiLabel}># TICKETS</Text>
                            <Text style={analysisStyles.kpiValue}>{selectedCategoryKpis.tickets}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() => info.open('TICKET MEDIO', 'IMPORTE MEDIO POR COMPRA EN ESTE CONTENEDOR.')}
                          >
                            <Text style={analysisStyles.kpiLabel}>TICKET MEDIO</Text>
                            <Text style={analysisStyles.kpiValue}>
                              {fmtCurrency(selectedCategoryKpis.ticket_medio)}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() => info.open('PESO SOBRE TOTAL', 'PORCENTAJE DEL GASTO TOTAL DEL MES QUE REPRESENTA ESTE CONTENEDOR.')}
                          >
                            <Text style={analysisStyles.kpiLabel}>PESO SOBRE TOTAL</Text>
                            <Text style={analysisStyles.kpiValue}>
                              {safeNum(selectedCategoryKpis.peso_sobre_total_gasto).toFixed(1)}%
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() => info.open('VARIACIÓN VS MES ANTERIOR', 'CAMBIO PORCENTUAL RESPECTO AL MES ANTERIOR.')}
                          >
                            <Text style={analysisStyles.kpiLabel}>VAR. IMPORTE</Text>
                            <Text
                              style={[
                                analysisStyles.kpiValue,
                                safeNum(selectedCategoryKpis.variacion_importe_pct) >= 0 ? styles.varUp : styles.varDown,
                              ]}
                            >
                              {fmtPct(selectedCategoryKpis.variacion_importe_pct)}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <Text style={analysisStyles.emptyText}>
                        NO HAY KPIS SUFICIENTES PARA ESTE CONTENEDOR CON EL FILTRO ACTUAL.
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {!hasMonthlyCharts && (
                <View style={[panelStyles.section, { marginBottom: 24 }]}>
                  <View style={panelStyles.card}>
                    <Text style={panelStyles.cardTitle}>NOTA</Text>
                    <Text style={[panelStyles.cardSubtitle, { marginTop: 6 }]}>
                      NO SE DETECTAN SERIES MENSUALES (SERIE_DIARIA_MES / SERIE_MENSUAL).
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <InfoModal
          visible={info.visible}
          title={info.title}
          text={info.text}
          onClose={info.close}
        />
      </View>
    </>
  );
};

export default DayToDayKpisScreen;

// --------------------
// Estilos específicos
// --------------------
const styles = StyleSheet.create({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Selector mes
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  monthIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBtnDisabled: {
    opacity: 0.45,
  },
  monthCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  monthTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  monthHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: '700',
  },

  // Resumen
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    minHeight: 86,
  },
  kpiIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  kpiCardLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
    fontWeight: '900',
  },
  kpiCardValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  kpiCardHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
  },

  // Lectura rápida
  readingCard: {
    backgroundColor: colors.neutralSoft,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  readingTitle: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  readingText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  readingStrong: {
    fontWeight: '900',
    color: colors.textPrimary,
  },
  readingInlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    alignSelf: 'flex-start',
    gap: 6,
  },
  readingInlineInfoText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '900',
  },

  // Concentración
  concentrationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  concentrationCell: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  concentrationLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '900',
  },
  concentrationValue: {
    marginTop: 4,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  concentrationHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
  },

  // Tooltip
  tooltip: {
    position: 'absolute',
    width: 160,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  tooltipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tooltipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '900',
    paddingRight: 8,
  },
  tooltipValue: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '900',
  },

  // Ranking selector
  rankHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rankExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rankExpandText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '900',
  },

  rankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    marginTop: 6,
  },
  rankRowSelected: {
    backgroundColor: colors.primarySoft,
  },
  rankLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  rankDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginRight: 8,
  },
  rankDotSelected: {
    backgroundColor: colors.primary,
  },
  rankLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  rankLabelSelected: {
    color: colors.primary,
  },
  rankSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '700',
  },
  rankRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  rankValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
    marginBottom: 4,
  },
  rankValueSelected: {
    color: colors.primary,
  },
  rankBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  rankBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  // TODOS
  allRow: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  allRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  allLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  allLabelSelected: {
    color: colors.primary,
  },
  allHint: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '900',
  },

  // Subcategorías (una fila, botones iguales)
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subTitle: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  subInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  subInfoText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '900',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subPill: {
    width: 118, // tamaño igual para todos
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subPillSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  subPillText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '900',
  },
  subPillTextSelected: {
    color: colors.primary,
  },

  // KPIs grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  kpiCell: {
    width: '48%',
    marginBottom: 10,
  },

  // Evolución KPIs
  evoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  evoCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  evoLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '900',
  },
  evoValue: {
    marginTop: 4,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  evoHint: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '800',
  },

  varUp: {
    color: colors.danger,
  },
  varDown: {
    color: colors.success,
  },
});
