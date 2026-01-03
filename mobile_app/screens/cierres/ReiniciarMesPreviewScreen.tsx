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


import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

import { reinicioApi, type ReinicioGastosIngresosPreview } from '../../services/reinicioApi';
import { EuroformatEuro } from '../../utils/format';

// ✅ Para comparar vs lo insertado actualmente
import { fetchGastos, type Gasto } from '../../services/gastosApi';

// ✅ Info modal reutilizable (patrón BalanceScreen)
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

type LoadState = 'LOADING' | 'OK' | 'ERROR';

type RouteParams = {
  anio?: number;
  mes?: number;
  cierreId?: string | null;
};

function mesNombreES(m: number): string {
  const names = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return names[m - 1] ?? `mes ${m}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * "HH:mm - D/MM/YYYY" (fecha/hora local del dispositivo)
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

function normalizeKey(nombre: any): string {
  return String(nombre ?? '').trim().toUpperCase();
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function deltaColor(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return colors.textSecondary;
  const green = (colors as any).success ?? (colors as any).actionSuccess ?? '#16a34a';
  const red = (colors as any).danger ?? (colors as any).actionDanger ?? '#b91c1c';
  return pct > 0 ? red : green; // ✅ incremento rojo, decremento verde
}

export const ReiniciarMesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route?.params ?? {}) as RouteParams;

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

  // Preview “gastos-ingresos” (lo que pide el screen: 1.1..1.4)
  const [giPreview, setGiPreview] = useState<ReinicioGastosIngresosPreview | null>(null);

  // Mapa "pasado" por nombre: gasto.nombre -> gasto.importe_cuota
  const [importeCuotaByNombre, setImporteCuotaByNombre] = useState<Record<string, number>>({});

  // ✅ Info modal (único por pantalla)
  const info = useInfoModal();

  const load = useCallback(async () => {
    setState('LOADING');
    setErrorMsg(null);

    try {
      const [giPrev, gastosActivos] = await Promise.all([
        reinicioApi.fetchReinicioGastosIngresosPreview(),
        fetchGastos('activos'),
      ]);

      setGiPreview(giPrev ?? null);

      const map: Record<string, number> = {};
      (gastosActivos ?? []).forEach((g: Gasto) => {
        const key = normalizeKey(g?.nombre);
        const cuota = Number(g?.importe_cuota ?? 0);

        // Si hay duplicados por nombre, nos quedamos con el último (o el >0)
        if (!key) return;
        if (!Number.isFinite(cuota)) return;

        // Preferimos un valor >0 si existe
        if (map[key] == null || map[key] === 0) map[key] = cuota;
      });

      setImporteCuotaByNombre(map);

      setState('OK');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido cargar la previsualización del reinicio.');
      setState('ERROR');
    }
  }, []);

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
    // Si llegas aquí ya cumples condiciones de navegación.
    // Aun así: no ejecutamos sin preview.
    return !!giPreview;
  }, [giPreview]);

  const disabledReason = useMemo(() => {
    if (canExecute) return null;
    if (!giPreview) return 'Preview de reinicio no disponible';
    return 'No disponible';
  }, [canExecute, giPreview]);

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
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'No se ha podido ejecutar el reinicio.');
      setState('ERROR');
    }
  };

  // ---------------------------------------------------------------------------
  // (2) Previsualización del reinicio: 2 columnas (Concepto | Cantidad) + InfoButton
  // ---------------------------------------------------------------------------

  const renderResumenReinicio = () => {
    if (!giPreview) return null;

    const rows: Array<{ label: string; count: number }> = [
      { label: 'Gastos a reiniciar', count: Number(giPreview.gastos_a_reiniciar ?? 0) },
      { label: 'Ingresos a reiniciar', count: Number(giPreview.ingresos_a_reiniciar ?? 0) },
      { label: 'Últimas cuotas', count: Number(giPreview.ultimas_cuotas ?? 0) },
    ];

    return (
      <View style={styles.previewCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>Previsualización del reinicio</Text>
            <Text style={styles.previewSubtitle}>Resumen de lo que se aplicará al reiniciar.</Text>
          </View>

          <InfoButton
            align="title"
            onPress={() =>
              info.open(
                'Previsualización del reinicio',
                'Resumen de conteos: gastos e ingresos que se reinician y cuántas últimas cuotas se detectan.'
              )
            }
          />
        </View>

        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colConcept, styles.tableHeaderText]}>Concepto</Text>
          <Text style={[styles.colCount, styles.tableHeaderText]}>Cantidad</Text>
        </View>
        <View style={styles.previewDivider} />

        {rows.map((r) => (
          <View key={r.label} style={styles.tableRow2}>
            <Text style={styles.colConcept}>{r.label}</Text>
            <Text style={styles.colCount}>{String(r.count)}</Text>
          </View>
        ))}

        <Text style={styles.previewMuted}>As of: {formatNowSimple()}</Text>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // (3)(4)(5) Promedios: Contenedor (nombre) | Importe | Dif mes
  // ---------------------------------------------------------------------------

  const renderPromedios = () => {
    if (!giPreview) return null;

    const proms = Array.isArray(giPreview.promedios) ? giPreview.promedios : [];
    if (proms.length === 0) {
      return (
        <View style={styles.previewCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.previewTitle}>Promedios a insertar</Text>
            <InfoButton
              align="title"
              onPress={() =>
                info.open(
                  'Promedios a insertar',
                  'Promedios calculados (PROM-3M) que se aplicarán sobre contenedores. Se comparan con el importe actual (importe_cuota) para ver la variación porcentual.'
                )
              }
            />
          </View>

          <Text style={[styles.previewMuted, { marginTop: 6 }]}>
            No hay promedios calculados (0). Si esperabas verlos, revisa que existan gastos COT pagados en los últimos 3 meses.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.previewCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>Promedios a insertar</Text>
            <Text style={styles.previewSubtitle}>
              Se actualizarán contenedores con el promedio (PROM-3M) y se compara contra el importe actual.
            </Text>
          </View>

          <InfoButton
            align="title"
            onPress={() =>
              info.open(
                'Promedios a insertar',
                '“Contenedor” es el nombre del gasto. “Importe” es el promedio calculado. “Dif mes” muestra la variación porcentual vs el importe actual (importe_cuota) del gasto activo con el mismo nombre.'
              )
            }
          />
        </View>

        <View style={styles.tableHeaderRow3}>
          <Text style={[styles.colConcept, styles.tableHeaderText]}>Contenedor</Text>
          <Text style={[styles.colAmountSimple, styles.tableHeaderText]}>Importe</Text>
          <Text style={[styles.colDelta, styles.tableHeaderText]}>Dif mes</Text>
        </View>
        <View style={styles.previewDivider} />

        {proms.map((p: any, idx: number) => {
          // ✅ Preferimos nombre (lo que necesitas)
          // Fallbacks para no romper mientras ajustas router/backend.
          const nombreRaw =
            p?.nombre ??
            p?.gasto_nombre ??
            p?.contenedor_nombre ??
            p?.contenedor ??
            p?.contenedor_tipo_id ??
            `Contenedor ${idx + 1}`;

          const nombre = String(nombreRaw);
          const key = normalizeKey(nombre);

          const n = Number(p?.n_gastos_afectados ?? 0);
          const futuro = Number(p?.valor_promedio ?? 0);

          const pasado = Number(importeCuotaByNombre[key] ?? 0);
          const difPct =
            pasado > 0 && Number.isFinite(pasado) && Number.isFinite(futuro)
              ? ((futuro - pasado) / pasado) * 100
              : null;

          return (
            <View key={`${key}-${idx}`} style={styles.tableRow3}>
              <Text style={styles.colConcept}>{nombre}</Text>

              {/* Importe: sin colores “extra”, siempre positivo */}
              <Text style={styles.colAmountSimple}>
                {EuroformatEuro(futuro, 'normal')}
              </Text>

              <Text style={[styles.colDelta, { color: deltaColor(difPct) }]}>
                {fmtPct(difPct)}
              </Text>
            </View>
          );
        })}

        <Text style={styles.previewMuted}>
          Nota: “Dif mes” compara el promedio (futuro) vs el importe_cuota actual del gasto activo con el mismo nombre.
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

        {/* ✅ Eliminado: renderMesInfo() */}

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

  // Preview cards
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },

  // Header por sección: título izquierda, "i" derecha
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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

  // Tabla base
  tableHeaderText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E6E6EA',
    marginVertical: spacing.xs,
  },

  // 2 columnas (resumen reinicio)
  tableHeaderRow: {
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

  // 3 columnas (promedios + dif)
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
  colCount: {
    width: 80,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
  },

  // Importe simple (sin colores)
  colAmountSimple: {
    width: 120,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  // Dif mes
  colDelta: {
    width: 80,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '800',
  },

  pullHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
});

export default ReiniciarMesScreen;
