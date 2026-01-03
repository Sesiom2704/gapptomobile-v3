// mobile_app/screens/cierres/ReiniciarMesScreen.tsx
// -----------------------------------------------------------------------------
// ReiniciarMesScreen (V4)
//
// Cambios (según tu feedback):
// 1) Eliminar tarjeta "Pendientes KPI / Presupuesto COT total / Ventana" (si entras aquí, ya se cumple).
// 2) Previsualización del reinicio:
//    - Solo 2 columnas: Concepto | Cantidad
//    - Botón de info en cabecera (InfoButton a la derecha)
//    - Textos explicativos SOLO dentro del modal info (no en subtítulos visibles)
// 3) Promedios a insertar:
//    - Botón de info en cabecera
//    - Tabla: Contenedor(nombre) | Importe(promedio) | Dif mes(%)
//    - Contenedor: usar p.contenedor_nombre si viene; fallback al id
//    - Importe: siempre positivo; sin colores extra
//    - Dif mes: incremento rojo / decremento verde
//
// Requisitos de datos:
// - reinicioApi.fetchReinicioGastosIngresosPreview() debe devolver promedios con:
//   contenedor_nombre, importe_cuota_actual, dif_mes_pct
// -----------------------------------------------------------------------------
//
// Dependencias UI:
// - Usa InfoButton/InfoModal/useInfoModal como en BalanceScreen.
// -----------------------------------------------------------------------------
// Backend esperado:
// - GET  /api/v1/reinicio/mes/preview  (solo para window+elig si quisieras, aquí lo mantenemos solo para canExecute)
// - GET  /api/v1/reinicio/gastos-ingresos/preview  (con campos extra)
// - POST /api/v1/reinicio/gastos-ingresos/ejecutar?aplicar_promedios=true&enforce_window=true
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

// ✅ Info modal reutilizable (mismo patrón que BalanceScreen)
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

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
 * Formato: "HH:mm - D/MM/YYYY"
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

function fmtPct(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : null;
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function pctColor(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : null;
  if (n == null || !Number.isFinite(n) || n === 0) return colors.textSecondary;
  // ✅ incrementos rojo / decrementos verde (según tu especificación)
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  return n > 0 ? red : green;
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

  // ✅ Modal de info único
  const info = useInfoModal();

  const nowPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  const periodo = useMemo(() => {
    return {
      anio: params?.anio ?? nowPeriod.anio,
      mes: params?.mes ?? nowPeriod.mes,
    };
  }, [params?.anio, params?.mes, nowPeriod.anio, nowPeriod.mes]);

  const [state, setState] = useState<LoadState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Se mantiene para validar canExecute (window + can_reiniciar)
  const [mesPreview, setMesPreview] = useState<ReinicioMesPreview | null>(null);

  // Preview principal (conteos + promedios)
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
      await reinicioApi.postReinicioGastosIngresosEjecutar({
        aplicarPromedios: true,
        enforceWindow: true,
      });

      await load();
      Alert.alert('Reinicio aplicado', 'Los gastos/ingresos han sido reiniciados correctamente.');
      // navigation.goBack();
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido ejecutar el reinicio.');
      setState('ERROR');
    }
  };

  // ---------------------------------------------------------------------------
  // ✅ Card: Previsualización del reinicio (Concepto | Cantidad) + InfoButton
  // ---------------------------------------------------------------------------

  const renderResumenReinicio = () => {
    if (!giPreview) return null;

    const rows: Array<{ label: string; count: number }> = [
      { label: 'Gastos a reiniciar', count: Number(giPreview.gastos_a_reiniciar ?? 0) },
      { label: 'Ingresos a reiniciar', count: Number(giPreview.ingresos_a_reiniciar ?? 0) },
      { label: 'Últimas cuotas', count: Number(giPreview.ultimas_cuotas ?? 0) },
    ];

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.cardTitle}>Previsualización del reinicio</Text>
          <InfoButton
            align="title"
            onPress={() =>
              info.open(
                'Previsualización del reinicio',
                'Resumen de conteos: número de gastos e ingresos que cambiarán al reiniciar y cuántas “últimas cuotas” se detectan (cuotas_restantes == 1 en gastos con cuotas > 1).'
              )
            }
          />
        </View>

        <View style={styles.tableHeaderRow2}>
          <Text style={[styles.tableHeaderText, styles.colConcept]}>Concepto</Text>
          <Text style={[styles.tableHeaderText, styles.colCount2]}>Cantidad</Text>
        </View>
        <View style={styles.divider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow2}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colCount2}>{String(r.count)}</Text>
          </View>
        ))}

        <Text style={styles.muted}>As of: {formatNowSimple()}</Text>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // ✅ Card: Promedios a insertar (Contenedor | Importe | Dif mes) + InfoButton
  // ---------------------------------------------------------------------------

  const renderPromedios = () => {
    if (!giPreview) return null;

    const proms = Array.isArray(giPreview.promedios) ? giPreview.promedios : [];
    if (proms.length === 0) {
      return (
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardTitle}>Promedios a insertar</Text>
            <InfoButton
              align="title"
              onPress={() =>
                info.open(
                  'Promedios a insertar',
                  'PROM-3M por contenedor. Se calcula con los gastos cotidianos pagados de los últimos 3 meses (por grupos de tipo).'
                )
              }
            />
          </View>

          <Text style={styles.muted}>
            No hay promedios calculados (0). Si esperabas verlos, revisa que existan gastos COT pagados en los últimos 3
            meses.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.cardTitle}>Promedios a insertar</Text>
          <InfoButton
            align="title"
            onPress={() =>
              info.open(
                'Promedios a insertar',
                'PROM-3M por contenedor. “Importe” es el promedio calculado. “Dif mes” compara el promedio con el importe_cuota actual del contenedor (si está disponible). Incremento se muestra en rojo y decremento en verde.'
              )
            }
          />
        </View>

        <View style={styles.tableHeaderRow3}>
          <Text style={[styles.tableHeaderText, styles.colConcept]}>Contenedor</Text>
          <Text style={[styles.tableHeaderText, styles.colAmount]}>Importe</Text>
          <Text style={[styles.tableHeaderText, styles.colDiff]}>Dif mes</Text>
        </View>
        <View style={styles.divider} />

        {proms.map((p) => {
          const key = String(p.contenedor_tipo_id ?? Math.random());
          const contNombre = (p as any).contenedor_nombre ?? p.contenedor_tipo_id ?? '—';
          const val = Number((p as any).valor_promedio ?? 0);
          const difPct = (p as any).dif_mes_pct as number | null | undefined;

          return (
            <View key={key} style={styles.tableRow3}>
              <Text style={styles.colConcept}>{String(contNombre)}</Text>

              <Text style={styles.colAmount}>
                {EuroformatEuro(val, 'normal')}
              </Text>

              <Text style={[styles.colDiff, { color: pctColor(difPct) }]}>
                {fmtPct(difPct)}
              </Text>
            </View>
          );
        })}

        <Text style={styles.muted}>
          Nota: “Dif mes” se calcula como (promedio - importe_cuota_actual) / importe_cuota_actual.
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
        <Text style={styles.subtitle}>Previsualiza los cambios y ejecútalos cuando estés listo.</Text>

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

      {/* ✅ Modal global de info */}
      <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
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

  // Base card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },

  // Header por sección: título izq, info der
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },

  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },

  muted: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },

  divider: {
    height: 1,
    backgroundColor: '#E6E6EA',
    marginVertical: spacing.xs,
  },

  // -------------------------
  // Tablas
  // -------------------------
  tableHeaderText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },

  // 2 columnas (Concepto | Cantidad)
  tableHeaderRow2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  tableRow2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  colCount2: {
    width: 90,
    textAlign: 'right',
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '800',
  },

  // 3 columnas (Contenedor | Importe | Dif mes)
  tableHeaderRow3: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  tableRow3: {
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

  colAmount: {
    width: 120,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  colDiff: {
    width: 80,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '900',
    color: colors.textSecondary,
  },

  pullHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
});

export default ReiniciarMesScreen;
