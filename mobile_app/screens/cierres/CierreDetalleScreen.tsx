// mobile_app/screens/cierres/CierreDetalleScreen.tsx
// -----------------------------------------------------------------------------
// Pantalla detalle de cierre:
// - Cabecera (tabla 2 columnas + desviación en una línea)
// - Detalle de gastos (resumen) + tarjetas por segmento
// - Formato € unificado con utils/format.ts
// - Sin mostrar versión (v1/v2)
// -----------------------------------------------------------------------------

// mobile_app/screens/cierres/CierreDetalleScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import {
  cierreMensualApi,
  CierreMensual,
  CierreMensualDetalle,
} from '../../services/cierreMensualApi';

import { EuroformatEuro } from '../../utils/format';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function getDeviationColor(value: number) {
  if (value > 0) return colors.success;
  if (value < 0) return colors.danger;
  return colors.warning;
}

function safeNumber(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

const CierreDetalleScreen: React.FC = () => {
  const route = useRoute<any>();
  const cierreId: string = route.params?.cierreId;
  const cierreFromList: CierreMensual | undefined = route.params?.cierre;

  const [loading, setLoading] = useState<boolean>(false);
  const [detalles, setDetalles] = useState<CierreMensualDetalle[]>([]);

  const loadDetalles = useCallback(async () => {
    if (!cierreId) return;

    setLoading(true);
    try {
      const data = await cierreMensualApi.detalles(cierreId);
      setDetalles(Array.isArray(data) ? data : []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los detalles.');
    } finally {
      setLoading(false);
    }
  }, [cierreId]);

  useEffect(() => {
    loadDetalles();
  }, [loadDetalles]);

  const periodoLabel = useMemo(() => {
    if (!cierreFromList) return 'Detalle de cierre';
    return `Cierre ${cierreFromList.anio}-${pad2(cierreFromList.mes)}`;
  }, [cierreFromList]);

  const resumenDetalle = useMemo(() => {
    const sum = detalles.reduce(
      (acc, x) => {
        acc.esp += safeNumber(x.esperado);
        acc.real += safeNumber(x.real);
        acc.dev += safeNumber(x.desviacion);
        return acc;
      },
      { esp: 0, real: 0, dev: 0 }
    );

    const inferredDev =
      sum.dev !== 0 ? sum.dev : (sum.esp !== 0 || sum.real !== 0 ? (sum.real - sum.esp) : 0);

    return {
      esperado: sum.esp,
      real: sum.real,
      desviacion: inferredDev,
    };
  }, [detalles]);

  const cab = useMemo(() => {
    if (!cierreFromList) return null;

    const ingresos = safeNumber(cierreFromList.ingresos_reales);
    const gastos = safeNumber(cierreFromList.gastos_reales_total);
    const resEsp = safeNumber(cierreFromList.resultado_esperado);
    const resReal = safeNumber(cierreFromList.resultado_real);
    const desv =
      Number.isFinite(Number(cierreFromList.desv_resultado))
        ? safeNumber(cierreFromList.desv_resultado)
        : resReal - resEsp;

    return { ingresos, gastos, resEsp, resReal, desv };
  }, [cierreFromList]);

  return (
    <>
      <Header
        title={periodoLabel}
        subtitle="Cabecera y desglose por segmento."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {/* ------------------------------------------------------------------ */}
          {/* 1) CABECERA                                                        */}
          {/* ------------------------------------------------------------------ */}
          {cierreFromList && cab && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>Cabecera</Text>

              <View style={panelStyles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <View style={panelStyles.menuIconCircleSecondary}>
                    <Ionicons name="stats-chart-outline" size={22} color={colors.primary} />
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={panelStyles.cardTitle}>
                      {cierreFromList.criterio || 'CAJA'}
                    </Text>
                    <Text style={panelStyles.cardSubtitle}>
                      Ingresos, gastos, resultado y desviación del mes cerrado.
                    </Text>
                  </View>
                </View>

                <View style={{ marginTop: 6 }}>
                  {/* Fila 1 */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={panelStyles.cardSubtitle}>
                      Ingresos reales:{' '}
                      <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                        {EuroformatEuro(cab.ingresos, 'plus')}
                      </Text>
                    </Text>

                    <Text style={panelStyles.cardSubtitle}>
                      Gastos reales:{' '}
                      <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                        {EuroformatEuro(cab.gastos, 'minus')}
                      </Text>
                    </Text>
                  </View>

                  {/* Fila 2 */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={panelStyles.cardSubtitle}>
                      Resultado esperado:{' '}
                      <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                        {EuroformatEuro(cab.resEsp, 'normal')}
                      </Text>
                    </Text>

                    <Text style={panelStyles.cardSubtitle}>
                      Resultado real:{' '}
                      <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                        {EuroformatEuro(cab.resReal, 'normal')}
                      </Text>
                    </Text>
                  </View>

                  {/* Fila 3: Desviación (etiqueta negra, valor en negrita y color) */}
                  <View style={{ marginTop: 10 }}>
                    <Text style={panelStyles.cardSubtitle}>
                      <Text style={{ color: colors.textPrimary, fontWeight: '400' }}>
                        Desviación:{' '}
                      </Text>
                      <Text style={{ fontWeight: '900', color: getDeviationColor(cab.desv) }}>
                        {EuroformatEuro(cab.desv, 'signed')}
                      </Text>
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* 2) DETALLE DE GASTOS (resumen)                                      */}
          {/* ------------------------------------------------------------------ */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Detalle de gastos</Text>

            <View style={panelStyles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={panelStyles.cardSubtitle}>
                  Esperado:{' '}
                  <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                    {EuroformatEuro(resumenDetalle.esperado, 'minus')}
                  </Text>
                </Text>

                <Text style={panelStyles.cardSubtitle}>
                  Real:{' '}
                  <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                    {EuroformatEuro(resumenDetalle.real, 'minus')}
                  </Text>
                </Text>
              </View>

              {/* Desviación (etiqueta negra, valor en negrita y color) */}
              <View style={{ marginTop: 10 }}>
                <Text style={panelStyles.cardSubtitle}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '400' }}>
                    Desviación:{' '}
                  </Text>
                  <Text
                    style={{
                      fontWeight: '900',
                      color: getDeviationColor(resumenDetalle.desviacion),
                    }}
                  >
                    {EuroformatEuro(resumenDetalle.desviacion, 'signed')}
                  </Text>
                </Text>
              </View>
            </View>

            {loading && (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator />
              </View>
            )}

            {!loading && detalles.length === 0 && (
              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>Sin detalle</Text>
                <Text style={panelStyles.cardSubtitle}>
                  Este cierre no tiene líneas de detalle registradas.
                </Text>
              </View>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* 3) TARJETAS POR SEGMENTO                                           */}
            {/* ------------------------------------------------------------------ */}
            {!loading &&
              detalles.map((d) => {
                const esperado = safeNumber(d.esperado);
                const real = safeNumber(d.real);
                const desviacion = Number.isFinite(Number(d.desviacion))
                  ? safeNumber(d.desviacion)
                  : (real - esperado);

                const tituloBase = (d.tipo_detalle || 'Detalle').toUpperCase();
                const seg = d.segmento_id ? ` · ${d.segmento_id}` : '';
                const titulo = `${tituloBase}${seg}`;

                return (
                  <View key={d.id} style={panelStyles.menuCard}>
                    <View style={panelStyles.menuIconCircleSecondary}>
                      <Ionicons name="layers-outline" size={22} color={colors.primary} />
                    </View>

                    <View style={panelStyles.menuTextContainer}>
                      <Text style={panelStyles.menuTitle}>{titulo}</Text>

                      {/* Fila 1: Esperado (-) | Real (-) */}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginTop: 6,
                        }}
                      >
                        <Text style={panelStyles.menuSubtitle}>
                          Esperado:{' '}
                          <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                            {EuroformatEuro(esperado, 'minus')}
                          </Text>
                        </Text>

                        <Text style={panelStyles.menuSubtitle}>
                          Real:{' '}
                          <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                            {EuroformatEuro(real, 'minus')}
                          </Text>
                        </Text>
                      </View>

                      {/* Fila 2: Desviación (etiqueta negra, valor en negrita y color) */}
                      <View style={{ marginTop: 8 }}>
                        <Text style={panelStyles.menuSubtitle}>
                          <Text style={{ color: colors.textPrimary, fontWeight: '400' }}>
                            Desviación:{' '}
                          </Text>
                          <Text style={{ fontWeight: '900', color: getDeviationColor(desviacion) }}>
                            {EuroformatEuro(desviacion, 'signed')}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
          </View>
        </ScrollView>
      </View>
    </>
  );
};

export default CierreDetalleScreen;
