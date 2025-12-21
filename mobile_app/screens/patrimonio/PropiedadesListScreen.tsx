// mobile_app/screens/patrimonio/PropiedadesListScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import patrimonioApi, { type PatrimonioRow } from '../../services/patrimonioApi';
import { formatFechaCorta } from '../../utils/format';

type Props = { navigation: any };

export default function PropiedadesListScreen({ navigation }: Props) {
  const [items, setItems] = useState<PatrimonioRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const data = await patrimonioApi.listPatrimonios({ ordenar: 'asc' });
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setItems(await fetchAll());
    } catch {
      setErr('No se pudo cargar el listado.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await fetchAll());
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll]);

  const sortByFechaAsc = (a: PatrimonioRow, b: PatrimonioRow) => {
    const da = a.fecha_adquisicion ? new Date(a.fecha_adquisicion).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.fecha_adquisicion ? new Date(b.fecha_adquisicion).getTime() : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return (a.referencia || a.id).localeCompare(b.referencia || b.id);
  };

  const { propsActivas, propsNoDisp, propsInactivas } = useMemo(() => {
    const activas = items.filter(i => i.activo !== false);
    return {
      propsActivas: activas.filter(i => i.disponible !== false).sort(sortByFechaAsc),
      propsNoDisp: activas.filter(i => i.disponible === false).sort(sortByFechaAsc),
      propsInactivas: items.filter(i => i.activo === false).sort(sortByFechaAsc),
    };
  }, [items]);

  const goDetalle = (id: string) => navigation.navigate('PropiedadDetalle', { patrimonioId: id });
  const goEdit = (id: string) => navigation.navigate('PropiedadForm', { patrimonioId: id });
  const goCreate = () => navigation.navigate('PropiedadForm', {});
  const goRanking = () => navigation.navigate('PropiedadesRanking');

  const onToggleActivo = (id: string, nextActive: boolean) => {
    Alert.alert('Confirmar', nextActive ? '¿Marcar como ACTIVO?' : '¿Marcar como NO ACTIVO?', [
      { text: 'No' },
      {
        text: 'Sí',
        onPress: async () => {
          try {
            await patrimonioApi.setPatrimonioActivo(id, nextActive);
            await onRefresh();
          } catch {
            Alert.alert('Error', 'No se pudo cambiar el estado ACTIVO.');
          }
        },
      },
    ]);
  };

  const onToggleDisponible = (id: string, nextDisponible: boolean) => {
    Alert.alert('Confirmar', nextDisponible ? '¿Marcar como DISPONIBLE?' : '¿Marcar como NO DISPONIBLE?', [
      { text: 'No' },
      {
        text: 'Sí',
        onPress: async () => {
          try {
            await patrimonioApi.setPatrimonioDisponible(id, nextDisponible);
            await onRefresh();
          } catch {
            Alert.alert('Error', 'No se pudo cambiar el estado DISPONIBLE.');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: PatrimonioRow }) => {
    const isActive = item.activo !== false;
    const isDisponible = item.disponible !== false;

    const part = item.participacion_pct != null ? `${Math.round(item.participacion_pct)}%` : '—';
    const fecha = item.fecha_adquisicion ? formatFechaCorta(item.fecha_adquisicion) : '—';

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{item.referencia || item.id}</Text>
        <Text style={styles.cardSubtitle}>{item.direccion_completa || '—'}</Text>

        <Text style={styles.cardMeta}>
          Participación: <Text style={styles.bold}>{part}</Text>
          {' · '}
          Adquisición: <Text style={styles.bold}>{fecha}</Text>
        </Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => goDetalle(item.id)}>
            <Text style={[styles.btnText, { color: '#fff' }]}>Detalles</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => goEdit(item.id)}>
            <Text style={[styles.btnText, { color: '#fff' }]}>Editar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, isDisponible ? styles.btnWarnSoft : styles.btnWarn]}
            onPress={() => onToggleDisponible(item.id, !isDisponible)}
          >
            <Text style={[styles.btnText, { color: isDisponible ? '#5A2E00' : '#fff' }]}>
              {isDisponible ? 'Disponible' : 'No Disp.'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, isActive ? styles.btnSuccess : styles.btnDanger]}
            onPress={() => onToggleActivo(item.id, !isActive)}
          >
            <Text style={[styles.btnText, { color: '#fff' }]}>{isActive ? 'Activo' : 'No Act.'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const Section = ({
    title,
    data,
  }: {
    title: string;
    data: PatrimonioRow[];
  }) => (
    <View style={{ marginTop: spacing.md }}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{data.length}</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        scrollEnabled={false}
      />
    </View>
  );

  return (
    <>
      <Header title="Propiedades" subtitle="Alta, consulta y mantenimiento." />

      <View style={styles.screen}>
        {/* CTA Row */}
        <View style={styles.topActions}>
          <TouchableOpacity style={[styles.cta, styles.ctaPrimary]} onPress={goCreate}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.ctaText}>Nueva</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.cta, styles.ctaSecondary]} onPress={goRanking}>
            <Ionicons name="podium-outline" size={18} color={colors.primary} />
            <Text style={[styles.ctaText, { color: colors.primary }]}>Ranking</Text>
          </TouchableOpacity>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}
        {loading && items.length === 0 ? <ActivityIndicator style={{ marginTop: spacing.lg }} /> : null}

        <FlatList
          data={[1]}
          keyExtractor={() => 'root'}
          renderItem={() => (
            <View style={{ paddingBottom: spacing.xl }}>
              <Section title="Propiedades" data={propsActivas} />
              <Section title="En trámite" data={propsNoDisp} />
              <Section title="Nos dejaron" data={propsInactivas} />
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cta: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1,
  },
  ctaPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ctaSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.borderColor,
  },
  ctaText: {
    fontWeight: '800',
    color: '#fff',
  },
  err: { color: colors.danger, marginBottom: spacing.sm },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderColor,
    marginBottom: spacing.xs,
  },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: colors.textPrimary },
  sectionCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: spacing.md,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: colors.textPrimary, marginBottom: 2 },
  cardSubtitle: { color: colors.textSecondary, marginBottom: 4 },
  cardMeta: { color: colors.textSecondary, marginBottom: spacing.sm, fontSize: 12 },
  bold: { fontWeight: '900', color: colors.textPrimary },

  actionsRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  btn: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  btnText: { fontWeight: '800', fontSize: 12, textAlign: 'center' },

  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: '#6B7280' },

  btnWarnSoft: { backgroundColor: '#FFD6A5' },
  btnWarn: { backgroundColor: '#FF8C42' },

  btnSuccess: { backgroundColor: colors.success },
  btnDanger: { backgroundColor: colors.danger },
});
