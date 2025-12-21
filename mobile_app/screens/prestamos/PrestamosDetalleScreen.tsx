import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { ListRow } from '../../components/ui/ListRow';
import { ActionSheet } from '../../components/modals/ActionSheet';
import { colors, spacing } from '../../theme';

import { EuroformatEuro, parseEuroToNumber, formatFechaCorta } from '../../utils/format';
import { prestamosApi } from '../../services/prestamosApi';

type RouteParams = { prestamoId: string };

type Prestamo = {
  id: string;
  nombre: string;
  estado?: string | null;

  periodicidad?: string | null;
  tipo_interes?: string | null;
  tin_pct?: number | string | null;

  importe_principal?: number | string | null;
  capital_pendiente?: number | string | null;

  cuotas_totales?: number | string | null;
  cuotas_pagadas?: number | string | null;

  fecha_inicio?: string | null;
  fecha_vencimiento?: string | null;
};

type Cuota = {
  id: string;
  num_cuota: number;
  fecha_vencimiento: string;
  importe_cuota: number | string;
  capital: number | string;
  interes: number | string;
  pagada: boolean;
  fecha_pago?: string | null;
};

const n = (v: any) => (v == null || v === '' ? 0 : Number(v));

/** Formato € consistente con el resto de la app */
const fmtEur = (v: number | string | null | undefined) => {
  const num = parseEuroToNumber(v ?? null);
  if (num == null || !Number.isFinite(num)) return '—';
  return EuroformatEuro(num, 'normal');
};

/** Fecha larga tipo: "02 de diciembre de 2025" (para la tarjeta de próximo pago / cuotas) */
const fmtFechaLarga = (raw?: string | null) => {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
};

export default function PrestamosDetalleScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { prestamoId } = (route.params ?? {}) as RouteParams;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [prestamo, setPrestamo] = useState<Prestamo | null>(null);
  const [cuotas, setCuotas] = useState<Cuota[]>([]);

  const [sheetVisible, setSheetVisible] = useState(false);

  const subtitle = useMemo(() => {
    if (!prestamo) return undefined;
    return `${String(prestamo.estado ?? '—')} · ${String(prestamo.periodicidad ?? '—')}`;
  }, [prestamo]);

  const load = useCallback(
    async (showSpinner: boolean) => {
      try {
        if (showSpinner) setLoading(true);
        const [p, c] = await Promise.all([
          prestamosApi.get(prestamoId),
          prestamosApi.cuotas(prestamoId),
        ]);
        setPrestamo(p ?? null);
        setCuotas(Array.isArray(c) ? c : []);
      } catch {
        setPrestamo(null);
        setCuotas([]);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [prestamoId]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  const goEdit = () => {
    setSheetVisible(false);
    navigation.navigate('PrestamoForm', { prestamoId });
  };

  const toggleCuota = async (cuota: Cuota) => {
    try {
      if (cuota.pagada) {
        await prestamosApi.desmarcarCuota(cuota.id);
      } else {
        await prestamosApi.pagarCuota(cuota.id);
      }
      await load(false);
    } catch {
      Alert.alert('Error', 'No se pudo actualizar la cuota.');
    }
  };

  const nextCuota = useMemo(() => {
    const list = Array.isArray(cuotas) ? cuotas : [];
    const unpaid = list.filter((c) => !c.pagada);

    unpaid.sort((a, b) => {
      const ta = new Date(a.fecha_vencimiento).getTime();
      const tb = new Date(b.fecha_vencimiento).getTime();
      return ta - tb;
    });

    return unpaid[0] ?? null;
  }, [cuotas]);

  // Orden visual opcional: por fecha ascendente (si te interesa)
  const cuotasOrdenadas = useMemo(() => {
    const list = Array.isArray(cuotas) ? [...cuotas] : [];
    list.sort((a, b) => {
      const ta = new Date(a.fecha_vencimiento).getTime();
      const tb = new Date(b.fecha_vencimiento).getTime();
      return ta - tb;
    });
    return list;
  }, [cuotas]);

  return (
    <Screen>
      <Header
        title={prestamo?.nombre ?? 'Préstamo'}
        subtitle={subtitle}
        showBack
        onBackPress={() => navigation.goBack()}
        rightIconName="ellipsis-vertical"
        onRightPress={() => setSheetVisible(true)}
      />

      <View style={styles.body}>
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loaderText}>Cargando…</Text>
          </View>
        ) : !prestamo ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No se pudo cargar el préstamo.</Text>
          </View>
        ) : (
          <FlatList
            data={cuotasOrdenadas}
            keyExtractor={(it) => String(it.id)}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={
              <View style={styles.section}>
                {/* Tarjeta info */}
                <View style={styles.card}>
                  <ListRow
                    title="Principal"
                    right={<Text style={styles.rightValue}>{fmtEur(prestamo.importe_principal)}</Text>}
                    showDivider
                  />
                  <ListRow
                    title="Pendiente"
                    right={<Text style={styles.rightValue}>{fmtEur(prestamo.capital_pendiente)}</Text>}
                    showDivider
                  />
                  <ListRow
                    title="TIN"
                    right={<Text style={styles.rightValue}>{n(prestamo.tin_pct).toFixed(2)}%</Text>}
                    showDivider
                  />
                  <ListRow
                    title="Plazo"
                    right={
                      <Text style={styles.rightValue}>
                        {n(prestamo.cuotas_pagadas)}/{n(prestamo.cuotas_totales)} cuotas
                      </Text>
                    }
                    showDivider={false}
                  />
                </View>

                {/* Próximo pago */}
                <View style={[styles.card, { marginTop: spacing.sm }]}>
                  <Text style={styles.cardTitle}>Próximo pago</Text>

                  {!nextCuota ? (
                    <Text style={styles.cardSubtitle}>No hay cuotas pendientes.</Text>
                  ) : (
                    <View style={{ marginTop: 8, gap: 8 }}>
                      <View style={styles.kvRow}>
                        <Text style={styles.kvLabel}>Vencimiento</Text>
                        <Text style={styles.kvValue}>{fmtFechaLarga(nextCuota.fecha_vencimiento)}</Text>
                      </View>

                      <View style={styles.kvRow}>
                        <Text style={styles.kvLabel}>Importe cuota</Text>
                        <Text style={styles.kvValue}>{fmtEur(nextCuota.importe_cuota)}</Text>
                      </View>

                      <View style={styles.kvRow}>
                        <Text style={styles.kvLabel}>Capital</Text>
                        <Text style={styles.kvValue}>{fmtEur(nextCuota.capital)}</Text>
                      </View>

                      <View style={styles.kvRow}>
                        <Text style={styles.kvLabel}>Interés</Text>
                        <Text style={styles.kvValue}>{fmtEur(nextCuota.interes)}</Text>
                      </View>
                    </View>
                  )}
                </View>

                <Text style={styles.sectionTitle}>Cuotas</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cuotaRow, item.pagada && styles.cuotaRowPaid]}
                onPress={() => void toggleCuota(item)}
              >
                <Ionicons
                  name={item.pagada ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={item.pagada ? colors.primary : colors.textSecondary}
                  style={{ marginTop: 2, marginRight: 10 }}
                />

                <View style={{ flex: 1 }}>
                  <Text style={styles.cuotaTitle}>
                    Cuota {item.num_cuota} · {fmtFechaLarga(item.fecha_vencimiento)}
                  </Text>

                  <Text style={styles.cuotaSub}>
                    Importe {fmtEur(item.importe_cuota)} · Capital {fmtEur(item.capital)} · Interés{' '}
                    {fmtEur(item.interes)}
                  </Text>

                  {/* Si quieres mostrar fecha de pago cuando está pagada */}
                  {item.pagada ? (
                    <Text style={styles.cuotaPaidMeta}>
                      Pagada: {item.fecha_pago ? formatFechaCorta(item.fecha_pago) : '—'}
                    </Text>
                  ) : null}
                </View>

                {/* ✅ Quitado el chevron (no navega) */}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No hay cuotas.</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>

      <ActionSheet
        visible={sheetVisible}
        title="Acciones"
        onClose={() => setSheetVisible(false)}
        actions={[
          {
            label: 'Editar',
            iconName: 'create-outline',
            onPress: goEdit,
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  loader: {
    paddingTop: 24,
    alignItems: 'center',
    gap: 8,
  },
  loaderText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  empty: {
    paddingTop: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rightValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  // Tarjeta "Próximo pago"
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  kvLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  kvValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  cuotaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  cuotaRowPaid: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  cuotaTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cuotaSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  cuotaPaidMeta: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textSecondary,
  },
});