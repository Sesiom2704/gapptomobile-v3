import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
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
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, returnToTab, returnToScreen]);

  // ✅ Mes actual por defecto
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth()); // 0-11

  const [data, setData] = useState<ExtraordinariosResponseDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plegables
  const [showIngresos, setShowIngresos] = useState(true);
  const [showGastos, setShowGastos] = useState(true);
  const [showOmitidos, setShowOmitidos] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiMonth = selectedMonth + 1; // backend 1-12
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

  // Totales
  const totalIngresos = data?.total_ingresos ?? 0;
  const totalGastosExtra = data?.total_gastos ?? 0;
  const totalGastosOmitidos = data?.total_gastos_omitidos ?? 0;

  // ✅ Balance según tu regla
  const balance = data?.balance ?? (totalIngresos + totalGastosOmitidos - totalGastosExtra);

  const gastosExtra = data?.gastos ?? [];
  const ingresosExtra = data?.ingresos ?? [];
  const gastosOmitidos = data?.gastos_omitidos ?? [];

  // --------------------------
  // Navegación a forms (punto 4)
  // --------------------------
  const navigateToGastoForm = useCallback(
    (item: ExtraordinarioItemDto, preset?: 'extra') => {
      navigation.navigate('DayToDayTab', {
        screen: 'GastoGestionableForm',
        params: {
          gasto: {
            id: item.id,
            nombre: item.nombre,
            tipo_id: item.tipo_id ?? null,
            segmento_id: item.segmento_id ?? null,
            proveedor_id: item.proveedor_id ?? null,
            cuenta_id: item.cuenta_id ?? null,
            referencia_vivienda_id: item.referencia_vivienda_id ?? null,
            periodicidad: item.periodicidad ?? null,
            importe: item.importe,
            importe_cuota: item.importe_cuota ?? null,
            cuotas: item.cuotas ?? null,
            fecha: item.fecha ?? null,
            rango_pago: item.rango_pago ?? null,
            activo: item.activo,
            pagado: item.pagado ?? false,
            kpi: item.kpi,
            comentarios: item.comentarios ?? null,
          },
          preset: preset,
          returnToTab: 'MonthTab',
          returnToScreen: 'MonthExtraordinariosScreen',
        },
      });
    },
    [navigation]
  );

  const navigateToIngresoForm = useCallback(
    (item: ExtraordinarioItemDto) => {
      navigation.navigate('DayToDayTab', {
        screen: 'IngresoForm',
        params: {
          mode: 'extraordinario',
          ingreso: {
            id: item.id,
            concepto: item.nombre,
            tipo_id: item.tipo_id ?? null,
            cuenta_id: item.cuenta_id ?? null,
            referencia_vivienda_id: item.referencia_vivienda_id ?? null,
            periodicidad: item.periodicidad ?? 'PAGO UNICO',
            importe: item.importe,
            fecha_inicio: item.fecha_inicio ?? null,
            rango_cobro: item.rango_cobro ?? null,
            activo: item.activo,
            cobrado: item.cobrado ?? false,
            kpi: item.kpi,
            ultimo_ingreso_on: item.fecha_referencia,
          },
          returnToTab: 'MonthTab',
          returnToScreen: 'MonthExtraordinariosScreen',
        },
      });
    },
    [navigation]
  );

  // --------------------------
  // Render cards
  // --------------------------
  const renderGastoCard = (gasto: ExtraordinarioItemDto, onPress: () => void) => {
    const fecha = gasto.fecha_referencia
      ? new Date(gasto.fecha_referencia).toISOString().substring(0, 10)
      : '';

    return (
      <TouchableOpacity key={gasto.id} style={styles.card} activeOpacity={0.85} onPress={onPress}>
        <View style={styles.cardRowMain}>
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>{gasto.nombre}</Text>
            {gasto.categoria_nombre ? (
              <Text style={styles.cardSubtitle}>{gasto.categoria_nombre}</Text>
            ) : null}
          </View>
          <Text style={styles.cardAmountNegative}>{formatCurrency(gasto.importe)}</Text>
        </View>
        <View style={styles.cardRowMeta}>
          <Text style={styles.cardMetaLabel}>Referencia</Text>
          <Text style={styles.cardMetaValue}>{fecha}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderIngresoCard = (ingreso: ExtraordinarioItemDto) => {
    const fecha = ingreso.fecha_referencia
      ? new Date(ingreso.fecha_referencia).toISOString().substring(0, 10)
      : '';

    return (
      <TouchableOpacity
        key={ingreso.id}
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigateToIngresoForm(ingreso)}
      >
        <View style={styles.cardRowMain}>
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>{ingreso.nombre}</Text>
            {ingreso.categoria_nombre ? (
              <Text style={styles.cardSubtitle}>{ingreso.categoria_nombre}</Text>
            ) : null}
          </View>
          <Text style={styles.cardAmountPositive}>{formatCurrency(ingreso.importe)}</Text>
        </View>
        <View style={styles.cardRowMeta}>
          <Text style={styles.cardMetaLabel}>Último cobro</Text>
          <Text style={styles.cardMetaValue}>{fecha}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const SectionHeader = ({
    title,
    open,
    onToggle,
    rightText,
  }: {
    title: string;
    open: boolean;
    onToggle: () => void;
    rightText?: string;
  }) => {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          animateToggle();
          onToggle();
        }}
        style={styles.sectionHeaderRow}
      >
        <View style={styles.sectionHeaderLeft}>
          <Ionicons
            name={open ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textSecondary}
          />
          <Text style={panelStyles.sectionTitle}>{title}</Text>
        </View>

        {rightText ? <Text style={styles.sectionHeaderRight}>{rightText}</Text> : null}
      </TouchableOpacity>
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
            <TouchableOpacity style={styles.monthArrowButton} onPress={goToPrevMonth}>
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <Text style={styles.monthLabel}>{monthLabel}</Text>

            <TouchableOpacity style={styles.monthArrowButton} onPress={goToNextMonth}>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Resumen superior: 3 columnas en la misma fila */}
          <View style={styles.summaryRow3}>
            <View style={styles.summaryItemCentered}>
              <Text style={styles.summaryLabel}>Ingresos extraord.</Text>
              <Text style={[styles.summaryValue, styles.summaryPositive]}>
                {formatCurrency(totalIngresos)}
              </Text>
            </View>

            <View style={styles.summaryItemCentered}>
              <Text style={styles.summaryLabel}>Gastos extraord.</Text>
              <Text style={[styles.summaryValue, styles.summaryNegative]}>
                {formatCurrency(totalGastosExtra)}
              </Text>
            </View>

            <View style={styles.summaryItemCentered}>
              <Text style={styles.summaryLabel}>Gastos omitidos</Text>
              <Text style={[styles.summaryValue, styles.summaryOmitidos]}>
                {formatCurrency(totalGastosOmitidos)}
              </Text>
            </View>
          </View>

          {/* Balance debajo, centrado y más grande */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabelBig}>Balance extraordinario</Text>
            <Text
              style={[
                styles.balanceValueBig,
                balance >= 0 ? styles.balancePositive : styles.balanceNegative,
              ]}
            >
              {formatCurrency(balance)}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando extraordinarios…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={panelStyles.scrollContent}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
          >
            {error ? (
              <View style={panelStyles.section}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={panelStyles.section}>
              <SectionHeader
                title="Ingresos extraordinarios"
                open={showIngresos}
                onToggle={() => setShowIngresos((v) => !v)}
                rightText={formatCurrency(totalIngresos)}
              />
              {showIngresos ? (
                ingresosExtra.length === 0 ? (
                  <Text style={styles.emptyText}>No hay ingresos extraordinarios en este mes.</Text>
                ) : (
                  ingresosExtra.map(renderIngresoCard)
                )
              ) : null}
            </View>

            <View style={panelStyles.section}>
              <SectionHeader
                title="Gastos extraordinarios"
                open={showGastos}
                onToggle={() => setShowGastos((v) => !v)}
                rightText={formatCurrency(totalGastosExtra)}
              />
              {showGastos ? (
                gastosExtra.length === 0 ? (
                  <Text style={styles.emptyText}>No hay gastos extraordinarios en este mes.</Text>
                ) : (
                  gastosExtra.map((g) =>
                    renderGastoCard(g, () => navigateToGastoForm(g, 'extra'))
                  )
                )
              ) : null}
            </View>

            <View style={[panelStyles.section, { marginBottom: 24 }]}>
              <SectionHeader
                title="Gastos omitidos"
                open={showOmitidos}
                onToggle={() => setShowOmitidos((v) => !v)}
                rightText={formatCurrency(totalGastosOmitidos)}
              />
              {showOmitidos ? (
                gastosOmitidos.length === 0 ? (
                  <Text style={styles.emptyText}>No hay gastos omitidos en este mes.</Text>
                ) : (
                  gastosOmitidos.map((g) => renderGastoCard(g, () => navigateToGastoForm(g)))
                )
              ) : null}
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
  summaryRow3: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },

  summaryItemCentered: {
    flex: 1,
    alignItems: 'center',
  },

  summaryOmitidos: {
    // Amarillo-naranja (si tienes colors.warning úsalo)
    color: '#f59e0b',
  },

  balanceBlock: {
    marginTop: 10,
    alignItems: 'center',
  },

  balanceLabelBig: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
    textAlign: 'center',
    fontWeight: '700',
  },

  balanceValueBig: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
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

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginBottom: 6,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderRight: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
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