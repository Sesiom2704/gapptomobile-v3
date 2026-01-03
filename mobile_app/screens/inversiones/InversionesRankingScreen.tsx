/**
 * Archivo: mobile_app/screens/inversiones/InversionesRankingScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de inversiones tipo ranking con filtros por métrica (IRR/ROI/MOIC/Capital).
 *   - Ordenación: activas primero; dentro, por métrica desc.
 *   - Tap en card => abre InversionForm en modo view (readOnly).
 *   - Menú "..." => ActionSheet (Ver detalle, Editar, Eliminar).
 *
 * Cambios (respecto a tu versión):
 *   - Sustituye PropertyRankingCard por UnifiedAssetCard (limpio, sin “mapear” campos a cosas raras).
 *   - Mantiene navegación, ActionSheet y ranking.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native';

import Header from '../../components/layout/Header';
import { colors, spacing } from '../../theme';
import screenStyles from '../styles/screenStyles';

import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import FilterRow from '../../components/ui/FilterRow';
import Chip from '../../components/ui/Chip';

import inversionesApi, { InversionRow, InversionKpisOut } from '../../services/inversionesApi';
import { EuroformatEuro } from '../../utils/format';

import UnifiedAssetCard from '../../components/cards/UnifiedAssetCard';

type Props = { navigation: any };

type Metric = 'irr' | 'roi' | 'moic' | 'capital';

type RowVM = InversionRow & {
  __kpis?: InversionKpisOut | null;
};

const METRIC_BTNS: { label: string; value: Metric }[] = [
  { label: 'IRR esp.', value: 'irr' },
  { label: 'ROI esp.', value: 'roi' },
  { label: 'MOIC esp.', value: 'moic' },
  { label: 'Capital', value: 'capital' },
];

function safeNum(n: any): number | null {
  const x = typeof n === 'number' ? n : n == null ? null : Number(n);
  return x == null || Number.isNaN(x) ? null : x;
}

function fmtPct(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v == null) return '—';
  return `${v.toFixed(2)}%`;
}

function fmtX(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v == null) return '—';
  return `${v.toFixed(2)}x`;
}

function fmtEur(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v == null) return '—';
  return EuroformatEuro(v, 'signed');
}

async function fetchKpis(invId: string): Promise<InversionKpisOut | null> {
  try {
    return await inversionesApi.getInversionKpis(invId);
  } catch {
    return null;
  }
}

export default function InversionesRankingScreen({ navigation }: Props) {
  const [metric, setMetric] = useState<Metric>('irr');

  const [rows, setRows] = useState<RowVM[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedRow, setSelectedRow] = useState<RowVM | null>(null);

  const metricLabel = useMemo(() => {
    if (metric === 'irr') return 'IRR esperada';
    if (metric === 'roi') return 'ROI esperada';
    if (metric === 'moic') return 'MOIC esperado';
    return 'Capital invertido (estimado)';
  }, [metric]);

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack();
  }, [navigation]);

  const handleAdd = useCallback(() => {
    navigation.navigate('InversionForm', { mode: 'create' });
  }, [navigation]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const invs = await inversionesApi.listInversiones();

      const enriched: RowVM[] = await Promise.all(
        (invs ?? []).map(async (inv) => {
          const kpis = await fetchKpis(inv.id);
          return { ...inv, __kpis: kpis };
        })
      );

      setRows(enriched);
    } catch (e) {
      console.error('[InversionesRanking] load error', e);
      setError('No se han podido cargar las inversiones. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  const ranked = useMemo(() => {
    const isActive = (p: RowVM) => (p.estado ?? 'ACTIVA') === 'ACTIVA';

    const getMetricValue = (p: RowVM): number => {
      if (metric === 'capital') {
        return safeNum(p.aporte_estimado) ?? -Infinity;
      }

      const k = p.__kpis?.esperado;
      if (!k) return -Infinity;

      if (metric === 'irr') return safeNum(k.irr_pct_aprox) ?? -Infinity;
      if (metric === 'roi') return safeNum(k.roi_pct) ?? -Infinity;
      return safeNum(k.moic) ?? -Infinity;
    };

    return [...rows].sort((a, b) => {
      const aActive = isActive(a);
      const bActive = isActive(b);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return getMetricValue(b) - getMetricValue(a);
    });
  }, [rows, metric]);

  const openOptions = useCallback((row: RowVM) => {
    setSelectedRow(row);
    setSheetVisible(true);
  }, []);

  const confirmarEliminar = useCallback(
    (row: RowVM) => {
      Alert.alert('Eliminar inversión', `¿Eliminar "${row.nombre}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await inversionesApi.deleteInversion(row.id);
              await load();
            } catch (err) {
              console.error('[InversionesRanking] delete error', err);
              Alert.alert('Error', 'No se ha podido eliminar la inversión.');
            } finally {
              setSheetVisible(false);
            }
          },
        },
      ]);
    },
    [load]
  );

  const accionesSheet: ActionSheetAction[] = useMemo(() => {
    if (!selectedRow) return [];

    return [
      {
        label: 'Ver detalle',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('InversionForm', {
            mode: 'view',
            readOnly: true,
            inversion: selectedRow,
            inversionId: selectedRow.id,
          });
        },
        iconName: 'information-circle-outline',
        color: colors.actionNeutral,
      },
      {
        label: 'Editar',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('InversionForm', {
            mode: 'edit',
            readOnly: false,
            inversion: selectedRow,
            inversionId: selectedRow.id,
          });
        },
        iconName: 'create-outline',
        color: colors.actionWarning,
      },
      {
        label: 'Eliminar',
        onPress: () => {
          setSheetVisible(false);
          confirmarEliminar(selectedRow);
        },
        iconName: 'trash-outline',
        color: colors.actionDanger,
        destructive: true,
      },
    ];
  }, [confirmarEliminar, navigation, selectedRow]);

  const renderContenido = () => {
    if (loading && rows.length === 0) {
      return (
        <View style={screenStyles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={screenStyles.loadingText}>Cargando inversiones…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={screenStyles.centered}>
          <Text style={screenStyles.errorText}>{error}</Text>
        </View>
      );
    }

    if (ranked.length === 0) {
      return (
        <View style={screenStyles.centered}>
          <Text style={screenStyles.emptyText}>No hay inversiones todavía.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={screenStyles.list}
        contentContainerStyle={screenStyles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {ranked.map((inv, idx) => {
          const inactive = (inv.estado ?? 'ACTIVA') !== 'ACTIVA';
          const subtitle = inactive ? '(NO ACTIVA)' : undefined;

          const esperado = inv.__kpis?.esperado;
          const headerValue =
            metric === 'capital'
              ? fmtEur(inv.aporte_estimado ?? null)
              : metric === 'irr'
                ? fmtPct(esperado?.irr_pct_aprox ?? null)
                : metric === 'roi'
                  ? fmtPct(esperado?.roi_pct ?? null)
                  : fmtX(esperado?.moic ?? null);

          const tipo = inv.tipo_gasto?.nombre ?? '—';
          const prov = inv.proveedor?.nombre ?? '—';
          const deal = inv.dealer?.nombre ?? '—';

          // Nota: si más adelante nos confirmas campo de “retorno real” cuando cerrada,
          // lo añadimos aquí sin tocar el componente base.
          const cardRows = [
            { label: 'Estado', value: inv.estado ?? '—' },
            { label: 'Tipo', value: tipo },
            { label: 'Proveedor', value: prov },
            { label: 'Dealer', value: deal },
            { label: 'Retorno esperado', value: fmtEur(inv.retorno_esperado_total ?? null), emphasize: true },
          ];

          return (
            <UnifiedAssetCard
              key={inv.id}
              title={inv.nombre}
              subtitle={subtitle}
              active={!inactive}
              headerValue={headerValue}
              leading={{ kind: 'rank', value: idx + 1 }}
              rows={cardRows}
              onPress={() =>
                navigation.navigate('InversionForm', {
                  mode: 'view',
                  readOnly: true,
                  inversion: inv,
                  inversionId: inv.id,
                })
              }
              onOptionsPress={() => openOptions(inv)}
            />
          );
        })}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Ranking"
        subtitle="Rentabilidad esperada y capital"
        showBack
        onBackPress={handleBack}
        onAddPress={handleAdd}
      />

      <View style={screenStyles.screen}>
        <View style={[screenStyles.topArea, { paddingHorizontal: spacing.sm }]}>
          <FilterRow columns={2} gap={spacing.sm}>
            {METRIC_BTNS.map((b) => (
              <Chip
                key={b.value}
                label={b.label}
                selected={metric === b.value}
                onPress={() => setMetric(b.value)}
                fullWidth
                centerText
              />
            ))}
          </FilterRow>

          <Text style={screenStyles.helperText}>Ordenado por {metricLabel}</Text>
        </View>

        <View style={screenStyles.bottomArea}>{renderContenido()}</View>

        <ActionSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          title="Acciones sobre la inversión"
          actions={accionesSheet}
        />
      </View>
    </>
  );
}
