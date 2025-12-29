// mobile_app/screens/cierres/CierreMensualPreviewScreen.tsx
// -----------------------------------------------------------------------------
// Screen: Previews mensuales (Cierre "what-if" + Reinicio)
// - Preview Cierre: "si cerráramos ahora el mes M" (sin insertar)
// - Preview Reinicio: eligibility + presupuesto + contenedores (si backend lo da)
// - SCROLL + PULL TO REFRESH
// -----------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { reinicioApi, type CierrePreview, type ReinicioMesPreview } from '../../services/reinicioApi';
import { EuroformatEuro } from '../../utils/format';

type Estado = 'LOADING' | 'OK' | 'ERROR';

function mesNombreES(m: number): string {
  const names = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function isInReinicioWindow(now = new Date()): boolean {
  const d = now.getDate();
  return d >= 1 && d <= 5;
}

function moneyColor(value?: number | null): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  if (n > 0) return green;
  if (n < 0) return red;
  return colors.textPrimary;
}

export const CierreMensualPreviewScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const now = useMemo(() => new Date(), []);
  const yearM = now.getFullYear();
  const monthM = now.getMonth() + 1;

  const subtitleLabel = useMemo(() => `${mesNombreES(monthM)} ${yearM}`, [monthM, yearM]);

  const [estado, setEstado] = useState<Estado>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const [cierrePreview, setCierrePreview] = useState<CierrePreview | null>(null);
  const [mesPreview, setMesPreview] = useState<ReinicioMesPreview | null>(null);

  const reinicioWindowOk = useMemo(() => isInReinicioWindow(new Date()), []);

  const load = useCallback(async () => {
    setErrorMsg(null);
    setEstado((prev) => (prev === 'OK' ? prev : 'LOADING'));

    try {
      // 1) Preview cierre (what-if) del mes actual (M)
      const cierre = await reinicioApi.fetchCierrePreview({ anio: yearM, mes: monthM });
      setCierrePreview(cierre);

      // 2) Preview reinicio mes (sin insertar)
      const mp = await reinicioApi.fetchMesPreview({ anio: yearM, mes: monthM });
      setMesPreview(mp);

      setEstado('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se han podido cargar los previews.');
      setEstado('ERROR');
    }
  }, [yearM, monthM]);

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

  const irAFlujoCierre = () => navigation.navigate('ReinciarCierreScreen');

  const irAFlujoReinicio = () => {
    navigation.navigate('ReiniciarMesScreen', {
      anio: yearM,
      mes: monthM,
      cierreId: null,
    });
  };

  const renderCierrePreviewCard = () => {
    return (
      <View style={styles.previewBox}>
        <View style={styles.previewHeaderRow}>
          <Text style={styles.previewTitle}>Preview cierre mensual</Text>
          <Text style={styles.previewTag}>{mesNombreES(monthM)} {yearM}</Text>
        </View>

        {!cierrePreview ? (
          <Text style={styles.previewLine}>Sin datos de preview.</Text>
        ) : (
          <>
            <Text style={styles.previewLine}>
              Simulación: si cerraras el mes ahora (sin insertar). Corte: {cierrePreview.as_of}
            </Text>

            <View style={[styles.kvRow, { marginTop: 10 }]}>
              <Text style={styles.kvLabel}>Ingresos acumulados</Text>
              <Text style={[styles.kvValue, { color: moneyColor(cierrePreview.ingresos_reales) }]}>
                {EuroformatEuro(cierrePreview.ingresos_reales ?? 0, 'signed')}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Gastos acumulados</Text>
              <Text style={[styles.kvValue, { color: moneyColor(-Math.abs(cierrePreview.gastos_reales_total ?? 0)) }]}>
                {EuroformatEuro(-Math.abs(cierrePreview.gastos_reales_total ?? 0), 'signed')}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Resultado simulado</Text>
              <Text style={[styles.kvValue, { color: moneyColor(cierrePreview.resultado_real) }]}>
                {EuroformatEuro(cierrePreview.resultado_real ?? 0, 'signed')}
              </Text>
            </View>

            {typeof cierrePreview.desv_resultado === 'number' && (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>Desviación</Text>
                <Text style={[styles.kvValue, { color: moneyColor(cierrePreview.desv_resultado) }]}>
                  {EuroformatEuro(cierrePreview.desv_resultado ?? 0, 'signed')}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  const renderReinicioPreviewCard = () => {
    const elig = mesPreview?.eligibility;
    const canBackend = !!elig?.can_reiniciar;
    const canReiniciar = reinicioWindowOk && canBackend;

    return (
      <View style={styles.previewBox}>
        <View style={styles.previewHeaderRow}>
          <Text style={styles.previewTitle}>Preview reinicio de mes</Text>
          <Text style={styles.previewTag}>{mesNombreES(monthM)} {yearM}</Text>
        </View>

        {!reinicioWindowOk && (
          <Text style={styles.previewLine}>Fuera de ventana (1–5). El reinicio no debería ejecutarse.</Text>
        )}

        <View style={[styles.kvRow, { marginTop: reinicioWindowOk ? 0 : 8 }]}>
          <Text style={styles.kvLabel}>Estado backend</Text>
          <Text style={styles.kvValue}>{canBackend ? 'OK' : 'NO'}</Text>
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Pendientes KPI (gastos)</Text>
          <Text style={styles.kvValue}>{Number(elig?.gastos_pendientes ?? 0)}</Text>
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Pendientes KPI (ingresos)</Text>
          <Text style={styles.kvValue}>{Number(elig?.ingresos_pendientes ?? 0)}</Text>
        </View>

        <View style={[styles.kvRow, { marginTop: 6 }]}>
          <Text style={styles.kvLabel}>Presupuesto para {subtitleLabel}</Text>
          <Text style={styles.kvValue}>
            {EuroformatEuro(Number(mesPreview?.presupuesto_total ?? 0), 'signed')}
          </Text>
        </View>

        <Text style={[styles.previewLine, { marginTop: 8 }]}>
          Estado: {canReiniciar ? 'LISTO' : 'BLOQUEADO'}
        </Text>

        {/* Contenedores (si backend los envía) */}
        {Array.isArray(mesPreview?.contenedores) && mesPreview!.contenedores.length > 0 && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.previewLine}>Contenedores</Text>

            <View style={styles.grid}>
              {mesPreview!.contenedores.map((c, idx) => (
                <View key={`${c.id ?? c.label}-${idx}`} style={styles.gridCell}>
                  <Text style={styles.gridLabel} numberOfLines={1}>{c.label}</Text>
                  <Text style={styles.gridValue}>
                    {EuroformatEuro(Number(c.presupuesto ?? 0), 'normal')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderBody = () => {
    if (estado === 'LOADING') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.helperText}>Cargando previews…</Text>
        </View>
      );
    }

    if (estado === 'ERROR') {
      return (
        <View style={styles.content}>
          <Text style={styles.errorText}>{errorMsg ?? 'Error inesperado.'}</Text>
          <OptionCard
            iconName="refresh-outline"
            title="Reintentar"
            description="Desliza hacia abajo o pulsa para recargar."
            onPress={() => void load()}
          />
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Previews</Text>
        <Text style={styles.subtitle}>
          Pantalla informativa: simula el cierre del mes actual y muestra el estado del reinicio.
        </Text>

        {renderCierrePreviewCard()}
        {renderReinicioPreviewCard()}

        <View style={{ gap: spacing.md }}>
          <OptionCard
            iconName="calendar-outline"
            title="Abrir flujo de cierre"
            description="Acciones y flujo de cierre."
            onPress={irAFlujoCierre}
          />
          <OptionCard
            iconName="repeat-outline"
            title="Abrir flujo de reinicio"
            description="Validación y reinicio de estados."
            onPress={irAFlujoReinicio}
          />
        </View>
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header title="Previews mensuales" subtitle={subtitleLabel} showBack />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
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
    color: (colors as any).actionDanger ?? (colors as any).danger ?? '#b91c1c',
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  previewBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  previewTag: { fontSize: 11, color: colors.textSecondary },
  previewLine: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  kvLabel: { fontSize: 12, color: colors.textSecondary },
  kvValue: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  gridCell: {
    width: '48%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E6E6EA',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  gridLabel: { fontSize: 11, color: colors.textSecondary },
  gridValue: { marginTop: 2, fontSize: 13, fontWeight: '800', color: colors.textPrimary },
});

export default CierreMensualPreviewScreen;
