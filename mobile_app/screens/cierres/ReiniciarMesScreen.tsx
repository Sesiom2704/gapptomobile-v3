// mobile_app/screens/cierres/ReinciarCierreScreen.tsx
// -----------------------------------------------------------------------------
// ReinciarCierreScreen
// - Muestra comparativa (mes actual vs cierre anterior) como tenías
// - CTA "Generar cierre" (persistente) con OptionCard enabled/disabled
//   Condiciones (3):
//     1) Ventana 1-5
//     2) Sin pendientes (gastos pendientes = 0)
//     3) Preview cierre disponible (reinicioApi.fetchCierrePreview OK)
// - Pull-to-refresh
// - Tras generar cierre -> navega a ReiniciarMesScreen
// -----------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { fetchGastos } from '../../services/gastosApi';
import { reinicioApi, type CierrePreview } from '../../services/reinicioApi';

import { getMonthlySummary } from '../../services/analyticsApi';
import type { MonthlySummaryResponse } from '../../types/analytics';

import { cierreMensualApi, type CierreMensual } from '../../services/cierreMensualApi';
import { EuroformatEuro } from '../../utils/format';

type CierreState = 'LOADING' | 'OK' | 'ERROR';

function mesNombreES(m: number): string {
  const names = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function getPrevMonthRef(baseDate = new Date()): { anio: number; mes: number } {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

function isInReinicioWindow(now = new Date()): boolean {
  const d = now.getDate();
  return d >= 1 && d <= 5;
}

function pctDelta(curr: number, prev: number): number | null {
  const p = Number(prev);
  const c = Number(curr);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) return null;
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

  const currentPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  const prevPeriod = useMemo(() => getPrevMonthRef(new Date()), []);

  const reinicioWindowOk = useMemo(() => isInReinicioWindow(new Date()), []);

  const [state, setState] = useState<CierreState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [pendientesCount, setPendientesCount] = useState<number>(0);

  // Cierre persistido del mes anterior (M-1) para comparativa
  const [cierrePrev, setCierrePrev] = useState<CierreMensual | null>(null);

  // Summary del mes actual para comparativa
  const [summaryCurrent, setSummaryCurrent] = useState<MonthlySummaryResponse | null>(null);

  // Preview cierre "what-if" del mes actual (M) para validar condición 3
  const [cierrePreviewM, setCierrePreviewM] = useState<CierrePreview | null>(null);

  const load = useCallback(async () => {
    setErrorMsg(null);
    setState('LOADING');

    try {
      // 1) Pendientes
      const pendientes = await fetchGastos('pendientes');
      const count = Array.isArray(pendientes) ? pendientes.length : 0;
      setPendientesCount(count);

      // 2) Cierre M-1 (persistido) para comparativa (si existe)
      const cierres = await cierreMensualApi.list();
      const found =
        (cierres ?? []).find((c) => c.anio === prevPeriod.anio && c.mes === prevPeriod.mes) ?? null;
      setCierrePrev(found);

      // 3) Summary del mes actual para comparativa (ya lo tenías)
      const current = await getMonthlySummary();
      setSummaryCurrent(current);

      // 4) Preview cierre del mes actual (what-if) (condición 3)
      const prevM = await reinicioApi.fetchCierrePreview({
        anio: currentPeriod.anio,
        mes: currentPeriod.mes,
      });
      setCierrePreviewM(prevM);

      setState('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar el estado del cierre.');
      setState('ERROR');
    }
  }, [prevPeriod.anio, prevPeriod.mes, currentPeriod.anio, currentPeriod.mes]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const irAKpis = () => navigation.navigate('CierreKpiScreen', { cierreId: cierrePrev?.id });

  const canGenerarCierre = useMemo(() => {
    const cond1 = reinicioWindowOk;
    const cond2 = pendientesCount === 0;
    const cond3 = !!cierrePreviewM; // si el preview no está disponible, bloquea
    return cond1 && cond2 && cond3;
  }, [reinicioWindowOk, pendientesCount, cierrePreviewM]);

  const disabledReason = useMemo(() => {
    if (canGenerarCierre) return null;

    const parts: string[] = [];
    if (!reinicioWindowOk) parts.push('Disponible del día 1 al 5');
    if (pendientesCount > 0) parts.push(`Pendientes: ${pendientesCount}`);
    if (!cierrePreviewM) parts.push('Preview de cierre no disponible');
    return parts.join(' · ');
  }, [canGenerarCierre, reinicioWindowOk, pendientesCount, cierrePreviewM]);

  const confirmarGenerar = () => {
    if (!canGenerarCierre) return;

    Alert.alert(
      'Generar cierre',
      `Se generará el cierre (persistente) del mes anterior.\n\n¿Deseas continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Generar', style: 'destructive', onPress: () => void generarCierre() },
      ]
    );
  };

  const generarCierre = async () => {
    try {
      setState('LOADING');
      setErrorMsg(null);

      // Persistente: genera el cierre (tu backend lo resuelve como corresponda)
      const res = await reinicioApi.postGenerarCierre({ force: false });

      // Tras generar cierre -> abrir ReiniciarMesScreen del mes actual
      navigation.navigate('ReiniciarMesScreen', {
        anio: currentPeriod.anio,
        mes: currentPeriod.mes,
        cierreId: res?.id ?? null,
      });

      setState('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido generar el cierre.');
      setState('ERROR');
    }
  };

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

  const renderPreviewWhatIf = () => {
    if (!cierrePreviewM) {
      return (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Preview cierre (what-if)</Text>
          <Text style={[styles.helperSmall, { marginTop: 6 }]}>
            No disponible (no se pudo calcular el preview del mes actual).
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Preview cierre (what-if)</Text>
        <Text style={[styles.helperSmall, { marginTop: 6 }]}>
          Simulación: si cerraras ahora. Corte: {cierrePreviewM.as_of}
        </Text>

        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={styles.label}>Ingresos</Text>
          <Text style={[styles.value, { color: moneyColor(cierrePreviewM.ingresos_reales) }]}>
            {EuroformatEuro(cierrePreviewM.ingresos_reales ?? 0, 'signed')}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Gastos</Text>
          <Text style={[styles.value, { color: moneyColor(-Math.abs(cierrePreviewM.gastos_reales_total ?? 0)) }]}>
            {EuroformatEuro(-Math.abs(cierrePreviewM.gastos_reales_total ?? 0), 'signed')}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Resultado</Text>
          <Text style={[styles.value, { color: moneyColor(cierrePreviewM.resultado_real) }]}>
            {EuroformatEuro(cierrePreviewM.resultado_real ?? 0, 'signed')}
          </Text>
        </View>
      </View>
    );
  };

  const renderBody = () => {
    if (state === 'LOADING') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.helperText}>Cargando…</Text>
        </View>
      );
    }

    if (state === 'ERROR') {
      return (
        <View style={styles.content}>
          <Text style={styles.errorText}>{errorMsg ?? 'Error inesperado.'}</Text>
          <OptionCard
            iconName="refresh-outline"
            title="Reintentar"
            description="Vuelve a cargar el estado."
            onPress={() => void load()}
          />
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Cierre mensual</Text>
        <Text style={styles.subtitle}>
          Previsualización del mes actual (what-if) y comparativa frente al cierre del mes anterior.
        </Text>

        {renderPreviewWhatIf()}
        {renderComparativa()}

        <OptionCard
          iconName="calendar-outline"
          title="Generar cierre"
          description={
            canGenerarCierre
              ? 'Genera el cierre (persistente) y continúa al reinicio de mes.'
              : (disabledReason ?? 'No disponible')
          }
          onPress={confirmarGenerar}
          state={canGenerarCierre ? 'enabled' : 'disabled'}
          onDisabledPress={() =>
            Alert.alert('No disponible', disabledReason ?? 'No cumples las condiciones para generar el cierre.')
          }
          showChevron={false}
        />

        <Text style={styles.pullHint}>Desliza hacia abajo para recomprobar.</Text>
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header title="Cierre mensual" subtitleYear={currentPeriod.anio} subtitleMonth={currentPeriod.mes} showBack />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {renderBody()}
      </ScrollView>
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

  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: '#F5F5F7',
    flexGrow: 1,
  },

  content: { gap: spacing.md },
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
  helperText: { fontSize: 13, color: colors.textSecondary },
  errorText: {
    fontSize: 14,
    color: colors.actionDanger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

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
  label: { fontSize: 13, color: colors.textSecondary },
  valueBlock: { alignItems: 'flex-end', gap: 2 },
  value: { fontSize: 13, fontWeight: '800' },
  delta: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  helperSmall: { marginTop: 8, fontSize: 11, color: colors.textSecondary, lineHeight: 16 },

  pullHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
});

export default ReinciarCierreScreen;
