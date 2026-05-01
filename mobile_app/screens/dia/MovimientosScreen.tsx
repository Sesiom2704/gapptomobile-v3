/**
 * Archivo: screens/dia/MovimientosScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de consulta de movimientos del mes (cobros y pagos ya realizados).
 *   - Muestra un resumen del mes (ingresos, gastos, balance) y un listado de movimientos.
 *   - Permite cambiar de mes, buscar movimientos y filtrar por cuenta o tipo.
 *
 * Ajustes v3:
 *   - Buscador avanzado plegable con formato unificado.
 *   - Filtros con FilterPill y TwoLineCompactPill, igual que otras pantallas.
 *   - Mantiene navegación mensual, resumen y listado existente.
 *   - Evita mostrar ids como banco/cuenta cuando no llega nombre legible.
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
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { ListRow } from '../../components/ui/ListRow';
import { IconCircle } from '../../components/ui/IconCircle';
import { FilterPill } from '../../components/ui/FilterPill';
import { TwoLineCompactPill } from '../../components/ui/TwoLineCompactPill';

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

const getCuentaDisplayName = (m: MovimientoItem) => {
  return m.cuenta_nombre || m.banco_nombre || 'SIN CUENTA';
};

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

  const [buscadorAbierto, setBuscadorAbierto] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [selectedTipo, setSelectedTipo] = useState<TipoFiltro>('TODOS');
  const [selectedCuentaKey, setSelectedCuentaKey] = useState<string>('TODAS');

  const [showTipoFilter, setShowTipoFilter] = useState<boolean>(true);
  const [showCuentaFilter, setShowCuentaFilter] = useState<boolean>(true);

  const closeBuscador = useCallback(() => {
    Keyboard.dismiss();
    setBuscadorAbierto(false);
  }, []);

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
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
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

  const renderBuscador = () => {
    const hasAnyCuenta = cuentaOptions.length > 1;

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
            placeholder="Descripción, cuenta, banco o tipo…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />

          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View style={styles.filterHeaderRow}>
            <Text style={styles.searchLabel}>Tipo de movimiento</Text>

            <TouchableOpacity
              onPress={() => setShowTipoFilter((prev) => !prev)}
              style={styles.showHideButton}
            >
              <Ionicons
                name={
                  showTipoFilter
                    ? 'remove-circle-outline'
                    : 'add-circle-outline'
                }
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.showHideText}>
                {showTipoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showTipoFilter && (
            <View style={styles.pillsRow}>
              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Todos"
                  selected={selectedTipo === 'TODOS'}
                  disabled={movimientos.length === 0}
                  onPress={() => setSelectedTipo('TODOS')}
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Ingresos"
                  selected={selectedTipo === 'INGRESO'}
                  disabled={!movimientos.some((m) => m.es_ingreso)}
                  onPress={() =>
                    setSelectedTipo(
                      selectedTipo === 'INGRESO' ? 'TODOS' : 'INGRESO'
                    )
                  }
                  style={styles.filterPill}
                />
              </View>

              <View style={styles.pillWrapper}>
                <FilterPill
                  label="Gastos"
                  selected={selectedTipo === 'GASTO'}
                  disabled={!movimientos.some((m) => !m.es_ingreso)}
                  onPress={() =>
                    setSelectedTipo(
                      selectedTipo === 'GASTO' ? 'TODOS' : 'GASTO'
                    )
                  }
                  style={styles.filterPill}
                />
              </View>
            </View>
          )}
        </View>

        {hasAnyCuenta && (
          <View style={{ marginTop: 16 }}>
            <View style={styles.filterHeaderRow}>
              <Text style={styles.searchLabel}>Cuenta bancaria</Text>

              <TouchableOpacity
                onPress={() => setShowCuentaFilter((prev) => !prev)}
                style={styles.showHideButton}
              >
                <Ionicons
                  name={
                    showCuentaFilter
                      ? 'remove-circle-outline'
                      : 'add-circle-outline'
                  }
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.showHideText}>
                  {showCuentaFilter ? 'Ocultar' : 'Mostrar'}
                </Text>
              </TouchableOpacity>
            </View>

            {showCuentaFilter && (
              <View style={styles.pillsRowWrap}>
                {cuentaOptions.map((option) => {
                  const selected = selectedCuentaKey === option.key;

                  return (
                    <View style={styles.pillWrapper} key={option.key}>
                      <TwoLineCompactPill
                        label={option.label}
                        selected={selected}
                        onPress={() =>
                          setSelectedCuentaKey(
                            selected && option.key !== 'TODAS'
                              ? 'TODAS'
                              : option.key
                          )
                        }
                        style={styles.filterPill}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

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
                    {getMonthLabel(year, month)} · ingresos cobrados, gastos
                    pagados y balance neto.
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
          onScrollBeginDrag={closeBuscador}
          onTouchStart={() => {
            if (buscadorAbierto) Keyboard.dismiss();
          }}
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
                      subtitle={`${formatFechaCorta(
                        m.fecha
                      )} · ${cuentaDisplay} · ${getTipoLabel(m.tipo)}`}
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

  searchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  searchToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  searchPanel: {
    marginTop: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
  },
  searchLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  searchRow: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    color: colors.textPrimary,
    fontSize: 13,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  showHideButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  showHideText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginTop: 2,
  },
  pillsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginTop: 2,
  },
  pillWrapper: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  filterPill: {
    minHeight: 32,
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