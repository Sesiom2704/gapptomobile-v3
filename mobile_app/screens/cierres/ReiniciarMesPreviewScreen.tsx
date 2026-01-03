// mobile_app/screens/cierres/ReiniciarMesScreen.tsx
// -----------------------------------------------------------------------------
// ReiniciarMesScreen (V4)
//
// Ajustes:
// 1) Eliminar tarjeta "Pendientes KPI / presupuesto COT / ventana" (no aplica aquí).
// 2) Previsualización del reinicio: InfoButton + tabla 2 columnas (Concepto | Cantidad).
// 3) Promedios a insertar: InfoButton.
// 4) Contenedor: mostrar nombre (gasto.nombre) en vez de id.
// 5) Dif mes: comparar futuro (promedio) vs pasado (gastos.importe_cuota) y mostrar %:
//    - incremento: rojo
//    - decremento: verde
// -----------------------------------------------------------------------------

// mobile_app/screens/cierres/ReiniciarMesPreviewScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { reinicioApi, type CierrePreview, type ReinicioGastosIngresosPreview } from '../../services/reinicioApi';
import { EuroformatEuro } from '../../utils/format';

import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

type LoadState = 'LOADING' | 'OK' | 'ERROR';

type RouteParams = {
  anio?: number;
  mes?: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatNowSimple(): string {
  const d = new Date();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const day = d.getDate();
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  return `${hh}:${mm} - ${day}/${month}/${year}`;
}

function mesNombreES(m: number): string {
  const names = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function getPrevMonthRef(anio: number, mes: number): { anio: number; mes: number } {
  const d = new Date(anio, mes - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
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
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  return n > 0 ? red : green;
}

export const ReiniciarMesPreviewScreen: React.FC = () => {
  const route = useRoute<any>();
  const params = (route?.params ?? {}) as RouteParams;

  const info = useInfoModal();

  const nowPeriod = useMemo(() => {
    const now = new Date();
    return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
  }, []);

  // Periodo “consultado” (si no viene, usamos mes actual)
  const periodo = useMemo(() => {
    return {
      anio: params?.anio ?? nowPeriod.anio,
      mes: params?.mes ?? nowPeriod.mes,
    };
  }, [params?.anio, params?.mes, nowPeriod.anio, nowPeriod.mes]);

  // Para “preview cierre” usamos M-1 del periodo consultado
  const prevPeriod = useMemo(() => getPrevMonthRef(periodo.anio, periodo.mes), [periodo.anio, periodo.mes]);

  const [state, setState] = useState<LoadState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Card 1: “si cerráramos hoy” -> usamos cierre/preview del mismo periodo consultado
  const [cierreHoyPreview, setCierreHoyPreview] = useState<CierrePreview | null>(null);

  // Card 2: reinicio gastos/ingresos preview
  const [giPreview, setGiPreview] = useState<ReinicioGastosIngresosPreview | null>(null);

  // Card 3: preview cierre M-1 (como en cierre mensual)
  const [cierrePrevPreview, setCierrePrevPreview] = useState<CierrePreview | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      const [cierreHoy, giPrev, cierrePrev] = await Promise.all([
        reinicioApi.fetchCierrePreview({ anio: periodo.anio, mes: periodo.mes }),
        reinicioApi.fetchReinicioGastosIngresosPreview(),
        reinicioApi.fetchCierrePreview({ anio: prevPeriod.anio, mes: prevPeriod.mes }),
      ]);

      setCierreHoyPreview(cierreHoy ?? null);
      setGiPreview(giPrev ?? null);
      setCierrePrevPreview(cierrePrev ?? null);

      setState('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar la previsualización.');
      setState('ERROR');
    }
  }, [periodo.anio, periodo.mes, prevPeriod.anio, prevPeriod.mes]);

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

  // -----------------------------
  // Renders de tarjetas
  // -----------------------------

  const renderCardCierreHoy = () => {
    if (!cierreHoyPreview) return null;

    const rows = [
      { label: 'Ingresos reales', value: Number(cierreHoyPreview.ingresos_reales ?? 0), mode: 'plus' as const },
      { label: 'Gastos reales', value: Number(cierreHoyPreview.gastos_reales_total ?? 0), mode: 'minus' as const },
      { label: 'Resultado real', value: Number(cierreHoyPreview.resultado_real ?? 0), mode: 'signed' as const },
    ];

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.cardTitle}>Si cerráramos hoy ({mesNombreES(periodo.mes)} {periodo.anio})</Text>
        </View>

        <View style={styles.tableHeaderRow2}>
          <Text style={[styles.tableHeaderText, styles.colConcept]}>Concepto</Text>
          <Text style={[styles.tableHeaderText, styles.colAmount]}>Importe</Text>
        </View>
        <View style={styles.divider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow2}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colAmount}>
              {EuroformatEuro(r.value, r.mode)}
            </Text>
          </View>
        ))}

        <Text style={styles.muted}>As of: {formatNowSimple()}</Text>
      </View>
    );
  };

  const renderCardReinicioResumen = () => {
    if (!giPreview) return null;

    const rows: Array<{ label: string; count: number }> = [
      { label: 'Gastos a reiniciar', count: Number(giPreview.gastos_a_reiniciar ?? 0) },
      { label: 'Ingresos a reiniciar', count: Number(giPreview.ingresos_a_reiniciar ?? 0) },
      { label: 'Últimas cuotas', count: Number(giPreview.ultimas_cuotas ?? 0) },
    ];

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reinicio del mes (resumen)</Text>

        <View style={styles.tableHeaderRow2}>
          <Text style={[styles.tableHeaderText, styles.colConcept]}>Concepto</Text>
          <Text style={[styles.tableHeaderText, styles.colCount]}>Cantidad</Text>
        </View>
        <View style={styles.divider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow2}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colCount}>{String(r.count)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderCardPromedios = () => {
    if (!giPreview) return null;
    const proms = Array.isArray(giPreview.promedios) ? giPreview.promedios : [];

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reinicio del mes (promedios)</Text>

        {proms.length === 0 ? (
          <Text style={styles.muted}>No hay promedios calculados.</Text>
        ) : (
          <>
            <View style={styles.tableHeaderRow3}>
              <Text style={[styles.tableHeaderText, styles.colConcept]}>Contenedor</Text>
              <Text style={[styles.tableHeaderText, styles.colAmount]}>Importe</Text>
              <Text style={[styles.tableHeaderText, styles.colDiff]}>Dif mes</Text>
            </View>
            <View style={styles.divider} />

            {proms.map((p, idx) => {
              const nombre = String(p.contenedor_nombre ?? p.contenedor_tipo_id ?? `Contenedor ${idx + 1}`);
              const val = Number(p.valor_promedio ?? 0);
              const difPct = p.dif_mes_pct;

              return (
                <View key={`${nombre}-${idx}`} style={styles.tableRow3}>
                  <Text style={styles.colConcept}>{nombre}</Text>
                  <Text style={styles.colAmount}>{EuroformatEuro(val, 'normal')}</Text>
                  <Text style={[styles.colDiff, { color: pctColor(difPct) }]}>{fmtPct(difPct)}</Text>
                </View>
              );
            })}
          </>
        )}
      </View>
    );
  };

  const renderCardCierrePrev = () => {
    if (!cierrePrevPreview) return null;

    const rows = [
      { label: 'Ingresos reales', value: Number(cierrePrevPreview.ingresos_reales ?? 0), mode: 'plus' as const },
      { label: 'Gastos reales', value: Number(cierrePrevPreview.gastos_reales_total ?? 0), mode: 'minus' as const },
      { label: 'Resultado real', value: Number(cierrePrevPreview.resultado_real ?? 0), mode: 'signed' as const },
    ];

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.cardTitle}>Previsualización cierre ({mesNombreES(prevPeriod.mes)} {prevPeriod.anio})</Text>
        </View>

        <View style={styles.tableHeaderRow2}>
          <Text style={[styles.tableHeaderText, styles.colConcept]}>Concepto</Text>
          <Text style={[styles.tableHeaderText, styles.colAmount]}>Importe</Text>
        </View>
        <View style={styles.divider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow2}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colAmount}>
              {EuroformatEuro(r.value, r.mode)}
            </Text>
          </View>
        ))}
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
            description="Vuelve a cargar la previsualización."
            onPress={() => void load()}
          />
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.h1}>Previsualización</Text>
          <InfoButton
            align="title"
            onPress={() =>
              info.open(
                'Previsualización (Mes a mes)',
                'Esta pantalla es informativa:\n\n1) “Si cerráramos hoy”: foto del periodo consultado si lo cerraras ahora.\n2) “Reinicio del mes”: conteos y promedios que se aplicarían en un reinicio.\n3) “Previsualización cierre”: valores que se insertarían al generar/persistir el cierre del mes anterior.'
              )
            }
          />
        </View>

        {renderCardCierreHoy()}
        {renderCardReinicioResumen()}
        {renderCardPromedios()}
        {renderCardCierrePrev()}
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header
          title="Mes a mes"
          subtitleYear={periodo.anio}
          subtitleMonth={periodo.mes}
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {renderBody()}
      </ScrollView>

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
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.xl },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  h1: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  helperText: { fontSize: 13, color: colors.textSecondary },
  errorText: { fontSize: 14, color: colors.actionDanger, textAlign: 'center', marginBottom: spacing.md },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, textTransform: 'capitalize' },

  muted: { marginTop: 10, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },

  divider: { height: 1, backgroundColor: '#E6E6EA', marginVertical: spacing.xs },

  tableHeaderText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },

  tableHeaderRow2: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 6 },
  tableRow2: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 8 },

  tableHeaderRow3: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 6 },
  tableRow3: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 8 },

  colConcept: { flex: 1, fontSize: 12, color: colors.textSecondary, paddingRight: 10 },
  colCount: { width: 90, textAlign: 'right', fontSize: 12, color: colors.textSecondary, fontWeight: '800' },
  colAmount: { width: 120, textAlign: 'right', fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  colDiff: { width: 80, textAlign: 'right', fontSize: 12, fontWeight: '900', color: colors.textSecondary },
});

export default ReiniciarMesPreviewScreen;
