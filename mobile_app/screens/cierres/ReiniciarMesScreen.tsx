// mobile_app/screens/cierres/ReiniciarMesScreen.tsx
// -----------------------------------------------------------------------------
// ReiniciarMesScreen (V3)
//
// Objetivo:
// - Antes de ejecutar, mostrar preview del reinicio de gastos/ingresos:
//   1.1 Cuántos gastos se reinician
//   1.2 Cuántos ingresos se reinician
//   1.3 Cuántas cuotas son las últimas (V2 no lo hacía)
//   1.4 Qué promedios se insertarán en su contenedor
// - Al pulsar el botón, ejecutar y aplicar cambios.
//
// Backend esperado (V3):
// - GET  /api/v1/reinicio/mes/preview
// - GET  /api/v1/reinicio/gastos-ingresos/preview
// - POST /api/v1/reinicio/gastos-ingresos/ejecutar?aplicar_promedios=...&enforce_window=...
//
// Notas de UX:
// - Se mantiene patrón de diseño de ReinciarCierreScreen:
//   * estados LOADING/ERROR/OK
//   * cards y tabla 3 columnas
//   * confirmación con Alert
// -----------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { reinicioApi, type ReinicioMesPreview, type ReinicioGastosIngresosPreview } from '../../services/reinicioApi';
import { EuroformatEuro } from '../../utils/format';

type LoadState = 'LOADING' | 'OK' | 'ERROR';

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Formato consistente con lo que ya estabas pidiendo:
 * "HH:mm - D/MM/YYYY"
 * (fecha/hora local del dispositivo)
 */
function formatNowSimple(): string {
  const d = new Date();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const day = d.getDate();
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  return `${hh}:${mm} - ${day}/${month}/${year}`;
}

function moneyColor(value?: number | null): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  if (n > 0) return green;
  if (n < 0) return red;
  return colors.textPrimary;
}

type RouteParams = {
  anio?: number;
  mes?: number;
  cierreId?: string | null;
};

export const ReiniciarMesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route?.params ?? {}) as RouteParams;

  const nowPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  const periodo = useMemo(() => {
    // si vienes desde cierre, respetamos lo que te pasen; si no, usamos mes actual
    return {
      anio: params?.anio ?? nowPeriod.anio,
      mes: params?.mes ?? nowPeriod.mes,
    };
  }, [params?.anio, params?.mes, nowPeriod.anio, nowPeriod.mes]);

  const [state, setState] = useState<LoadState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Preview “mes” (ventana 1-5 + eligibility KPI + presupuesto cot)
  const [mesPreview, setMesPreview] = useState<ReinicioMesPreview | null>(null);

  // Preview “gastos-ingresos” (lo que pide el screen: 1.1..1.4)
  const [giPreview, setGiPreview] = useState<ReinicioGastosIngresosPreview | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      const [mesPrev, giPrev] = await Promise.all([
        reinicioApi.fetchMesPreview({ anio: periodo.anio, mes: periodo.mes }),
        reinicioApi.fetchReinicioGastosIngresosPreview(),
      ]);

      setMesPreview(mesPrev ?? null);
      setGiPreview(giPrev ?? null);

      setState('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar la previsualización del reinicio.');
      setState('ERROR');
    }
  }, [periodo.anio, periodo.mes]);

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

  const canExecute = useMemo(() => {
    // Reglas:
    // - Necesitamos previews
    // - Recomendado: estar en ventana 1..5 (si backend lo está forzando, enforce_window lo hará cumplir)
    // - No se puede si hay pendientes KPI (can_reiniciar)
    const windowOk = !!mesPreview?.ventana_1_5_ok;
    const eligOk = !!mesPreview?.eligibility?.can_reiniciar;

    return !!giPreview && !!mesPreview && windowOk && eligOk;
  }, [giPreview, mesPreview]);

  const disabledReason = useMemo(() => {
    if (canExecute) return null;

    const parts: string[] = [];
    if (!mesPreview) parts.push('Preview de mes no disponible');
    if (!giPreview) parts.push('Preview de reinicio no disponible');

    const windowOk = !!mesPreview?.ventana_1_5_ok;
    const elig = mesPreview?.eligibility;

    if (mesPreview && !windowOk) parts.push('Disponible del día 1 al 5');
    if (elig && !elig.can_reiniciar) {
      const g = Number(elig.gastos_pendientes ?? 0);
      const i = Number(elig.ingresos_pendientes ?? 0);
      parts.push(`Pendientes KPI: gastos ${g}, ingresos ${i}`);
    }

    return parts.join(' · ');
  }, [canExecute, mesPreview, giPreview]);

  const confirmarEjecutar = () => {
    if (!canExecute) return;

    const gastos = giPreview?.gastos_a_reiniciar ?? 0;
    const ingresos = giPreview?.ingresos_a_reiniciar ?? 0;
    const ultimas = giPreview?.ultimas_cuotas ?? 0;
    const nProm = giPreview?.promedios?.length ?? 0;

    Alert.alert(
      'Reiniciar mes',
      `Se aplicarán cambios en ${mesNombreES(periodo.mes)} ${periodo.anio}.\n\n` +
        `• Gastos a reiniciar: ${gastos}\n` +
        `• Ingresos a reiniciar: ${ingresos}\n` +
        `• Últimas cuotas: ${ultimas}\n` +
        `• Promedios a actualizar: ${nProm}\n\n` +
        `¿Deseas continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reiniciar', style: 'destructive', onPress: () => void ejecutarReinicio() },
      ]
    );
  };

  const ejecutarReinicio = async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      // enforceWindow=true para que backend bloquee fuera 1..5 (alineado con la preview)
      await reinicioApi.postReinicioGastosIngresosEjecutar({
        aplicarPromedios: true,
        enforceWindow: true,
      });

      // Recargar previews para reflejar el nuevo estado
      await load();

      Alert.alert('Reinicio aplicado', 'Los gastos/ingresos han sido reiniciados correctamente.');

      // Si quieres navegar automáticamente, puedes cambiarlo:
      // navigation.goBack();
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido ejecutar el reinicio.');
      setState('ERROR');
    }
  };

  // ---------------------------------------------------------------------------
  // Render preview “Resumen reinicio” (1.1–1.3) en tabla 3 columnas:
  // Concepto | Cantidad | Importe
  // (Importe no aplica para 1.1–1.3, se muestra "—")
  // ---------------------------------------------------------------------------

  const renderResumenReinicio = () => {
    if (!giPreview) return null;

    const rows: Array<{ label: string; count: number; amountText: string; amountColor?: string }> = [
      { label: 'Gastos a reiniciar', count: Number(giPreview.gastos_a_reiniciar ?? 0), amountText: '—' },
      { label: 'Ingresos a reiniciar', count: Number(giPreview.ingresos_a_reiniciar ?? 0), amountText: '—' },
      { label: 'Últimas cuotas', count: Number(giPreview.ultimas_cuotas ?? 0), amountText: '—' },
    ];

    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>Previsualización del reinicio</Text>
            <Text style={styles.previewSubtitle}>
              Resumen de lo que se aplicará al reiniciar.
            </Text>
          </View>
        </View>

        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colConcept, styles.tableHeaderText]}>Concepto</Text>
          <Text style={[styles.colCount, styles.tableHeaderText]}>Cantidad</Text>
          <Text style={[styles.colAmount, styles.tableHeaderText]}>Importe</Text>
        </View>
        <View style={styles.previewDivider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colCount}>{String(r.count)}</Text>
            <Text style={[styles.colAmount, { color: r.amountColor ?? colors.textSecondary }]}>
              {r.amountText}
            </Text>
          </View>
        ))}

        <Text style={styles.previewMuted}>As of: {formatNowSimple()}</Text>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Render promedios (1.4) en tabla 3 columnas:
  // Contenedor (id) | Cantidad (n_gastos_afectados) | Importe (valor_promedio)
  // ---------------------------------------------------------------------------

  const renderPromedios = () => {
    if (!giPreview) return null;

    const proms = Array.isArray(giPreview.promedios) ? giPreview.promedios : [];
    if (proms.length === 0) {
      return (
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Promedios a insertar</Text>
          <Text style={[styles.previewMuted, { marginTop: 6 }]}>
            No hay promedios calculados (0). Si esperabas verlos, revisa que existan gastos COT pagados en los últimos 3 meses.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>Promedios a insertar</Text>
            <Text style={styles.previewSubtitle}>
              Contenedores que se actualizarán con el promedio (PROM-3M).
            </Text>
          </View>
        </View>

        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colConcept, styles.tableHeaderText]}>Contenedor</Text>
          <Text style={[styles.colCount, styles.tableHeaderText]}>Cantidad</Text>
          <Text style={[styles.colAmount, styles.tableHeaderText]}>Importe</Text>
        </View>
        <View style={styles.previewDivider} />

        {proms.map((p) => {
          const cont = String(p.contenedor_tipo_id ?? '—');
          const n = Number(p.n_gastos_afectados ?? 0);
          const val = Number(p.valor_promedio ?? 0);

          return (
            <View key={cont} style={styles.tableRow}>
              <Text style={styles.colConcept}>{cont}</Text>
              <Text style={styles.colCount}>{String(n)}</Text>
              <Text style={[styles.colAmount, { color: moneyColor(val) }]}>
                {EuroformatEuro(val, 'plus')}
              </Text>
            </View>
          );
        })}

        <Text style={styles.previewMuted}>
          Nota: “Cantidad” indica cuántos gastos contenedor se actualizarán con ese promedio.
        </Text>
      </View>
    );
  };

  const renderMesInfo = () => {
    if (!mesPreview) return null;

    const elig = mesPreview.eligibility;
    const cotTotal = Number(mesPreview.presupuesto_cotidianos_total?.total ?? 0);

    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>
          {mesNombreES(periodo.mes)} {periodo.anio}
        </Text>

        <View style={[styles.row, { marginTop: 10 }]}>
          <Text style={styles.label}>Ventana (1–5)</Text>
          <Text style={[styles.value, { color: mesPreview.ventana_1_5_ok ? moneyColor(1) : moneyColor(-1) }]}>
            {mesPreview.ventana_1_5_ok ? 'OK' : 'Fuera de ventana'}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Pendientes KPI</Text>
          <Text style={styles.value}>
            {`Gastos ${Number(elig?.gastos_pendientes ?? 0)} · Ingresos ${Number(elig?.ingresos_pendientes ?? 0)}`}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Presupuesto COT (total)</Text>
          <Text style={[styles.value, { color: moneyColor(-Math.abs(cotTotal)) }]}>
            {EuroformatEuro(cotTotal, 'minus')}
          </Text>
        </View>

        <Text style={styles.helperSmall}>
          El reinicio se bloquea si hay pendientes KPI o si estás fuera del día 1 al 5.
        </Text>
      </View>
    );
  };

  const renderBody = () => {
    if (state === 'LOADING') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.helperText}>Cargando previsualización…</Text>
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
            description="Vuelve a cargar la previsualización."
            onPress={() => void load()}
          />
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Reiniciar mes</Text>
        <Text style={styles.subtitle}>
          Previsualiza los cambios y ejecútalos cuando estés listo.
        </Text>

        {renderMesInfo()}
        {renderResumenReinicio()}
        {renderPromedios()}

        <OptionCard
          iconName="repeat-outline"
          title="Aplicar reinicio"
          description={
            canExecute
              ? 'Aplicará el reinicio de gastos/ingresos y actualizará promedios en contenedores.'
              : (disabledReason ?? 'No disponible')
          }
          onPress={confirmarEjecutar}
          state={canExecute ? 'enabled' : 'disabled'}
          onDisabledPress={() => Alert.alert('No disponible', disabledReason ?? 'No cumples las condiciones.')}
          showChevron={false}
        />

        <Text style={styles.pullHint}>Desliza hacia abajo para recomprobar.</Text>
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header title="Reiniciar mes" subtitleYear={periodo.anio} subtitleMonth={periodo.mes} showBack />
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

  // Card base (tipo “comparativa”)
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'capitalize',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    alignItems: 'baseline',
  },
  label: { fontSize: 13, color: colors.textSecondary },
  value: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  helperSmall: { marginTop: 8, fontSize: 11, color: colors.textSecondary, lineHeight: 16 },

  // Preview cards
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
    marginTop: 10,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },

  // Tabla 3 columnas
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  tableHeaderText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  colConcept: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    paddingRight: 10,
  },
  colCount: {
    width: 70,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  colAmount: {
    width: 140,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E6E6EA',
    marginVertical: spacing.xs,
  },

  pullHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
});

export default ReiniciarMesScreen;
