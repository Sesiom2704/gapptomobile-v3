// mobile_app/screens/cierres/CierreKpiScreen.tsx
// -----------------------------------------------------------------------------
// KPIs de cierres (visión general):
// - 1 llamada: GET /api/v1/cierre_mensual/kpis?limit=12
// - Si no hay 12 meses, calcula sobre lo que exista.
// - Muestra:
//   1) Resumen con mini-tarjetas (estilo Home).
//   2) Tendencia (LineChart): FILTRABLE por Resultado / Ingresos / Gastos.
//      - Tooltip al pulsar un punto (mes + importe).
//   3) Comparativa mensual (barras tappable): Ingresos vs Gastos por mes.
//      - Tooltip al pulsar una barra (mes + importe).
//   4) Por segmentos (LineChart): Real por segmento (Cotidianos / Viviendas / Gestionables).
//      - Tooltip al pulsar un punto (mes + importe + segmento).
//
// Importante:
// - BarChart de chart-kit no ofrece tap fiable/typed en cada barra.
//   -> usamos barras nativas (Views) para interacción robusta.
// -----------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { cierreMensualApi, CierreMensual, CierreMensualDetalle } from '../../services/cierreMensualApi';
import { EuroformatEuro } from '../../utils/format';

// --------------------
// Tipos locales
// --------------------
type CierreMensualKpisResponse = {
  limit: number;
  count: number;
  cierres: CierreMensual[];
  detalles: CierreMensualDetalle[];
};

type TrendMetric = 'resultado' | 'ingresos' | 'gastos';

type TooltipBase = {
  visible: boolean;
  label: string;
  value: number;
};

type TrendTooltip = TooltipBase & {
  x: number;
  y: number;
  metric: TrendMetric;
};

type SegTooltip = TooltipBase & {
  x: number;
  y: number;
  segmentLabel: 'Cotidianos' | 'Viviendas' | 'Gestionables';
};

type BarSelected = {
  key: string; // `${idx}-${kind}`
  idx: number;
  kind: 'ingresos' | 'gastos';
};

// --------------------
// Helpers
// --------------------
function safeNum(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function periodLabel(c: { anio: number; mes: number }) {
  const yy = String(c.anio % 100).padStart(2, '0');
  return `${c.mes}/${yy}`; // "12/25"
}

function groupDetallesByCierre(detalles: CierreMensualDetalle[]) {
  const map = new Map<string, CierreMensualDetalle[]>();
  for (const d of detalles) {
    const key = String(d.cierre_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return map;
}

function findDetalle(detalles: CierreMensualDetalle[] | undefined, tipo: string) {
  if (!detalles) return undefined;
  return detalles.find((x) => String(x.tipo_detalle || '').toUpperCase() === tipo.toUpperCase());
}

function metricTitle(m: TrendMetric) {
  if (m === 'resultado') return 'Resultado real por mes';
  if (m === 'ingresos') return 'Ingresos reales por mes';
  return 'Gastos reales por mes';
}

function metricSubtitle(m: TrendMetric) {
  if (m === 'resultado') return 'Línea con el resultado real de cada cierre.';
  if (m === 'ingresos') return 'Línea con los ingresos reales de cada cierre.';
  return 'Línea con los gastos reales (valor absoluto) de cada cierre.';
}

function formatMetricValue(value: number, m: TrendMetric) {
  if (m === 'ingresos') return EuroformatEuro(value, 'plus');
  if (m === 'gastos') return EuroformatEuro(-Math.abs(value), 'minus'); // mostrado como gasto
  return EuroformatEuro(value, 'signed');
}

function formatBarValue(value: number, kind: 'ingresos' | 'gastos') {
  return kind === 'ingresos' ? EuroformatEuro(value, 'plus') : EuroformatEuro(-Math.abs(value), 'minus');
}

// --------------------
// Chart config (base)
// --------------------
const chartConfig: any = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(42, 158, 159, ${opacity})`, // primary
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // textSecondary
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: colors.primary,
  },
};

// -----------------------------------------------------------------------------
// Componente: Barras tappable (Ingresos vs Gastos)
// - Dos barras por mes (ingresos y gastos abs).
// - Tooltip anclado dentro de la columna seleccionada.
// -----------------------------------------------------------------------------
function TappableBarsComparativa(props: {
  labels: string[];
  ingresos: number[];
  gastosAbs: number[];
  maxWidth: number;
}) {
  const { labels, ingresos, gastosAbs, maxWidth } = props;

  const [selected, setSelected] = useState<BarSelected | null>(null);

  const itemW = 56; // ancho por mes
  const chartH = 220; // alto área de barras
  const barW = 16;
  const gapBars = 10;

  const contentW = Math.max(maxWidth, labels.length * itemW);

  const maxVal = useMemo(() => {
    const m1 = Math.max(0, ...ingresos.map((x) => Math.abs(x)));
    const m2 = Math.max(0, ...gastosAbs.map((x) => Math.abs(x)));
    return Math.max(m1, m2, 1);
  }, [ingresos, gastosAbs]);

  const heightFor = (v: number) => Math.max(4, Math.round((Math.abs(v) / maxVal) * (chartH - 28)));

  const selectedInfo = useMemo(() => {
    if (!selected) return null;
    const idx = selected.idx;
    const label = labels[idx] ?? '';
    const value = selected.kind === 'ingresos' ? ingresos[idx] ?? 0 : gastosAbs[idx] ?? 0;
    return { label, value, kind: selected.kind };
  }, [selected, labels, ingresos, gastosAbs]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ width: contentW, paddingTop: 8, paddingBottom: 4 }}>
        <View style={[stylesBars.chartArea, { height: chartH }]}>
          {labels.map((lab, idx) => {
            const ing = ingresos[idx] ?? 0;
            const gas = gastosAbs[idx] ?? 0;

            const hIng = heightFor(ing);
            const hGas = heightFor(gas);

            const keyIng = `${idx}-ingresos`;
            const keyGas = `${idx}-gastos`;
            const isIngSelected = selected?.key === keyIng;
            const isGasSelected = selected?.key === keyGas;

            return (
              <View key={`${lab}-${idx}`} style={[stylesBars.col, { width: itemW }]}>
                {/* Tooltip por columna (se muestra arriba dentro del área) */}
                {(isIngSelected || isGasSelected) && selectedInfo && (
                  <View style={stylesBars.tooltip}>
                    <Text style={stylesBars.tooltipLabel}>{selectedInfo.label}</Text>
                    <Text style={stylesBars.tooltipValue}>{formatBarValue(selectedInfo.value, selectedInfo.kind)}</Text>
                  </View>
                )}

                <View style={stylesBars.barsRow}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setSelected({ key: keyIng, idx, kind: 'ingresos' })}
                    style={[
                      stylesBars.bar,
                      {
                        width: barW,
                        height: hIng,
                        backgroundColor: colors.primary,
                        opacity: isIngSelected ? 1 : 0.85,
                      },
                    ]}
                  />
                  <View style={{ width: gapBars }} />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setSelected({ key: keyGas, idx, kind: 'gastos' })}
                    style={[
                      stylesBars.bar,
                      {
                        width: barW,
                        height: hGas,
                        backgroundColor: colors.textSecondary,
                        opacity: isGasSelected ? 1 : 0.75,
                      },
                    ]}
                  />
                </View>

                <Text style={stylesBars.xLabel} numberOfLines={1}>
                  {lab}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendChip}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>Ingresos</Text>
          </View>
          <View style={styles.legendChip}>
            <View style={[styles.legendDot, { backgroundColor: colors.textSecondary }]} />
            <Text style={styles.legendText}>Gastos</Text>
          </View>
        </View>

        <Text style={[panelStyles.cardSubtitle, { marginTop: 8 }]}>
          Tip: toca una barra para ver el importe exacto.
        </Text>
      </View>
    </ScrollView>
  );
}

const CierreKpiScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<CierreMensualKpisResponse | null>(null);

  // Filtro para tendencia
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('resultado');

  // Tooltips
  const [trendTip, setTrendTip] = useState<TrendTooltip>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    value: 0,
    metric: 'resultado',
  });

  const [segTip, setSegTip] = useState<SegTooltip>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    value: 0,
    segmentLabel: 'Cotidianos',
  });

  const width = Dimensions.get('window').width;
  const chartWidth = Math.max(360, width - 24);
  const chartHeightLine = 220;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await cierreMensualApi.kpis({ limit: 12 })) as CierreMensualKpisResponse;
      setResp(data ?? null);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los KPIs.');
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cierresAsc = useMemo(() => {
    const cierres = resp?.cierres ?? [];
    const copy = [...cierres];
    copy.sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
    return copy;
  }, [resp]);

  const detallesByCierreId = useMemo(() => groupDetallesByCierre(resp?.detalles ?? []), [resp]);

  const resumen = useMemo(() => {
    const cierres = cierresAsc;
    const n = cierres.length;

    let ingresos = 0;
    let gastos = 0;
    let resultado = 0;
    let desv = 0;

    for (const c of cierres) {
      ingresos += safeNum(c.ingresos_reales);
      gastos += safeNum(c.gastos_reales_total);
      resultado += safeNum(c.resultado_real);
      desv += safeNum(c.desv_resultado);
    }

    const resultadoMedio = n ? resultado / n : 0;
    const desvMedia = n ? desv / n : 0;

    const trendResultado =
      n >= 2 ? safeNum(cierres[n - 1].resultado_real) - safeNum(cierres[0].resultado_real) : 0;

    return { n, ingresos, gastos, resultado, desv, resultadoMedio, desvMedia, trendResultado };
  }, [cierresAsc]);

  const labels = useMemo(() => cierresAsc.map(periodLabel), [cierresAsc]);

  const serieResultado = useMemo(() => cierresAsc.map((c) => safeNum(c.resultado_real)), [cierresAsc]);
  const serieIngresos = useMemo(() => cierresAsc.map((c) => safeNum(c.ingresos_reales)), [cierresAsc]);
  const serieGastosAbs = useMemo(() => cierresAsc.map((c) => Math.abs(safeNum(c.gastos_reales_total))), [cierresAsc]);

  const serieTendencia = useMemo(() => {
    if (trendMetric === 'ingresos') return serieIngresos;
    if (trendMetric === 'gastos') return serieGastosAbs;
    return serieResultado;
  }, [trendMetric, serieIngresos, serieGastosAbs, serieResultado]);

  const segSeries = useMemo(() => {
    const cot: number[] = [];
    const viv: number[] = [];
    const ges: number[] = [];

    for (const c of cierresAsc) {
      const dets = detallesByCierreId.get(String(c.id));
      const dCot = findDetalle(dets, 'COTIDIANOS');
      const dViv = findDetalle(dets, 'VIVIENDAS');
      const dGes = findDetalle(dets, 'GESTIONABLES');

      cot.push(Math.abs(safeNum(dCot?.real)));
      viv.push(Math.abs(safeNum(dViv?.real)));
      ges.push(Math.abs(safeNum(dGes?.real)));
    }

    return { cot, viv, ges };
  }, [cierresAsc, detallesByCierreId]);

  const subtitle = useMemo(() => {
    const n = resumen.n;
    if (!n) return 'Sin cierres todavía.';
    if (n === 1) return 'KPIs calculados sobre 1 cierre.';
    return `KPIs calculados sobre los últimos ${n} cierres (máx 12).`;
  }, [resumen.n]);

  const hasData = (resp?.cierres?.length ?? 0) > 0;

  const setMetric = (m: TrendMetric) => {
    setTrendMetric(m);
    setTrendTip((t) => ({ ...t, visible: false }));
  };

  return (
    <>
      <Header title="KPIs de cierres" subtitle={subtitle} showBack />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Resumen</Text>

            {loading && (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator />
              </View>
            )}

            {!loading && !hasData && (
              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>Sin datos</Text>
                <Text style={panelStyles.cardSubtitle}>Todavía no hay cierres para calcular KPIs.</Text>
              </View>
            )}

            {!loading && hasData && (
              <>
                <View style={styles.summaryRowTop}>
                  <View style={styles.summaryTopCard}>
                    <View style={styles.summaryIconCircle}>
                      <Ionicons name="arrow-down-circle-outline" size={22} color={colors.primary} />
                    </View>
                    <View style={styles.summaryTextBlock}>
                      <Text style={styles.summaryLabel}>{`Ingresos (${resumen.n}m)`}</Text>
                      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {EuroformatEuro(resumen.ingresos, 'plus')}
                      </Text>
                      <Text style={styles.summaryDelta}>Total real</Text>
                    </View>
                  </View>

                  <View style={styles.summaryTopCard}>
                    <View style={styles.summaryIconCircle}>
                      <Ionicons name="arrow-up-circle-outline" size={22} color={colors.primary} />
                    </View>
                    <View style={styles.summaryTextBlock}>
                      <Text style={styles.summaryLabel}>{`Gastos (${resumen.n}m)`}</Text>
                      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {EuroformatEuro(resumen.gastos, 'minus')}
                      </Text>
                      <Text style={styles.summaryDelta}>Total real</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.summaryRowSmall}>
                  <View style={styles.summaryCardSmall}>
                    <View style={styles.summaryIconCircleSmall}>
                      <Ionicons name="trending-up-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.summaryTextBlockSmall}>
                      <Text style={styles.summaryLabel}>Resultado medio</Text>
                      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {EuroformatEuro(resumen.resultadoMedio, 'signed')}
                      </Text>
                      <Text style={styles.summaryDelta}>Promedio mensual</Text>
                    </View>
                  </View>

                  <View style={styles.summaryCardSmall}>
                    <View style={styles.summaryIconCircleSmall}>
                      <Ionicons name="analytics-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.summaryTextBlockSmall}>
                      <Text style={styles.summaryLabel}>Desviación media</Text>
                      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {EuroformatEuro(resumen.desvMedia, 'signed')}
                      </Text>
                      <Text style={styles.summaryDelta}>Real - esperado</Text>
                    </View>
                  </View>
                </View>

                <View style={[panelStyles.card, { marginTop: 10 }]}>
                  <Text style={panelStyles.cardTitle}>Lectura rápida</Text>
                  <Text style={[panelStyles.cardSubtitle, { marginTop: 6 }]}>
                    Tendencia de resultado (último vs primero):{' '}
                    <Text style={{ fontWeight: '800', color: colors.textPrimary }}>
                      {EuroformatEuro(resumen.trendResultado, 'signed')}
                    </Text>
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Tendencia (LineChart) con tooltip */}
          {!loading && hasData && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>Tendencia</Text>

              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>{metricTitle(trendMetric)}</Text>
                <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>{metricSubtitle(trendMetric)}</Text>

                <View style={styles.segmented}>
                  <TouchableOpacity
                    style={[styles.segmentBtn, trendMetric === 'resultado' && styles.segmentBtnActive]}
                    onPress={() => setMetric('resultado')}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.segmentText, trendMetric === 'resultado' && styles.segmentTextActive]}>
                      Resultado
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.segmentBtn, trendMetric === 'ingresos' && styles.segmentBtnActive]}
                    onPress={() => setMetric('ingresos')}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.segmentText, trendMetric === 'ingresos' && styles.segmentTextActive]}>
                      Ingresos
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.segmentBtn, trendMetric === 'gastos' && styles.segmentBtnActive]}
                    onPress={() => setMetric('gastos')}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.segmentText, trendMetric === 'gastos' && styles.segmentTextActive]}>
                      Gastos
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 10 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ position: 'relative' }}>
                      <LineChart
                        data={{ labels, datasets: [{ data: serieTendencia }] }}
                        width={chartWidth}
                        height={chartHeightLine}
                        chartConfig={chartConfig}
                        bezier
                        style={{ borderRadius: 14 }}
                        withInnerLines={false}
                        withOuterLines={false}
                        yAxisLabel=""
                        yAxisSuffix=""
                        onDataPointClick={(dp: any) => {
                          const idx = Number(dp?.index ?? 0);
                          const lab = labels[idx] ?? '';
                          const val = Number(dp?.value ?? 0);

                          const tipX = Math.max(8, Math.min(chartWidth - 160, Number(dp?.x ?? 0) - 70));
                          const tipY = Math.max(8, Number(dp?.y ?? 0) - 52);

                          setTrendTip({
                            visible: true,
                            x: tipX,
                            y: tipY,
                            label: lab,
                            value: val,
                            metric: trendMetric,
                          });
                        }}
                      />


                      {trendTip.visible && (
                        <View style={[styles.tooltip, { left: trendTip.x, top: trendTip.y }]}>
                          <Text style={styles.tooltipLabel}>{trendTip.label}</Text>
                          <Text style={styles.tooltipValue}>{formatMetricValue(trendTip.value, trendTip.metric)}</Text>
                        </View>
                      )}
                    </View>
                  </ScrollView>
                </View>

                <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                  Tip: toca un punto para ver el importe exacto.
                </Text>
              </View>
            </View>
          )}

          {/* Comparativa (Barras tappable) */}
          {!loading && hasData && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>Ingresos vs Gastos</Text>

              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>Comparativa mensual</Text>
                <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                  Dos barras por mes. Toca una barra para ver la cifra.
                </Text>

                <TappableBarsComparativa labels={labels} ingresos={serieIngresos} gastosAbs={serieGastosAbs} maxWidth={chartWidth} />
              </View>
            </View>
          )}

          {/* Segmentos (LineChart) con tooltip */}
          {!loading && hasData && (
            <View style={[panelStyles.section, { marginBottom: 24 }]}>
              <Text style={panelStyles.sectionTitle}>Por segmentos</Text>

              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>Gasto real por segmento</Text>
                <Text style={[panelStyles.cardSubtitle, { marginTop: 4 }]}>
                  Tendencia del gasto real (valor absoluto). Toca un punto para ver la cifra.
                </Text>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                  <View style={{ position: 'relative' }}>
                    <LineChart
                      data={{
                        labels,
                        datasets: [
                          {
                            data: segSeries.cot,
                            color: (opacity = 1) => `rgba(42, 158, 159, ${opacity})`,
                            strokeWidth: 3,
                          },
                          {
                            data: segSeries.viv,
                            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
                            strokeWidth: 3,
                          },
                          {
                            data: segSeries.ges,
                            color: (opacity = 1) => `rgba(245, 158, 11, ${opacity})`,
                            strokeWidth: 3,
                          },
                        ],
                      }}
                      width={chartWidth}
                      height={260}
                      chartConfig={chartConfig}
                      bezier
                      style={{ borderRadius: 14 }}
                      withInnerLines={false}
                      withOuterLines={false}
                      yAxisLabel=""
                      yAxisSuffix=""
                      onDataPointClick={(dp: any) => {
                        const idx = Number(dp?.index ?? 0);
                        const lab = labels[idx] ?? '';
                        const val = Number(dp?.value ?? 0);

                        const datasetIndex = Number(dp?.datasetIndex ?? 0);
                        let seg: SegTooltip['segmentLabel'] = 'Cotidianos';
                        if (datasetIndex === 1) seg = 'Viviendas';
                        if (datasetIndex === 2) seg = 'Gestionables';

                        const tipX = Math.max(8, Math.min(chartWidth - 175, Number(dp?.x ?? 0) - 78));
                        const tipY = Math.max(8, Number(dp?.y ?? 0) - 56);

                        setSegTip({
                          visible: true,
                          x: tipX,
                          y: tipY,
                          label: lab,
                          value: val,
                          segmentLabel: seg,
                        });
                      }}
                    />


                    {segTip.visible && (
                      <View style={[styles.tooltip, { left: segTip.x, top: segTip.y, width: 165 }]}>
                        <Text style={styles.tooltipLabel}>
                          {segTip.segmentLabel} · {segTip.label}
                        </Text>
                        <Text style={styles.tooltipValue}>{formatBarValue(segTip.value, 'gastos')}</Text>
                      </View>
                    )}
                  </View>
                </ScrollView>

                <View style={styles.legendRow}>
                  <View style={styles.legendChip}>
                    <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
                    <Text style={styles.legendText}>Cotidianos</Text>
                  </View>
                  <View style={styles.legendChip}>
                    <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.legendText}>Viviendas</Text>
                  </View>
                  <View style={styles.legendChip}>
                    <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                    <Text style={styles.legendText}>Gestionables</Text>
                  </View>
                </View>

                <Text style={[panelStyles.cardSubtitle, { marginTop: 10 }]}>
                  Si más adelante separas “Ahorro” como columna propia, aquí añadimos un 4º dataset.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
};

export default CierreKpiScreen;

// --------------------
// Estilos
// --------------------
const styles = StyleSheet.create({
  // Mini-cards estilo Home
  summaryRowTop: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  summaryTopCard: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 86,
  },
  summaryIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  summaryTextBlock: {
    flex: 1,
  },

  summaryRowSmall: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCardSmall: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 76,
  },
  summaryIconCircleSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  summaryTextBlockSmall: {
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

  // Segmented control
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSoft,
    borderRadius: 999,
    padding: 4,
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.textPrimary,
  },

  // Tooltip
  tooltip: {
    position: 'absolute',
    width: 150,
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
  tooltipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  tooltipValue: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '800',
  },

  // Leyendas
  legendRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});

const stylesBars = StyleSheet.create({
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingTop: 18,
    paddingBottom: 10,
    overflow: 'hidden',
  },
  col: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
    paddingHorizontal: 4,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: 170,
    marginBottom: 10,
  },
  bar: {
    borderRadius: 8,
  },
  xLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  tooltip: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tooltipLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '700',
    textAlign: 'center',
  },
  tooltipValue: {
    marginTop: 1,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
    textAlign: 'center',
  },
});
