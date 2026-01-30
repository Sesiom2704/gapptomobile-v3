// mobile_app/screens/dia/DayToDayKpisScreen.tsx
// -----------------------------------------------------------------------------
// KPIs Día a Día (pantalla “profundización”)
//
// CAMBIOS solicitados (TARJETA SUPERIOR):
// - Cambiar “TOTAL GASTADO” por “TOTALES” y mostrar el nombre del mes.
// - Mostrar 2 totales:
//    1) Pagado por mí (pagado = true / split mensual pagado_mes)
//    2) Invitado (pagado = false / split mensual invitado_mes)
// - Mostrar el % de cada bloque sobre el total general del mes (sin filtrar por pagado).
// - Añadir insights:
//    * Si invitado >= 30% del total general -> alerta “te estás convirtiendo en un gorras!”
//    * Si (Supermercados pagado / Supermercados total) < 75% -> insight “NO estás contribuyendo lo suficiente.”
//
// EXTRA solicitado previamente:
// - Añadir “Ranking por proveedores” debajo de “Ranking por contenedores”
//   y, si hay componentes (OCIO), mostrar ranking por componente (Transporte/Hospedaje/Actividades) usando tipo_id.
//
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
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

// --------------------
// Tipos locales
// --------------------

type PagoFiltro = 'TODOS' | 'YO' | 'OTRO';

type SubtipoOption = {
  id: string | null; // null = todos los tipos de la categoría
  label: string;
};

// Contenedores principales (categorías de análisis)
// (Contenedores en MAYÚSCULAS por tu regla)
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
// (Subcategorías SIN mayúsculas: solo contenedores van en mayúscula)
const SUBTIPOS_POR_CATEGORIA: Record<string, SubtipoOption[]> = {
  SUPERMERCADOS: [{ id: null, label: 'Todos' }],
  SUMINISTROS: [{ id: null, label: 'Todos' }],
  VEHICULOS: [
    { id: null, label: 'Todos' },
    { id: 'TIP-GASOLINA-SW1ZQO', label: 'Combustible' },
    { id: 'PEA-TIPOGASTO-7HDY89', label: 'Peajes' },
    { id: 'MAV-TIPOGASTO-BVC356', label: 'Mantenimiento' },
  ],
  ROPA: [{ id: null, label: 'Todos' }],
  RESTAURACION: [{ id: null, label: 'Todos' }],
  OCIO: [
    { id: null, label: 'Todos' },
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

function safeStr(x: any): string {
  return typeof x === 'string' ? x : '';
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

/**
 * Porcentaje sin signo (para KPIs “parte de un total”)
 */
function fmtPctPlain(n: number | undefined | null) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return `${v.toFixed(1)}%`;
}

/**
 * Porcentaje con signo (para variaciones)
 */
function fmtPctSigned(n: number | undefined | null) {
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

function capitalizeFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ✅ Mes con primera letra en mayúscula
function monthLabelEs(d: Date) {
  try {
    // "enero de 2026" -> "Enero de 2026"
    const raw = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d);
    return capitalizeFirst(raw);
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${m}/${y}`;
  }
}

function isFutureMonth(d: Date) {
  const now = startOfMonth(new Date());
  const md = startOfMonth(d);
  return md.getTime() > now.getTime();
}

// --------------------
// Ranking Proveedores helpers
// --------------------

function normalizeProviderName(name: string) {
  return (name || '').trim().toUpperCase();
}

function aggregateProvidersByName(list: any[]) {
  const map: Record<string, any> = {};

  (list || []).forEach((p) => {
    const key = normalizeProviderName(p?.nombre);
    if (!key) return;

    if (!map[key]) {
      map[key] = {
        nombre: key,
        importe: safeNum(p?.importe),
        num_compras: Math.max(0, Math.trunc(safeNum(p?.num_compras))),
        tendencia: p?.tendencia ?? 'FLAT',
        tipo_id: safeStr(p?.tipo_id) || null,
      };
    } else {
      map[key].importe = safeNum(map[key].importe) + safeNum(p?.importe);
      map[key].num_compras =
        Math.max(0, Math.trunc(safeNum(map[key].num_compras))) + Math.max(0, Math.trunc(safeNum(p?.num_compras)));

      const incomingTid = safeStr(p?.tipo_id) || null;
      if (incomingTid && map[key].tipo_id && incomingTid !== map[key].tipo_id) {
        map[key].tipo_id = null; // mezcla de tipos => null
      }
    }
  });

  return Object.values(map).sort((a: any, b: any) => safeNum(b?.importe) - safeNum(a?.importe));
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
// Helpers: leer splits de backend (pagado/total/invitado) de forma tolerante
// --------------------
type Split = { total: number; paid: number; guest: number };

/**
 * ✅ FIX IMPORTANTE:
 * En esta pantalla queremos el split mensual REAL (independiente del filtro pago),
 * por eso priorizamos:
 * - total_mes
 * - pagado_mes
 * - invitado_mes
 * y solo como fallback usamos gastado_mes (que depende de pago=YO/OTRO/TODOS).
 */
function readSplit(obj: any): Split {
  const total =
    safeNum(obj?.total_mes) ||
    safeNum(obj?.total) ||
    safeNum(obj?.importe_total) ||
    safeNum(obj?.gastado_total) ||
    safeNum(obj?.importe) ||
    0;

  const paid =
    safeNum(obj?.pagado_mes) ||
    safeNum(obj?.paid) ||
    safeNum(obj?.pagado) ||
    safeNum(obj?.importe_pagado) ||
    safeNum(obj?.gastado_pagado) ||
    safeNum(obj?.gastado_mes) || // fallback antiguo (dependía de pago)
    safeNum(obj?.importe_pagado_por_mi) ||
    0;

  const guest =
    safeNum(obj?.invitado_mes) ||
    safeNum(obj?.guest) ||
    safeNum(obj?.invitado) ||
    safeNum(obj?.importe_invitado) ||
    safeNum(obj?.gastado_invitado) ||
    safeNum(obj?.importe_no_pagado) ||
    0;

  const computedTotal = total > 0 ? total : paid + guest;

  return { total: computedTotal, paid, guest };
}

function pctOf(part: number, total: number) {
  const t = total > 0 ? total : 1;
  return (part / t) * 100;
}

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
  const [selectedView, setSelectedView] = useState<'GENERAL' | 'CATEGORIA'>(params.view ?? 'GENERAL');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [pagoFiltro, setPagoFiltro] = useState<PagoFiltro>(params.pago ?? 'YO');
  const [monthsBack, setMonthsBack] = useState<number>(params.monthsBack ?? 12);

  // Selector mes
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Contenedor / Subtipo
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(params.categoria ?? null);
  const [selectedSubtipoId, setSelectedSubtipoId] = useState<string | null>(params.tipoId ?? null);

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
  const week = (data as any)?.week;
  const month = (data as any)?.month;

  const categoriasMes = (data as any)?.categorias_mes ?? [];
  const ultimos7Dias: Last7DayItem[] = (data as any)?.ultimos_7_dias ?? [];
  const categoryKpis = (data as any)?.category_kpis ?? {};
  const proveedoresPorCategoria = (data as any)?.proveedores_por_categoria ?? {};
  const insightsArr: any[] = (data as any)?.insights ?? [];

  const serieDiariaMes: DailySeriesItem[] = ((data as any)?.serie_diaria_mes ?? []) as any;
  const serieMensual: MonthlySeriesItem[] = ((data as any)?.serie_mensual ?? []) as any;
  const kpisEvolucion: EvolutionKpis | null = ((data as any)?.kpis_evolucion ?? null) as any;

  const fullCategoryRanking = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; importe: number; porcentaje?: number }>();
    categoriasMes.forEach((c: any) => {
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

  const effectiveSelectedCategory = useMemo(() => {
    if (!selectedCategoryKey) return null;
    const inOptions = CATEGORY_OPTIONS.find((c) => c.key === selectedCategoryKey);
    if (!inOptions) return null;

    const backend = categoriasMes.find((c: any) => c.key === selectedCategoryKey);
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
    return SUBTIPOS_POR_CATEGORIA[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory]);

  // KPIs 7 días (derivado)
  const kpi7d = useMemo(() => {
    const vals = ultimos7Dias.map((d) => safeNum((d as any).importe));
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

    const variance = n > 1 ? vals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / n : 0;
    const std = Math.sqrt(Math.max(0, variance));

    return {
      n,
      sum,
      avg,
      std,
      zeroDays,
      max: { value: maxV, label: (ultimos7Dias as any)[maxIdx]?.label ?? '—' },
      min: { value: minV, label: (ultimos7Dias as any)[minIdx]?.label ?? '—' },
    };
  }, [ultimos7Dias]);

  const concentration = useMemo(() => {
    if (!categoriasMes.length) return { top1Pct: 0, top3Pct: 0, top1: null as any };

    const sorted = [...categoriasMes].sort((a: any, b: any) => safeNum(b.importe) - safeNum(a.importe));
    const total = sorted.reduce((acc, c: any) => acc + safeNum(c.importe), 0) || 1;

    const top1 = sorted[0];
    const top1Pct = (safeNum(top1?.importe) / total) * 100;

    const top3Sum = sorted.slice(0, 3).reduce((acc, c: any) => acc + safeNum(c.importe), 0);
    const top3Pct = (top3Sum / total) * 100;

    return { top1Pct, top3Pct, top1 };
  }, [categoriasMes]);

  const { labels: labels7, values: values7 } = useMemo(() => normalizeLast7(ultimos7Dias), [ultimos7Dias]);

  const { labels: labelsMonthDays, values: valuesMonthDays } = useMemo(() => {
    if (!serieDiariaMes?.length) return { labels: [], values: [] };
    return normalizeDailyMonthSeries(serieDiariaMes);
  }, [serieDiariaMes]);

  const { labels: labelsMonths, values: valuesMonths, fullLabels: fullMonthLabels } = useMemo(() => {
    if (!serieMensual?.length) return { labels: [], values: [], fullLabels: [] as string[] };
    return normalizeMonthlySeries(serieMensual);
  }, [serieMensual]);

  const width = Dimensions.get('window').width;
  const chartWidth = Math.max(360, width - 24);
  const chartHeight = 220;

  const monthlyChartWidth = Math.max(chartWidth, labelsMonths.length * 36);

  const selectedCategoryKpis = useMemo(() => {
    if (!effectiveSelectedCategory) return null;
    return categoryKpis[effectiveSelectedCategory.key] ?? null;
  }, [effectiveSelectedCategory, categoryKpis]);

  const SectionHeader = ({ title, onInfo }: { title: string; onInfo: () => void }) => {
    return (
      <View style={styles.sectionHeaderRow}>
        <Text style={panelStyles.sectionTitle}>{title}</Text>
        <InfoButton align="title" onPress={onInfo} />
      </View>
    );
  };

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

  const onMonthlyChartTap = useCallback(
    (evt: GestureResponderEvent) => {
      if (!labelsMonths.length) return;

      const { locationX, locationY } = evt.nativeEvent;

      const n = labelsMonths.length;
      const x = Math.max(0, Math.min(monthlyChartWidth, locationX));
      const idx = Math.max(0, Math.min(n - 1, Math.floor((x / monthlyChartWidth) * n)));

      const val = valuesMonths[idx] ?? 0;
      const full = fullMonthLabels[idx] ?? labelsMonths[idx] ?? '';

      showTooltip({
        value: Number(val ?? 0),
        x: locationX,
        y: locationY,
        label: full ? `Mes ${String(full)}` : 'Mes',
        width: monthlyChartWidth,
      });
    },
    [labelsMonths.length, monthlyChartWidth, valuesMonths, fullMonthLabels, labelsMonths, showTooltip]
  );

  // --------------------
  // Totales mes (split real) + insights
  // --------------------
  const monthSplit = useMemo(() => readSplit(month), [month]);

  const monthPaid = monthSplit.paid;
  const monthGuest = monthSplit.guest;
  const monthTotal = monthSplit.total;

  const monthPaidPct = useMemo(() => pctOf(monthPaid, monthTotal), [monthPaid, monthTotal]);
  const monthGuestPct = useMemo(() => pctOf(monthGuest, monthTotal), [monthGuest, monthTotal]);

  // Insight 1: invitado >= 30% del total general
  const isGorrasAlert = monthGuestPct >= 30;

  // Insight 2: supermercados pagado/total < 75%
  // ✅ Se lee desde data.insights (si backend lo devuelve). Si no, no se muestra.
  const supermercadoInsight = useMemo(() => {
    return (insightsArr || []).find((i: any) => String(i?.id ?? '') === 'SUPERMARKET_LOW_CONTRIBUTION') ?? null;
  }, [insightsArr]);

  const isSupermarketLowContribution = Boolean(supermercadoInsight);
  const supermarketPaidRatio = safeNum(supermercadoInsight?.meta?.paid_pct ?? 0); // ya viene en %
  // (opcional por si quieres mostrar importes)
  // const supermarketPaid = safeNum(supermercadoInsight?.meta?.paid ?? 0);
  // const supermarketTotal = safeNum(supermercadoInsight?.meta?.total ?? 0);

  // --------------------
  // Ranking por proveedores (debajo del ranking por contenedores)
  // --------------------
  const providersInContext = useMemo(() => {
    let list: any[] = [];

    if (selectedView === 'CATEGORIA' && effectiveSelectedCategory?.key) {
      list = proveedoresPorCategoria[effectiveSelectedCategory.key] ?? [];
    } else {
      Object.keys(proveedoresPorCategoria || {}).forEach((k) => {
        list = list.concat(proveedoresPorCategoria[k] ?? []);
      });
    }

    // defensivo (normalmente ya viene filtrado si envías tipoId)
    if (selectedSubtipoId) {
      list = list.filter((p) => safeStr(p?.tipo_id) === selectedSubtipoId);
    }

    return list;
  }, [proveedoresPorCategoria, selectedView, effectiveSelectedCategory?.key, selectedSubtipoId]);

  const providerGroups = useMemo(() => {
    // Caso simple: GENERAL o subtipo seleccionado
    if (selectedView !== 'CATEGORIA' || selectedSubtipoId || !effectiveSelectedCategory?.key) {
      return [
        {
          key: 'ALL',
          title: 'Top proveedores',
          items: aggregateProvidersByName(providersInContext),
        },
      ];
    }

    const catKey = effectiveSelectedCategory.key;
    const subOpts = SUBTIPOS_POR_CATEGORIA?.[catKey] ?? [];
    const typedOpts = subOpts.filter((o) => !!o.id);

    // Si no hay componentes definidos, lista única
    if (!typedOpts.length) {
      return [
        {
          key: 'ALL',
          title: 'Top proveedores',
          items: aggregateProvidersByName(providersInContext),
        },
      ];
    }

    // Agrupa por tipo_id (componente)
    const byTipo: Record<string, any[]> = {};
    (providersInContext || []).forEach((p) => {
      const tid = safeStr(p?.tipo_id) || '__NO_TYPE__';
      if (!byTipo[tid]) byTipo[tid] = [];
      byTipo[tid].push(p);
    });

    // ✅ SIEMPRE mostramos los grupos del contenedor (aunque estén vacíos)
    const groups = typedOpts.map((o) => ({
      key: o.id as string,
      title: o.label,
      items: aggregateProvidersByName(byTipo[o.id as string] ?? []),
    }));

    if ((byTipo['__NO_TYPE__'] ?? []).length) {
      groups.push({
        key: 'SIN_TIPO',
        title: 'Otros',
        items: aggregateProvidersByName(byTipo['__NO_TYPE__'] ?? []),
      });
    }

    return groups;
  }, [selectedView, selectedSubtipoId, effectiveSelectedCategory?.key, providersInContext]);

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
                label={monthLabelEs(selectedMonth)}
                hint="Se aplica a ranking, concentración y serie diaria del mes."
                onPrev={() => setSelectedMonth((prev) => addMonths(prev, -1))}
                onNext={() => setSelectedMonth((prev) => addMonths(prev, +1))}
                disablePrev={false}
                disableNext={isFutureMonth(addMonths(selectedMonth, 1))}
              />
            </View>
          </View>

          {/* FILTROS */}
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
                <Text style={analysisStyles.filterToggleText}>{filtrosAbiertos ? 'Ocultar filtros' : 'Mostrar filtros'}</Text>
              </View>
            </TouchableOpacity>

            {filtrosAbiertos && (
              <View style={analysisStyles.filterContent}>
                <Text style={analysisStyles.filterLabel}>Modo</Text>
                <FilterRow columns={2}>
                  {(['GENERAL', 'CATEGORIA'] as const).map((vista) => (
                    <FilterPill
                      key={vista}
                      label={vista === 'GENERAL' ? 'General' : 'Por contenedor'}
                      selected={selectedView === vista}
                      onPress={() => setSelectedView(vista)}
                    />
                  ))}
                </FilterRow>

                <Text style={analysisStyles.filterHelper}>
                  En “General” ves KPIs globales. En “Por contenedor” profundizas en un contenedor (y opcionalmente un
                  subgasto) desde el ranking superior.
                </Text>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>Quién paga</Text>
                  <FilterRow columns={3}>
                    <FilterPill label="Todos" selected={pagoFiltro === 'TODOS'} onPress={() => setPagoFiltro('TODOS')} />
                    <FilterPill label="Pagados por mí" selected={pagoFiltro === 'YO'} onPress={() => setPagoFiltro('YO')} />
                    <FilterPill label="Lo paga otro" selected={pagoFiltro === 'OTRO'} onPress={() => setPagoFiltro('OTRO')} />
                  </FilterRow>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>Ventana evolución (meses)</Text>
                  <FilterRow columns={3}>
                    {[6, 12, 18].map((m) => (
                      <FilterPill key={m} label={`${m}m`} selected={monthsBack === m} onPress={() => setMonthsBack(m)} />
                    ))}
                  </FilterRow>
                  <Text style={analysisStyles.filterHelper}>Afecta a la evolución mensual (serie de meses y KPIs de tendencia).</Text>
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
                <Text style={{ marginTop: 8, fontSize: 12, color: colors.textSecondary }}>Cargando KPIs...</Text>
              </View>
            </View>
          )}

          {/* CONTENIDO */}
          {data && (
            <>
              {/* ✅ TOTALES (mes) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title={`TOTALES · ${monthLabelEs(selectedMonth)}`}
                  onInfo={() =>
                    info.open(
                      'Totales del mes',
                      'Desglose del total general del mes (sin filtrar por pagado) entre: pagado por ti (pagado=true) e invitaciones (pagado=false). Los porcentajes son sobre el total general del mes.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.totalHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.totalTitle}>Total general</Text>
                      <Text style={styles.totalHeaderValue}>{fmtCurrency(monthTotal)}</Text>
                    </View>

                    <View style={styles.totalIconCircle}>
                      <Ionicons name="wallet-outline" size={18} color={colors.primary} />
                    </View>
                  </View>

                  <View style={styles.splitBox}>
                    <View style={styles.splitRow}>
                      <View style={styles.splitLeft}>
                        <View style={styles.splitDot} />
                        <Text style={styles.splitLabel}>Pagado por mí</Text>
                      </View>

                      <View style={styles.splitRight}>
                        <Text style={styles.splitValue}>{fmtCurrency(monthPaid)}</Text>
                        <View style={styles.pctPill}>
                          <Text style={styles.pctPillText}>{fmtPctPlain(monthPaidPct)}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.splitDivider} />

                    <View style={styles.splitRow}>
                      <View style={styles.splitLeft}>
                        <View style={[styles.splitDot, { backgroundColor: colors.border }]} />
                        <Text style={styles.splitLabel}>Invitado</Text>
                      </View>

                      <View style={styles.splitRight}>
                        <Text style={styles.splitValue}>{fmtCurrency(monthGuest)}</Text>
                        <View style={[styles.pctPill, isGorrasAlert ? styles.pctPillWarn : null]}>
                          <Text style={[styles.pctPillText, isGorrasAlert ? styles.pctPillTextWarn : null]}>
                            {fmtPctPlain(monthGuestPct)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* INSIGHTS (condicionales) */}
                  {(isGorrasAlert || isSupermarketLowContribution) && (
                    <View style={{ marginTop: 10 }}>
                      <View style={styles.insightHeaderRow}>
                        <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                        <Text style={styles.insightTitle}>Insights</Text>
                      </View>

                      {isGorrasAlert && (
                        <View style={styles.insightAlertCard}>
                          <View style={styles.insightAlertTop}>
                            <Ionicons name="warning-outline" size={16} color={colors.danger} />
                            <Text style={styles.insightAlertTitle}>Alerta</Text>
                          </View>
                          <Text style={styles.insightAlertText}>
                            Las invitaciones suponen <Text style={styles.readingStrong}>{fmtPctPlain(monthGuestPct)}</Text> del gasto total del mes. Te estás convirtiendo en un gorras.
                          </Text>
                        </View>
                      )}

                      {isSupermarketLowContribution && (
                        <View style={styles.insightCard}>
                          <View style={styles.insightTop}>
                            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
                            <Text style={styles.insightCardTitle}>Supermercados</Text>
                          </View>
                          <Text style={styles.insightText}>
                            En <Text style={styles.readingStrong}>SUPERMERCADOS</Text>, solo estás pagando{' '}
                            <Text style={styles.readingStrong}>{fmtPctPlain(supermarketPaidRatio)}</Text> del total del contenedor. No estás contribuyendo lo suficiente.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* Ranking / Selector contenedor */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Ranking por contenedores (mes)"
                  onInfo={() =>
                    info.open(
                      'Ranking por contenedores',
                      'Selector principal de contenedor. Por defecto “Todos”. Se muestra el top 3 y puedes desplegar para ver el resto.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.rankHeaderRow}>
                    <Text style={analysisStyles.cardSubtitle}>
                      {rankingExpanded ? 'Todos los contenedores' : 'Top 3 contenedores'}
                    </Text>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setRankingExpanded((p) => !p)}
                      style={styles.rankExpandBtn}
                    >
                      <Text style={styles.rankExpandText}>{rankingExpanded ? 'Ver menos' : 'Ver todos'}</Text>
                      <Ionicons name={rankingExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
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
                            <Text style={[styles.rankLabel, isSelected && styles.rankLabelSelected]}>{cat.label}</Text>
                            <Text style={styles.rankSub}>{fmtCurrency(cat.importe)}</Text>
                          </View>
                        </View>

                        <View style={styles.rankRight}>
                          <Text style={[styles.rankValue, isSelected && styles.rankValueSelected]}>
                            {safeNum((cat as any).porcentaje) ? `${safeNum((cat as any).porcentaje).toFixed(1)}%` : '—'}
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
                    style={[styles.allRow, selectedView === 'GENERAL' && !selectedCategoryKey ? styles.allRowSelected : null]}
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
                        Todos
                      </Text>
                    </View>
                    <Text style={styles.allHint}>Sin filtro de contenedor</Text>
                  </TouchableOpacity>

                  {/* Subcategorías */}
                  {selectedView === 'CATEGORIA' && effectiveSelectedCategory && (
                    <View style={{ marginTop: 12 }}>
                      <View style={styles.subHeaderRow}>
                        <Text style={styles.subTitle}>Subcategorías · {effectiveSelectedCategory.label}</Text>

                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() =>
                            info.open(
                              'Subcategorías (subgasto)',
                              'Refina el contenedor seleccionado. Si eliges “Todos”, se calcula sobre el contenedor completo.'
                            )
                          }
                          style={styles.subInfoBtn}
                        >
                          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                          <Text style={styles.subInfoText}>Qué es</Text>
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
                                <Text style={[styles.subPillText, selected && styles.subPillTextSelected]}>{opt.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>

                      <Text style={[analysisStyles.cardSubtitle, { marginTop: 10 }]}>
                        Toca una subcategoría para filtrar. “Todos” incluye el contenedor completo.
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* ✅ NUEVO: Ranking por proveedores (debajo de contenedores) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Ranking por proveedores"
                  onInfo={() =>
                    info.open(
                      'Ranking por proveedores',
                      'Top proveedores del mes según filtros (pago, contenedor y/o subtipo). Si el contenedor tiene componentes (p.ej. OCIO), se muestra el ranking por componente: Transporte/Hospedaje/Actividades.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {(providerGroups || []).map((g) => (
                    <View key={g.key} style={{ marginBottom: 10 }}>
                      <Text style={styles.providerGroupTitle}>{g.title}</Text>

                      {!g.items || g.items.length === 0 ? (
                        <Text style={analysisStyles.emptyText}>Sin proveedores para este componente.</Text>
                      ) : (
                        g.items.slice(0, 12).map((p: any, idx: number) => (
                          <TouchableOpacity
                            key={`${g.key}-${p.nombre}-${idx}`}
                            style={styles.providerRow}
                            activeOpacity={0.85}
                            onPress={() =>
                              navigation.navigate('GastosList', {
                                initialFiltro: 'cotidiano',
                                fromDiaADia: true,
                                initialSearchText: p.nombre,
                              } as any)
                            }
                          >
                            <View style={styles.providerLeft}>
                              <View style={styles.providerAvatar}>
                                <Text style={styles.providerAvatarText}>
                                  {(String(p.nombre || '??').slice(0, 2)).toUpperCase()}
                                </Text>
                              </View>

                              <View>
                                <Text style={styles.providerName}>{p.nombre}</Text>
                                <Text style={styles.providerSub}>{safeNum(p.num_compras)} compras</Text>
                              </View>
                            </View>

                            <View style={styles.providerRight}>
                              <Text style={styles.providerAmount}>{fmtCurrency(safeNum(p.importe))}</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  ))}
                </View>
              </View>

              {/* RESUMEN (7 días) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Resumen (últimos 7 días)"
                  onInfo={() =>
                    info.open(
                      'Resumen 7 días',
                      'Suma, media y dispersión (variabilidad) de tus últimos 7 días. Útil para ver si estás en racha de gasto o en modo estable.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.summaryRow}>
                    <View style={styles.kpiCard}>
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Total 7d</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.sum)}</Text>
                        <Text style={styles.kpiCardHint}>Días: {kpi7d.n || '—'}</Text>
                      </View>
                    </View>

                    <View style={styles.kpiCard}>
                      <View style={styles.kpiIconCircle}>
                        <Ionicons name="trending-up-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kpiCardLabel}>Media diaria</Text>
                        <Text style={styles.kpiCardValue}>{fmtCurrency(kpi7d.avg)}</Text>
                        <Text style={styles.kpiCardHint}>Ceros: {kpi7d.zeroDays}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <View style={styles.readingCard}>
                      <Text style={styles.readingTitle}>Lectura rápida</Text>
                      <Text style={styles.readingText}>
                        Máximo:{' '}
                        <Text style={styles.readingStrong}>
                          {fmtCurrency(kpi7d.max.value)} ({String(kpi7d.max.label)})
                        </Text>
                        {'\n'}
                        Mínimo:{' '}
                        <Text style={styles.readingStrong}>
                          {fmtCurrency(kpi7d.min.value)} ({String(kpi7d.min.label)})
                        </Text>
                        {'\n'}
                        Variabilidad (desviación): <Text style={styles.readingStrong}>{fmtCurrency(kpi7d.std)}</Text>
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* CONCENTRACIÓN (mes) */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Concentración (mes)"
                  onInfo={() =>
                    info.open(
                      'Concentración',
                      'Qué porcentaje del gasto del mes está concentrado en el top 1 y top 3 contenedores. Si es alto, tu gasto está “dominado” por pocos contenedores.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.concentrationRow}>
                    <View style={styles.concentrationCell}>
                      <Text style={styles.concentrationLabel}>Top 1</Text>
                      <Text style={styles.concentrationValue}>{fmtPctPlain(concentration.top1Pct)}</Text>
                      <Text style={styles.concentrationHint}>
                        {concentration.top1?.label ? String(concentration.top1.label).toUpperCase() : '—'}
                      </Text>
                    </View>

                    <View style={styles.concentrationCell}>
                      <Text style={styles.concentrationLabel}>Top 3</Text>
                      <Text style={styles.concentrationValue}>{fmtPctPlain(concentration.top3Pct)}</Text>
                      <Text style={styles.concentrationHint}>Contenedores principales</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* CHART: últimos 7 días */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Evolución (últimos 7 días)"
                  onInfo={() =>
                    info.open('Evolución 7 días', 'Línea de importes por día. Útil para detectar picos y comparar tu patrón reciente.')
                  }
                />

                <View style={panelStyles.card}>
                  {labels7.length ? (
                    <LineChart
                      data={{ labels: labels7, datasets: [{ data: values7.length ? values7 : [0] }] }}
                      width={chartWidth}
                      height={chartHeight}
                      chartConfig={chartConfig}
                      bezier
                      style={{ borderRadius: 12 }}
                      onDataPointClick={(d: any) =>
                        showTooltip({
                          value: safeNum(d?.value),
                          x: d?.x,
                          y: d?.y,
                          label: String(labels7?.[d?.index] ?? 'Día'),
                          width: chartWidth,
                        })
                      }
                    />
                  ) : (
                    <Text style={analysisStyles.cardSubtitle}>Sin datos para los últimos 7 días.</Text>
                  )}
                </View>
              </View>

              {/* CHART: serie diaria del mes */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Serie diaria (mes)"
                  onInfo={() =>
                    info.open(
                      'Serie diaria (mes)',
                      'Barras con el importe diario del mes seleccionado. Te ayuda a ver si gastas de forma regular o por “picos”.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {labelsMonthDays.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <BarChartAny
                        data={{ labels: labelsMonthDays, datasets: [{ data: valuesMonthDays.length ? valuesMonthDays : [0] }] }}
                        width={Math.max(chartWidth, labelsMonthDays.length * 18)}
                        height={chartHeight}
                        chartConfig={chartConfig}
                        fromZero
                        style={{ borderRadius: 12 }}
                        showValuesOnTopOfBars={false}
                        withInnerLines={false}
                        yAxisLabel=""
                        yAxisSuffix=""
                        onDataPointClick={(d: any) =>
                          showTooltip({
                            value: safeNum(d?.value),
                            x: d?.x,
                            y: d?.y,
                            label: `Día ${String(labelsMonthDays?.[d?.index] ?? '')}`,
                            width: Math.max(chartWidth, labelsMonthDays.length * 18),
                          })
                        }
                      />
                    </ScrollView>
                  ) : (
                    <Text style={analysisStyles.cardSubtitle}>Sin datos diarios para este mes.</Text>
                  )}
                </View>
              </View>

              {/* CHART: serie mensual */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Serie mensual"
                  onInfo={() => info.open('Serie mensual', 'Barras por mes para la ventana seleccionada. Toca el gráfico para ver el valor de un mes.')}
                />

                <View style={panelStyles.card}>
                  {labelsMonths.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <Pressable onPress={onMonthlyChartTap}>
                        <BarChartAny
                          data={{ labels: labelsMonths, datasets: [{ data: valuesMonths.length ? valuesMonths : [0] }] }}
                          width={monthlyChartWidth}
                          height={chartHeight}
                          chartConfig={chartConfig}
                          fromZero
                          style={{ borderRadius: 12 }}
                          showValuesOnTopOfBars={false}
                          withInnerLines={false}
                          yAxisLabel=""
                          yAxisSuffix=""
                        />
                      </Pressable>
                    </ScrollView>
                  ) : (
                    <Text style={analysisStyles.cardSubtitle}>Sin datos mensuales para la ventana seleccionada.</Text>
                  )}
                </View>
              </View>

              {/* KPIs evolución */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="KPIs de tendencia"
                  onInfo={() =>
                    info.open('KPIs de tendencia', 'Métricas derivadas de la serie mensual (si el backend las devuelve), para interpretar dirección y cambios.')
                  }
                />

                <View style={panelStyles.card}>
                  {kpisEvolucion ? (
                    <View style={styles.evoRow}>
                      <View style={styles.evoCard}>
                        <Text style={styles.evoLabel}>Variación</Text>
                        {(() => {
                          const varPct = safeNum((kpisEvolucion as any)?.variacion_mes_pct ?? (kpisEvolucion as any)?.var_pct);
                          const varAbs = safeNum((kpisEvolucion as any)?.variacion_mes_abs ?? (kpisEvolucion as any)?.var_abs);

                          return (
                            <>
                              <Text style={[styles.evoValue, varPct > 0 ? styles.varUp : styles.varDown]}>
                                {fmtPctSigned(varPct)}
                              </Text>
                              <Text style={styles.evoHint}>{fmtCurrency(varAbs)} vs mes anterior</Text>
                            </>
                          );
                        })()}
                      </View>

                      <View style={styles.evoCard}>
                        <Text style={styles.evoLabel}>Tendencia</Text>
                        <Text style={styles.evoValue}>
                          {String((kpisEvolucion as any)?.tendencia ?? (kpisEvolucion as any)?.trend ?? '—')}
                        </Text>
                        <Text style={styles.evoHint}>
                          {String((kpisEvolucion as any)?.tendencia_detalle ?? 'lectura cualitativa')}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={analysisStyles.cardSubtitle}>Sin KPIs de tendencia disponibles.</Text>
                  )}
                </View>
              </View>
            </>
          )}

          {/* Tooltip flotante */}
          {chartTip.visible && (
            <View style={[styles.tooltip, { left: chartTip.x, top: chartTip.y }]}>
              <View style={styles.tooltipTopRow}>
                <Text style={styles.tooltipLabel} numberOfLines={1}>
                  {chartTip.label}
                </Text>
                <TouchableOpacity onPress={hideTooltip} activeOpacity={0.85}>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.tooltipValue}>{fmtCurrency(chartTip.value)}</Text>
            </View>
          )}
        </ScrollView>

        <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
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

  // ---------
  // TOTALES (nuevo diseño)
  // ---------
  totalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  totalTitle: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  totalHeaderValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  totalIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  splitBox: {
    backgroundColor: colors.neutralSoft,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  splitLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 10,
  },
  splitDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  splitLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  splitRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  splitDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 10,
  },

  pctPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  pctPillText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '800',
  },
  pctPillWarn: {
    backgroundColor: colors.neutralSoft,
    borderColor: colors.danger,
  },
  pctPillTextWarn: {
    color: colors.danger,
  },

  // Insights
  insightHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  insightTitle: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  insightAlertCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    marginBottom: 10,
  },
  insightAlertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  insightAlertTitle: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '800',
  },
  insightAlertText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    fontWeight: '600',
  },

  insightCard: {
    backgroundColor: colors.neutralSoft,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  insightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  insightCardTitle: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  insightText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    fontWeight: '600',
  },

  // ---------
  // Ranking selector
  // ---------
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
    fontWeight: '600',
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
    fontWeight: '700',
  },
  rankLabelSelected: {
    color: colors.primary,
  },
  rankSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  rankRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  rankValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
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
    fontWeight: '700',
  },
  allLabelSelected: {
    color: colors.primary,
  },
  allHint: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },

  // Subcategorías
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subTitle: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
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
    fontWeight: '600',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subPill: {
    width: 118,
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
    fontWeight: '600',
  },
  subPillTextSelected: {
    color: colors.primary,
  },

  // ✅ Proveedores
  providerGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  providerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  providerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  providerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  providerAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  providerName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  providerSub: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  providerRight: {
    alignItems: 'flex-end',
  },
  providerAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
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
    fontWeight: '600',
  },
  kpiCardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  kpiCardHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
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
    fontWeight: '700',
  },
  readingText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  readingStrong: {
    fontWeight: '800',
    color: colors.textPrimary,
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
    fontWeight: '600',
  },
  concentrationValue: {
    marginTop: 4,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  concentrationHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
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
    fontWeight: '600',
    paddingRight: 8,
  },
  tooltipValue: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '700',
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
    fontWeight: '600',
  },
  evoValue: {
    marginTop: 4,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  evoHint: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },

  varUp: {
    color: colors.danger,
  },
  varDown: {
    color: colors.success,
  },
});
