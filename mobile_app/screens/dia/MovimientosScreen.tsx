/**
 * Archivo: screens/dia/MovimientosScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de consulta de movimientos del mes (cobros y pagos ya realizados).
 *   - Muestra un resumen del mes (ingresos, gastos, balance) y un listado de movimientos.
 *
 * Maneja:
 *   - UI: Header + resumen fijo en card + listado en ScrollView con pull-to-refresh.
 *   - Estado: local (useState) para data, loading, refreshing y error.
 *   - Datos:
 *       - Lectura: fetchMovimientosMes (incluye totales y array de movimientos).
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
 *       - Pull-to-refresh: recarga de movimientos.
 *       - Render condicional de estados: loading, error, vacío.
 *
 * Dependencias clave:
 *   - UI interna: Header, panelStyles
 *   - Tema: colors
 *   - Utilidades: EuroformatEuro, formatFechaCorta
 *   - Iconos: Ionicons
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (fila de movimiento: icono positivo/negativo + título/subtítulo + importe).
 *   - Riesgos: estilos duplicados en filas entre pantallas; conviene unificar en un componente base (ListRow).
 *
 * Notas de estilo:
 *   - Centralizar estilos repetidos (importe, icono circular, tipografías) para mantener coherencia visual en listados.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { ListRow } from '../../components/ui/ListRow';
import { IconCircle } from '../../components/ui/IconCircle';

// API
import {
  fetchMovimientosMes,
  MovimientosMesResponse,
  MovimientoItem,
} from '../../services/movimientosApi';

// NUEVO → formato unificado
import { EuroformatEuro, formatFechaCorta } from '../../utils/format';

type RouteParams = {
  // compat: algunos sitios ya usan esto
  fromHome?: boolean;

  // nuevo patrón: volver exacto al sitio de origen
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string; // screen interno del stack/tab
  returnParams?: Record<string, any>;
};

const MovimientosScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const params: RouteParams = route?.params ?? {};

  const [data, setData] = useState<MovimientosMesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const cargarMovimientos = useCallback(
    async (isRefresh: boolean = false) => {
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        setError(null);
        const response = await fetchMovimientosMes();
        setData(response);
      } catch (e) {
        console.error('[MovimientosScreen] Error cargando movimientos', e);
        setError('No se han podido cargar los movimientos.');
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    cargarMovimientos();
  }, [cargarMovimientos]);

  const onRefresh = useCallback(() => {
    cargarMovimientos(true);
  }, [cargarMovimientos]);

  // ✅ Back: vuelve al origen si viene indicado; si no, goBack normal
  const handleBack = useCallback(() => {
    // Compatibilidad antigua: si venías del Home y no hay returnTo, vuelve a HomeTab
    if (!params.returnToTab && params.fromHome) {
      navigation.navigate('HomeTab');
      return;
    }

    // Nuevo patrón: vuelta “exacta”
    if (params.returnToTab) {
      // Si además se indica screen interno, navega al stack correspondiente
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

    // Fallback estándar
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('HomeTab');
    }
  }, [navigation, params]);

  // Etiquetas de tipo de movimiento
  const getTipoLabel = (tipo: MovimientoItem['tipo']) => {
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

  const year = data?.year;
  const month = data?.month;
  const totalIngresos = data?.total_ingresos ?? 0;
  const totalGastos = data?.total_gastos ?? 0;
  const balance = data?.balance ?? 0;
  const movimientos = data?.movimientos ?? [];

  return (
    <>
      <Header
        title="Movimientos del mes"
        subtitle={
          year && month
            ? `Cobros y pagos realizados en ${month.toString().padStart(2, '0')}/${year}.`
            : 'Cobros y pagos que ya se han realizado este mes.'
        }
        showBack
        onBackPress={() => {
          const returnToTab = route?.params?.returnToTab;
          const returnToScreen = route?.params?.returnToScreen;

          if (returnToTab) {
            navigation.navigate(returnToTab, returnToScreen ? { screen: returnToScreen } : undefined);
            return;
          }

          if (navigation.canGoBack()) navigation.goBack();
        }}
      />

      <View style={panelStyles.screen}>
        {/* 🔹 RESUMEN FIJO */}
        {data && (
          <View style={[panelStyles.section, { paddingBottom: 8 }]}>
            <View style={panelStyles.card}>
              <Text style={panelStyles.cardTitle}>Resumen del mes</Text>
              <Text style={panelStyles.cardSubtitle}>
                Ingresos cobrados, gastos pagados y balance neto.
              </Text>

              <View style={styles.summaryRow}>
                {/* INGRESOS */}
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

                {/* GASTOS */}
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

              {/* BALANCE */}
              <View style={[styles.balanceRow, { marginTop: 12 }]}>
                <View>
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

        {/* 🔹 LISTA DE MOVIMIENTOS */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Loading inicial */}
          {loading && !data && !error && (
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: colors.textSecondary,
                }}
              >
                Cargando movimientos...
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={panelStyles.section}>
              <View style={panelStyles.card}>
                <Text style={{ color: colors.danger, fontSize: 13 }}>
                  {error}
                </Text>
              </View>
            </View>
          )}

          {/* LISTADO */}
          {data && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>Movimientos</Text>

              <View style={panelStyles.card}>
                {movimientos.length === 0 && (
                  <Text
                    style={{
                      fontSize: 13,
                      color: colors.textSecondary,
                      textAlign: 'center',
                      paddingVertical: 8,
                    }}
                  >
                    No hay movimientos registrados en este mes.
                  </Text>
                )}

                {movimientos.map((m) => {
                  const isPositive = m.es_ingreso;

                  return (
                    <ListRow
                      key={m.id}
                      left={
                        <IconCircle
                          name={isPositive ? 'arrow-down-outline' : 'arrow-up-outline'}
                          diameter={28}
                          size={16}
                          backgroundColor={isPositive ? colors.success : colors.danger}
                          iconColor="#fff"
                        />
                      }
                      title={(m.descripcion ?? '').toUpperCase()}
                      subtitle={`${formatFechaCorta(m.fecha)} · ${
                        m.cuenta_nombre || m.cuenta_id || 'SIN CUENTA'
                      } · ${getTipoLabel(m.tipo)}`}
                      right={
                        <Text
                          style={[
                            styles.amountBase,
                            isPositive ? styles.amountPositive : styles.amountNegative,
                          ]}
                        >
                          {EuroformatEuro(m.importe, isPositive ? 'plus' : 'minus')}
                        </Text>
                      }
                      showDivider={false} // si quieres divider dentro del card, pon true y quita padding extra
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

// ========================= STYLES ===========================

const styles = StyleSheet.create({
  // =========================
  // Resumen
  // =========================
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

  // Nota: en tu código ambos círculos son iguales -> uno solo reutilizable.
  summaryIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  summaryTextBlock: { flex: 1 },
  summaryLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  summaryDelta: { marginTop: 2, fontSize: 11, color: colors.textMuted },

  // =========================
  // Balance
  // =========================
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
  positive: { color: colors.success },
  negative: { color: colors.danger },

  // =========================
  // Movimientos (para ListRow)
  // =========================
  amountBase: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },

  /**
   * Si ya migraste el listado a <ListRow />, estos estilos antiguos sobran:
   * - movementRow
   * - movementIconCircle / movementIconCirclePositive/Negative
   * - movementTextContainer / movementTitle / movementSubtitle
   *
   * Si todavía NO migraste, deja los antiguos de momento.
   */
});

