// mobile_app/screens/cierres/ReiniciarMesScreen.tsx
// -----------------------------------------------------------------------------
// ReiniciarMesScreen (ajustes según lo comentado)
//
// Requisitos aplicados:
// 1) En la preview NO mostramos:
//    - Ventana 1-5 (se muestra en mensaje superior si aplica)
//    - Gastos pendientes / Ingresos pendientes (eso va en el botón)
// 2) Botón “Reiniciar mes”:
//    - Usa OptionCard con state enabled/disabled
//    - Si disabled y pulsas: mensaje (Alert)
//    - En description aparecen los motivos (ventana o pendientes)
// 3) Sin botón “Recomprobar”:
//    - Pull-to-refresh (deslizar hacia abajo) recarga
//
// Nota: El desglose por contenedores se mantiene como placeholder vacío
// (sin inventar datos) hasta que conectemos el endpoint real.
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
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import {
  fetchReinicioMesEligibility,
  fetchPresupuestoCotidianosTotal,
  postReiniciarMes
} from '../../services/reinicioApi';

import { EuroformatEuro } from '../../utils/format';

type Estado =
  | 'LOADING'
  | 'BLOQUEADO'
  | 'LISTO'
  | 'EJECUTANDO'
  | 'OK'
  | 'ERROR';

type RouteParams = {
  anio: number;
  mes: number;
  cierreId?: string | null;
};

type PresupuestoContenedor = {
  id: string;
  nombre: string;
  total: number;
};

function mesNombreES(m: number): string {
  const names = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

// Reinicio solo día 1..5
function isInReinicioWindow(now = new Date()): boolean {
  const d = now.getDate();
  return d >= 1 && d <= 5;
}

export const ReiniciarMesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { anio, mes } = (route.params ?? {}) as RouteParams;

  const subtitleLabel = useMemo(() => `${mesNombreES(mes)} ${anio}`, [mes, anio]);

  const [estado, setEstado] = useState<Estado>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [gastosPendientesCount, setGastosPendientesCount] = useState<number>(0);
  const [ingresosPendientesCount, setIngresosPendientesCount] = useState<number>(0);
  const [canReiniciarBackend, setCanReiniciarBackend] = useState<boolean>(false);

  // Preview total + contenedores
  const [presupuestoCotTotal, setPresupuestoCotTotal] = useState<number>(0);
  const [contenedores, setContenedores] = useState<PresupuestoContenedor[]>([]);

  // Summary tras ejecutar
  const [lastSummary, setLastSummary] = useState<any>(null);

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);

  const reinicioWindowOk = useMemo(() => isInReinicioWindow(new Date()), []);
  const hasPendientes = (gastosPendientesCount ?? 0) > 0 || (ingresosPendientesCount ?? 0) > 0;

  const canReiniciar = useMemo(() => {
    return reinicioWindowOk && canReiniciarBackend;
  }, [reinicioWindowOk, canReiniciarBackend]);

  const load = useCallback(async () => {
    setEstado('LOADING');
    setErrorMsg(null);

    try {
      const elig = await fetchReinicioMesEligibility();
      setGastosPendientesCount(Number(elig?.gastos_pendientes ?? 0));
      setIngresosPendientesCount(Number(elig?.ingresos_pendientes ?? 0));
      setCanReiniciarBackend(!!elig?.can_reiniciar);

      // Preview: presupuesto total de “cotidianos”
      const totalCot = await fetchPresupuestoCotidianosTotal();
      setPresupuestoCotTotal(Number(totalCot ?? 0));

      // Contenedores: aún no conectado (no inventamos)
      setContenedores([]);

      const blocked = !elig?.can_reiniciar || !reinicioWindowOk;
      setEstado(blocked ? 'BLOQUEADO' : 'LISTO');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar el estado del mes.');
      setEstado('ERROR');
    }
  }, [reinicioWindowOk]);

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

  const irAGastosPendientes = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'GastosList',
      params: {
        initialFiltro: 'pendientes',
        fromHome: false,
        returnToTab: 'MonthTab',
        returnToScreen: 'ReiniciarMesScreen',
      },
    });
  };

  const irAIngresosPendientes = () => {
    navigation.navigate('DayToDayTab', {
      screen: 'IngresosList',
      params: {
        fromHome: false,
        returnToTab: 'MonthTab',
        returnToScreen: 'ReiniciarMesScreen',
      },
    });
  };

  const confirmarReiniciarMes = () => {
    if (!canReiniciar) return;

    Alert.alert(
      'Reiniciar mes',
      'Se aplicará el reinicio de estados (gastos e ingresos) para el nuevo mes.\n\n¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reiniciar', style: 'destructive', onPress: () => void reiniciarMes() },
      ]
    );
  };

  const reiniciarMes = async () => {
    try {
      setEstado('EJECUTANDO');
      setErrorMsg(null);

      const res = await postReiniciarMes({ aplicarPromedios: true });
      setLastSummary(res?.summary ?? null);

      setEstado('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido reiniciar el mes.');
      setEstado('ERROR');
    }
  };

  const disabledReason = useMemo(() => {
    if (canReiniciar) return null;

    const parts: string[] = [];
    if (!reinicioWindowOk) parts.push('Disponible del día 1 al 5');
    if (hasPendientes) parts.push(`Pendientes: ${gastosPendientesCount} gastos · ${ingresosPendientesCount} ingresos`);
    if (!reinicioWindowOk && !hasPendientes && !canReiniciarBackend) parts.push('Bloqueado por backend');
    return parts.join(' · ');
  }, [canReiniciar, reinicioWindowOk, hasPendientes, gastosPendientesCount, ingresosPendientesCount, canReiniciarBackend]);

  const renderPreview = () => {
    return (
      <View style={styles.previewBox}>
        <Text style={styles.previewTitle}>Preview</Text>

        {/* Solo presupuesto (renombrado como pediste) */}
        <View style={styles.previewRow}>
          <Text style={styles.previewKey}>{`Presupuesto para ${subtitleLabel}`}</Text>
          <Text style={styles.previewValStrong}>{EuroformatEuro(presupuestoCotTotal, 'normal')}</Text>
        </View>

        {/* Contenedores (2 por fila) */}
        <Text style={[styles.previewSectionTitle, { marginTop: 10 }]}>Contenedores</Text>

        {contenedores.length === 0 ? (
          <Text style={styles.previewEmpty}>
            Aún no disponible: falta conectar el endpoint de contenedores y sus presupuestos.
          </Text>
        ) : (
          <View style={styles.grid}>
            {contenedores.map((c) => (
              <View key={c.id} style={styles.gridCell}>
                <Text style={styles.gridLabel} numberOfLines={1}>
                  {c.nombre}
                </Text>
                <Text style={styles.gridValue}>{EuroformatEuro(c.total, 'normal')}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderTopMessage = () => {
    // Mensaje superior (sustituye a “Ventana” en preview)
    if (!reinicioWindowOk) {
      return (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Fuera de ventana</Text>
          <Text style={styles.infoText}>El reinicio solo está disponible del día 1 al 5.</Text>
        </View>
      );
    }

    if (hasPendientes) {
      return (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Hay pendientes KPI</Text>
          <Text style={styles.infoText}>
            Debes dejar a cero los pendientes antes de reiniciar. Se muestran en el botón.
          </Text>
        </View>
      );
    }

    return null;
  };

  const renderBody = () => {
    if (estado === 'LOADING' || estado === 'EJECUTANDO') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.helperText}>
            {estado === 'EJECUTANDO' ? 'Aplicando reinicio…' : 'Cargando estado del mes…'}
          </Text>
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
            description="Vuelve a cargar el estado del mes."
            onPress={() => void load()}
          />
        </View>
      );
    }

    if (estado === 'OK') {
      return (
        <View style={styles.content}>
          <Text style={styles.h1}>Reinicio aplicado</Text>
          <Text style={styles.subtitle}>El backend ha ejecutado el reinicio. Resumen:</Text>

          {lastSummary && (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Cambios</Text>
              <Text style={styles.previewLine}>
                Gastos · Mensuales reseteados: {lastSummary?.Gastos?.['Mensuales reseteados'] ?? 0}
              </Text>
              <Text style={styles.previewLine}>
                Gastos · Periódicos reactivados: {lastSummary?.Gastos?.['Periódicos reactivados'] ?? 0}
              </Text>
              <Text style={styles.previewLine}>
                Gastos · COT forzados visibles: {lastSummary?.Gastos?.['COT forzados visibles'] ?? 0}
              </Text>
              <Text style={styles.previewLine}>
                Gastos · Promedios actualizados: {lastSummary?.Gastos?.['Promedios actualizados'] ?? 0}
              </Text>
              <Text style={styles.previewLine}>
                Ingresos · Mensuales reseteados: {lastSummary?.Ingresos?.['Mensuales reseteados'] ?? 0}
              </Text>
              <Text style={styles.previewLine}>
                Ingresos · Periódicos reactivados: {lastSummary?.Ingresos?.['Periódicos reactivados'] ?? 0}
              </Text>
            </View>
          )}

          <Text style={styles.pullHint}>Desliza hacia abajo para refrescar el estado.</Text>
        </View>
      );
    }

    // BLOQUEADO o LISTO
    const isBlocked = !canReiniciar;

    return (
      <View style={styles.content}>
        <Text style={styles.h1}>{isBlocked ? 'No se puede reiniciar aún' : 'Listo para reiniciar'}</Text>
        <Text style={styles.subtitle}>
          {isBlocked
            ? 'Revisa la ventana y pendientes KPI antes de continuar.'
            : 'Cumples requisitos. Puedes aplicar el reinicio.'}
        </Text>

        {renderTopMessage()}
        {renderPreview()}

        {/* Botón principal: pendientes y ventana van aquí (no en preview) */}
        <OptionCard
          iconName="repeat-outline"
          title="Reiniciar mes"
          description={
            canReiniciar
              ? 'Ejecuta el reinicio de estados para el nuevo mes (incluye promedios 3M).'
              : (disabledReason ?? 'No disponible')
          }
          onPress={confirmarReiniciarMes}
          state={canReiniciar ? 'enabled' : 'disabled'}
          onDisabledPress={() =>
            Alert.alert(
              'No disponible',
              disabledReason ?? 'Para reiniciar debes cumplir las condiciones (ventana 1–5 y sin pendientes KPI).'
            )
          }
          showChevron={false}
        />

        {/* Accesos directos (opcionales pero útiles) */}
        {gastosPendientesCount > 0 && (
          <OptionCard
            iconName="alert-circle-outline"
            title="Revisar gastos pendientes"
            description={`Pendientes KPI: ${gastosPendientesCount}.`}
            onPress={irAGastosPendientes}
          />
        )}

        {ingresosPendientesCount > 0 && (
          <OptionCard
            iconName="alert-circle-outline"
            title="Revisar ingresos pendientes"
            description={`Pendientes KPI: ${ingresosPendientesCount}.`}
            onPress={irAIngresosPendientes}
          />
        )}

        <Text style={styles.pullHint}>Desliza hacia abajo para recomprobar.</Text>
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header title="Reiniciar mes" subtitle={subtitleLabel} showBack />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
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

  body: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
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

  // Mensaje superior “ventana/pending”
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  previewBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },

  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
  },
  previewKey: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  previewValStrong: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
  },

  previewSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  previewEmpty: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },

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
  gridLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  gridValue: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  previewLine: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  pullHint: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
});

export default ReiniciarMesScreen;
