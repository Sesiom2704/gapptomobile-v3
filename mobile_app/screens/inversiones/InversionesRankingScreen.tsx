// mobile_app/screens/inversiones/InversionesRankingScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native';

import Header from '../../components/layout/Header';
import { colors, spacing } from '../../theme';
import screenStyles from '../styles/screenStyles';

import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import FilterRow from '../../components/ui/FilterRow';
import Chip from '../../components/ui/Chip';

import inversionesApi, { InversionRow, InversionKpisOut } from '../../services/inversionesApi';
import PropertyRankingCard from '../../components/cards/PropertyRankingCard';
import { EuroformatEuro } from '../../utils/format';

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

    const gris = '#4b5563';
    const amarillo = '#eab308';
    const rojo = '#b91c1c';

    return [
      {
        label: 'Ver detalle',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('InversionDetalle', { inversionId: selectedRow.id });
        },
        iconName: 'information-circle-outline',
        color: gris,
      },
      {
        label: 'Editar',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('InversionForm', { mode: 'edit', inversionId: selectedRow.id });
        },
        iconName: 'create-outline',
        color: amarillo,
      },
      {
        label: 'Eliminar',
        onPress: () => confirmarEliminar(selectedRow),
        iconName: 'trash-outline',
        color: rojo,
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

          // KPI principal según métrica
          const esperado = inv.__kpis?.esperado;
          const kpiValue =
            metric === 'capital'
              ? fmtEur(inv.aporte_estimado ?? null)
              : metric === 'irr'
                ? fmtPct(esperado?.irr_pct_aprox ?? null)
                : metric === 'roi'
                  ? fmtPct(esperado?.roi_pct ?? null)
                  : fmtX(esperado?.moic ?? null);

          // Reutilizo PropertyRankingCard para no crear componente nuevo:
          // - title = nombre
          // - direccion = tipo + proveedor/dealer (texto)
          const tipo = inv.tipo_gasto?.nombre ?? '—';
          const prov = inv.proveedor?.nombre ?? '—';
          const deal = inv.dealer?.nombre ?? '—';
          const meta = `Tipo: ${tipo} · Prov: ${prov} · Dealer: ${deal}`;

          return (
            <PropertyRankingCard
              key={inv.id}
              title={inv.nombre}
              subtitle={subtitle}
              disabledStyle={inactive}
              kpiValue={kpiValue}
              rankPosition={idx + 1}
              participacionValue={inv.estado ?? '—'}
              supConstValue={inv.moneda ?? 'EUR'}
              adquisicionValue={inv.fecha_creacion ?? '—'}
              supUtilValue={inv.fecha_objetivo_salida ?? '—'}
              valorMercadoValue={fmtEur(inv.retorno_esperado_total ?? null)}
              direccion={meta}
              onPress={() => navigation.navigate('InversionDetalle', { inversionId: inv.id })}
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
