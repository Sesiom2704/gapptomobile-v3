// mobile_app/screens/cierres/ReinciarCierreScreen.tsx
// -----------------------------------------------------------------------------
// ReinciarCierreScreen
//
// Ajustes solicitados:
// 1) Previsualización con 3 columnas: Concepto | Cantidad | Importe
// 2) No mostrar el mensaje “No hay pendientes detectados…” (si llegas aquí, ya es porque procede)
// 3) As of simplificado: "HH:mm - D/MM/YYYY"
// 4) Generación del cierre: usar el nuevo endpoint persistente:
//      POST /api/v1/reinicio/cierre/ejecutar?anio&mes
//    (inserta cabecera + detalle en backend)
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Formato solicitado:
 *   "17:20 - 2/01/2026"
 * - Hora: HH:mm
 * - Día: D (sin 0)
 * - Mes: MM (con 0)
 * - Año: YYYY
 *
 * Nota: usamos Date() local del dispositivo.
 */
function formatAsOfSimple(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);

  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const day = d.getDate(); // sin 0
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();

  return `${hh}:${mm} - ${day}/${month}/${year}`;
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
      try {
        const preview = await reinicioApi.fetchCierrePreview({
          anio: prevPeriod.anio,
          mes: prevPeriod.mes,
        });
        setCierrePreview(preview ?? null);
      } catch (previewErr) {
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

  /**
   * ✅ Generar cierre usando el NUEVO endpoint (persistente) en /reinicio.
   *
   * Backend:
   *   POST /api/v1/reinicio/cierre/ejecutar?anio=YYYY&mes=MM
   *
   * Importante:
   * - Este endpoint devuelve { cierre_id, ... } pero NO devuelve toda la cabecera.
   * - Por compatibilidad con el resto de la pantalla (comparativa), tras ejecutar:
   *     1) recargamos cierres con cierreMensualApi.list()
   *     2) buscamos el cierre por anio/mes y lo seteamos como cierrePrev
   */
  const generarCierre = async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      await reinicioApi.postCierreEjecutar({
        anio: prevPeriod.anio,
        mes: prevPeriod.mes,
        enforceWindow: false,
      });

      // Recargar lista para obtener la cabecera persistida (y tener todos los campos)
      const cierres = await cierreMensualApi.list();
      const found =
        (cierres ?? []).find((c) => c.anio === prevPeriod.anio && c.mes === prevPeriod.mes) ?? null;

      setCierrePrev(found);
      setState('CIERRE_GENERADO');

      // Refrescar preview (opcional, pero ayuda a que el “as_of” cambie)
      try {
        const preview = await reinicioApi.fetchCierrePreview({
          anio: prevPeriod.anio,
          mes: prevPeriod.mes,
        });
        setCierrePreview(preview ?? null);
      } catch {
        // no bloquea
      }
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
  // 3 columnas: Concepto | Cantidad | Importe
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

    const extras = cierrePreview.extras ?? {};

    // Cantidades para la columna "cantidad"
    const nIngresos =
      Number(extras?.n_ingresos_total ?? extras?.n_recurrentes_ing ?? 0) || 0;

    const nGastos =
      Number(extras?.n_gastos_reales_total ?? (extras?.n_gastos_gestionables_reales ?? 0) + (extras?.n_cotidianos ?? 0)) || 0;

    // Importes (columna importe)
    const ingresosReales = Number(cierrePreview.ingresos_reales ?? 0);
    const gastosReales = Number(cierrePreview.gastos_reales_total ?? 0);
    const resultadoReal = Number(cierrePreview.resultado_real ?? 0);

    // Nota: en tu UI ya formateas “gastos” como minus en EuroformatEuro
    const rows: Array<{
      label: string;
      count: number | null;
      value: number;
      format: 'plus' | 'minus' | 'signed';
    }> = [
      { label: 'Ingresos reales', count: nIngresos, value: ingresosReales, format: 'plus' },
      { label: 'Gastos reales', count: nGastos, value: gastosReales, format: 'minus' },
      { label: 'Resultado real', count: null, value: resultadoReal, format: 'signed' },
    ];

    const asOf = formatAsOfSimple(cierrePreview.as_of);

    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>
              Previsualización del cierre ({mesNombreES(prevPeriod.mes)} {prevPeriod.anio})
            </Text>
            <Text style={styles.previewSubtitle}>
              Valores que se insertarían al generar el cierre.
            </Text>
          </View>
        </View>

        {/* Header tabla 3 columnas */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colConcept, styles.tableHeaderText]}>Concepto</Text>
          <Text style={[styles.colCount, styles.tableHeaderText]}>Cantidad</Text>
          <Text style={[styles.colAmount, styles.tableHeaderText]}>Importe</Text>
        </View>
        <View style={styles.previewDivider} />

        {/* Filas */}
        {rows.map((r) => {
          const amountText =
            r.format === 'minus'
              ? EuroformatEuro(r.value, 'minus')
              : r.format === 'plus'
                ? EuroformatEuro(r.value, 'plus')
                : EuroformatEuro(r.value, 'signed');

          // Color: ingresos/resultados según signo; gastos en rojo por convención
          const color =
            r.label.toLowerCase().includes('gastos')
              ? moneyColor(-Math.abs(r.value))
              : moneyColor(r.value);

          return (
            <View key={r.label} style={styles.tableRow}>
              <Text style={styles.colConcept}>{r.label}</Text>
              <Text style={styles.colCount}>{r.count == null ? '—' : String(r.count)}</Text>
              <Text style={[styles.colAmount, { color }]}>{amountText}</Text>
            </View>
          );
        })}

        <Text style={styles.previewMuted}>As of: {asOf}</Text>
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

          {/* ✅ Eliminado: “No hay pendientes detectados…” */}
          <Text style={styles.subtitle}>
            Puedes generar el cierre del mes anterior.
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
    width: 60,
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
});

export default ReinciarCierreScreen;
