// mobile_app/screens/mes/resumenScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { getMonthlySummary } from '../../services/analyticsApi';
import type { MonthlySummaryResponse } from '../../types/analytics';
import { EuroformatEuro } from '../../utils/format';

// Helpers locales de formato
function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

// Si NO estás usando monthlySummaryStyles.ts aún, usa estos estilos mínimos
// y luego ya los refactorizamos juntos si quieres.
const styles = StyleSheet.create({
  // Loader centrado
  loaderCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  loaderText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },

  errorText: {
    fontSize: 13,
    color: colors.danger,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  sectionTitleRight: {
    fontSize: 11,
    color: colors.textSecondary,
  },

  rowSpaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  col: {
    flex: 1,
  },

  label: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valuePositive: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.success,
  },
  valueNegative: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
  },
  valueAccent: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  helperText: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
  },

  // Barras horizontales de distribución
  distRow: {
    marginTop: 8,
  },
  distHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  distLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  distValue: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  distBarBg: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  distBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  distBarFillAlt: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },

  // Run rate
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

  // Notas
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  noteIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  noteTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  noteMessage: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  emptyText: {
    marginTop: 4,
    fontSize: 12,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});

// -----------------------------
// Componente principal
// -----------------------------

const ResumenScreen: React.FC = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [data, setData] = useState<MonthlySummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const resp = await getMonthlySummary(); // año/mes actual por defecto
      setData(resp);
    } catch (err) {
      console.log('[ResumenScreen] Error cargando resumen mensual', err);
      setError('No se ha podido cargar el resumen mensual.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const general = data?.general;
  const detIng = data?.detalle_ingresos;
  const detGas = data?.detalle_gastos;

  return (
    <>
      <Header
        title="Resumen mensual"
        subtitleYear={year}
        subtitleMonth={month}
        subtitleMessage="Ingresos, gastos y run rate 12 meses."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {/* Error, si lo hay */}
          {error && (
            <View style={panelStyles.section}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Loader inicial */}
          {loading && !data && (
            <View style={panelStyles.section}>
              <View style={[panelStyles.card, styles.loaderCard]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loaderText}>Cargando resumen mensual...</Text>
              </View>
            </View>
          )}

          {/* Si ya tenemos datos, pintamos todas las tarjetas */}
          {data && (
            <>
              {/* 1) VISIÓN GENERAL */}
              <View style={panelStyles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={panelStyles.sectionTitle}>Visión general</Text>
                  <Text style={styles.sectionTitleRight}>{data.mes_label}</Text>
                </View>

                <View style={panelStyles.card}>
                  <View style={styles.rowSpaceBetween}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Ingresos del mes</Text>
                      <Text style={styles.valuePositive}>
                        {EuroformatEuro(general?.ingresos_mes ?? 0, 'plus')}
                      </Text>
                    </View>

                    <View style={styles.col}>
                      <Text style={styles.label}>Gastos del mes</Text>
                      <Text style={styles.valueNegative}>
                        {EuroformatEuro(general?.gastos_mes ?? 0, 'minus')}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.rowSpaceBetween, { marginTop: 10 }]}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Ahorro del mes</Text>
                      <Text
                        style={
                          (general?.ahorro_mes ?? 0) >= 0
                            ? styles.valuePositive
                            : styles.valueNegative
                        }
                      >
                        {EuroformatEuro(general?.ahorro_mes ?? 0, 'signed')}
                      </Text>
                    </View>

                    <View style={styles.col}>
                      <Text style={styles.label}>vs media 12m</Text>
                      <Text style={styles.value}>
                        Ing:{' '}
                        {fmtPct(general?.ingresos_vs_media_12m_pct)}
                      </Text>
                      <Text style={styles.value}>
                        Gas:{' '}
                        {fmtPct(general?.gastos_vs_media_12m_pct)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.helperText}>
                    Los porcentajes comparan este mes con la media de los últimos
                    12 cierres mensuales (ingresos y gastos reales).
                  </Text>
                </View>
              </View>

              {/* 2) DETALLE INGRESOS VS GASTOS */}
              <View style={panelStyles.section}>
                <Text style={panelStyles.sectionTitle}>
                  Detalle ingresos vs gastos
                </Text>

                <View style={panelStyles.card}>
                  <View style={styles.rowSpaceBetween}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Ingresos recurrentes</Text>
                      <Text style={styles.value}>
                        {EuroformatEuro(detIng?.recurrentes ?? 0, 'plus')}
                      </Text>
                      <Text style={styles.helperText}>
                        Ingresos activos con KPI, cobrados este mes.
                      </Text>
                    </View>

                    <View style={styles.col}>
                      <Text style={styles.label}>Ingresos extraordinarios</Text>
                      <Text style={styles.valueAccent}>
                        {EuroformatEuro(detIng?.extraordinarios ?? 0, 'plus')}
                      </Text>
                      <Text style={styles.helperText}>
                        {detIng?.num_extra ?? 0} ingreso(s) con periodicidad PAGO
                        ÚNICO este mes.
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.rowSpaceBetween, { marginTop: 12 }]}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Gastos gestionables rec.</Text>
                      <Text style={styles.value}>
                        {EuroformatEuro(detGas?.recurrentes ?? 0, 'minus')}
                      </Text>
                      <Text style={styles.helperText}>
                        Cuotas pagadas de gastos gestionables (no cotidianos).
                      </Text>
                    </View>

                    <View style={styles.col}>
                      <Text style={styles.label}>Gastos extraord. gestionables</Text>
                      <Text style={styles.valueNegative}>
                        {EuroformatEuro(detGas?.extraordinarios ?? 0, 'minus')}
                      </Text>
                      <Text style={styles.helperText}>
                        {detGas?.num_extra ?? 0} gasto(s) PAGO ÚNICO gestionable
                        este mes.
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 3) DISTRIBUCIÓN DE INGRESOS */}
              <View style={panelStyles.section}>
                <Text style={panelStyles.sectionTitle}>
                  Distribución de ingresos
                </Text>

                <View style={panelStyles.card}>
                  {data.distribucion_ingresos.map((item, idx) => (
                    <View key={idx} style={styles.distRow}>
                      <View style={styles.distHeaderRow}>
                        <Text style={styles.distLabel}>{item.label}</Text>
                        <Text style={styles.distValue}>
                          {EuroformatEuro(item.importe, 'plus')} ·{' '}
                          {item.porcentaje_sobre_total.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={styles.distBarBg}>
                        <View
                          style={[
                            styles.distBarFill,
                            {
                              width: `${Math.min(
                                100,
                                item.porcentaje_sobre_total,
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}

                  {data.distribucion_ingresos.length === 0 && (
                    <Text style={styles.emptyText}>
                      Aún no hay ingresos registrados para este mes.
                    </Text>
                  )}
                </View>
              </View>

              {/* 4) DISTRIBUCIÓN DE GASTOS */}
              <View style={panelStyles.section}>
                <Text style={panelStyles.sectionTitle}>
                  Distribución de gastos
                </Text>

                <View style={panelStyles.card}>
                  {data.distribucion_gastos.map((item, idx) => (
                    <View key={idx} style={styles.distRow}>
                      <View style={styles.distHeaderRow}>
                        <Text style={styles.distLabel}>{item.label}</Text>
                        <Text style={styles.distValue}>
                          {EuroformatEuro(item.importe, 'minus')} ·{' '}
                          {item.porcentaje_sobre_total.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={styles.distBarBg}>
                        <View
                          style={[
                            styles.distBarFillAlt,
                            {
                              width: `${Math.min(
                                100,
                                item.porcentaje_sobre_total,
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}

                  {data.distribucion_gastos.length === 0 && (
                    <Text style={styles.emptyText}>
                      Aún no hay gastos registrados para este mes.
                    </Text>
                  )}
                </View>
              </View>

              {/* 5) RUN RATE 12 MESES */}
              <View style={panelStyles.section}>
                <Text style={panelStyles.sectionTitle}>Run rate 12 meses</Text>

                <View style={panelStyles.card}>
                  {data.run_rate_12m ? (
                    <>
                      <View style={styles.kpiGrid}>
                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Ingreso medio 12m</Text>
                          <Text style={styles.value}>
                            {EuroformatEuro(
                              data.run_rate_12m.ingreso_medio_12m,
                              'plus',
                            )}
                          </Text>
                        </View>
                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Gasto medio 12m</Text>
                          <Text style={styles.valueNegative}>
                            {EuroformatEuro(
                              data.run_rate_12m.gasto_medio_12m,
                              'minus',
                            )}
                          </Text>
                        </View>
                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Ahorro medio 12m</Text>
                          <Text
                            style={
                              data.run_rate_12m.ahorro_medio_12m >= 0
                                ? styles.valuePositive
                                : styles.valueNegative
                            }
                          >
                            {EuroformatEuro(
                              data.run_rate_12m.ahorro_medio_12m,
                              'signed',
                            )}
                          </Text>
                        </View>
                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Proyección ahorro anual</Text>
                          <Text
                            style={
                              data.run_rate_12m.proyeccion_ahorro_anual >= 0
                                ? styles.valuePositive
                                : styles.valueNegative
                            }
                          >
                            {EuroformatEuro(
                              data.run_rate_12m.proyeccion_ahorro_anual,
                              'signed',
                            )}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.helperText}>
                        Basado en {data.run_rate_12m.meses_usados} cierre(s)
                        mensual(es). Si aún no hay 12 meses, se usa la media de
                        los disponibles.
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.emptyText}>
                      Aún no hay cierres mensuales suficientes para calcular el
                      run rate de 12 meses.
                    </Text>
                  )}
                </View>
              </View>

              {/* 6) NOTAS RÁPIDAS DEL MES */}
              <View style={[panelStyles.section, { marginBottom: 24 }]}>
                <Text style={panelStyles.sectionTitle}>Notas rápidas</Text>

                <View style={panelStyles.card}>
                  {data.notas.length === 0 && (
                    <Text style={styles.emptyText}>
                      No hay notas destacadas para este mes.
                    </Text>
                  )}

                  {data.notas.map((nota, idx) => {
                    let bg = colors.surface;
                    let border = colors.border;
                    let icon = 'ℹ️';

                    if (nota.tipo === 'WARNING') {
                      bg = '#FFF3E0';
                      border = '#FFB74D';
                      icon = '⚠️';
                    } else if (nota.tipo === 'SUCCESS') {
                      bg = '#E8F5E9';
                      border = '#81C784';
                      icon = '✅';
                    }

                    return (
                      <View key={idx} style={styles.noteRow}>
                        <View
                          style={[
                            styles.noteIcon,
                            {
                              backgroundColor: bg,
                              borderWidth: 0.5,
                              borderColor: border,
                            },
                          ]}
                        >
                          <Text style={{ fontSize: 12 }}>{icon}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.noteTitle}>{nota.titulo}</Text>
                          <Text style={styles.noteMessage}>{nota.mensaje}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </>
  );
};

export default ResumenScreen;
