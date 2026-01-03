/**
 * Archivo: mobile_app/screens/prestamos/PrestamosListScreen.tsx
 *
 * Responsabilidad:
 *   - Listar préstamos con búsqueda y filtros (estado / vencen mes).
 *   - Permitir navegación a detalle y a alta (form).
 *
 * Cambios (respecto a tu versión):
 *   - Reemplaza el render basado en ListRow por UnifiedAssetCard.
 *   - Mantiene: búsqueda, filtros, refresco, navegación, formato de importes.
 *   - No se añade ActionSheet aquí para no introducir endpoints no confirmados (no se pierde funcionalidad).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FilterRow } from '../../components/ui/FilterRow';
import { FilterPill } from '../../components/ui/FilterPill';
import { colors, spacing } from '../../theme';
import { EuroformatEuro, parseEuroToNumber } from '../../utils/format';
import { prestamosApi } from '../../services/prestamosApi';

import UnifiedAssetCard from '../../components/cards/UnifiedAssetCard';

type EstadoFiltro = 'ACTIVOS' | 'VENCEN_MES' | 'CANCELADOS' | 'INACTIVOS';

type PrestamoItem = {
  id: string;
  nombre: string;

  periodicidad?: string | null;
  tin_pct?: number | string | null;

  estado?: string | null;

  importe_principal?: number | string | null;
  plazo_meses?: number | string | null;

  capital_pendiente?: number | string | null;
  cuotas_totales?: number | string | null;
  cuotas_pagadas?: number | string | null;

  fecha_inicio?: string | null;
  fecha_vencimiento?: string | null;
};

const FILTROS: { key: EstadoFiltro; label: string }[] = [
  { key: 'ACTIVOS', label: 'Activos' },
  { key: 'VENCEN_MES', label: 'Vencen mes' },
  { key: 'CANCELADOS', label: 'Cancelados' },
];

const n = (v: any) => (v == null || v === '' ? 0 : Number(v));

/**
 * Formatea importes usando utils/format.ts:
 * - admite number|string|null
 * - soporta "1.234,56" / "1234.56" / etc.
 */
const fmtEur = (v: number | string | null | undefined) => {
  const num = parseEuroToNumber(v ?? null);
  if (num == null || !Number.isFinite(num)) return '—';
  return EuroformatEuro(num, 'normal');
};

export default function PrestamosListScreen() {
  const navigation = useNavigation<any>();

  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<EstadoFiltro>('ACTIVOS');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [items, setItems] = useState<PrestamoItem[]>([]);

  const title = useMemo(() => {
    if (filtro === 'ACTIVOS') return 'Préstamos · Activos';
    if (filtro === 'CANCELADOS') return 'Préstamos · Cancelados';
    if (filtro === 'INACTIVOS') return 'Préstamos · Inactivos';
    return 'Préstamos · Vencen mes';
  }, [filtro]);

  // ✅ Volver atrás: siempre a Patrimonio
  const handleBack = useCallback(() => {
    navigation.navigate('PatrimonyTab', { screen: 'PatrimonyHomeScreen' });
  }, [navigation]);

  const load = useCallback(
    async (showSpinner: boolean) => {
      try {
        if (showSpinner) setLoading(true);

        const params: any = {};
        if (q.trim()) params.q = q.trim();

        if (filtro === 'ACTIVOS') params.estado = 'ACTIVO';
        if (filtro === 'CANCELADOS') params.estado = 'CANCELADO';
        if (filtro === 'INACTIVOS') params.estado = 'INACTIVO';
        if (filtro === 'VENCEN_MES') params.vencen = 'MES';

        console.log('[PrestamosList] params =>', params);

        const data = await prestamosApi.list(params);

        console.log(
          '[PrestamosList] response length =>',
          Array.isArray(data) ? data.length : 'not-array',
          data
        );

        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        console.log('[PrestamosList] ERROR =>', e?.message);
        console.log('[PrestamosList] status =>', e?.response?.status);
        console.log('[PrestamosList] data =>', e?.response?.data);

        Alert.alert(
          'Error',
          `No se pudo cargar préstamos.\nStatus: ${String(e?.response?.status ?? '—')}\n${String(
            e?.response?.data?.detail ?? e?.message ?? ''
          )}`
        );

        setItems([]);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [q, filtro]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  const goNew = () => navigation.navigate('PrestamoForm', {});
  const goDetalle = (prestamoId: string) => navigation.navigate('PrestamoDetalle', { prestamoId });

  return (
    <Screen>
      <Header
        title={title}
        showBack
        onBackPress={handleBack}
        rightIconName="add"
        onRightPress={goNew}
      />

      <View style={styles.body}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar por nombre…"
          placeholderTextColor={colors.textSecondary}
          style={styles.search}
          returnKeyType="search"
          onSubmitEditing={() => void load(true)}
        />

        <FilterRow columns={3} style={{ marginBottom: spacing.sm }}>
          {FILTROS.map((f) => (
            <FilterPill
              key={f.key}
              label={f.label}
              selected={filtro === f.key}
              onPress={() => setFiltro(f.key)}
            />
          ))}
        </FilterRow>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loaderText}>Cargando…</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => String(it.id)}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => {
              const cuotasTot = Math.max(0, n(item.cuotas_totales));
              const cuotasPag = Math.max(0, n(item.cuotas_pagadas));

              const tin = n(item.tin_pct);
              const tinLabel = Number.isFinite(tin) ? tin.toFixed(2) : '—';

              const estadoUpper = String(item.estado ?? '').toUpperCase();
              const active = estadoUpper === 'ACTIVO';

              const cardRows = [
                { label: 'Periodicidad', value: String(item.periodicidad ?? '—') },
                { label: 'TIN', value: `${tinLabel}%` },
                { label: 'Principal', value: fmtEur(item.importe_principal), emphasize: true },
                { label: 'Pendiente', value: fmtEur(item.capital_pendiente), emphasize: true },
                { label: 'Cuotas pagadas', value: `${cuotasPag}/${cuotasTot}` },
                { label: 'Vencimiento', value: String(item.fecha_vencimiento ?? '—') },
              ];

              return (
                <UnifiedAssetCard
                  title={String(item.nombre ?? '—')}
                  subtitle={String(item.estado ?? '—')}
                  active={active}
                  // En préstamos no hay "cifra del filtro" en el header actualmente.
                  // Si quisieras, podríamos poner TIN como headerValue, pero mantengo UI conservadora.
                  headerValue={undefined}
                  rows={cardRows}
                  onPress={() => goDetalle(item.id)}
                />
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No hay préstamos para este filtro.</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flex: 1,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
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
});
