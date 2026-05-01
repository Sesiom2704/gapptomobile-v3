/**
 * Archivo: screens/dia/MovimientosScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de consulta de movimientos del mes (cobros y pagos ya realizados).
 *   - Muestra un resumen del mes (ingresos, gastos, balance) y un listado de movimientos.
 *   - Permite cambiar de mes, buscar movimientos y filtrar por cuenta o tipo.
 *
 * Maneja:
 *   - UI: Header + resumen fijo en card + filtros + listado en ScrollView con pull-to-refresh.
 *   - Estado:
 *       - data, loading, refreshing y error.
 *       - selectedYear / selectedMonth para navegar entre meses.
 *       - searchText para buscar por descripción, cuenta, banco o tipo.
 *       - selectedTipo para filtrar todos/ingresos/gastos.
 *       - selectedCuentaKey para filtrar por cuenta/banco.
 *   - Datos:
 *       - Lectura: fetchMovimientosMes(year, month), incluye totales y array de movimientos.
 *   - Navegación:
 *       - Soporta retorno condicionado (returnToTab/returnToScreen) y compatibilidad antigua (fromHome).
 *
 * Entradas / Salidas:
 *   - Props:
 *       - navigation: React Navigation
 *       - route: React Navigation
 *   - route.params:
 *       - fromHome?: boolean (compat)
 *       - returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab'
 *       - returnToScreen?: string
 *       - returnParams?: Record<string, any>
 *   - Efectos:
 *       - Carga inicial de movimientos (useEffect).
 *       - Cambio de mes: recarga de movimientos.
 *       - Pull-to-refresh: recarga del mes seleccionado.
 *       - Render condicional de estados: loading, error, vacío.
 *
 * Dependencias clave:
 *   - UI interna: Header, panelStyles, ListRow, IconCircle
 *   - Tema: colors
 *   - Utilidades: EuroformatEuro, formatFechaCorta
 *   - Iconos: Ionicons
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO.
 *   - Los chips de filtros y selector de mes podrían convertirse en componentes reutilizables.
 *
 * Notas de estilo:
 *   - Se mantiene ListRow para no perder coherencia visual con otros listados.
 *   - Se evita mostrar cuenta_id/banco_id como texto principal porque en cotidianos estaba apareciendo el id.
 *   - La solución definitiva del banco de cotidianos debe venir desde backend enviando cuenta_nombre o banco_nombre.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { ListRow } from '../../components/ui/ListRow';
import { IconCircle } from '../../components/ui/IconCircle';

import {
  fetchMovimientosMes,
  MovimientosMesResponse,
  MovimientoItem,
  MovementKind,
} from '../../services/movimientosApi';

import { EuroformatEuro, formatFechaCorta } from '../../utils/format';

type RouteParams = {
  fromHome?: boolean;
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string;
  returnParams?: Record<string, any>;
};

type TipoFiltro = 'TODOS' | 'INGRESO' | 'GASTO';

type CuentaFiltro = {
  key: string;
  label: string;
};

const getCurrentYearMonth = () => {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
};

const getMonthLabel = (year: number, month: number) => {
  return `${month.toString().padStart(2, '0')}/${year}`;
};

const moveMonth = (
  year: number,
  month: number,
  offset: number
): { year: number; month: number } => {
  const date = new Date(year, month - 1 + offset, 1);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
};

const normalizeText = (value: unknown) => {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

/**
 * Devuelve un nombre visible para la cuenta/banco.
 *
 * Importante:
 * - No mostramos directamente cuenta_id o banco_id porque ese era el problema en cotidianos.
 * - Si backend todavía no envía nombre, mostramos "SIN CUENTA".
 */
const getCuentaDisplayName = (m: MovimientoItem) => {
  return (
    m.cuenta_nombre ||
    m.banco_nombre ||
    'SIN CUENTA'
  );
};

/**
 * Devuelve una clave estable para filtrar por cuenta/banco.
 *
 * Si hay nombre, usa el nombre.
 * Si no hay nombre pero hay id, usa el id internamente, pero la etiqueta visible será controlada aparte.
 */
const getCuentaFilterKey = (m: MovimientoItem) => {
  if (m.cuenta_id !== undefined && m.cuenta_id !== null) {
    return `cuenta:${String(m.cuenta_id)}`;
  }

  if (m.banco_id !== undefined && m.banco_id !== null) {
    return `banco:${String(m.banco_id)}`;
  }

  const display = getCuentaDisplayName(m);
  return `nombre:${display}`;
};

const MovimientosScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const params: RouteParams = route?.params ?? {};
  const current = getCurrentYearMonth();

  const [selectedYear, setSelectedYear] = useState<number>(current.year);
  const [selectedMonth, setSelectedMonth] = useState<number>(current.month);

  const [data, setData] = useState<MovimientosMesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState<string>('');
  const [selectedTipo, setSelectedTipo] = useState<TipoFiltro>('TODOS');
  const [selectedCuentaKey, setSelectedCuentaKey] = useState<string>('TODAS');

  const cargarMovimientos = useCallback(
    async (isRefresh: boolean = false) => {
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        setError(null);

        const response = await fetchMovimientosMes(selectedYear, selectedMonth);
        setData(response);
      } catch (e) {
        console.error('[MovimientosScreen] Error cargando movimientos', e);
        setError('No se han podido cargar los movimientos.');
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [selectedYear, selectedMonth]
  );

  useEffect(() => {
    cargarMovimientos();
  }, [cargarMovimientos]);

  const onRefresh = useCallback(() => {
    cargarMovimientos(true);
  }, [cargarMovimientos]);

  const handleBack = useCallback(() => {
    if (!params.returnToTab && params.fromHome) {
      navigation.navigate('HomeTab');
      return;
    }

    if (params.returnToTab) {
      if (params.returnToScreen) {
        navigation.navigate(params.returnToTab, {
          screen: params.returnToScreen,
          params: params.returnParams ?? undefined,
        });
      } else {
        navigation.navigate(params.returnToTab);
      }
      return;
    }

    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('HomeTab');
    }
  }, [navigation, params]);

  const handlePreviousMonth = useCallback(() => {
    const next = moveMonth(selectedYear, selectedMonth, -1);
    setSelectedYear(next.year);
    setSelectedMonth(next.month);
    setSelectedCuentaKey('TODAS');
  }, [selectedYear, selectedMonth]);

  const handleNextMonth = useCallback(() => {
    const next = moveMonth(selectedYear, selectedMonth, 1);
    setSelectedYear(next.year);
    setSelectedMonth(next.month);
    setSelectedCuentaKey('TODAS');
  }, [selectedYear, selectedMonth]);

  const getTipoLabel = (tipo: MovementKind) => {
    switch (tipo) {
      case 'GASTO_GESTIONABLE':
        return 'Gasto gestionable';
      case 'GASTO_COTIDIANO':
        return 'Gasto cotidiano';
      case 'INGRESO':
        return 'Ingreso';
      default:
        return '';
    }
  };

  const movimientos = data?.movimientos ?? [];

  const cuentaOptions = useMemo<CuentaFiltro[]>(() => {
    const map = new Map<string, string>();

    movimientos.forEach((m) => {
      const key = getCuentaFilterKey(m);
      const label = getCuentaDisplayName(m);

      if (!map.has(key)) {
        map.set(key, label);
      }
    });

    return [
      { key: 'TODAS', label: 'Todas' },
      ...Array.from(map.entries())
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [movimientos]);

  const movimientosFiltrados = useMemo(() => {
    const q = normalizeText(searchText);

    return movimientos.filter((m) => {
      const cuentaKey = getCuentaFilterKey(m);
      const cuentaDisplay = getCuentaDisplayName(m);
      const tipoLabel = getTipoLabel(m.tipo);

      const matchCuenta =
        selectedCuentaKey === 'TODAS' || cuentaKey === selectedCuentaKey;

      const matchTipo =
        selectedTipo === 'TODOS' ||
        (selectedTipo === 'INGRESO' && m.es_ingreso) ||
        (selectedTipo === 'GASTO' && !m.es_ingreso);

      const searchable = normalizeText(
        [
          m.descripcion,
          cuentaDisplay,
          m.cuenta_nombre,
          m.banco_nombre,
          tipoLabel,
          m.fecha,
          m.importe,
        ].join(' ')
      );

      const matchSearch = !q || searchable.includes(q);

      return matchCuenta && matchTipo && matchSearch;
    });
  }, [movimientos, searchText, selectedCuentaKey, selectedTipo]);

  const year = data?.year ?? selectedYear;
  const month = data?.month ?? selectedMonth;
  const totalIngresos = data?.total_ingresos ?? 0;
  const totalGastos = data?.total_gastos ?? 0;
  const balance = data?.balance ?? 0;

  return (
    <>
      <Header
        title="Movimientos del mes"
        subtitle={`Cobros y pagos realizados en ${getMonthLabel(year, month)}.`}
        showBack
        onBackPress={handleBack}
      />

      <View style={panelStyles.screen}>
        {data && (
          <View style={[panelStyles.section, { paddingBottom: 8 }]}>
            <View style={panelStyles.card}>
              <View style={styles.monthHeaderRow}>
                <Pressable
                  style={styles.monthButton}
                  onPress={handlePreviousMonth}
                >
                  <Ionicons
                    name="chevron-back"
                    size={18}
                    color={colors.textPrimary}
                  />
                </Pressable>

                <View style={styles.monthTextBlock}>
                  <Text style={panelStyles.cardTitle}>Resumen del mes</Text>
                  <Text style={panelStyles.cardSubtitle}>
                    {getMonthLabel(year, month)} · ingresos cobrados, gastos pagados y balance neto.
                  </Text>
                </View>

                <Pressable style={styles.monthButton} onPress={handleNextMonth}>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textPrimary}
                  />
                </Pressable>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryCardInner}>
                  <View style={styles.summaryIconCircle}>
                    <Ionicons
                      name="arrow-down-circle-outline"
                      size={20}
                      color={colors.success}
                    />
                  </View>

                  <View style={styles.summaryTextBlock}>
                    <Text style={styles.summaryLabel}>Ingresos cobrados</Text>
                    <Text style={styles.summaryValue}>
                      {EuroformatEuro(totalIngresos, 'plus')}
                    </Text>
                    <Text style={styles.summaryDelta}>
                      Cobros confirmados este mes
                    </Text>
                  </View>
                </View>

                <View style={styles.summaryCardInner}>
                  <View style={styles.summaryIconCircle}>
                    <Ionicons
                      name="arrow-up-circle-outline"
                      size={20}
                      color={colors.danger}
                    />
                  </View>

                  <View style={styles.summaryTextBlock}>
                    <Text style={styles.summaryLabel}>Gastos pagados</Text>
                    <Text style={styles.summaryValue}>
                      {EuroformatEuro(totalGastos, 'minus')}
                    </Text>
                    <Text style={styles.summaryDelta}>
                      Pagos realizados este mes
                    </Text>
                  </View>
                </View>
              </View>

              <View style={[styles.balanceRow, { marginTop: 12 }]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.balanceLabel}>Balance del mes</Text>
                  <Text style={styles.balanceSubtitle}>
                    Ingresos cobrados menos gastos pagados.
                  </Text>
                </View>

                <Text
                  style={[
                    styles.balanceValue,
                    balance >= 0 ? styles.positive : styles.negative,
                  ]}
                >
                  {EuroformatEuro(balance, 'signed')}
                </Text>
              </View>
            </View>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {loading && !data && !error && (
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Cargando movimientos...</Text>
            </View>
          )}

          {error && (
            <View style={panelStyles.section}>
              <View style={panelStyles.card}>
                <Text style={{ color: colors.danger, fontSize: 13 }}>
                  {error}
                </Text>
              </View>
            </View>
          )}

          {data && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>Filtros</Text>

              <View style={panelStyles.card}>
                <View style={styles.searchBox}>
                  <Ionicons
                    name="search-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder="Buscar por descripción, cuenta o banco..."
                    placeholderTextColor={colors.textMuted}
                    style={styles.searchInput}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />

                  {searchText.length > 0 && (
                    <Pressable onPress={() => setSearchText('')}>
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  )}
                </View>

                <Text style={styles.filterLabel}>Tipo</Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  <FilterChip
                    label="Todos"
                    active={selectedTipo === 'TODOS'}
                    onPress={() => setSelectedTipo('TODOS')}
                  />
                  <FilterChip
                    label="Ingresos"
                    active={selectedTipo === 'INGRESO'}
                    onPress={() => setSelectedTipo('INGRESO')}
                  />
                  <FilterChip
                    label="Gastos"
                    active={selectedTipo === 'GASTO'}
                    onPress={() => setSelectedTipo('GASTO')}
                  />
                </ScrollView>

                <Text style={styles.filterLabel}>Cuenta / banco</Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {cuentaOptions.map((option) => (
                    <FilterChip
                      key={option.key}
                      label={option.label}
                      active={selectedCuentaKey === option.key}
                      onPress={() => setSelectedCuentaKey(option.key)}
                    />
                  ))}
                </ScrollView>
              </View>
            </View>
          )}

          {data && (
            <View style={panelStyles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={panelStyles.sectionTitle}>Movimientos</Text>
                <Text style={styles.counterText}>
                  {movimientosFiltrados.length} de {movimientos.length}
                </Text>
              </View>

              <View style={panelStyles.card}>
                {movimientosFiltrados.length === 0 && (
                  <Text style={styles.emptyText}>
                    No hay movimientos que coincidan con los filtros aplicados.
                  </Text>
                )}

                {movimientosFiltrados.map((m) => {
                  const isPositive = m.es_ingreso;
                  const cuentaDisplay = getCuentaDisplayName(m);

                  return (
                    <ListRow
                      key={`${m.tipo}-${m.id}`}
                      left={
                        <IconCircle
                          name={
                            isPositive
                              ? 'arrow-down-outline'
                              : 'arrow-up-outline'
                          }
                          diameter={28}
                          size={16}
                          backgroundColor={
                            isPositive ? colors.success : colors.danger
                          }
                          iconColor="#fff"
                        />
                      }
                      title={(m.descripcion ?? '').toUpperCase()}
                      subtitle={`${formatFechaCorta(m.fecha)} · ${cuentaDisplay} · ${getTipoLabel(m.tipo)}`}
                      right={
                        <Text
                          style={[
                            styles.amountBase,
                            isPositive
                              ? styles.amountPositive
                              : styles.amountNegative,
                          ]}
                        >
                          {EuroformatEuro(
                            m.importe,
                            isPositive ? 'plus' : 'minus'
                          )}
                        </Text>
                      }
                      showDivider={false}
                    />
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
};

type FilterChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

const FilterChip: React.FC<FilterChipProps> = ({ label, active, onPress }) => {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
};

export default MovimientosScreen;

const styles = StyleSheet.create({
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthTextBlock: {
    flex: 1,
    paddingHorizontal: 8,
  },
  monthButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  summaryCardInner: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  summaryIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  summaryTextBlock: {
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

  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  balanceSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  positive: {
    color: colors.success,
  },
  negative: {
    color: colors.danger,
  },

  searchBox: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    color: colors.textPrimary,
    fontSize: 13,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {
    gap: 8,
    paddingBottom: 10,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },

  amountBase: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  amountPositive: {
    color: colors.success,
  },
  amountNegative: {
    color: colors.danger,
  },
});