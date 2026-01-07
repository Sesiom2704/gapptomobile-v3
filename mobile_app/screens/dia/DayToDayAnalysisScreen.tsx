// mobile_app/screens/dia/DayToDayAnalysisScreen.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { FilterPill } from '../../components/ui/FilterPill';
import { FilterRow } from '../../components/ui/FilterRow';
import { getDayToDayAnalysis } from '../../services/analyticsApi';
import {
  DayToDayAnalysisResponse,
  ProviderItem,
  Last7DayItem,
  InsightItem,
  InsightSeverity,
} from '../../types/analytics';
import { analysisStyles } from '../../components/analysis/analysisStyles';

// ✅ Info (botón i + modal reutilizable)
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

// --------------------
// Tipos y constantes
// --------------------

type PagoFiltro = 'TODOS' | 'YO' | 'OTRO';

type SubtipoOption = {
  id: string | null; // null = todos los tipos de la categoría
  label: string;
};

const CATEGORY_OPTIONS = [
  { key: 'SUPERMERCADOS', label: 'Supermercados' },
  { key: 'SUMINISTROS', label: 'Suministros' },
  { key: 'VEHICULOS', label: 'Vehículos' },
  { key: 'ROPA', label: 'Ropa' },
  { key: 'RESTAURACION', label: 'Restauración' },
  { key: 'OCIO', label: 'Ocio' },
] as const;

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

// ✅ “TODOS” (categoría virtual para el UI)
const ALL_CATEGORY_KEY = 'ALL';
const ALL_CATEGORY_LABEL = 'TODOS';

// -----------------------------------------------------------------------------
// Mapeo frontend alineado con backend (TIPO_TO_CATEGORY)
// -----------------------------------------------------------------------------
const TIPO_TO_CATEGORY_FRONTEND: Record<string, string> = {
  'COM-TIPOGASTO-311A33BD': 'SUPERMERCADOS',
  'ELE-TIPOGASTO-47CC77E5': 'SUMINISTROS',

  'TIP-GASOLINA-SW1ZQO': 'VEHICULOS',
  'MAV-TIPOGASTO-BVC356': 'VEHICULOS',
  'PEA-TIPOGASTO-7HDY89': 'VEHICULOS',

  'ROP-TIPOGASTO-S227BB': 'ROPA',
  'RES-TIPOGASTO-26ROES': 'RESTAURACION',

  'TRA-TIPOGASTO-RB133Z': 'OCIO',
  'HOS-TIPOGASTO-357FDG': 'OCIO',
  'ACT-TIPOGASTO-2X9H1Q': 'OCIO',
};

const TIPO_LABELS: Record<string, string> = {
  'COM-TIPOGASTO-311A33BD': 'Compras (supermercado)',
  'ELE-TIPOGASTO-47CC77E5': 'Electricidad / suministros',

  'TIP-GASOLINA-SW1ZQO': 'Combustible',
  'PEA-TIPOGASTO-7HDY89': 'Peajes',
  'MAV-TIPOGASTO-BVC356': 'Mantenimiento',

  'ROP-TIPOGASTO-S227BB': 'Ropa',
  'RES-TIPOGASTO-26ROES': 'Restauración',

  'TRA-TIPOGASTO-RB133Z': 'Transporte',
  'HOS-TIPOGASTO-357FDG': 'Hospedaje',
  'ACT-TIPOGASTO-2X9H1Q': 'Actividades',
};

// Subgastos por categoría
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
  RESTAURACION: [{ id: null, label: 'Todos los tipos' }],
  OCIO: [
    { id: null, label: 'Todos los tipos' },
    { id: 'TRA-TIPOGASTO-RB133Z', label: 'Transporte' },
    { id: 'HOS-TIPOGASTO-357FDG', label: 'Hospedaje' },
    { id: 'ACT-TIPOGASTO-2X9H1Q', label: 'Actividades' },
  ],
  [ALL_CATEGORY_KEY]: [{ id: null, label: 'Todos los tipos' }], // NO se muestra por regla
};

// --------------------
// Utilidades
// --------------------

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

function tendenciaColor(t: 'UP' | 'DOWN' | 'FLAT') {
  if (t === 'UP') return colors.danger;
  if (t === 'DOWN') return colors.success;
  return colors.textSecondary;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeProviderName(name: string) {
  return (name || '').trim().toUpperCase();
}

function normalizeCategoryKey(key: string | null) {
  if (!key) return null;
  if (key === 'RESTURACION') return 'RESTAURACION';
  return key;
}

function insightIconName(sev: InsightSeverity) {
  if (sev === 'critical') return 'warning-outline';
  if (sev === 'warning') return 'alert-circle-outline';
  return 'information-circle-outline';
}

// --------------------
// Tipado route params
// --------------------
type DayToDayAnalysisRouteParams = {
  fromHome?: boolean;
};

// --------------------
// Tipos auxiliares UI
// --------------------
type MonthBreakdownItem = {
  tipoId: string;
  label: string;
  categoriaKey: string;
  presupuesto: number;
  gastado: number;
};

// --------------------
// Componente principal
// --------------------

export const DayToDayAnalysisScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const fromHome: boolean =
    (route?.params as DayToDayAnalysisRouteParams | undefined)?.fromHome ?? false;

  // ✅ Info modal
  const info = useInfoModal();

  // Vista GENERAL / CATEGORIA
  const [selectedView, setSelectedView] =
    useState<'GENERAL' | 'CATEGORIA'>('GENERAL');

  // Mostrar/ocultar bloque de filtros
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  // Quién paga
  const [pagoFiltro, setPagoFiltro] = useState<PagoFiltro>('YO');

  // Categoría seleccionada (incluye ALL)
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);

  // Subgasto (tipoId)
  const [selectedSubtipoId, setSelectedSubtipoId] = useState<string | null>(null);

  // Datos backend (principal)
  const [data, setData] = useState<DayToDayAnalysisResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Mes en curso plegable + desglose por tipo
  const [monthExpanded, setMonthExpanded] = useState(false);
  const [monthBreakdownLoading, setMonthBreakdownLoading] = useState(false);
  const [monthBreakdownError, setMonthBreakdownError] = useState<string | null>(null);
  const [monthBreakdownItems, setMonthBreakdownItems] = useState<MonthBreakdownItem[]>([]);
  const monthBreakdownCacheRef = useRef<Record<string, MonthBreakdownItem[]>>({});

  // ✅ Nueva llamada: tendencia últimos 7 días del gasto seleccionado
  const [selectedTrend7d, setSelectedTrend7d] = useState<Last7DayItem[]>([]);
  const [selectedTrendLoading, setSelectedTrendLoading] = useState(false);
  const [selectedTrendError, setSelectedTrendError] = useState<string | null>(null);

  // Si cambia categoría, resetea subgasto
  useEffect(() => {
    setSelectedSubtipoId(null);
  }, [selectedCategoryKey]);

  // Si está seleccionado “TODOS”, subgasto a null (regla 1)
  useEffect(() => {
    const normalizedCat = normalizeCategoryKey(selectedCategoryKey);
    if (normalizedCat === ALL_CATEGORY_KEY && selectedSubtipoId) {
      setSelectedSubtipoId(null);
    }
  }, [selectedCategoryKey, selectedSubtipoId]);

  // Para dividir contenedores en filas de 3
  const categoryRows = useMemo<CategoryOption[][]>(() => {
    const rows: CategoryOption[][] = [];
    for (let i = 0; i < CATEGORY_OPTIONS.length; i += 3) {
      rows.push(CATEGORY_OPTIONS.slice(i, i + 3));
    }
    return rows;
  }, []);

  // --------------------
  // Carga de datos principal
  // --------------------

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = { pago: pagoFiltro };

      const normalizedCat = normalizeCategoryKey(selectedCategoryKey);
      const isAll = normalizedCat === ALL_CATEGORY_KEY;

      if (selectedView === 'CATEGORIA') {
        if (selectedSubtipoId) {
          params.tipoId = selectedSubtipoId;
        } else if (normalizedCat && !isAll) {
          params.categoria = normalizedCat;
        }
      }

      const resp = await getDayToDayAnalysis(params);
      setData(resp);

      // Default de categoría:
      // - En vista CATEGORIA: “TODOS”
      // - En GENERAL: primera del mes si existe
      if (!selectedCategoryKey) {
        if (selectedView === 'CATEGORIA') {
          setSelectedCategoryKey(ALL_CATEGORY_KEY);
        } else if (resp.categorias_mes.length > 0) {
          setSelectedCategoryKey(resp.categorias_mes[0].key);
        }
      }
    } catch (err) {
      console.log('[DayToDayAnalysisScreen] Error cargando análisis día a día', err);
      setError('No se ha podido cargar el análisis día a día.');
    } finally {
      setLoading(false);
    }
  }, [pagoFiltro, selectedView, selectedCategoryKey, selectedSubtipoId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Al cambiar contexto, cerramos mes expandido
  useEffect(() => {
    setMonthExpanded(false);
    setMonthBreakdownError(null);
    setMonthBreakdownItems([]);
    setMonthBreakdownLoading(false);
  }, [pagoFiltro, selectedView, selectedCategoryKey, selectedSubtipoId]);

  // --------------------
  // Derivados backend
  // --------------------

  const today = data?.today;
  const week = data?.week;
  const month = data?.month;

  const categoriasMes = data?.categorias_mes ?? [];
  const categoryKpis = data?.category_kpis ?? {};
  const proveedoresPorCategoria = data?.proveedores_por_categoria ?? {};
  const ultimos7DiasGeneral: Last7DayItem[] = data?.ultimos_7_dias ?? [];

  const insights: InsightItem[] = data?.insights ?? [];
  const alertasStrings: string[] = data?.alertas ?? [];

  // Categorías con “TODOS” al principio
  const categoriasMesConTodos = useMemo(() => {
    const totalImporte = month?.gastado_mes ?? 0;
    const todos = {
      key: ALL_CATEGORY_KEY,
      label: ALL_CATEGORY_LABEL,
      importe: totalImporte,
      porcentaje: 100,
    };
    return [todos, ...categoriasMes];
  }, [categoriasMes, month?.gastado_mes]);

  // Categoría seleccionada efectiva
  const effectiveSelectedCategory = useMemo(() => {
    if (!data) return null;

    const normalizedCat = normalizeCategoryKey(selectedCategoryKey);

    if (normalizedCat === ALL_CATEGORY_KEY) {
      return { key: ALL_CATEGORY_KEY, label: ALL_CATEGORY_LABEL, importe: month?.gastado_mes ?? 0 };
    }

    if (categoriasMes.length) {
      const fromState = normalizedCat && categoriasMes.find((c) => c.key === normalizedCat);
      return fromState || categoriasMes[0];
    }

    return null;
  }, [data, categoriasMes, selectedCategoryKey, month?.gastado_mes]);

  const isAllSelected = effectiveSelectedCategory?.key === ALL_CATEGORY_KEY;

  // KPIs categoría seleccionada
  const selectedCategoryKpis = useMemo(() => {
    if (!effectiveSelectedCategory) return null;

    if (effectiveSelectedCategory.key === ALL_CATEGORY_KEY) {
      const ticketsTotal = Object.values(categoryKpis).reduce(
        (acc, k) => acc + (k?.tickets ?? 0),
        0
      );
      const importeMes = month?.gastado_mes ?? 0;
      const ticketMedio = ticketsTotal > 0 ? importeMes / ticketsTotal : 0;
      const varImportePct = data?.kpis_evolucion?.variacion_mes_pct ?? 0;

      return {
        tickets: ticketsTotal,
        ticket_medio: ticketMedio,
        variacion_importe_pct: varImportePct,
        variacion_tickets_pct: 0,
        peso_sobre_total_gasto: 100,
      };
    }

    return categoryKpis[effectiveSelectedCategory.key] ?? null;
  }, [effectiveSelectedCategory, categoryKpis, month?.gastado_mes, data?.kpis_evolucion?.variacion_mes_pct]);

  // Proveedores (TODOS => agregación)
  const selectedProveedores: ProviderItem[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];

    if (effectiveSelectedCategory.key === ALL_CATEGORY_KEY) {
      const map: Record<string, ProviderItem> = {};

      Object.keys(proveedoresPorCategoria || {}).forEach((catKey) => {
        const lista: ProviderItem[] = proveedoresPorCategoria[catKey] ?? [];
        lista.forEach((p) => {
          const key = normalizeProviderName(p.nombre);
          if (!key) return;

          if (!map[key]) {
            map[key] = {
              nombre: key,
              importe: Number(p.importe ?? 0),
              num_compras: Number(p.num_compras ?? 0),
              tendencia: p.tendencia ?? 'FLAT',
            };
          } else {
            map[key].importe = Number(map[key].importe ?? 0) + Number(p.importe ?? 0);
            map[key].num_compras =
              Number(map[key].num_compras ?? 0) + Number(p.num_compras ?? 0);
          }
        });
      });

      return Object.values(map)
        .sort((a, b) => Number(b.importe ?? 0) - Number(a.importe ?? 0))
        .slice(0, 12);
    }

    return proveedoresPorCategoria[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory, proveedoresPorCategoria]);

  // Subtipos (NO se muestran si TODOS)
  const subtipoOptions: SubtipoOption[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];
    return SUBTIPOS_POR_CATEGORIA[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory]);

  // Diff vs ayer (HOY)
  const diffRaw = today?.diff_vs_ayer ?? '';
  let diffMain = diffRaw || '—';
  let diffSuffix = '';
  let diffIsPositive: boolean | null = null;

  if (diffRaw) {
    const trimmed = diffRaw.trim();
    diffIsPositive = trimmed.startsWith('+');
    if (diffRaw.includes('€')) {
      const [left, right] = diffRaw.split('€');
      diffMain = `${left.trim()} €`;
      diffSuffix = right.trim();
    } else {
      diffMain = diffRaw;
    }
  }

  // --------------------
  // Header de sección con InfoButton
  // --------------------
  const SectionHeader = ({
    title,
    onInfo,
  }: {
    title: string;
    onInfo: () => void;
  }) => (
    <View style={styles.sectionHeaderRow}>
      <Text style={panelStyles.sectionTitle}>{title}</Text>
      <InfoButton align="title" onPress={onInfo} />
    </View>
  );

  // --------------------
  // Mes en curso: desglose por tipo
  // --------------------

  const buildMonthBreakdownContextKey = useCallback(() => {
    const normalizedCat = normalizeCategoryKey(selectedCategoryKey);
    const catKey = selectedView === 'CATEGORIA' ? normalizedCat ?? 'NULL' : 'GENERAL';
    return `${pagoFiltro}::${selectedView}::${catKey}`;
  }, [pagoFiltro, selectedView, selectedCategoryKey]);

  const getTipoIdsForContext = useCallback((): string[] => {
    if (selectedView === 'GENERAL') return Object.keys(TIPO_TO_CATEGORY_FRONTEND);

    const normalizedCat = normalizeCategoryKey(selectedCategoryKey);
    if (!normalizedCat || normalizedCat === ALL_CATEGORY_KEY) {
      return Object.keys(TIPO_TO_CATEGORY_FRONTEND);
    }

    return Object.keys(TIPO_TO_CATEGORY_FRONTEND).filter(
      (tid) => TIPO_TO_CATEGORY_FRONTEND[tid] === normalizedCat
    );
  }, [selectedView, selectedCategoryKey]);

  const fetchMonthBreakdown = useCallback(async () => {
    try {
      setMonthBreakdownLoading(true);
      setMonthBreakdownError(null);

      const contextKey = buildMonthBreakdownContextKey();
      const cached = monthBreakdownCacheRef.current[contextKey];
      if (cached && cached.length) {
        setMonthBreakdownItems(cached);
        return;
      }

      const tipoIds = getTipoIdsForContext();
      if (!tipoIds.length) {
        setMonthBreakdownItems([]);
        return;
      }

      const results = await Promise.all(
        tipoIds.map(async (tipoId) => {
          const resp = await getDayToDayAnalysis({ pago: pagoFiltro, tipoId });
          const presupuesto = Number(resp?.month?.presupuesto_mes ?? 0);
          const gastado = Number(resp?.month?.gastado_mes ?? 0);

          const categoriaKey = TIPO_TO_CATEGORY_FRONTEND[tipoId] ?? 'OTROS';
          const label = TIPO_LABELS[tipoId] ?? tipoId;

          return { tipoId, label, categoriaKey, presupuesto, gastado } as MonthBreakdownItem;
        })
      );

      const categoryOrder = [
        'SUPERMERCADOS',
        'SUMINISTROS',
        'VEHICULOS',
        'ROPA',
        'RESTAURACION',
        'OCIO',
        'OTROS',
      ];

      const filtered = results
        .filter((x) => (x.presupuesto ?? 0) > 0 || (x.gastado ?? 0) > 0)
        .sort((a, b) => {
          const ia = categoryOrder.indexOf(a.categoriaKey);
          const ib = categoryOrder.indexOf(b.categoriaKey);
          if (ia !== ib) return ia - ib;
          return Number(b.gastado ?? 0) - Number(a.gastado ?? 0);
        });

      monthBreakdownCacheRef.current[contextKey] = filtered;
      setMonthBreakdownItems(filtered);
    } catch (e) {
      console.log('[DayToDayAnalysisScreen] Error month breakdown', e);
      setMonthBreakdownError('No se pudo cargar el desglose del mes.');
      setMonthBreakdownItems([]);
    } finally {
      setMonthBreakdownLoading(false);
    }
  }, [buildMonthBreakdownContextKey, getTipoIdsForContext, pagoFiltro]);

  const onToggleMonthExpanded = useCallback(async () => {
    setMonthExpanded((prev) => !prev);

    const willOpen = !monthExpanded;
    if (willOpen) await fetchMonthBreakdown();
  }, [fetchMonthBreakdown, monthExpanded]);

  // --------------------
  // ✅ NUEVA llamada: tendencia 7 días del gasto seleccionado
  // --------------------
  const fetchSelectedTrend7d = useCallback(async () => {
    try {
      setSelectedTrendLoading(true);
      setSelectedTrendError(null);

      const normalizedCat = normalizeCategoryKey(selectedCategoryKey);
      const isAll = normalizedCat === ALL_CATEGORY_KEY;

      const params: any = { pago: pagoFiltro };

      // Priorizamos subtipo si existe
      if (selectedSubtipoId) {
        params.tipoId = selectedSubtipoId;
      } else if (normalizedCat && !isAll) {
        params.categoria = normalizedCat;
      } // ALL => sin categoria/tipoId

      const resp = await getDayToDayAnalysis(params);
      setSelectedTrend7d(resp?.ultimos_7_dias ?? []);
    } catch (e) {
      console.log('[DayToDayAnalysisScreen] Error selected trend 7d', e);
      setSelectedTrendError('No se pudo cargar la tendencia del gasto seleccionado.');
      setSelectedTrend7d([]);
    } finally {
      setSelectedTrendLoading(false);
    }
  }, [pagoFiltro, selectedCategoryKey, selectedSubtipoId]);

  /**
   * ✅ CLAVE del bug que reportas:
   * Antes solo se cargaba en vista CATEGORIA.
   * Ahora se carga siempre que haya categoría efectiva (GENERAL o CATEGORIA),
   * y por tanto la sección SIEMPRE tiene datos.
   */
  useEffect(() => {
    if (!data) return;
    if (!effectiveSelectedCategory) return;
    // Evita llamar antes de que selectedCategoryKey esté inicializado
    if (!selectedCategoryKey) return;

    fetchSelectedTrend7d();
  }, [data, effectiveSelectedCategory, selectedCategoryKey, selectedSubtipoId, pagoFiltro, fetchSelectedTrend7d]);

  // Helpers gráfico
  const maxImporte7dGeneral = useMemo(() => {
    if (!ultimos7DiasGeneral.length) return 1;
    return Math.max(1, ...ultimos7DiasGeneral.map((d) => d.importe));
  }, [ultimos7DiasGeneral]);

  const maxImporte7dSelected = useMemo(() => {
    if (!selectedTrend7d.length) return 1;
    return Math.max(1, ...selectedTrend7d.map((d) => d.importe));
  }, [selectedTrend7d]);

  // --------------------
  // Render
  // --------------------

  return (
    <>
      <Header
        title="Análisis día a día"
        subtitle="Desglose de tus gastos cotidianos por categoría y proveedor."
        showBack
        rightIconName="eye-outline"
        onRightPress={() =>
          navigation.navigate('DayToDayKpisScreen', {
            fromHome,
            pago: pagoFiltro,
            view: selectedView,
            categoria: selectedCategoryKey,
            tipoId: selectedSubtipoId,
            returnToTab: fromHome ? 'HomeTab' : 'DayToDayTab',
            returnToScreen: fromHome ? 'HomeScreen' : 'DayToDayHomeScreen',
          })
        }
        onBackPress={() => {
          if (fromHome) navigation.navigate('HomeTab');
          else navigation.goBack();
        }}
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
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
                <Text style={analysisStyles.filterToggleText}>
                  {filtrosAbiertos ? 'Ocultar filtros' : 'Mostrar filtros'}
                </Text>
              </View>
            </TouchableOpacity>

            {filtrosAbiertos && (
              <View style={analysisStyles.filterContent}>
                <Text style={analysisStyles.filterLabel}>Vista</Text>
                <FilterRow columns={2}>
                  {(['GENERAL', 'CATEGORIA'] as const).map((vista) => (
                    <FilterPill
                      key={vista}
                      label={vista === 'GENERAL' ? 'Vista general' : 'Análisis por categoría'}
                      selected={selectedView === vista}
                      onPress={() => setSelectedView(vista)}
                    />
                  ))}
                </FilterRow>

                <Text style={analysisStyles.filterHelper}>
                  En vista general ves el resumen de hoy, semana, mes y tendencias.
                  En vista por categoría puedes centrarte en un contenedor y subgasto.
                </Text>

                <View style={{ marginTop: 12 }}>
                  <Text style={analysisStyles.filterLabel}>Quién paga</Text>
                  <FilterRow columns={3}>
                    <FilterPill label="Todos" selected={pagoFiltro === 'TODOS'} onPress={() => setPagoFiltro('TODOS')} />
                    <FilterPill label="Pagados por mi" selected={pagoFiltro === 'YO'} onPress={() => setPagoFiltro('YO')} />
                    <FilterPill label="Lo paga otro" selected={pagoFiltro === 'OTRO'} onPress={() => setPagoFiltro('OTRO')} />
                  </FilterRow>
                </View>

                {selectedView === 'CATEGORIA' && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={analysisStyles.filterLabel}>Contenedores</Text>

                    <FilterRow columns={3}>
                      <FilterPill
                        label={ALL_CATEGORY_LABEL}
                        selected={normalizeCategoryKey(selectedCategoryKey) === ALL_CATEGORY_KEY}
                        onPress={() => setSelectedCategoryKey(ALL_CATEGORY_KEY)}
                      />
                    </FilterRow>

                    {categoryRows.map((row, idx) => (
                      <FilterRow key={idx} columns={3}>
                        {row.map((cat) => (
                          <FilterPill
                            key={cat.key}
                            label={cat.label}
                            selected={normalizeCategoryKey(selectedCategoryKey) === cat.key}
                            onPress={() => setSelectedCategoryKey(cat.key)}
                          />
                        ))}
                      </FilterRow>
                    ))}
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
                  Cargando análisis...
                </Text>
              </View>
            </View>
          )}

          {/* VISTA GENERAL */}
          {selectedView === 'GENERAL' && data && (
            <>
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Hoy"
                  onInfo={() =>
                    info.open(
                      'Hoy',
                      'Resumen del gasto de hoy (cotidianos) según el filtro. Incluye movimientos, ticket medio y comparativa vs ayer.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.todayTextBlock}>
                      <Text style={analysisStyles.cardTitle}>{today?.fecha_label ?? 'Hoy'}</Text>
                      <Text style={analysisStyles.cardSubtitle}>
                        {today?.tendencia ?? 'Resumen de tus gastos cotidianos de hoy.'}
                      </Text>
                    </View>

                    <View style={styles.todayAmountContainer}>
                      <Text style={styles.todayAmountLabel}>Gastado hoy</Text>
                      <Text style={styles.todayAmountValue}>{fmtCurrency(today?.total_hoy)}</Text>
                    </View>
                  </View>

                  <View style={analysisStyles.kpiRow}>
                    <View style={analysisStyles.kpiItem}>
                      <Text style={analysisStyles.kpiLabel}>Movimientos</Text>
                      <Text style={analysisStyles.kpiValue}>{today?.num_movimientos ?? 0}</Text>
                    </View>
                    <View style={analysisStyles.kpiItem}>
                      <Text style={analysisStyles.kpiLabel}>Ticket medio</Text>
                      <Text style={analysisStyles.kpiValue}>{fmtCurrency(today?.ticket_medio)}</Text>
                    </View>
                    <View style={analysisStyles.kpiItem}>
                      <Text style={analysisStyles.kpiLabel}>Comparativa</Text>
                      <Text
                        style={[
                          analysisStyles.kpiValue,
                          diffIsPositive === null
                            ? undefined
                            : diffIsPositive
                            ? styles.varValueUp
                            : styles.varValueDown,
                        ]}
                      >
                        {diffMain}
                      </Text>
                      {diffSuffix ? <Text style={styles.kpiLabel}>{diffSuffix}</Text> : null}
                    </View>
                  </View>
                </View>
              </View>

              <View style={panelStyles.section}>
                <SectionHeader
                  title="Semana actual"
                  onInfo={() =>
                    info.open(
                      'Semana actual',
                      'Gasto acumulado de la semana, límite semanal estimado y proyección al final de semana.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.weekRowTop}>
                    <View style={styles.weekColLeft}>
                      <Text style={analysisStyles.cardTitle}>Gasto de la semana</Text>
                      <Text style={styles.weekMainAmount}>{fmtCurrency(week?.total_semana)}</Text>
                      <Text style={analysisStyles.cardSubtitle}>
                        Límite semanal: {fmtCurrency(week?.limite_semana ?? 0)}
                      </Text>
                    </View>
                    <View style={styles.weekColRight}>
                      <Text style={styles.weekLabel}>Proyección fin de semana</Text>
                      <Text style={styles.weekProjection}>{fmtCurrency(week?.proyeccion_fin_semana)}</Text>
                      <Text style={styles.weekDaysLabel}>{(week?.dias_restantes ?? 0)} días restantes</Text>
                    </View>
                  </View>

                  <View style={analysisStyles.progressRow}>
                    <Text style={analysisStyles.progressCaption}>Progreso sobre el límite semanal</Text>
                    <View style={analysisStyles.progressBarBackground}>
                      <View
                        style={[
                          analysisStyles.progressBarFill,
                          {
                            width: `${Math.min(
                              100,
                              week && week.limite_semana > 0
                                ? (week.total_semana / week.limite_semana) * 100
                                : 0
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              </View>

              {/* Tendencia GENERAL debajo de Semana */}
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Tendencia últimos 7 días"
                  onInfo={() =>
                    info.open(
                      'Tendencia últimos 7 días',
                      'Evolución del gasto diario (cotidianos) en los últimos 7 días para el filtro actual.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <Text style={analysisStyles.cardSubtitle}>
                    Gasto diario en gastos cotidianos (últimos 7 días).
                  </Text>

                  <View style={styles.barChartContainer}>
                    {ultimos7DiasGeneral.map((d, idx) => {
                      const heightPct =
                        maxImporte7dGeneral > 0 ? (d.importe / maxImporte7dGeneral) * 100 : 0;
                      return (
                        <View key={`${d.fecha ?? d.label}-${idx}`} style={styles.barItem}>
                          <View style={styles.barWrapper}>
                            <View style={[styles.bar, { height: `${heightPct}%` }]} />
                          </View>
                          <Text style={styles.barLabel}>{d.label}</Text>
                          <Text style={styles.barValue}>
                            {d.importe > 0 ? d.importe.toFixed(1) + '€' : '—'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          )}

          {/* MES EN CURSO (plegable) */}
          {data && (
            <View style={panelStyles.section}>
              <SectionHeader
                title={
                  selectedView === 'GENERAL'
                    ? 'Mes en curso'
                    : effectiveSelectedCategory
                    ? `Mes en curso · ${effectiveSelectedCategory.label}`
                    : 'Mes en curso'
                }
                onInfo={() =>
                  info.open(
                    'Mes en curso',
                    'Presupuesto mensual estimado y gasto acumulado. Toca la tarjeta para desplegar el desglose por tipo de gasto.'
                  )
                }
              />

              <TouchableOpacity style={panelStyles.card} activeOpacity={0.9} onPress={async () => {
                setMonthExpanded((prev) => !prev);
                const willOpen = !monthExpanded;
                if (willOpen) await fetchMonthBreakdown();
              }}>
                <View style={styles.monthHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.monthRow}>
                      <View style={styles.monthCol}>
                        <Text style={analysisStyles.cardTitle}>Presupuesto mensual</Text>
                        <Text style={styles.monthAmount}>{fmtCurrency(month?.presupuesto_mes)}</Text>
                      </View>
                      <View style={styles.monthCol}>
                        <Text style={analysisStyles.cardTitle}>Gastado hasta hoy</Text>
                        <Text style={styles.monthAmountHighlight}>{fmtCurrency(month?.gastado_mes)}</Text>
                      </View>
                    </View>

                    <View style={analysisStyles.progressRow}>
                      <Text style={analysisStyles.progressCaption}>
                        {month && month.presupuesto_mes > 0
                          ? `${((month.gastado_mes / month.presupuesto_mes) * 100).toFixed(1)}% del presupuesto mensual usado`
                          : 'Aún no hay presupuesto estimado suficiente para este mes'}
                      </Text>
                      <View style={analysisStyles.progressBarBackground}>
                        <View
                          style={[
                            analysisStyles.progressBarFillSoft,
                            {
                              width:
                                month && month.presupuesto_mes > 0
                                  ? `${Math.min(100, (month.gastado_mes / month.presupuesto_mes) * 100)}%`
                                  : '0%',
                            },
                          ]}
                        />
                      </View>
                    </View>
                  </View>

                  <Ionicons
                    name={monthExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textSecondary}
                    style={{ marginLeft: 10, marginTop: 4 }}
                  />
                </View>

                {monthExpanded && (
                  <View style={styles.monthExpandedBlock}>
                    <View style={styles.monthExpandedTopRow}>
                      <Text style={styles.monthExpandedTitle}>Desglose por tipo de gasto</Text>
                      <Text style={styles.monthExpandedHint}>Presupuesto vs gastado</Text>
                    </View>

                    {monthBreakdownLoading && (
                      <View style={styles.inlineLoaderRow}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.inlineLoaderText}>Cargando desglose...</Text>
                      </View>
                    )}

                    {monthBreakdownError && !monthBreakdownLoading && (
                      <Text style={styles.inlineErrorText}>{monthBreakdownError}</Text>
                    )}

                    {!monthBreakdownLoading && !monthBreakdownError && monthBreakdownItems.length === 0 && (
                      <Text style={analysisStyles.emptyText}>
                        No hay datos suficientes para desglosar el presupuesto por tipo en este contexto.
                      </Text>
                    )}

                    {!monthBreakdownLoading && !monthBreakdownError && monthBreakdownItems.length > 0 && (
                      <>
                        {monthBreakdownItems.map((it) => {
                          const pct = it.presupuesto > 0 ? (it.gastado / it.presupuesto) * 100 : 0;
                          const pctSafe = clamp(pct, 0, 100);
                          const overBudget = it.presupuesto > 0 && it.gastado > it.presupuesto;

                          return (
                            <View key={it.tipoId} style={styles.monthBreakdownRow}>
                              <View style={styles.monthBreakdownLeft}>
                                <Text style={styles.monthBreakdownLabel}>{it.label}</Text>
                                <Text style={styles.monthBreakdownSub}>
                                  {fmtCurrency(it.gastado)} / {fmtCurrency(it.presupuesto)}
                                  {overBudget ? ' · excedido' : ''}
                                </Text>
                              </View>

                              <View style={styles.monthBreakdownRight}>
                                <Text style={styles.monthBreakdownPct}>
                                  {it.presupuesto > 0 ? `${pct.toFixed(0)}%` : '—'}
                                </Text>
                                <View style={styles.monthBreakdownBarBg}>
                                  <View style={[styles.monthBreakdownBarFill, { width: `${pctSafe}%` }]} />
                                </View>
                              </View>
                            </View>
                          );
                        })}
                        <Text style={styles.monthBreakdownFootnote}>
                          Nota: el presupuesto es estimado por el sistema a partir del histórico.
                        </Text>
                      </>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* DISTRIBUCIÓN POR CATEGORÍA */}
          {data && (
            <View style={panelStyles.section}>
              <SectionHeader
                title="Distribución por categoría (mes)"
                onInfo={() =>
                  info.open(
                    'Distribución por categoría',
                    'Listado de categorías del mes con importe y porcentaje. Incluye “TODOS” al inicio.'
                  )
                }
              />

              <View style={panelStyles.card}>
                <Text style={analysisStyles.cardSubtitle}>
                  Toca una categoría para ver sus KPIs y proveedores asociados.
                </Text>

                {categoriasMesConTodos.map((cat: any) => {
                  const isSelected =
                    effectiveSelectedCategory && cat.key === effectiveSelectedCategory.key;
                  const isAllRow = cat.key === ALL_CATEGORY_KEY;

                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={[styles.categoryRow, isSelected && styles.categoryRowSelected]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedCategoryKey(cat.key)}
                    >
                      <View style={styles.categoryLeft}>
                        <View style={[styles.categoryDot, isSelected && styles.categoryDotSelected]} />
                        <View>
                          <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                            {isAllRow ? ALL_CATEGORY_LABEL : cat.label}
                          </Text>
                          <Text style={styles.categorySub}>{fmtCurrency(cat.importe)}</Text>
                        </View>
                      </View>

                      <View style={styles.categoryRight}>
                        {!isAllRow ? (
                          <>
                            <Text style={[styles.categoryPercent, isSelected && styles.categoryPercentSelected]}>
                              {cat.porcentaje.toFixed(1)}%
                            </Text>
                            <View style={styles.categoryBarBackground}>
                              <View style={[styles.categoryBarFill, { width: `${cat.porcentaje}%` }]} />
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={[styles.categoryPercent, isSelected && styles.categoryPercentSelected]}>
                              {' '}
                            </Text>
                            <View style={styles.categoryBarBackground}>
                              <View style={[styles.categoryBarFill, { width: '100%' }]} />
                            </View>
                          </>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* DETALLE CATEGORÍA */}
          {data && effectiveSelectedCategory && (
            <View style={panelStyles.section}>
              <SectionHeader
                title={`Detalle categoría: ${effectiveSelectedCategory.label}`}
                onInfo={() =>
                  info.open(
                    'Detalle de categoría',
                    'KPIs del contenedor seleccionado y variaciones. Puedes aplicar subgasto.'
                  )
                }
              />

              <View style={panelStyles.card}>
                {/* Regla 1: si TODOS => no subgastos */}
                {!isAllSelected && subtipoOptions.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
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
                      Si no seleccionas subgasto, el análisis se aplica al contenedor completo.
                    </Text>
                  </View>
                )}

                {selectedCategoryKpis ? (
                  <>
                    <View style={styles.kpiGrid}>
                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}>Importe mes</Text>
                        <Text style={analysisStyles.kpiValue}>
                          {isAllSelected
                            ? fmtCurrency(month?.gastado_mes)
                            : fmtCurrency((effectiveSelectedCategory as any).importe)}
                        </Text>
                      </View>

                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}># Tickets</Text>
                        <Text style={analysisStyles.kpiValue}>{selectedCategoryKpis.tickets ?? 0}</Text>
                      </View>

                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}>Ticket medio</Text>
                        <Text style={analysisStyles.kpiValue}>{fmtCurrency(selectedCategoryKpis.ticket_medio)}</Text>
                      </View>

                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}>Peso sobre total</Text>
                        <Text style={analysisStyles.kpiValue}>
                          {isAllSelected ? '100.0%' : `${selectedCategoryKpis.peso_sobre_total_gasto.toFixed(1)}%`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.varRow}>
                      <View style={styles.varItem}>
                        <Text style={styles.varLabel}>Importe vs mes anterior</Text>
                        <Text
                          style={[
                            styles.varValue,
                            selectedCategoryKpis.variacion_importe_pct >= 0
                              ? styles.varValueUp
                              : styles.varValueDown,
                          ]}
                        >
                          {fmtPct(selectedCategoryKpis.variacion_importe_pct)}
                        </Text>
                      </View>
                      <View style={styles.varItem}>
                        <Text style={styles.varLabel}>Tickets vs mes anterior</Text>
                        <Text
                          style={[
                            styles.varValue,
                            selectedCategoryKpis.variacion_tickets_pct >= 0
                              ? styles.varValueUp
                              : styles.varValueDown,
                          ]}
                        >
                          {fmtPct(selectedCategoryKpis.variacion_tickets_pct)}
                        </Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <Text style={analysisStyles.emptyText}>No hay KPIs suficientes para esta categoría en este filtro.</Text>
                )}
              </View>
            </View>
          )}

          {/* ✅ AQUÍ VA: entre Detalle categoría y Proveedores destacados */}
          {data && effectiveSelectedCategory && (
            <View style={panelStyles.section}>
              <SectionHeader
                title="Tendencia últimos 7 días (gasto seleccionado)"
                onInfo={() =>
                  info.open(
                    'Tendencia 7 días (gasto seleccionado)',
                    'Evolución del gasto diario en los últimos 7 días para la categoría/subgasto seleccionado.'
                  )
                }
              />

              <View style={panelStyles.card}>
                {selectedTrendLoading ? (
                  <View style={styles.inlineLoaderRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.inlineLoaderText}>Cargando tendencia...</Text>
                  </View>
                ) : selectedTrendError ? (
                  <Text style={styles.inlineErrorText}>{selectedTrendError}</Text>
                ) : selectedTrend7d.length === 0 ? (
                  <Text style={analysisStyles.emptyText}>No hay datos de tendencia para este gasto.</Text>
                ) : (
                  <>
                    <Text style={analysisStyles.cardSubtitle}>
                      {selectedSubtipoId
                        ? 'Subgasto seleccionado'
                        : isAllSelected
                        ? 'Todos los gastos seleccionados'
                        : 'Categoría seleccionada'}
                    </Text>

                    <View style={styles.barChartContainer}>
                      {selectedTrend7d.map((d, idx) => {
                        const heightPct =
                          maxImporte7dSelected > 0 ? (d.importe / maxImporte7dSelected) * 100 : 0;
                        return (
                          <View key={`${d.fecha ?? d.label}-${idx}`} style={styles.barItem}>
                            <View style={styles.barWrapper}>
                              <View style={[styles.bar, { height: `${heightPct}%` }]} />
                            </View>
                            <Text style={styles.barLabel}>{d.label}</Text>
                            <Text style={styles.barValue}>
                              {d.importe > 0 ? d.importe.toFixed(1) + '€' : '—'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            </View>
          )}

          {/* PROVEEDORES DESTACADOS */}
          {data && (
            <View style={panelStyles.section}>
              <SectionHeader
                title="Proveedores destacados"
                onInfo={() =>
                  info.open(
                    'Proveedores destacados',
                    'Top proveedores del contenedor seleccionado. Con “TODOS” se agregan proveedores de todas las categorías.'
                  )
                }
              />

              <View style={panelStyles.card}>
                {selectedProveedores.map((p, idx) => (
                  <TouchableOpacity
                    key={`${p.nombre}-${idx}`}
                    style={styles.providerRow}
                    activeOpacity={0.85}
                    onPress={() =>
                      navigation.navigate('GastosList', {
                        initialFiltro: 'cotidiano',
                        fromDiaADia: true,
                        fromHome,
                        initialSearchText: p.nombre,
                      } as any)
                    }
                  >
                    <View style={styles.providerLeft}>
                      <View style={styles.providerAvatar}>
                        <Text style={styles.providerAvatarText}>{p.nombre.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View>
                        <Text style={styles.providerName}>{p.nombre}</Text>
                        <Text style={styles.providerSub}>{p.num_compras} compras</Text>
                      </View>
                    </View>
                    <View style={styles.providerRight}>
                      <Text style={styles.providerAmount}>{fmtCurrency(p.importe)}</Text>
                      <View style={styles.providerTrendRow}>
                        <Ionicons
                          name={p.tendencia === 'UP' ? 'arrow-up' : p.tendencia === 'DOWN' ? 'arrow-down' : 'remove'}
                          size={14}
                          color={tendenciaColor(p.tendencia)}
                          style={{ marginRight: 2 }}
                        />
                        <Text style={[styles.providerTrendText, { color: tendenciaColor(p.tendencia) }]}>
                          {p.tendencia === 'UP' ? '↑ vs 3m' : p.tendencia === 'DOWN' ? '↓ vs 3m' : 'Estable'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}

                {selectedProveedores.length === 0 && (
                  <Text style={analysisStyles.emptyText}>Sin datos de proveedores para este filtro.</Text>
                )}
              </View>
            </View>
          )}

          {/* Alertas e Insights solo en GENERAL */}
          {selectedView === 'GENERAL' && data && (
            <View style={[panelStyles.section, { marginBottom: 24 }]}>
              <SectionHeader
                title="Alertas e insights"
                onInfo={() =>
                  info.open(
                    'Alertas e insights',
                    'Mensajes automáticos generados por el sistema. Se priorizan insights estructurados del backend.'
                  )
                }
              />

              <View style={panelStyles.card}>
                {insights.length > 0 ? (
                  insights.map((it) => (
                    <View key={it.id} style={styles.insightRow}>
                      <View style={styles.alertIconCircle}>
                        <Ionicons
                          name={insightIconName(it.severity)}
                          size={16}
                          color={
                            it.severity === 'critical'
                              ? colors.danger
                              : it.severity === 'warning'
                              ? colors.primary
                              : colors.primary
                          }
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.insightTitle}>{it.title}</Text>
                        <Text style={styles.alertText}>{it.message}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <>
                    {alertasStrings.map((texto, idx) => (
                      <View key={idx} style={styles.alertRow}>
                        <View style={styles.alertIconCircle}>
                          <Ionicons name="alert-circle-outline" size={16} color={colors.primary} />
                        </View>
                        <Text style={styles.alertText}>{texto}</Text>
                      </View>
                    ))}

                    {alertasStrings.length === 0 && (
                      <Text style={analysisStyles.emptyText}>No hay alertas destacadas para este filtro.</Text>
                    )}
                  </>
                )}
              </View>
            </View>
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

export default DayToDayAnalysisScreen;

// --------------------
// Estilos
// --------------------

const styles = StyleSheet.create({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  todayTextBlock: {
    flex: 1,
    paddingRight: 12,
  },
  todayAmountContainer: {
    alignItems: 'flex-end',
    minWidth: 110,
  },
  todayAmountLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  todayAmountValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },

  kpiLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },

  weekRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weekColLeft: {
    flex: 1,
    paddingRight: 12,
  },
  weekColRight: {
    flex: 1,
    alignItems: 'flex-end',
    paddingLeft: 12,
  },
  weekMainAmount: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  weekLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  weekProjection: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  weekDaysLabel: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },

  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthCol: {
    flex: 1,
  },
  monthAmount: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  monthAmountHighlight: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  monthExpandedBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  monthExpandedTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  monthExpandedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  monthExpandedHint: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  inlineLoaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  inlineLoaderText: {
    marginLeft: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },
  inlineErrorText: {
    fontSize: 12,
    color: colors.danger,
    paddingVertical: 6,
  },
  monthBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  monthBreakdownLeft: {
    flex: 1,
    paddingRight: 10,
  },
  monthBreakdownLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  monthBreakdownSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  monthBreakdownRight: {
    width: 90,
    alignItems: 'flex-end',
  },
  monthBreakdownPct: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  monthBreakdownBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  monthBreakdownBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  monthBreakdownFootnote: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textSecondary,
  },

  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  categoryRowSelected: {
    backgroundColor: colors.primarySoft,
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginRight: 8,
  },
  categoryDotSelected: {
    backgroundColor: colors.primary,
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  categoryLabelSelected: {
    color: colors.primary,
  },
  categorySub: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  categoryRight: {
    flex: 1,
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  categoryPercent: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
    minHeight: 16,
  },
  categoryPercentSelected: {
    color: colors.primary,
  },
  categoryBarBackground: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  kpiCell: {
    width: '48%',
    marginBottom: 8,
  },

  varRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  varItem: {
    flex: 1,
    paddingRight: 8,
  },
  varLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  varValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  varValueUp: {
    color: colors.danger,
  },
  varValueDown: {
    color: colors.success,
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
  providerTrendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  providerTrendText: {
    fontSize: 11,
  },

  barChartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  barItem: {
    flex: 1,
    alignItems: 'center',
  },
  barWrapper: {
    height: 80,
    width: 16,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    marginBottom: 4,
  },
  bar: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  barLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  barValue: {
    fontSize: 11,
    color: colors.textMuted,
  },

  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  insightTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  alertIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  alertText: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
  },
});
