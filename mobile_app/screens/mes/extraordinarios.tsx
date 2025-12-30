import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import {
  fetchExtraordinarios,
  ExtraordinariosResponseDto,
  ExtraordinarioItemDto,
} from '../../services/extraordinarios';

const monthNames = [
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

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);

type RouteParams = {
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string;
};

const ExtraordinariosScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const { returnToTab, returnToScreen } = (route.params ?? {}) as RouteParams;

  const handleBack = useCallback(() => {
    if (returnToTab && returnToScreen) {
      navigation.navigate(returnToTab, { screen: returnToScreen });
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation, returnToTab, returnToScreen]);

  // Mes seleccionado en front (0-11)
  const [selectedYear, setSelectedYear] = useState(2025);
  const [selectedMonth, setSelectedMonth] = useState(11); // diciembre

  const [data, setData] = useState<ExtraordinariosResponseDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiMonth = selectedMonth + 1; // backend usa 1-12
      const res = await fetchExtraordinarios(selectedYear, apiMonth);
      setData(res);
    } catch (err) {
      console.error('Error cargando extraordinarios', err);
      setError('No se han podido cargar los extraordinarios.');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const goToPrevMonth = () => {
    setSelectedMonth((prev) => {
      if (prev === 0) {
        setSelectedYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const goToNextMonth = () => {
    setSelectedMonth((prev) => {
      if (prev === 11) {
        setSelectedYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const onRefresh = useCallback(() => {
    if (!loading) loadData();
  }, [loadData, loading]);

  const monthLabel = useMemo(
    () => `${monthNames[selectedMonth]} ${selectedYear}`,
    [selectedMonth, selectedYear]
  );

  const totalIngresos = data?.total_ingresos ?? 0;
  const totalGastos = data?.total_gastos ?? 0;
  const balance = data?.balance ?? 0;

  const gastos = data?.gastos ?? [];
  const ingresos = data?.ingresos ?? [];

  const renderGastoCard = (gasto: ExtraordinarioItemDto) => {
    const fecha = gasto.fecha_referencia
      ? new Date(gasto.fecha_referencia).toISOString().substring(0, 10)
      : '';

    return (
      <View key={gasto.id} style={styles.card}>
        <View style={styles.cardRowMain}>
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>{gasto.nombre}</Text>
            {gasto.categoria_nombre ? (
              <Text style={styles.cardSubtitle}>{gasto.categoria_nombre}</Text>
            ) : null}
          </View>
          <Text style={styles.cardAmountNegative}>
            {formatCurrency(gasto.importe)}
          </Text>
        </View>
        <View style={styles.cardRowMeta}>
          <Text style={styles.cardMetaLabel}>Último pago</Text>
          <Text style={styles.cardMetaValue}>{fecha}</Text>
        </View>
      </View>
    );
  };

  const renderIngresoCard = (ingreso: ExtraordinarioItemDto) => {
    const fecha = ingreso.fecha_referencia
      ? new Date(ingreso.fecha_referencia).toISOString().substring(0, 10)
      : '';

    return (
      <View key={ingreso.id} style={styles.card}>
        <View style={styles.cardRowMain}>
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>{ingreso.nombre}</Text>
            {ingreso.categoria_nombre ? (
              <Text style={styles.cardSubtitle}>{ingreso.categoria_nombre}</Text>
            ) : null}
          </View>
          <Text style={styles.cardAmountPositive}>
            {formatCurrency(ingreso.importe)}
          </Text>
        </View>
        <View style={styles.cardRowMeta}>
          <Text style={styles.cardMetaLabel}>Último cobro</Text>
          <Text style={styles.cardMetaValue}>{fecha}</Text>
        </View>
      </View>
    );
  };

  return (
    <>
      <Header
        title="Extraordinarios"
        subtitle="Gastos e ingresos fuera de lo habitual."
        showBack
        onBackPress={handleBack}
      />

      <View style={panelStyles.screen}>
        <View style={styles.summaryHeader}>
          <View style={styles.monthSelectorRow}>
            <TouchableOpacity
              style={styles.monthArrowButton}
              onPress={goToPrevMonth}
            >
              <Ionicons
                name="chevron-back"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            <Text style={styles.monthLabel}>{monthLabel}</Text>

            <TouchableOpacity
              style={styles.monthArrowButton}
              onPress={goToNextMonth}
            >
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Ingresos extraord.</Text>
              <Text style={[styles.summaryValue, styles.summaryPositive]}>
                {formatCurrency(totalIngresos)}
              </Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Gastos extraord.</Text>
              <Text style={[styles.summaryValue, styles.summaryNegative]}>
                {formatCurrency(totalGastos)}
              </Text>
            </View>
          </View>

          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Balance extraordinario</Text>
            <Text
              style={[
                styles.balanceValue,
                balance >= 0
                  ? styles.balancePositive
                  : styles.balanceNegative,
              ]}
            >
              {formatCurrency(balance)}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>
              Cargando extraordinarios…
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={panelStyles.scrollContent}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={onRefresh} />
            }
          >
            {error ? (
              <View style={panelStyles.section}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>
                Ingresos extraordinarios
              </Text>
              {ingresos.length === 0 ? (
                <Text style={styles.emptyText}>
                  No hay ingresos extraordinarios en este mes.
                </Text>
              ) : (
                ingresos.map(renderIngresoCard)
              )}
            </View>

            <View style={[panelStyles.section, { marginBottom: 24 }]}>
              <Text style={panelStyles.sectionTitle}>
                Gastos extraordinarios
              </Text>
              {gastos.length === 0 ? (
                <Text style={styles.emptyText}>
                  No hay gastos extraordinarios en este mes.
                </Text>
              ) : (
                gastos.map(renderGastoCard)
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
};

export default ExtraordinariosScreen;

const styles = StyleSheet.create({
  summaryHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  monthSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  monthArrowButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  monthLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'uppercase',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  summaryItem: {
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
  summaryPositive: {
    color: colors.success,
  },
  summaryNegative: {
    color: colors.danger,
  },
  balanceRow: {
    marginTop: 6,
  },
  balanceLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  balancePositive: {
    color: colors.success,
  },
  balanceNegative: {
    color: colors.danger,
  },

  loadingContainer: {
    flex: 1,
    paddingTop: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },

  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
  },
  cardRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardTextBlock: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  cardAmountNegative: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
  },
  cardAmountPositive: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
  cardRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  cardMetaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  cardMetaValue: {
    fontSize: 11,
    color: colors.textPrimary,
  },
});
