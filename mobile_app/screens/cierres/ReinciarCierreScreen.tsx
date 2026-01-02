// mobile_app/screens/cierres/ReinciarCierreScreen.tsx
// -----------------------------------------------------------------------------
// ReinciarCierreScreen (ajustes de diseño + comparativa + PREVIEW cierre a insertar)
//
// Requisitos (y comportamiento):
// 1) El cierre persistido sigue siendo M-1 (ej. NOV 2025) -> sirve de referencia.
// 2) La previsualización "comparativa" es del mes actual (M), ej. DIC 2025.
// 3) En lugar de “mostrar solo noviembre”, mostramos:
//    - Datos de DICIEMBRE (mes actual) y al lado el % vs NOVIEMBRE.
// 4) CTA dinámico sin chevron (OptionCard.showChevron=false).
//
// NUEVO (lo que pides ahora):
// 5) En este screen se debe ver una PREVISUALIZACIÓN de los datos que se insertarán
//    cuando se genere el cierre (M-1).
//
// IMPORTANTE (fix definitivo del 405):
// - NO usamos /api/v1/cierre_mensual/_debug_snapshot porque en staging devuelve 405.
// - Usamos el endpoint nuevo y soportado:
//     GET /api/v1/reinicio/cierre/preview?anio=...&mes=...
//   que devuelve un "what-if" (sin persistir).
//
// Implementación:
// - “Mes actual” = Date().
// - “Mes anterior (M-1)” = getPrevMonthRef(Date()).
// - “Cierre M-1 existente” = cierreMensualApi.list() y filtrar.
// - “Datos del mes actual (M)” = analyticsApi.getMonthlySummary().
// - “Preview del cierre a insertar (M-1)” = reinicioApi.fetchCierrePreview({anio, mes}).
// -----------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { cierreMensualApi, CierreMensual } from '../../services/cierreMensualApi';
import { fetchGastos } from '../../services/gastosApi';

import { getMonthlySummary } from '../../services/analyticsApi';
import type { MonthlySummaryResponse } from '../../types/analytics';

import { reinicioApi, type CierrePreview } from '../../services/reinicioApi';

import { EuroformatEuro } from '../../utils/format';

type CierreState =
  | 'LOADING'
  | 'HAY_PENDIENTES'
  | 'LISTO_PARA_CIERRE'
  | 'CIERRE_GENERADO'
  | 'ERROR';

function getPrevMonthRef(baseDate = new Date()): { anio: number; mes: number } {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

function mesNombreES(m: number): string {
  const names = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function pctDelta(curr: number, prev: number): number | null {
  const p = Number(prev);
  const c = Number(curr);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) return null; // evita infinitos; se muestra "—"
  return ((c - p) / Math.abs(p)) * 100;
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function moneyColor(value?: number | null): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  if (n > 0) return green;
  if (n < 0) return red;
  return colors.textPrimary;
}

export const ReinciarCierreScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  // Mes actual (M)
  const currentPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  // Mes anterior (M-1) -> el que se cierra/persiste
  const prevPeriod = useMemo(() => getPrevMonthRef(new Date()), []);

  const [state, setState] = useState<CierreState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pendientesCount, setPendientesCount] = useState<number>(0);
  const [cierrePrev, setCierrePrev] = useState<CierreMensual | null>(null);

  // Mes actual (M) para comparativa
  const [summaryCurrent, setSummaryCurrent] = useState<MonthlySummaryResponse | null>(null);

  // ✅ Preview “what-if” del cierre M-1 que se insertaría si generas cierre
  const [cierrePreview, setCierrePreview] = useState<CierrePreview | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      // 1) Pendientes (mantengo tu comportamiento actual: solo gastos pendientes)
      const pendientes = await fetchGastos('pendientes');
      const count = Array.isArray(pendientes) ? pendientes.length : 0;
      setPendientesCount(count);

      // 2) Cierre M-1 (si existe)
      const cierres = await cierreMensualApi.list();
      const found =
        (cierres ?? []).find((c) => c.anio === prevPeriod.anio && c.mes === prevPeriod.mes) ?? null;
      setCierrePrev(found);

      // 3) Datos del mes actual (M) para comparativa
      const current = await getMonthlySummary();
      setSummaryCurrent(current);

      // 4) ✅ PREVIEW real del cierre a insertar (M-1)
      //    IMPORTANTE: usamos reinicioApi (backend nuevo) para evitar 405 de _debug_snapshot.
      try {
        const preview = await reinicioApi.fetchCierrePreview({
          anio: prevPeriod.anio,
          mes: prevPeriod.mes,
        });
        setCierrePreview(preview ?? null);
      } catch (previewErr) {
        // No rompemos UX: simplemente no mostramos preview detallada
        console.warn('[ReinciarCierreScreen] No se pudo cargar cierre preview', previewErr);
        setCierrePreview(null);
      }

      // 5) Estado UX
      if (found) {
        setState('CIERRE_GENERADO');
      } else if (count > 0) {
        setState('HAY_PENDIENTES');
      } else {
        setState('LISTO_PARA_CIERRE');
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar el estado del cierre.');
      setState('ERROR');
    }
  }, [prevPeriod.anio, prevPeriod.mes]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const irAPendientes = () => {
    navigation.navigate('GastosList', { initialFiltro: 'pendientes', fromHome: false });
  };

  const confirmarGenerar = () => {
    Alert.alert(
      'Generar cierre',
      `Se generará el cierre de ${mesNombreES(prevPeriod.mes)} ${prevPeriod.anio}.\n\n¿Deseas continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Generar', style: 'default', onPress: () => void generarCierre() },
      ]
    );
  };

  const generarCierre = async () => {
    setState('LOADING');
    setErrorMsg(null);
    try {
      const res = await cierreMensualApi.generar({ force: false });
      setCierrePrev(res);
      setState('CIERRE_GENERADO');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido generar el cierre.');
      setState('ERROR');
    }
  };

  // Reinicio apunta al mes actual (M)
  const irAReiniciarMes = () => {
    navigation.navigate('ReiniciarMesScreen', {
      anio: currentPeriod.anio,
      mes: currentPeriod.mes,
      cierreId: cierrePrev?.id ?? null,
    });
  };

  const irAKpis = () => {
    navigation.navigate('CierreKpiScreen', { cierreId: cierrePrev?.id });
  };

  // ---------------------------------------------------------------------------
  // ✅ Render “Previsualización del cierre a insertar (M-1)”
  // ---------------------------------------------------------------------------

  const renderPreviewCierreAInsertar = () => {
    if (!cierrePreview) {
      return (
        <View style={styles.previewCard}>
          <View style={styles.previewHeaderRow}>
            <Text style={styles.previewTitle}>
              Previsualización del cierre ({mesNombreES(prevPeriod.mes)} {prevPeriod.anio})
            </Text>
          </View>
          <Text style={styles.previewMuted}>
            No se ha podido cargar la previsualización. Puedes generar el cierre igualmente.
          </Text>
        </View>
      );
    }

    const ingresosReales = Number(cierrePreview.ingresos_reales ?? 0);
    const gastosReales = Number(cierrePreview.gastos_reales_total ?? 0);
    const resultadoReal = Number(cierrePreview.resultado_real ?? 0);

    const ingresosEsperados =
      cierrePreview.ingresos_esperados != null ? Number(cierrePreview.ingresos_esperados) : null;
    const gastosEsperados =
      cierrePreview.gastos_esperados_total != null ? Number(cierrePreview.gastos_esperados_total) : null;
    const resultadoEsperado =
      cierrePreview.resultado_esperado != null ? Number(cierrePreview.resultado_esperado) : null;

    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeaderRow}>
          <View>
            <Text style={styles.previewTitle}>
              Previsualización del cierre ({mesNombreES(prevPeriod.mes)} {prevPeriod.anio})
            </Text>
            <Text style={styles.previewSubtitle}>
              Estos son los valores que se insertarían si generas el cierre ahora.
            </Text>
          </View>
        </View>

        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>Ingresos reales</Text>
          <Text style={[styles.previewValue, { color: moneyColor(ingresosReales) }]}>
            {EuroformatEuro(ingresosReales, 'plus')}
          </Text>
        </View>

        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>Gastos reales</Text>
          <Text style={[styles.previewValue, { color: moneyColor(-Math.abs(gastosReales)) }]}>
            {EuroformatEuro(gastosReales, 'minus')}
          </Text>
        </View>

        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>Resultado real</Text>
          <Text style={[styles.previewValue, { color: moneyColor(resultadoReal) }]}>
            {EuroformatEuro(resultadoReal, 'signed')}
          </Text>
        </View>

        {(ingresosEsperados != null || gastosEsperados != null || resultadoEsperado != null) && (
          <>
            <View style={styles.previewDivider} />

            {ingresosEsperados != null && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Ingresos esperados</Text>
                <Text style={styles.previewValue}>{EuroformatEuro(ingresosEsperados, 'plus')}</Text>
              </View>
            )}

            {gastosEsperados != null && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Gastos esperados</Text>
                <Text style={styles.previewValue}>{EuroformatEuro(gastosEsperados, 'minus')}</Text>
              </View>
            )}

            {resultadoEsperado != null && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Resultado esperado</Text>
                <Text style={styles.previewValue}>{EuroformatEuro(resultadoEsperado, 'signed')}</Text>
              </View>
            )}
          </>
        )}

        <Text style={styles.previewMuted}>
          As of: {(cierrePreview.as_of ?? '').toString()}
        </Text>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Comparativa mes actual (M) vs cierre anterior (M-1 ya persistido)
  // ---------------------------------------------------------------------------

  const renderComparativa = () => {
    const g = summaryCurrent?.general;
    const ingresosCurr = Number(g?.ingresos_mes ?? 0);
    const gastosCurr = Number(g?.gastos_mes ?? 0);
    const ahorroCurr = Number(g?.ahorro_mes ?? 0);

    const ingresosPrev = Number(cierrePrev?.ingresos_reales ?? 0);
    const gastosPrev = Number(cierrePrev?.gastos_reales_total ?? 0);
    const ahorroPrev = Number(cierrePrev?.resultado_real ?? 0);

    const dIng = pctDelta(ingresosCurr, ingresosPrev);
    const dGas = pctDelta(gastosCurr, gastosPrev);
    const dAho = pctDelta(ahorroCurr, ahorroPrev);

    return (
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeaderRow}>
          <View>
            <Text style={styles.summaryTitle}>{`${mesNombreES(currentPeriod.mes)} ${currentPeriod.anio}`}</Text>
            <Text style={styles.summarySubtitleSmall}>
              vs {mesNombreES(prevPeriod.mes)} {prevPeriod.anio}
            </Text>
          </View>

          <TouchableOpacity
            onPress={irAKpis}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Ver detalle y KPIs del cierre anterior"
            style={styles.eyeButton}
          >
            <Ionicons name="eye-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Ingresos</Text>
          <View style={styles.valueBlock}>
            <Text style={[styles.value, { color: moneyColor(ingresosCurr) }]}>
              {EuroformatEuro(ingresosCurr, 'plus')}
            </Text>
            <Text style={styles.delta}>{fmtPct(dIng)}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Gastos</Text>
          <View style={styles.valueBlock}>
            <Text style={[styles.value, { color: moneyColor(-Math.abs(gastosCurr)) }]}>
              {EuroformatEuro(gastosCurr, 'minus')}
            </Text>
            <Text style={styles.delta}>{fmtPct(dGas)}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Ahorro</Text>
          <View style={styles.valueBlock}>
            <Text style={[styles.value, { color: moneyColor(ahorroCurr) }]}>
              {EuroformatEuro(ahorroCurr, 'signed')}
            </Text>
            <Text style={styles.delta}>{fmtPct(dAho)}</Text>
          </View>
        </View>

        <Text style={styles.helperSmall}>
          Nota: el % compara el mes actual con el cierre del mes anterior. Si el mes anterior es 0, se muestra “—”.
        </Text>
      </View>
    );
  };

  const renderBody = () => {
    if (state === 'LOADING') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.helperText}>Cargando estado del cierre…</Text>
        </View>
      );
    }

    if (state === 'ERROR') {
      return (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorMsg ?? 'Error inesperado.'}</Text>

          <OptionCard
            iconName="refresh-outline"
            title="Reintentar"
            description="Vuelve a cargar el estado del cierre."
            onPress={() => void load()}
          />
        </View>
      );
    }

    if (state === 'HAY_PENDIENTES') {
      return (
        <View style={styles.content}>
          <Text style={styles.h1}>Hay pendientes</Text>
          <Text style={styles.subtitle}>
            Antes de generar el cierre, conviene revisar los gastos pendientes del mes.
          </Text>

          {/* ✅ Preview del cierre a insertar (M-1) */}
          {renderPreviewCierreAInsertar()}

          <OptionCard
            iconName="alert-circle-outline"
            title="Pendientes detectados"
            description={`Tienes ${pendientesCount} gasto(s) pendiente(s). Pulsa para revisarlos.`}
            onPress={() => irAPendientes()}
          />

          <OptionCard
            iconName="calculator-outline"
            title="Generar cierre igualmente"
            description="Si lo necesitas, puedes forzar el cierre ahora. Recomendado solo si lo tienes controlado."
            onPress={() => confirmarGenerar()}
          />
        </View>
      );
    }

    if (state === 'LISTO_PARA_CIERRE') {
      return (
        <View style={styles.content}>
          <Text style={styles.h1}>Listo para cierre</Text>
          <Text style={styles.subtitle}>
            No hay pendientes detectados. Puedes generar el cierre del mes anterior.
          </Text>

          {/* ✅ Preview del cierre a insertar (M-1) */}
          {renderPreviewCierreAInsertar()}

          <OptionCard
            iconName="checkmark-circle-outline"
            title="Generar cierre"
            description={`Genera el cierre de ${mesNombreES(prevPeriod.mes)} ${prevPeriod.anio}.`}
            onPress={() => confirmarGenerar()}
          />
        </View>
      );
    }

    // CIERRE_GENERADO: comparativa + CTA reiniciar mes
    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Resumen y comparativa</Text>
        <Text style={styles.subtitle}>
          Previsualización del mes actual y comparación frente al cierre del mes anterior.
        </Text>

        {renderComparativa()}

        <OptionCard
          iconName="repeat-outline"
          title="Reiniciar mes"
          description={`Preparar ${mesNombreES(currentPeriod.mes)} ${currentPeriod.anio}.`}
          onPress={() => irAReiniciarMes()}
          showChevron={false}
        />
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header
          title="Cierre mensual"
          subtitleYear={currentPeriod.anio}
          subtitleMonth={currentPeriod.mes}
          showBack
        />
      </View>

      <View style={styles.body}>{renderBody()}</View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  topArea: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  body: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  content: {
    gap: spacing.md,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  h1: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  helperText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: colors.actionDanger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // Comparativa (mes actual vs cierre anterior)
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  summarySubtitleSmall: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  eyeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E6E6EA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    alignItems: 'baseline',
  },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  valueBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  value: {
    fontSize: 13,
    fontWeight: '800',
  },
  delta: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  helperSmall: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },

  // Preview cierre a insertar (M-1)
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  previewSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  previewMuted: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    alignItems: 'baseline',
  },
  previewLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  previewValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E6E6EA',
    marginVertical: spacing.sm,
  },
});

export default ReinciarCierreScreen;
