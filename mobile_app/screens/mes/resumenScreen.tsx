/**
 * Archivo: mobile_app/screens/mes/resumenScreen.tsx
 *
 * Cambios solicitados:
 * - El Info de "vs media 12m" debe ser EXACTAMENTE el mismo patrón que PropiedadKpisScreen:
 *   - Icono Ionicons "information-circle-outline"
 *   - Modal con Pressable backdrop + card
 *   - Cierre con X o tocando fuera
 *   - Sin botón "Entendido"
 *
 * - vs media 12m vuelve al layout anterior:
 *   - "Ingresos:" y debajo "Gastos:"
 *
 * - Regla color:
 *   - % negativo = verde (mejor que la media)
 *   - % positivo = rojo (peor que la media)
 *
 * - Se mantiene eliminado el mes/año (mes_label) del header de "Visión general".
 * - "Notas rápidas" -> "Alertas e Insight".
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { getMonthlySummary } from '../../services/analyticsApi';
import type { MonthlySummaryResponse } from '../../types/analytics';
import { EuroformatEuro } from '../../utils/format';

// Mantengo InfoButton/InfoModal para el resto de secciones (si lo estabas usando ya)
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

/**
 * Formateo de porcentaje:
 * - Usa coma decimal (es-ES): 12.3 -> 12,3
 * - Si es entero (ej -100.0), muestra sin decimal: -100%
 * - Si no, 1 decimal: -97,9%
 * - Mantiene signo + para positivos
 */
function fmtPctEs(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—';

  const rounded1 = Math.round(value * 10) / 10;
  const isInt = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;

  const sign = rounded1 > 0 ? '+' : '';
  const numStr = isInt ? `${Math.round(rounded1)}` : `${rounded1.toFixed(1)}`;

  return `${sign}${numStr.replace('.', ',')}%`;
}

/**
 * Regla de color solicitada:
 * - Negativo = verde (mejor que la media)
 * - Positivo = rojo (peor que la media)
 * - 0 / null -> neutro
 */
function pctStyle(value: number | null | undefined) {
  if (value === null || value === undefined || isNaN(value)) return styles.pctNeutral;
  if (value < 0) return styles.pctGood; // negativo => verde
  if (value > 0) return styles.pctBad;  // positivo => rojo
  return styles.pctNeutral;
}

// Textos de ayuda
const INFO: Record<string, string> = {
  vision_general: 'Resumen del mes: ingresos, gastos y ahorro.',
  vs_media_12m:
    'Los porcentajes comparan este mes con la media de los últimos 12 cierres mensuales (ingresos y gastos reales).',
  detalle_ing_gas:
    'Separación entre importes recurrentes (activos) y extraordinarios (pago único) tanto en ingresos como en gastos.',
  distrib_ing:
    'Distribución porcentual de ingresos por categoría para el mes seleccionado. La barra representa % sobre el total.',
  distrib_gas:
    'Distribución porcentual de gastos por categoría para el mes seleccionado. La barra representa % sobre el total.',
  run_rate:
    'Estimación anualizada basada en la media de cierres mensuales disponibles (hasta 12 meses).',
  alertas:
    'Alertas e insight generados a partir de patrones del mes (warnings, éxitos o informativas).',
};

const styles = StyleSheet.create({
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

  // Cabecera de sección: título a la izquierda, botón "i" a la derecha
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
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
    fontSize: 14,
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

  // ✅ Bloque "vs media 12m" (label + icono) — mismo patrón que PropiedadKpisScreen
  vs12LabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },

  // Estilos para el % según regla solicitada
  pctGood: { color: colors.success, fontWeight: '700' },   // negativo
  pctBad: { color: colors.danger, fontWeight: '700' },     // positivo
  pctNeutral: { color: colors.textPrimary, fontWeight: '600' },

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

  // ✅ Modal estilo PropiedadKpisScreen (cerrar con X o fuera)
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#0007',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  modalText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
});

const ResumenScreen: React.FC = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [data, setData] = useState<MonthlySummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Mantengo el modal reusable para otras secciones (si lo estabas usando)
  const info = useInfoModal();

  // ✅ Modal específico para "vs media 12m" con el MISMO patrón que PropiedadKpisScreen
  const [vsInfoOpen, setVsInfoOpen] = useState(false);
  const [vsInfoTitle, setVsInfoTitle] = useState('');
  const [vsInfoText, setVsInfoText] = useState('');

  const openVsInfo = () => {
    setVsInfoTitle('vs media 12m');
    setVsInfoText(INFO.vs_media_12m);
    setVsInfoOpen(true);
  };

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
          {error && (
            <View style={panelStyles.section}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {loading && !data && (
            <View style={panelStyles.section}>
              <View style={[panelStyles.card, styles.loaderCard]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loaderText}>Cargando resumen mensual...</Text>
              </View>
            </View>
          )}

          {data && (
            <>
              {/* 1) VISIÓN GENERAL */}
              <View style={panelStyles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={panelStyles.sectionTitle}>Visión general</Text>

                  {/* ✅ Sin mes_label (mes/año). Mantengo Info general con el sistema reusable */}
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Visión general', INFO.vision_general)}
                  />
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

                    {/* ✅ vs media 12m: layout "Ingresos" encima y "Gastos" debajo
                        ✅ Info icon + modal EXACTO como PropiedadKpisScreen */}
                    <View style={styles.col}>
                      <View style={styles.vs12LabelRow}>
                        <Text style={styles.label}>vs media 12m</Text>

                        <TouchableOpacity onPress={openVsInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons
                            name="information-circle-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.value}>
                        Ingresos:{' '}
                        <Text style={[styles.value, pctStyle(general?.ingresos_vs_media_12m_pct)]}>
                          {fmtPctEs(general?.ingresos_vs_media_12m_pct)}
                        </Text>
                      </Text>

                      <Text style={styles.value}>
                        Gastos:{' '}
                        <Text style={[styles.value, pctStyle(general?.gastos_vs_media_12m_pct)]}>
                          {fmtPctEs(general?.gastos_vs_media_12m_pct)}
                        </Text>
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 2) DETALLE INGRESOS VS GASTOS */}
              <View style={panelStyles.section}>
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={panelStyles.sectionTitle}>Detalle ingresos vs gastos</Text>
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Detalle ingresos vs gastos', INFO.detalle_ing_gas)}
                  />
                </View>

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
                        {detIng?.num_extra ?? 0} ingreso(s) con periodicidad PAGO ÚNICO este mes.
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
                        {detGas?.num_extra ?? 0} gasto(s) PAGO ÚNICO gestionable este mes.
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 3) DISTRIBUCIÓN DE INGRESOS */}
              <View style={panelStyles.section}>
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={panelStyles.sectionTitle}>Distribución de ingresos</Text>
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Distribución de ingresos', INFO.distrib_ing)}
                  />
                </View>

                <View style={panelStyles.card}>
                  {data.distribucion_ingresos.map((item, idx) => (
                    <View key={idx} style={styles.distRow}>
                      <View style={styles.distHeaderRow}>
                        <Text style={styles.distLabel}>{item.label}</Text>
                        <Text style={styles.distValue}>
                          {EuroformatEuro(item.importe, 'plus')} · {item.porcentaje_sobre_total.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={styles.distBarBg}>
                        <View
                          style={[
                            styles.distBarFill,
                            { width: `${Math.min(100, item.porcentaje_sobre_total)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ))}

                  {data.distribucion_ingresos.length === 0 && (
                    <Text style={styles.emptyText}>Aún no hay ingresos registrados para este mes.</Text>
                  )}
                </View>
              </View>

              {/* 4) DISTRIBUCIÓN DE GASTOS */}
              <View style={panelStyles.section}>
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={panelStyles.sectionTitle}>Distribución de gastos</Text>
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Distribución de gastos', INFO.distrib_gas)}
                  />
                </View>

                <View style={panelStyles.card}>
                  {data.distribucion_gastos.map((item, idx) => (
                    <View key={idx} style={styles.distRow}>
                      <View style={styles.distHeaderRow}>
                        <Text style={styles.distLabel}>{item.label}</Text>
                        <Text style={styles.distValue}>
                          {EuroformatEuro(item.importe, 'minus')} · {item.porcentaje_sobre_total.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={styles.distBarBg}>
                        <View
                          style={[
                            styles.distBarFillAlt,
                            { width: `${Math.min(100, item.porcentaje_sobre_total)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ))}

                  {data.distribucion_gastos.length === 0 && (
                    <Text style={styles.emptyText}>Aún no hay gastos registrados para este mes.</Text>
                  )}
                </View>
              </View>

              {/* 5) RUN RATE 12 MESES */}
              <View style={panelStyles.section}>
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={panelStyles.sectionTitle}>Run rate 12 meses</Text>
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Run rate 12 meses', INFO.run_rate)}
                  />
                </View>

                <View style={panelStyles.card}>
                  {data.run_rate_12m ? (
                    <>
                      <View style={styles.kpiGrid}>
                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Ingreso medio 12m</Text>
                          <Text style={styles.value}>
                            {EuroformatEuro(data.run_rate_12m.ingreso_medio_12m, 'plus')}
                          </Text>
                        </View>

                        <View style={styles.kpiCell}>
                          <Text style={styles.label}>Gasto medio 12m</Text>
                          <Text style={styles.valueNegative}>
                            {EuroformatEuro(data.run_rate_12m.gasto_medio_12m, 'minus')}
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
                            {EuroformatEuro(data.run_rate_12m.ahorro_medio_12m, 'signed')}
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
                            {EuroformatEuro(data.run_rate_12m.proyeccion_ahorro_anual, 'signed')}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.helperText}>
                        Basado en {data.run_rate_12m.meses_usados} cierre(s) mensual(es).
                        Si aún no hay 12 meses, se usa la media de los disponibles.
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.emptyText}>
                      Aún no hay cierres mensuales suficientes para calcular el run rate de 12 meses.
                    </Text>
                  )}
                </View>
              </View>

              {/* 6) ALERTAS E INSIGHT */}
              <View style={[panelStyles.section, { marginBottom: 24 }]}>
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={panelStyles.sectionTitle}>Alertas e Insight</Text>
                  <InfoButton
                    align="title"
                    onPress={() => info.open('Alertas e Insight', INFO.alertas)}
                  />
                </View>

                <View style={panelStyles.card}>
                  {data.notas.length === 0 && (
                    <Text style={styles.emptyText}>No hay notas destacadas para este mes.</Text>
                  )}

                  {data.notas.map((nota, idx) => {
                    let bg: string = colors.surface;
                    let border: string = colors.border;
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

      {/* ✅ Modal reusable (resto secciones) */}
      <InfoModal
        visible={info.visible}
        title={info.title}
        text={info.text}
        onClose={info.close}
      />

      {/* ✅ Modal vs media 12m (MISMO patrón que PropiedadKpisScreen) */}
      <Modal
        visible={vsInfoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setVsInfoOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setVsInfoOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{vsInfoTitle}</Text>
              <Pressable onPress={() => setVsInfoOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalText}>{vsInfoText}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default ResumenScreen;
