// mobile_app/screens/cierres/ReinciarCierreScreen.tsx
// -----------------------------------------------------------------------------
// ReinciarCierreScreen (ajustes de diseño + comparativa)
//
// Requisitos aplicados:
// 1) El cierre persistido sigue siendo M-1 (ej. NOV 2025) -> sirve de referencia.
// 2) La previsualización debe ser del mes actual (M), ej. DIC 2025.
// 3) En lugar de “mostrar solo noviembre”, mostramos:
//    - Datos de DICIEMBRE (mes actual) y al lado el % vs NOVIEMBRE.
// 4) CTA dinámico sin chevron (usa OptionCard.showChevron=false).
//
// Implementación:
// - “Mes actual” se saca de Date().
// - “Mes anterior” (cierre) se busca en cierreMensualApi.list().
// - “Datos del mes actual” se sacan de analyticsApi.getMonthlySummary()
//   (mismo servicio que ya usas en ResumenScreen).
//
// Mapeo para comparativa:
// - Ingresos: current.general.ingresos_mes vs cierre.ingresos_reales
// - Gastos:   current.general.gastos_mes   vs cierre.gastos_reales_total
// - Ahorro:   current.general.ahorro_mes   vs cierre.resultado_real
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
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
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

  // Mes actual (M): Diciembre si estamos en diciembre.
  const currentPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  // Cierre de referencia (M-1): Noviembre si estamos en diciembre.
  const prevPeriod = useMemo(() => getPrevMonthRef(new Date()), []);

  const [state, setState] = useState<CierreState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pendientesCount, setPendientesCount] = useState<number>(0);
  const [cierrePrev, setCierrePrev] = useState<CierreMensual | null>(null);

  const [summaryCurrent, setSummaryCurrent] = useState<MonthlySummaryResponse | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      // 1) Pendientes
      const pendientes = await fetchGastos('pendientes');
      const count = Array.isArray(pendientes) ? pendientes.length : 0;
      setPendientesCount(count);

      // 2) Cierre M-1 (si existe)
      const cierres = await cierreMensualApi.list();
      const found =
        (cierres ?? []).find((c) => c.anio === prevPeriod.anio && c.mes === prevPeriod.mes) ?? null;
      setCierrePrev(found);

      // 3) Datos del mes actual (Diciembre) para preview/comparativa
      // getMonthlySummary() ya trae “mes actual” por defecto (como en ResumenScreen).
      const current = await getMonthlySummary();
      setSummaryCurrent(current);

      // 4) Estado UX:
      // - Si hay cierre M-1 -> pantalla principal (comparativa + CTA reiniciar mes)
      // - Si no hay cierre -> comportamiento original (pendientes / listo para cierre)
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

          <OptionCard
            iconName="alert-circle-outline"
            title="Pendientes detectados"
            description={`Tienes ${pendientesCount} gasto(s) pendiente(s). Pulsa para revisarlos.`}
            onPress={irAPendientes}
          />

          <OptionCard
            iconName="calculator-outline"
            title="Generar cierre igualmente"
            description="Si lo necesitas, puedes forzar el cierre ahora. Recomendado solo si lo tienes controlado."
            onPress={confirmarGenerar}
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

          <OptionCard
            iconName="checkmark-circle-outline"
            title="Generar cierre"
            description={`Genera el cierre de ${mesNombreES(prevPeriod.mes)} ${prevPeriod.anio}.`}
            onPress={confirmarGenerar}
          />
        </View>
      );
    }

    // CIERRE_GENERADO: comparativa + CTA reiniciar mes (dinámico, sin chevron)
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
          onPress={irAReiniciarMes}
          showChevron={false}
        />
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      {/* Header del mes actual (M) */}
      <View style={styles.topArea}>
        <Header title="Cierre mensual" subtitleYear={currentPeriod.anio} subtitleMonth={currentPeriod.mes} showBack />
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
});

export default ReinciarCierreScreen;
