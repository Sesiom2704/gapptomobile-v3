// mobile_app/screens/cierres/CierreMensualPreviewScreen.tsx
// -----------------------------------------------------------------------------
// Screen: Previews mensuales (Cierre + Reinicio) - SCROLLEABLE
//
// Cambios solicitados:
// 1) Preview Cierre -> debe apuntar al mes ACTUAL (M). Ej: estando en Diciembre,
//    el preview de cierre intenta mostrar Diciembre (no Noviembre).
//    - Si el cierre de M ya existe (persistido), lo mostramos.
//    - Si no existe, mostramos "Aún no generado" (no inventamos datos).
//
// 2) La pantalla debe poder scrollear y permitir pull-to-refresh.
//
// Importante:
// - No ejecuta acciones (no genera ni reinicia). Solo consulta y muestra.
// - Reutiliza APIs existentes (no inventa endpoints).
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

import { cierreMensualApi, CierreMensual } from '../../services/cierreMensualApi';
import {
  fetchReinicioMesEligibility,
  fetchPresupuestoCotidianosTotal,
} from '../../services/reinicioApi';

import { EuroformatEuro } from '../../utils/format';

type Estado = 'LOADING' | 'OK' | 'ERROR';

function mesNombreES(m: number): string {
  const names = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

// Requisito: reinicio solo día 1..5
function isInReinicioWindow(now = new Date()): boolean {
  const d = now.getDate();
  return d >= 1 && d <= 5;
}

// Color según signo (mismo criterio que ya venías usando)
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

  // Mes actual (M): si estás en Diciembre, M = Diciembre.
  const now = useMemo(() => new Date(), []);
  const yearM = now.getFullYear();
  const monthM = now.getMonth() + 1;

  const subtitleLabel = useMemo(() => `${mesNombreES(monthM)} ${yearM}`, [monthM, yearM]);

  const [estado, setEstado] = useState<Estado>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refresh UI
  const [refreshing, setRefreshing] = useState(false);

  // --- Preview cierre (MES ACTUAL) ---
  const [cierreMesActual, setCierreMesActual] = useState<CierreMensual | null>(null);

  // --- Preview reinicio ---
  const [gastosPendientesCount, setGastosPendientesCount] = useState<number>(0);
  const [ingresosPendientesCount, setIngresosPendientesCount] = useState<number>(0);
  const [canReiniciarBackend, setCanReiniciarBackend] = useState<boolean>(false);
  const [presupuestoCotTotal, setPresupuestoCotTotal] = useState<number>(0);

  const reinicioWindowOk = useMemo(() => isInReinicioWindow(new Date()), []);
  const canReiniciar = useMemo(
    () => reinicioWindowOk && canReiniciarBackend,
    [reinicioWindowOk, canReiniciarBackend]
  );

  const load = useCallback(async () => {
    setErrorMsg(null);

    // si es primera carga, mostramos LOADING global
    setEstado((prev) => (prev === 'OK' ? prev : 'LOADING'));

    try {
      // 1) Preview cierre del mes actual (M)
      const cierres = await cierreMensualApi.list();
      const foundM =
        (cierres ?? []).find((c) => c.anio === yearM && c.mes === monthM) ?? null;
      setCierreMesActual(foundM);

      // 2) Preview reinicio (estado real backend)
      const elig = await fetchReinicioMesEligibility();
      setGastosPendientesCount(Number(elig?.gastos_pendientes ?? 0));
      setIngresosPendientesCount(Number(elig?.ingresos_pendientes ?? 0));
      setCanReiniciarBackend(!!elig?.can_reiniciar);

      const totalCot = await fetchPresupuestoCotidianosTotal();
      setPresupuestoCotTotal(Number(totalCot ?? 0));

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

  const irAFlujoCierre = () => {
    navigation.navigate('ReinciarCierreScreen');
  };

  const irAFlujoReinicio = () => {
    // Este flujo, según tu navegación actual, recibe anio/mes (lo dejamos como mes actual si quieres)
    // Si tu ReiniciarMesScreen trabaja con otra referencia, ajustamos aquí.
    navigation.navigate('ReiniciarMesScreen', {
      anio: yearM,
      mes: monthM,
      cierreId: cierreMesActual?.id ?? null,
    });
  };

  const renderCierrePreviewCard = () => {
    return (
      <View style={styles.previewBox}>
        <View style={styles.previewHeaderRow}>
          <Text style={styles.previewTitle}>Preview cierre mensual</Text>
          <Text style={styles.previewTag}>
            {mesNombreES(monthM)} {yearM}
          </Text>
        </View>

        {!cierreMesActual ? (
          <>
            <Text style={styles.previewLine}>
              Aún no hay un cierre generado para este mes.
            </Text>
            <Text style={[styles.previewLine, { marginTop: 6 }]}>
              Cuando exista (persistido), aquí verás los importes reales y la desviación.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Ingresos reales</Text>
              <Text style={[styles.kvValue, { color: moneyColor(cierreMesActual.ingresos_reales) }]}>
                {EuroformatEuro(cierreMesActual.ingresos_reales ?? 0, 'signed')}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Gastos reales</Text>
              <Text style={[styles.kvValue, { color: moneyColor(-Math.abs(cierreMesActual.gastos_reales_total ?? 0)) }]}>
                {EuroformatEuro(-Math.abs(cierreMesActual.gastos_reales_total ?? 0), 'signed')}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Resultado real</Text>
              <Text style={[styles.kvValue, { color: moneyColor(cierreMesActual.resultado_real) }]}>
                {EuroformatEuro(cierreMesActual.resultado_real ?? 0, 'signed')}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Desviación</Text>
              <Text style={[styles.kvValue, { color: moneyColor(cierreMesActual.desv_resultado) }]}>
                {EuroformatEuro(cierreMesActual.desv_resultado ?? 0, 'signed')}
              </Text>
            </View>
          </>
        )}
      </View>
    );
  };

  const renderReinicioPreviewCard = () => {
    return (
      <View style={styles.previewBox}>
        <View style={styles.previewHeaderRow}>
          <Text style={styles.previewTitle}>Preview reinicio de mes</Text>
          <Text style={styles.previewTag}>
            {mesNombreES(monthM)} {yearM}
          </Text>
        </View>

        {/* Si está fuera de ventana 1-5, lo dejamos como info breve (sin “Ventana” dentro del preview) */}
        {!reinicioWindowOk && (
          <Text style={styles.previewLine}>
            Fuera de ventana (1–5). El reinicio no debería ejecutarse.
          </Text>
        )}

        <View style={[styles.kvRow, { marginTop: reinicioWindowOk ? 0 : 8 }]}>
          <Text style={styles.kvLabel}>Estado backend</Text>
          <Text style={styles.kvValue}>{canReiniciarBackend ? 'OK' : 'NO'}</Text>
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Pendientes KPI (gastos)</Text>
          <Text style={styles.kvValue}>{gastosPendientesCount}</Text>
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Pendientes KPI (ingresos)</Text>
          <Text style={styles.kvValue}>{ingresosPendientesCount}</Text>
        </View>

        <View style={[styles.kvRow, { marginTop: 6 }]}>
          <Text style={styles.kvLabel}>Presupuesto cotidianos (total)</Text>
          <Text style={styles.kvValue}>
            {EuroformatEuro(presupuestoCotTotal ?? 0, 'signed')}
          </Text>
        </View>

        <Text style={[styles.previewLine, { marginTop: 8 }]}>
          Estado: {canReiniciar ? 'LISTO' : 'BLOQUEADO'}
        </Text>
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

    // OK
    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Previews</Text>
        <Text style={styles.subtitle}>
          Pantalla informativa: muestra el estado del cierre del mes actual y el estado del reinicio.
        </Text>

        {renderCierrePreviewCard()}
        {renderReinicioPreviewCard()}

        {/* Accesos a flujos reales (siempre scrolleable) */}
        <View style={{ gap: spacing.md }}>
          <OptionCard
            iconName="calendar-outline"
            title="Abrir flujo de cierre"
            description="Detalle, KPIs y acciones del cierre."
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

      {/* ✅ SCROLL + PULL TO REFRESH */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
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

  // ✅ En ScrollView, la “pantalla” ya no usa body flex:1,
  // sino contentContainerStyle para permitir scroll natural.
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: '#F5F5F7',
    flexGrow: 1,
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
  previewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  previewTag: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  previewLine: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  kvLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  kvValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});

export default CierreMensualPreviewScreen;
