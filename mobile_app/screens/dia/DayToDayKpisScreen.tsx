// mobile_app/screens/dia/DayToDayKpisScreen.tsx
// -----------------------------------------------------------------------------
// KPIs Día a Día (pantalla “profundización”)
//
// OBJETIVO (actualizado):
// - Reutiliza GET /api/v1/analytics/day-to-day (getDayToDayAnalysis)
// - Muestra KPIs extra + gráficas (7 días, diaria del mes, evolución mensual)
// - Usa InfoButton/InfoModal en KPIs y secciones para explicar significado
//
// IMPORTANTE:
// - Mantiene funcionalidades existentes.
// - Los campos nuevos (serie_diaria_mes, serie_mensual, kpis_evolucion) son opcionales.
//   Si backend aún no está desplegado, la pantalla no falla: simplemente no pinta esas secciones.
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { FilterPill } from '../../components/ui/FilterPill';
import { FilterRow } from '../../components/ui/FilterRow';
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
  { key: 'SUPERMERCADOS', label: 'Supermercados' },
  { key: 'SUMINISTROS', label: 'Suministros' },
  { key: 'VEHICULOS', label: 'Vehículos' },
  { key: 'ROPA', label: 'Ropa' },
  { key: 'RESTURACION', label: 'Restauración' }, // (ojo: en backend tu comentario pone RESTURACION; mantenemos tal cual)
  { key: 'OCIO', label: 'Ocio' },
] as const;

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

// Mapa de subgastos por categoría (reutilizado del screen de Analysis)
const SUBTIPOS_POR_CATEGORIA: Record<string, SubtipoOption[]> = {
  SUPERMERCADOS: [{ id: null, label: 'Todos los tipos' }],
  SUMINISTROS: [{ id: null, label: 'Todos los tipos' }],
  VEHICULOS: [
    { id: null, label: 'Todos los tipos' },
    { id: 'TIP-GASOLINA-SW1ZQO', label: 'Combustible' },
    { id: 'PEA-TIPOGASTO-7HDY89', label: 'Peajes' },
    { id: 'MAV-TIPOGASTO-BVC356', label: 'Mantenimiento' },
  ],
  ROPA: [{ id: null, label: 'Todos los tipos' }],
  RESTURACION: [{ id: null, label: 'Todos los tipos' }],
  OCIO: [
    { id: null, label: 'Todos los tipos' },
    { id: 'TRA-TIPOGASTO-RB133Z', label: 'Transporte' },
    { id: 'HOS-TIPOGASTO-357FDG', label: 'Hospedaje' },
    { id: 'ACT-TIPOGASTO-2X9H1Q', label: 'Actividades' },
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

// Convierte últimos 7 días en arrays para charts (labels + values)
function normalizeLast7(ultimos7: Last7DayItem[]) {
  const labels = ultimos7.map((x) => String(x.label ?? ''));
  const values = ultimos7.map((x) => safeNum(x.importe));
  return { labels, values };
}

// ✅ Serie diaria del mes: labels compactos (1..31)
function normalizeDailyMonthSeries(items: DailySeriesItem[]) {
  const labels = items.map((x) => String(x.dia));
  const values = items.map((x) => safeNum(x.importe));
  return { labels, values };
}

// ✅ Serie mensual: labels "MM" (o "YYYY-MM" si prefieres)
function normalizeMonthlySeries(items: MonthlySeriesItem[]) {
  const labels = items.map((x) => {
    // mostramos solo mes para no saturar: "01", "02", ...
    const mm = String(x.month).padStart(2, '0');
    return mm;
  });
  const values = items.map((x) => safeNum(x.importe));
  const fullLabels = items.map((x) => x.label);
  return { labels, values, fullLabels };
}

// --------------------
// Tipado route params
// --------------------

type DayToDayKpisRouteParams = {
  fromHome?: boolean;

  // Opcional: si vienes desde Analysis, puedes “arrastrar” el filtro ya seleccionado
  pago?: PagoFiltro;
  view?: 'GENERAL' | 'CATEGORIA';
  categoria?: string | null;
  tipoId?: string | null;

  // ✅ opcional: ventana inicial para meses
  monthsBack?: number;
};

// --------------------
// Chart config (base)
// --------------------
const chartConfig: any = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(42, 158, 159, ${opacity})`, // primary
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // textSecondary
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: colors.primary,
  },
};

type TrendTooltip = {
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

  // ✅ Info modal (global)
  const info = useInfoModal();

  // Params (si vienes desde DayToDayAnalysis con preselección)
  const params = (route?.params ?? {}) as DayToDayKpisRouteParams;
  const fromHome = params.fromHome ?? false;

  // Filtros (alineados con Analysis para consistencia)
  const [selectedView, setSelectedView] = useState<'GENERAL' | 'CATEGORIA'>(
    params.view ?? 'GENERAL'
  );
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [pagoFiltro, setPagoFiltro] = useState<PagoFiltro>(params.pago ?? 'YO');

  // ✅ Ventana para evolución mensual (months_back en backend)
  const [monthsBack, setMonthsBack] = useState<number>(params.monthsBack ?? 12);

  // Categoría / subtipo
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(
    params.categoria ?? null
  );
  const [selectedSubtipoId, setSelectedSubtipoId] = useState<string | null>(
    params.tipoId ?? null
  );

  // Data
  const [data, setData] = useState<DayToDayAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tooltip chart
  const [trendTip, setTrendTip] = useState<TrendTooltip>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    value: 0,
  });

  // Reset subtipo si cambia categoría
  useEffect(() => {
    setSelectedSubtipoId(null);
  }, [selectedCategoryKey]);

  // Para dividir categorías en filas (3 columnas)
  const categoryRows = useMemo<CategoryOption[][]>(() => {
    const rows: CategoryOption[][] = [];
    for (let i = 0; i < CATEGORY_OPTIONS.length; i += 3) {
      rows.push(CATEGORY_OPTIONS.slice(i, i + 3) as unknown as CategoryOption[]);
    }
    return rows;
  }, []);

  // --------------------
  // Carga de datos
  // --------------------
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setTrendTip((t) => ({ ...t, visible: false }));

      const req: any = {
        pago: pagoFiltro,
        monthsBack, // ✅ frontend -> backend via analyticsApi (monthsBack -> months_back)
      };

      // En modo categoría: aplicamos (tipoId) o (categoria)
      if (selectedView === 'CATEGORIA') {
        if (selectedSubtipoId) req.tipoId = selectedSubtipoId;
        else if (selectedCategoryKey) req.categoria = selectedCategoryKey;
      }

      const resp = await getDayToDayAnalysis(req);
      setData(resp);

      // Si no hay categoría seleccionada y hay categorías, fijamos la primera (consistente con Analysis)
      if (!selectedCategoryKey && resp.categorias_mes?.length) {
        setSelectedCategoryKey(resp.categorias_mes[0].key);
      }
    } catch (e) {
      console.log('[DayToDayKpisScreen] Error cargando KPIs día a día', e);
      setError('No se han podido cargar los KPIs día a día.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pagoFiltro, selectedView, selectedCategoryKey, selectedSubtipoId, monthsBack]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --------------------
  // Derivados de datos
  // --------------------
  const today = data?.today;
  const week = data?.week;
  const month = data?.month;

  const categoriasMes = data?.categorias_mes ?? [];
  const ultimos7Dias: Last7DayItem[] = data?.ultimos_7_dias ?? [];
  const categoryKpis = data?.category_kpis ?? {};

  // ✅ Nuevos datos (si backend los trae)
  const serieDiariaMes: DailySeriesItem[] = data?.serie_diaria_mes ?? [];
  const serieMensual: MonthlySeriesItem[] = data?.serie_mensual ?? [];
  const kpisEvolucion: EvolutionKpis | null = (data?.kpis_evolucion ?? null) as any;

  const hasMonthlyCharts = Boolean(serieDiariaMes?.length || serieMensual?.length);

  const effectiveSelectedCategory = useMemo(() => {
    if (!categoriasMes.length) return null;
    const fromState =
      selectedCategoryKey &&
      categoriasMes.find((c) => c.key === selectedCategoryKey);
    return fromState || categoriasMes[0];
  }, [categoriasMes, selectedCategoryKey]);

  const subtipoOptions: SubtipoOption[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];
    return SUBTIPOS_POR_CATEGORIA[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory]);

  // KPIs extra basados en últimos 7 días
  const kpi7d = useMemo(() => {
    const vals = ultimos7Dias.map((d) => safeNum(d.importe));
    const n = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = n ? sum / n : 0;

    // “Días sin gasto” (importe == 0)
    const zeroDays = vals.filter((x) => x <= 0).length;

    // Máximo / mínimo
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

    // Volatilidad simple (desviación estándar)
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

  // Concentración por categorías (mes): Top1 y Top3 sobre el gasto del mes
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

  // Ranking categorías (mes)
  const topCategorias = useMemo(() => {
    const sorted = [...categoriasMes].sort((a, b) => safeNum(b.importe) - safeNum(a.importe));
    return sorted.slice(0, 6);
  }, [categoriasMes]);

  const maxTopCat = useMemo(() => {
    if (!topCategorias.length) return 1;
    return Math.max(1, ...topCategorias.map((c) => safeNum(c.importe)));
  }, [topCategorias]);

  // Serie para chart: últimos 7
  const { labels: labels7, values: values7 } = useMemo(
    () => normalizeLast7(ultimos7Dias),
    [ultimos7Dias]
  );

  // ✅ Serie para chart: diaria del mes
  const { labels: labelsMonthDays, values: valuesMonthDays } = useMemo(() => {
    if (!serieDiariaMes?.length) return { labels: [], values: [] };
    return normalizeDailyMonthSeries(serieDiariaMes);
  }, [serieDiariaMes]);

  // ✅ Serie para chart: mensual (N meses)
  const { labels: labelsMonths, values: valuesMonths, fullLabels: fullMonthLabels } = useMemo(() => {
    if (!serieMensual?.length) return { labels: [], values: [], fullLabels: [] as string[] };
    return normalizeMonthlySeries(serieMensual);
  }, [serieMensual]);

  // Sizing chart
  const width = Dimensions.get('window').width;
  const chartWidth = Math.max(360, width - 24);
  const chartHeight = 220;

  // En modo categoría: KPI de la categoría seleccionada
  const selectedCategoryKpis = useMemo(() => {
    if (!effectiveSelectedCategory) return null;
    return categoryKpis[effectiveSelectedCategory.key] ?? null;
  }, [effectiveSelectedCategory, categoryKpis]);

  // --------------------
  // Header de sección (título + InfoButton)
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
  // Render
  // --------------------
  return (
    <>
      <Header
        title="KPIs día a día"
        subtitle="Evolución y métricas avanzadas para profundizar en tus gastos cotidianos."
        showBack
        onBackPress={() => {
          if (fromHome) navigation.navigate('HomeTab');
          else navigation.goBack();
        }}
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {/* FILTROS (DESPLEGABLE) */}
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
                  {filtrosAbiertos ? 'Ocultar filtros' : 'Mostrar filtros'}
                </Text>
              </View>
            </TouchableOpacity>

            {filtrosAbiertos && (
              <View style={analysisStyles.filterContent}>
                <Text style={analysisStyles.filterLabel}>Modo</Text>
                <FilterRow columns={2}>
                  {(['GENERAL', 'CATEGORIA'] as const).map((vista) => (
                    <FilterPill
                      key={vista}
                      label={vista === 'GENERAL' ? 'General' : 'Por categoría'}
                      selected={selectedView === vista}
                      onPress={() => setSelectedView(vista)}
                    />
                  ))}
                </FilterRow>

                <Text style={analysisStyles.filterHelper}>
                  En “General” ves KPIs globales. En “Por categoría” profundizas en un contenedor (y opcionalmente
                  un subgasto) para obtener métricas más específicas.
                </Text>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>Quién paga</Text>
                  <FilterRow columns={3}>
                    <FilterPill
                      label="Todos"
                      selected={pagoFiltro === 'TODOS'}
                      onPress={() => setPagoFiltro('TODOS')}
                    />
                    <FilterPill
                      label="Pagados por mi"
                      selected={pagoFiltro === 'YO'}
                      onPress={() => setPagoFiltro('YO')}
                    />
                    <FilterPill
                      label="Lo paga otro"
                      selected={pagoFiltro === 'OTRO'}
                      onPress={() => setPagoFiltro('OTRO')}
                    />
                  </FilterRow>
                </View>

                {/* ✅ Ventana mensual (months_back) */}
                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>Ventana evolución (meses)</Text>
                  <FilterRow columns={3}>
                    {[6, 12, 18].map((m) => (
                      <FilterPill
                        key={m}
                        label={`${m}M`}
                        selected={monthsBack === m}
                        onPress={() => setMonthsBack(m)}
                      />
                    ))}
                  </FilterRow>
                  <Text style={analysisStyles.filterHelper}>
                    Afecta a la evolución mensual (serie de meses y KPIs de tendencia).
                  </Text>
                </View>

                {selectedView === 'CATEGORIA' && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={analysisStyles.filterLabel}>Contenedores</Text>
                    {categoryRows.map((row, idx) => (
                      <FilterRow key={idx} columns={3}>
                        {row.map((cat) => (
                          <FilterPill
                            key={cat.key}
                            label={cat.label}
                            selected={selectedCategoryKey === cat.key}
                            onPress={() => setSelectedCategoryKey(cat.key)}
                          />
                        ))}
                      </FilterRow>
                    ))}

                    {/* Subtipo (si existe) */}
                    {effectiveSelectedCategory && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={analysisStyles.filterLabel}>Subgasto</Text>
                        <View style={analysisStyles.filterRowWrap}>
                          {subtipoOptions.map((opt) => (
                            <FilterPill
                              key={opt.id ?? 'ALL'}
                              label={opt.label}
                              selected={selectedSubtipoId === opt.id}
                              onPress={() => setSelectedSubtipoId(opt.id)}
                            />
                          ))}
                        </View>
                        <Text style={analysisStyles.filterHelper}>
                          Si no seleccionas subgasto, las métricas se calculan sobre el contenedor completo.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
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
                  Cargando KPIs...
                </Text>
              </View>
            </View>
          )}

          {/* CONTENIDO */}
          {data && (
            <>
              {/* Resumen (mini-cards) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Resumen avanzado"
                  onInfo={() =>
                    info.open(
                      'Resumen avanzado',
                      'KPIs adicionales para entender el “ritmo” y la estabilidad de tu gasto: medias, máximos/mínimos y concentración por categorías.'
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
                          'Media diaria (7 días)',
                          'Promedio del gasto diario en los últimos 7 días. Útil para comparar tu ritmo de gasto semana a semana.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Media diaria (7d)</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.avg)}</Text>
                        <Text style={styles.kpiCardHint}>Promedio</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'Volatilidad (7 días)',
                          'Mide cuánto “oscila” tu gasto día a día. Cuanto más alta, más irregular está siendo tu semana.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="pulse-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Volatilidad (7d)</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.std)}</Text>
                        <Text style={styles.kpiCardHint}>Desv. estándar</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.summaryRow, { marginTop: 10 }]}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'Día más alto (7 días)',
                          'El día con mayor gasto en los últimos 7 días. Sirve para identificar “picos” y revisar qué pasó ese día.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="trending-up-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Día más alto</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.max.value)}</Text>
                        <Text style={styles.kpiCardHint}>{kpi7d.max.label}</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.kpiCard}
                      onPress={() =>
                        info.open(
                          'Días sin gasto (7 días)',
                          'Número de días en los últimos 7 en los que no hubo gasto cotidiano. Puede indicar días “limpios” o falta de registros.'
                        )
                      }
                    >
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Días sin gasto</Text>
                        <Text style={styles.kpiCardValue}>{kpi7d.zeroDays}</Text>
                        <Text style={styles.kpiCardHint}>Últimos 7 días</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.readingCard, { marginTop: 12 }]}>
                    <Text style={styles.readingTitle}>Lectura rápida</Text>

                    <Text style={styles.readingText}>
                      Ritmo semanal actual:{' '}
                      <Text style={styles.readingStrong}>{fmtCurrency(week?.total_semana ?? 0)}</Text>
                      {week?.limite_semana ? (
                        <>
                          {' '}de <Text style={styles.readingStrong}>{fmtCurrency(week.limite_semana)}</Text>
                          {' '}({fmtPct(((safeNum(week.total_semana) / Math.max(1, safeNum(week.limite_semana))) * 100) || 0)})
                        </>
                      ) : (
                        <> (sin límite semanal configurado)</>
                      )}
                      .
                    </Text>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.readingInlineInfo}
                      onPress={() =>
                        info.open(
                          'Lectura rápida',
                          'Compara el gasto semanal acumulado con el límite semanal (si existe). Si el porcentaje es alto pronto en la semana, conviene revisar hábitos o categorías dominantes.'
                        )
                      }
                    >
                      <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                      <Text style={styles.readingInlineInfoText}>Qué significa</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Concentración del gasto (mes) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Concentración del gasto (mes)"
                  onInfo={() =>
                    info.open(
                      'Concentración del gasto (mes)',
                      'Indica cuánto del gasto del mes se concentra en pocas categorías. Si Top 1 o Top 3 son altos, probablemente hay un contenedor dominando el mes.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {categoriasMes.length ? (
                    <>
                      <View style={styles.concentrationRow}>
                        <View style={styles.concentrationCell}>
                          <Text style={styles.concentrationLabel}>Top 1 categoría</Text>
                          <Text style={styles.concentrationValue}>{fmtPct(concentration.top1Pct)}</Text>
                          <Text style={styles.concentrationHint}>
                            {concentration.top1?.label ?? '—'}
                          </Text>
                        </View>

                        <View style={styles.concentrationCell}>
                          <Text style={styles.concentrationLabel}>Top 3 categorías</Text>
                          <Text style={styles.concentrationValue}>{fmtPct(concentration.top3Pct)}</Text>
                          <Text style={styles.concentrationHint}>
                            Peso conjunto (Top 3)
                          </Text>
                        </View>
                      </View>

                      <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                        Consejo: si Top 1 supera ~35–40% de forma recurrente, merece la pena revisar
                        ese contenedor (subgastos, proveedores y ticket medio).
                      </Text>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>
                      Aún no hay gastos en el mes para calcular concentración.
                    </Text>
                  )}
                </View>
              </View>

              {/* Evolución últimos 7 días (LineChart) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Evolución (últimos 7 días)"
                  onInfo={() =>
                    info.open(
                      'Evolución (7 días)',
                      'Serie diaria del gasto cotidiano (últimos 7 días). Toca un punto para ver el importe exacto del día.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <Text style={panelStyles.cardTitle}>
                    {selectedView === 'CATEGORIA' && effectiveSelectedCategory
                      ? `Tendencia · ${effectiveSelectedCategory.label}`
                      : 'Tendencia global'}
                  </Text>
                  <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                    Línea diaria con tooltip (tap) para inspección rápida.
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
                            const lab = labels7[idx] ?? '';
                            const val = Number(dp?.value ?? 0);

                            const tipX = Math.max(8, Math.min(chartWidth - 160, Number(dp?.x ?? 0) - 70));
                            const tipY = Math.max(8, Number(dp?.y ?? 0) - 52);

                            setTrendTip({
                              visible: true,
                              x: tipX,
                              y: tipY,
                              label: lab,
                              value: val,
                            });
                          }}
                        />

                        {trendTip.visible && (
                          <View style={[styles.tooltip, { left: trendTip.x, top: trendTip.y }]}>
                            <Text style={styles.tooltipLabel}>{trendTip.label}</Text>
                            <Text style={styles.tooltipValue}>{fmtCurrency(trendTip.value)}</Text>
                          </View>
                        )}
                      </View>
                    </ScrollView>
                  </View>

                  <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                    Tip: si ves “picos”, usa el modo Por categoría para aislar el contenedor que lo provoca.
                  </Text>
                </View>
              </View>

              {/* ✅ NUEVO: Evolución diaria del mes */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Evolución diaria del mes"
                  onInfo={() =>
                    info.open(
                      'Evolución diaria del mes',
                      'Serie diaria completa del mes (rellenada con 0 cuando no hay gasto). Permite detectar patrones: fines de semana, semanas de carga, etc.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {serieDiariaMes?.length ? (
                    <>
                      <Text style={panelStyles.cardTitle}>
                        {selectedView === 'CATEGORIA' && effectiveSelectedCategory
                          ? `Mes · ${effectiveSelectedCategory.label}`
                          : 'Mes · Global'}
                      </Text>
                      <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                        Gráfica diaria del mes actual. Si el mes es largo, desplaza horizontalmente.
                      </Text>

                      <View style={{ marginTop: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                          />
                        </ScrollView>
                      </View>

                      <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                        Consejo: combina esto con “Ranking de categorías” para explicar subidas.
                      </Text>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>
                      Este backend aún no devuelve serie diaria del mes (serie_diaria_mes) o no hay datos.
                    </Text>
                  )}
                </View>
              </View>

              {/* ✅ NUEVO: Evolución mensual + KPIs */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title={`Evolución mensual (${monthsBack} meses)`}
                  onInfo={() =>
                    info.open(
                      'Evolución mensual',
                      'Serie mensual para ver tendencia y estacionalidad. Incluye KPIs de evolución (MoM, medias móviles, tendencia).'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {serieMensual?.length ? (
                    <>
                      {/* KPIs evolución */}
                      {kpisEvolucion ? (
                        <>
                          <View style={styles.evoRow}>
                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() =>
                                info.open(
                                  'Variación vs mes anterior',
                                  'Diferencia del mes actual respecto al mes anterior (importe absoluto y porcentaje).'
                                )
                              }
                            >
                              <Text style={styles.evoLabel}>MoM</Text>
                              <Text style={styles.evoValue}>
                                {fmtCurrency(kpisEvolucion.variacion_mes_abs)}
                              </Text>
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
                              onPress={() =>
                                info.open(
                                  'Media 3 meses',
                                  'Media de gasto de los últimos 3 meses. Útil para ver el “nivel” reciente.'
                                )
                              }
                            >
                              <Text style={styles.evoLabel}>Media 3M</Text>
                              <Text style={styles.evoValue}>{fmtCurrency(kpisEvolucion.media_3m)}</Text>
                              <Text style={styles.evoHint}>Base 3 meses</Text>
                            </TouchableOpacity>
                          </View>

                          <View style={[styles.evoRow, { marginTop: 10 }]}>
                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() =>
                                info.open(
                                  'Media 6 meses',
                                  'Media de gasto de los últimos 6 meses. Útil para reducir ruido y ver tendencia.'
                                )
                              }
                            >
                              <Text style={styles.evoLabel}>Media 6M</Text>
                              <Text style={styles.evoValue}>{fmtCurrency(kpisEvolucion.media_6m)}</Text>
                              <Text style={styles.evoHint}>Base 6 meses</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={styles.evoCard}
                              onPress={() =>
                                info.open(
                                  'Tendencia',
                                  'Indicador cualitativo calculado por backend combinando medias móviles y variación mensual.'
                                )
                              }
                            >
                              <Text style={styles.evoLabel}>Tendencia</Text>
                              <Text style={styles.evoValue}>{kpisEvolucion.tendencia}</Text>
                              <Text style={styles.evoHint} numberOfLines={2}>
                                {kpisEvolucion.tendencia_detalle}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <Text style={[panelStyles.cardSubtitle, { marginBottom: 10 }]}>
                          KPIs de evolución no disponibles (kpis_evolucion).
                        </Text>
                      )}

                      {/* Bar chart mensual */}
                      <Text style={[panelStyles.cardTitle, { marginTop: 12 }]}>Serie mensual</Text>
                      <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                        Barras por mes (etiquetas = mes). Desliza si es necesario.
                      </Text>

                      <View style={{ marginTop: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <BarChart
                            data={{
                                labels: labelsMonths,
                                datasets: [{ data: valuesMonths }],
                            }}
                            width={Math.max(chartWidth, labelsMonths.length * 36)}
                            height={260}
                            chartConfig={chartConfig}
                            style={{ borderRadius: 14 }}
                            fromZero
                            withInnerLines={false}
                            yAxisLabel=""
                            yAxisSuffix=""
                            showValuesOnTopOfBars={false}
                            />
                        </ScrollView>

                        {/* Etiquetas completas (YYYY-MM) para contexto */}
                        <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                          Rango: {fullMonthLabels[0] ?? '—'} → {fullMonthLabels[fullMonthLabels.length - 1] ?? '—'}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>
                      Este backend aún no devuelve serie mensual (serie_mensual) o no hay datos para la ventana seleccionada.
                    </Text>
                  )}
                </View>
              </View>

              {/* Ranking categorías (mes) */}
              <View style={[panelStyles.section, { marginBottom: 24 }]}>
                <SectionHeader
                  title="Ranking de categorías (mes)"
                  onInfo={() =>
                    info.open(
                      'Ranking de categorías (mes)',
                      'Top categorías del mes por importe. Toca una fila para seleccionar esa categoría (útil para pasar al modo “Por categoría”).'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {topCategorias.length ? (
                    <>
                      <Text style={analysisStyles.cardSubtitle}>
                        Top 6 categorías por gasto del mes. Toca una para enfocarte.
                      </Text>

                      {topCategorias.map((cat) => {
                        const pct = maxTopCat ? (safeNum(cat.importe) / maxTopCat) * 100 : 0;
                        const isSelected = cat.key === effectiveSelectedCategory?.key;

                        return (
                          <TouchableOpacity
                            key={cat.key}
                            activeOpacity={0.85}
                            onPress={() => {
                              setSelectedView('CATEGORIA');
                              setSelectedCategoryKey(cat.key);
                            }}
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
                                {cat.porcentaje?.toFixed ? `${cat.porcentaje.toFixed(1)}%` : '—'}
                              </Text>
                              <View style={styles.rankBarBg}>
                                <View style={[styles.rankBarFill, { width: `${Math.min(100, pct)}%` }]} />
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  ) : (
                    <Text style={analysisStyles.emptyText}>Sin datos de categorías para este mes.</Text>
                  )}
                </View>
              </View>

              {/* Extra (solo en modo categoría): mini-lectura de KPIs de categoría si existen */}
              {selectedView === 'CATEGORIA' && effectiveSelectedCategory && (
                <View style={[panelStyles.section, { marginBottom: 24 }]}>
                  <SectionHeader
                    title={`KPIs del contenedor · ${effectiveSelectedCategory.label}`}
                    onInfo={() =>
                      info.open(
                        'KPIs del contenedor',
                        'Resumen compacto del contenedor seleccionado: tickets, ticket medio, peso sobre el total y variación vs mes anterior.'
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
                            onPress={() =>
                              info.open(
                                'Tickets',
                                'Número de compras (tickets) registradas para el contenedor en el mes (y filtro actual).'
                              )
                            }
                          >
                            <Text style={analysisStyles.kpiLabel}># Tickets</Text>
                            <Text style={analysisStyles.kpiValue}>{selectedCategoryKpis.tickets}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() =>
                              info.open(
                                'Ticket medio',
                                'Importe medio por compra en este contenedor. Útil para diferenciar “muchas compras pequeñas” vs “pocas compras grandes”.'
                              )
                            }
                          >
                            <Text style={analysisStyles.kpiLabel}>Ticket medio</Text>
                            <Text style={analysisStyles.kpiValue}>
                              {fmtCurrency(selectedCategoryKpis.ticket_medio)}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() =>
                              info.open(
                                'Peso sobre total',
                                'Porcentaje del gasto total del mes que representa este contenedor.'
                              )
                            }
                          >
                            <Text style={analysisStyles.kpiLabel}>Peso sobre total</Text>
                            <Text style={analysisStyles.kpiValue}>
                              {safeNum(selectedCategoryKpis.peso_sobre_total_gasto).toFixed(1)}%
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.9}
                            style={styles.kpiCell}
                            onPress={() =>
                              info.open(
                                'Variación vs mes anterior',
                                'Cambio porcentual respecto al mes anterior (mismo contenedor).'
                              )
                            }
                          >
                            <Text style={analysisStyles.kpiLabel}>Var. importe</Text>
                            <Text
                              style={[
                                analysisStyles.kpiValue,
                                safeNum(selectedCategoryKpis.variacion_importe_pct) >= 0
                                  ? styles.varUp
                                  : styles.varDown,
                              ]}
                            >
                              {fmtPct(selectedCategoryKpis.variacion_importe_pct)}
                            </Text>
                          </TouchableOpacity>
                        </View>

                        <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                          Si quieres “KPIs por proveedor” (frecuencia, repetición, top tickets), añadimos endpoint y lo montamos aquí.
                        </Text>
                      </>
                    ) : (
                      <Text style={analysisStyles.emptyText}>
                        No hay KPIs suficientes para este contenedor con el filtro actual.
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* (Opcional) Diagnóstico de features nuevas */}
              {!hasMonthlyCharts && (
                <View style={[panelStyles.section, { marginBottom: 24 }]}>
                  <View style={panelStyles.card}>
                    <Text style={panelStyles.cardTitle}>Nota</Text>
                    <Text style={[panelStyles.cardSubtitle, { marginTop: 6 }]}>
                      No se detectan series mensuales (serie_diaria_mes / serie_mensual). Si el backend ya está actualizado,
                      revisa que el endpoint móvil esté apuntando al mismo entorno (baseURL) y que estés autenticado.
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* ✅ Modal Info (uno global para toda la pantalla) */}
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

  // Mini cards (resumen)
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
    fontWeight: '700',
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
    fontWeight: '800',
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
    fontWeight: '800',
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
    fontWeight: '700',
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
  },

  // Tooltip chart
  tooltip: {
    position: 'absolute',
    width: 150,
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
  tooltipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  tooltipValue: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '800',
  },

  // Ranking categorías
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
    fontWeight: '800',
  },
  rankLabelSelected: {
    color: colors.primary,
  },
  rankSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rankRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  rankValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
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

  // KPIs grid (modo categoría)
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

  // ✅ Evolución (tarjetas)
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
    fontWeight: '800',
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
  },

  varUp: {
    color: colors.danger, // gasto sube => “peligro”
  },
  varDown: {
    color: colors.success,
  },
});
