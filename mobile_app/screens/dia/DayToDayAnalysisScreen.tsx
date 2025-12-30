// mobile_app/screens/dia/DayToDayAnalysisScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '../../types/analytics';
import { analysisStyles } from '../../components/analysis/analysisStyles';

// ✅ NUEVO: Info (botón i + modal reutilizable)
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

// --------------------
// Tipos y constantes
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
  { key: 'RESTURACION', label: 'Restauración' },
  { key: 'OCIO', label: 'Ocio' },
];

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

// Mapa de subgastos por categoría
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

// --------------------
// Tipado route params
// --------------------
type DayToDayAnalysisRouteParams = {
  fromHome?: boolean;
};

// --------------------
// Componente principal
// --------------------

export const DayToDayAnalysisScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  // ✅ AQUÍ va fromHome (una sola vez, route ya existe)
  const fromHome: boolean =
    (route?.params as DayToDayAnalysisRouteParams | undefined)?.fromHome ?? false;

  // ✅ Info modal
  const info = useInfoModal();

  // Vista GENERAL / CATEGORIA
  const [selectedView, setSelectedView] =
    useState<'GENERAL' | 'CATEGORIA'>('GENERAL');

  // Mostrar/ocultar bloque de filtros
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  // Quién paga: TODOS / YO / OTRO
  const [pagoFiltro, setPagoFiltro] = useState<PagoFiltro>('YO');

  // Categoría seleccionada (SUPERMERCADOS, VEHICULOS, etc.)
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(
    null
  );

  // Subgasto seleccionado (tipo_id concreto) dentro de la categoría
  // null = se aplica a toda la categoría (contenedor)
  const [selectedSubtipoId, setSelectedSubtipoId] = useState<string | null>(
    null
  );

  // Datos del backend
  const [data, setData] = useState<DayToDayAnalysisResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Si cambia la categoría, reseteamos el subgasto a "todos"
  useEffect(() => {
    setSelectedSubtipoId(null);
  }, [selectedCategoryKey]);

  // Para dividir los contenedores en filas de 3
  const categoryRows = useMemo<CategoryOption[][]>(() => {
    const rows: CategoryOption[][] = [];
    for (let i = 0; i < CATEGORY_OPTIONS.length; i += 3) {
      rows.push(CATEGORY_OPTIONS.slice(i, i + 3));
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

      const params: any = { pago: pagoFiltro };

      if (selectedView === 'CATEGORIA') {
        if (selectedSubtipoId) {
          params.tipoId = selectedSubtipoId;
        } else if (selectedCategoryKey) {
          params.categoria = selectedCategoryKey;
        }
      }

      const resp = await getDayToDayAnalysis(params);
      setData(resp);

      if (!selectedCategoryKey && resp.categorias_mes.length > 0) {
        setSelectedCategoryKey(resp.categorias_mes[0].key);
      }
    } catch (err) {
      console.log(
        '[DayToDayAnalysisScreen] Error cargando análisis día a día',
        err
      );
      setError('No se ha podido cargar el análisis día a día.');
    } finally {
      setLoading(false);
    }
  }, [pagoFiltro, selectedView, selectedCategoryKey, selectedSubtipoId]);

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
  const categoryKpis = data?.category_kpis ?? {};
  const proveedoresPorCategoria = data?.proveedores_por_categoria ?? {};
  const ultimos7Dias: Last7DayItem[] = data?.ultimos_7_dias ?? [];
  const alertas = data?.alertas ?? [];

  // Categoría seleccionada efectiva
  const effectiveSelectedCategory = useMemo(() => {
    if (!categoriasMes.length) return null;
    const fromState =
      selectedCategoryKey &&
      categoriasMes.find((c) => c.key === selectedCategoryKey);
    return fromState || categoriasMes[0];
  }, [categoriasMes, selectedCategoryKey]);

  const selectedCategoryKpis = useMemo(() => {
    if (!effectiveSelectedCategory) return null;
    return categoryKpis[effectiveSelectedCategory.key] ?? null;
  }, [effectiveSelectedCategory, categoryKpis]);

  const selectedProveedores: ProviderItem[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];
    return proveedoresPorCategoria[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory, proveedoresPorCategoria]);

  const maxImporte7d = useMemo(() => {
    if (!ultimos7Dias.length) return 1;
    return Math.max(1, ...ultimos7Dias.map((d) => d.importe));
  }, [ultimos7Dias]);

  const subtipoOptions: SubtipoOption[] = useMemo(() => {
    if (!effectiveSelectedCategory) return [];
    return SUBTIPOS_POR_CATEGORIA[effectiveSelectedCategory.key] ?? [];
  }, [effectiveSelectedCategory]);

  // Desglose visual de la diferencia vs ayer (HOY)
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
  // ✅ Header de sección con InfoButton a la derecha del título (NO en filtros)
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
        title="Análisis día a día"
        subtitle="Desglose de tus gastos cotidianos por categoría y proveedor."
        showBack
        onBackPress={() => {
          if (fromHome) {
            // Volver al tab Home sin dejar pantallas “fantasma” en el stack
            navigation.navigate('HomeTab');
          } else {
            navigation.goBack();
          }
        }}
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {/* FILTROS (DESPLEGABLE) - ✅ SIN BOTÓN INFO AQUÍ */}
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
                      label={
                        vista === 'GENERAL'
                          ? 'Vista general'
                          : 'Análisis por categoría'
                      }
                      selected={selectedView === vista}
                      onPress={() => setSelectedView(vista)}
                    />
                  ))}
                </FilterRow>

                <Text style={analysisStyles.filterHelper}>
                  En vista general ves el resumen de hoy, semana, mes y
                  tendencias sobre todos tus gastos cotidianos (según quién
                  paga). En vista por categoría puedes centrarte en un
                  contenedor e incluso en un subgasto concreto.
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
                <Text
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: colors.textSecondary,
                  }}
                >
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
                      'Resumen del gasto de hoy (cotidianos) según el filtro de quién paga. Incluye movimientos, ticket medio y comparativa vs ayer.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.todayTextBlock}>
                      <Text style={analysisStyles.cardTitle}>
                        {today?.fecha_label ?? 'Hoy'}
                      </Text>
                      <Text style={analysisStyles.cardSubtitle}>
                        {today?.tendencia ??
                          'Resumen de tus gastos cotidianos de hoy.'}
                      </Text>
                    </View>

                    <View style={styles.todayAmountContainer}>
                      <Text style={styles.todayAmountLabel}>Gastado hoy</Text>
                      <Text style={styles.todayAmountValue}>
                        {fmtCurrency(today?.total_hoy)}
                      </Text>
                    </View>
                  </View>

                  <View style={analysisStyles.kpiRow}>
                    <View style={analysisStyles.kpiItem}>
                      <Text style={analysisStyles.kpiLabel}>Movimientos</Text>
                      <Text style={analysisStyles.kpiValue}>
                        {today?.num_movimientos ?? 0}
                      </Text>
                    </View>
                    <View style={analysisStyles.kpiItem}>
                      <Text style={analysisStyles.kpiLabel}>Ticket medio</Text>
                      <Text style={analysisStyles.kpiValue}>
                        {fmtCurrency(today?.ticket_medio)}
                      </Text>
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
                      {diffSuffix ? (
                        <Text style={styles.kpiLabel}>{diffSuffix}</Text>
                      ) : null}
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
                      'Gasto acumulado de la semana, límite semanal configurado y proyección al final de semana según el ritmo actual.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <View style={styles.weekRowTop}>
                    <View style={styles.weekColLeft}>
                      <Text style={analysisStyles.cardTitle}>
                        Gasto de la semana
                      </Text>
                      <Text style={styles.weekMainAmount}>
                        {fmtCurrency(week?.total_semana)}
                      </Text>
                      <Text style={analysisStyles.cardSubtitle}>
                        Límite semanal: {fmtCurrency(week?.limite_semana ?? 0)}
                      </Text>
                    </View>
                    <View style={styles.weekColRight}>
                      <Text style={styles.weekLabel}>
                        Proyección fin de semana
                      </Text>
                      <Text style={styles.weekProjection}>
                        {fmtCurrency(week?.proyeccion_fin_semana)}
                      </Text>
                      <Text style={styles.weekDaysLabel}>
                        {(week?.dias_restantes ?? 0)} días restantes
                      </Text>
                    </View>
                  </View>

                  <View style={analysisStyles.progressRow}>
                    <Text style={analysisStyles.progressCaption}>
                      Progreso sobre el límite semanal
                    </Text>
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
            </>
          )}

          {/* MES EN CURSO */}
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
                    'Presupuesto mensual estimado y gasto acumulado del mes hasta hoy. La barra muestra el porcentaje usado.'
                  )
                }
              />

              <View style={panelStyles.card}>
                <View style={styles.monthRow}>
                  <View style={styles.monthCol}>
                    <Text style={analysisStyles.cardTitle}>Presupuesto mensual</Text>
                    <Text style={styles.monthAmount}>
                      {fmtCurrency(month?.presupuesto_mes)}
                    </Text>
                  </View>
                  <View style={styles.monthCol}>
                    <Text style={analysisStyles.cardTitle}>Gastado hasta hoy</Text>
                    <Text style={styles.monthAmountHighlight}>
                      {fmtCurrency(month?.gastado_mes)}
                    </Text>
                  </View>
                </View>

                <View style={analysisStyles.progressRow}>
                  <Text style={analysisStyles.progressCaption}>
                    {month && month.presupuesto_mes > 0
                      ? `${((month.gastado_mes / month.presupuesto_mes) * 100).toFixed(
                          1
                        )}% del presupuesto mensual usado`
                      : 'Aún no hay presupuesto estimado suficiente para este mes'}
                  </Text>
                  <View style={analysisStyles.progressBarBackground}>
                    <View
                      style={[
                        analysisStyles.progressBarFillSoft,
                        {
                          width:
                            month && month.presupuesto_mes > 0
                              ? `${Math.min(
                                  100,
                                  (month.gastado_mes / month.presupuesto_mes) * 100
                                )}%`
                              : '0%',
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
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
                    'Listado de categorías (contenedores) del mes con importe total y porcentaje sobre el gasto del mes. Al tocar una, se carga su detalle.'
                  )
                }
              />

              <View style={panelStyles.card}>
                <Text style={analysisStyles.cardSubtitle}>
                  Toca una categoría para ver sus KPIs y proveedores asociados.
                </Text>

                {categoriasMes.map((cat) => {
                  const isSelected =
                    effectiveSelectedCategory &&
                    cat.key === effectiveSelectedCategory.key;
                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={[
                        styles.categoryRow,
                        isSelected && styles.categoryRowSelected,
                      ]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedCategoryKey(cat.key)}
                    >
                      <View style={styles.categoryLeft}>
                        <View
                          style={[
                            styles.categoryDot,
                            isSelected && styles.categoryDotSelected,
                          ]}
                        />
                        <View>
                          <Text
                            style={[
                              styles.categoryLabel,
                              isSelected && styles.categoryLabelSelected,
                            ]}
                          >
                            {cat.label}
                          </Text>
                          <Text style={styles.categorySub}>
                            {fmtCurrency(cat.importe)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.categoryRight}>
                        <Text
                          style={[
                            styles.categoryPercent,
                            isSelected && styles.categoryPercentSelected,
                          ]}
                        >
                          {cat.porcentaje.toFixed(1)}%
                        </Text>
                        <View style={styles.categoryBarBackground}>
                          <View
                            style={[
                              styles.categoryBarFill,
                              { width: `${cat.porcentaje}%` },
                            ]}
                          />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {categoriasMes.length === 0 && (
                  <Text style={analysisStyles.emptyText}>
                    Aún no hay gastos cotidianos en este mes.
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* DETALLE CATEGORÍA + SUBGASTOS */}
          {data && effectiveSelectedCategory && (
            <View style={panelStyles.section}>
              <SectionHeader
                title={`Detalle categoría: ${effectiveSelectedCategory.label}`}
                onInfo={() =>
                  info.open(
                    'Detalle de categoría',
                    'KPIs del contenedor seleccionado (importe, tickets, ticket medio, peso) y variaciones vs mes anterior. Puedes aplicar un subgasto para refinar el análisis.'
                  )
                }
              />

              <View style={panelStyles.card}>
                {subtipoOptions.length > 0 && (
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
                          {fmtCurrency(effectiveSelectedCategory.importe)}
                        </Text>
                      </View>
                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}># Tickets</Text>
                        <Text style={analysisStyles.kpiValue}>
                          {selectedCategoryKpis.tickets}
                        </Text>
                      </View>
                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}>Ticket medio</Text>
                        <Text style={analysisStyles.kpiValue}>
                          {fmtCurrency(selectedCategoryKpis.ticket_medio)}
                        </Text>
                      </View>
                      <View style={styles.kpiCell}>
                        <Text style={analysisStyles.kpiLabel}>Peso sobre total</Text>
                        <Text style={analysisStyles.kpiValue}>
                          {selectedCategoryKpis.peso_sobre_total_gasto.toFixed(1)}%
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
                  <Text style={analysisStyles.emptyText}>
                    No hay KPIs suficientes para esta categoría en este filtro.
                  </Text>
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
                    'Top proveedores del contenedor seleccionado (según quién paga). Al tocar un proveedor se abre GastosList en modo cotidianos filtrando por ese nombre.'
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
                        <Text style={styles.providerAvatarText}>
                          {p.nombre.slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.providerName}>{p.nombre}</Text>
                        <Text style={styles.providerSub}>{p.num_compras} compras</Text>
                      </View>
                    </View>
                    <View style={styles.providerRight}>
                      <Text style={styles.providerAmount}>
                        {fmtCurrency(p.importe)}
                      </Text>
                      <View style={styles.providerTrendRow}>
                        <Ionicons
                          name={
                            p.tendencia === 'UP'
                              ? 'arrow-up'
                              : p.tendencia === 'DOWN'
                              ? 'arrow-down'
                              : 'remove'
                          }
                          size={14}
                          color={tendenciaColor(p.tendencia)}
                          style={{ marginRight: 2 }}
                        />
                        <Text
                          style={[
                            styles.providerTrendText,
                            { color: tendenciaColor(p.tendencia) },
                          ]}
                        >
                          {p.tendencia === 'UP'
                            ? '↑ vs 3m'
                            : p.tendencia === 'DOWN'
                            ? '↓ vs 3m'
                            : 'Estable'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}

                {selectedProveedores.length === 0 && (
                  <Text style={analysisStyles.emptyText}>
                    Sin datos de proveedores para este filtro.
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* En vista CATEGORIA paramos aquí */}
          {selectedView === 'GENERAL' && data && (
            <>
              <View style={panelStyles.section}>
                <SectionHeader
                  title="Tendencia últimos 7 días"
                  onInfo={() =>
                    info.open(
                      'Tendencia últimos 7 días',
                      'Evolución del gasto diario (cotidianos) en los últimos 7 días. Las barras se escalan al máximo de la semana.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  <Text style={analysisStyles.cardSubtitle}>
                    Gasto diario en gastos cotidianos (últimos 7 días).
                  </Text>

                  <View style={styles.barChartContainer}>
                    {ultimos7Dias.map((d, idx) => {
                      const heightPct =
                        maxImporte7d > 0 ? (d.importe / maxImporte7d) * 100 : 0;
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

              <View style={[panelStyles.section, { marginBottom: 24 }]}>
                <SectionHeader
                  title="Alertas e insights"
                  onInfo={() =>
                    info.open(
                      'Alertas e insights',
                      'Mensajes automáticos generados por el sistema con patrones detectados en tus gastos cotidianos para el filtro actual.'
                    )
                  }
                />

                <View style={panelStyles.card}>
                  {alertas.map((texto, idx) => (
                    <View key={idx} style={styles.alertRow}>
                      <View style={styles.alertIconCircle}>
                        <Ionicons
                          name="alert-circle-outline"
                          size={16}
                          color={colors.primary}
                        />
                      </View>
                      <Text style={styles.alertText}>{texto}</Text>
                    </View>
                  ))}

                  {alertas.length === 0 && (
                    <Text style={analysisStyles.emptyText}>
                      No hay alertas destacadas para este filtro.
                    </Text>
                  )}
                </View>
              </View>
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

export default DayToDayAnalysisScreen;

// --------------------
// Estilos específicos
// --------------------

const styles = StyleSheet.create({
  // ✅ NUEVO: Header de sección (título + info a la derecha)
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
  alertIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  alertText: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
  },
});
