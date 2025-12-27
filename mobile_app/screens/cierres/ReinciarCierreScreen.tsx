// mobile_app/screens/cierres/ReinciarCierreScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { cierreMensualApi, CierreMensual } from '../../services/cierreMensualApi';
import { fetchGastos } from '../../services/gastosApi';

type CierreState = 'LOADING' | 'HAY_PENDIENTES' | 'LISTO_PARA_CIERRE' | 'CIERRE_GENERADO' | 'ERROR';

function getPrevMonthRef(baseDate = new Date()): { anio: number; mes: number } {
  // baseDate: hoy -> queremos M-1
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 }; // mes 1..12
}

function mesNombreES(m: number): string {
  const names = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function fmtEuro(n?: number): string {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  try {
    return x.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  } catch {
    return `${x.toFixed(2)} €`;
  }
}

export const ReinciarCierreScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const prev = useMemo(() => getPrevMonthRef(new Date()), []);
  const titlePeriodo = useMemo(
    () => `Cierre mensual · ${mesNombreES(prev.mes)} ${prev.anio}`,
    [prev.anio, prev.mes]
  );

  const [state, setState] = useState<CierreState>('LOADING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pendientesCount, setPendientesCount] = useState<number>(0);
  const [cierre, setCierre] = useState<CierreMensual | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      // 1) Pendientes (gestionables)
      const pendientes = await fetchGastos('pendientes');
      const count = Array.isArray(pendientes) ? pendientes.length : 0;
      setPendientesCount(count);

      // 2) Buscar cierre M-1 (si existe)
      const cierres = await cierreMensualApi.list(); // opcional: pasar userId si lo necesitas
      const found = (cierres ?? []).find((c) => c.anio === prev.anio && c.mes === prev.mes) ?? null;
      setCierre(found);

      // 3) Estado UX
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
  }, [prev.anio, prev.mes]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const irAPendientes = () => {
    // Reutiliza tu lista de gastos con filtro inicial "pendientes"
    // Ajusta route/tab según tu navegación real si difiere.
    navigation.navigate('GastosList', { initialFiltro: 'pendientes', fromHome: false });
  };

  const confirmarGenerar = () => {
    Alert.alert(
      'Generar cierre',
      `Se generará el cierre de ${mesNombreES(prev.mes)} ${prev.anio}.\n\n¿Deseas continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Generar',
          style: 'default',
          onPress: () => void generarCierre(),
        },
      ]
    );
  };

  const generarCierre = async () => {
    setState('LOADING');
    setErrorMsg(null);
    try {
      const res = await cierreMensualApi.generar({ force: false });
      setCierre(res);
      setState('CIERRE_GENERADO');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido generar el cierre.');
      setState('ERROR');
    }
  };

  const confirmarReiniciar = () => {
    if (!cierre?.id) return;

    Alert.alert(
      'Reiniciar cierre',
      'Esto eliminará el cierre generado. Podrás volver a generarlo después.\n\n¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar cierre',
          style: 'destructive',
          onPress: () => void reiniciarCierre(),
        },
      ]
    );
  };

  const reiniciarCierre = async () => {
    if (!cierre?.id) return;

    setState('LOADING');
    setErrorMsg(null);
    try {
      await cierreMensualApi.delete(cierre.id);
      setCierre(null);
      // Recalcula estado (pendientes pueden seguir en 0 o haber cambiado)
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido reiniciar el cierre.');
      setState('ERROR');
    }
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
            description={`Genera el cierre de ${mesNombreES(prev.mes)} ${prev.anio}.`}
            onPress={confirmarGenerar}
          />
        </View>
      );
    }

    // CIERRE_GENERADO
    return (
      <View style={styles.content}>
        <Text style={styles.h1}>Cierre generado</Text>
        <Text style={styles.subtitle}>
          Este resumen ya está persistido. Puedes consultarlo y, si procede, reiniciarlo.
        </Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{`${mesNombreES(prev.mes)} ${prev.anio}`}</Text>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ingresos reales</Text>
            <Text style={styles.summaryValue}>{fmtEuro(cierre?.ingresos_reales)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gastos reales</Text>
            <Text style={styles.summaryValue}>{fmtEuro(cierre?.gastos_reales_total)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Resultado real</Text>
            <Text style={styles.summaryValue}>{fmtEuro(cierre?.resultado_real)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Desviación</Text>
            <Text style={styles.summaryValue}>{fmtEuro(cierre?.desv_resultado)}</Text>
          </View>
        </View>

        <OptionCard
          iconName="stats-chart-outline"
          title="Ver detalle / KPIs"
          description="Consulta el detalle del cierre y los KPIs agregados."
          onPress={() => navigation.navigate('CierreKpiScreen', { cierreId: cierre?.id })}
        />

        <OptionCard
          iconName="trash-outline"
          title="Reiniciar (eliminar cierre)"
          description="Elimina el cierre generado para poder volver a generarlo."
          onPress={confirmarReiniciar}
        />
      </View>
    );
  };

  return (
    <Screen withHeaderBackground>
      <View style={styles.topArea}>
        <Header title={titlePeriodo} showBack />
      </View>

      <View style={styles.body}>
        {renderBody()}
      </View>
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
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textTransform: 'capitalize',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});

export default ReinciarCierreScreen;
