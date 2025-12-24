/**
 * Archivo: mobile_app/screens/patrimonio/PropiedadesRankingScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de propiedades (activas e inactivas) ordenadas por KPI (Bruto / Cap Rate / NOI).
 *   - Visualización tipo “ranking” con tarjeta unificada (PropertyRankingCard).
 *   - Acciones contextuales por propiedad mediante ActionSheet (ver detalle, editar, activar/inactivar, eliminar).
 *
 * Mejora aplicada:
 *   - Ya NO se filtra por propiedades activas: se muestran todas.
 *   - El ranking PRIORIZA activas (arriba) y luego inactivas, manteniendo el orden por KPI dentro de cada grupo.
 *   - Las propiedades inactivas se renderizan con estilo “desactivado” (opacidad).
 *   - El badge “INACTIVA” se pinta por ENCIMA de la tarjeta (no tapa KPI ni el botón de opciones).
 *   - Valor mercado: se lee desde /patrimonios/{id}/compra (tabla patrimonio_compra).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';

import Header from '../../components/layout/Header';
import { colors, spacing } from '../../theme';
import { EuroformatEuro, formatFechaCorta } from '../../utils/format';

import patrimonioApi, { PatrimonioRow } from '../../services/patrimonioApi';
import { api } from '../../services/api';

import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import FilterRow from '../../components/ui/FilterRow';
import Chip from '../../components/ui/Chip';
import PropertyRankingCard from '../../components/cards/PropertyRankingCard';

import screenStyles from '../styles/screenStyles';

type Props = {
  navigation: any;
};

type Metric = 'bruto' | 'cap' | 'noi';

type Kpis = {
  rendimiento_bruto_pct?: number | null;
  cap_rate_pct?: number | null;
  noi?: number | null;
};

type Compra = {
  valor_mercado?: number | null;
  // por si lo tienes así en backend:
  valorMercado?: number | null;
  valor_mercado_eur?: number | null;
};

type RowVM = PatrimonioRow & {
  __kpis?: Kpis | null;
  __valor_mercado?: number | null;
};

const METRIC_BTNS: { label: string; value: Metric }[] = [
  { label: 'Bruto', value: 'bruto' },
  { label: 'Cap Rate', value: 'cap' },
  { label: 'NOI', value: 'noi' },
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

function fmtEur(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v == null) return '—';
  return EuroformatEuro(v, 'signed');
}

function getTitle(p: PatrimonioRow): string {
  return (p.referencia || p.id || 'PROPIEDAD').toString();
}

function getDireccion(p: PatrimonioRow): string {
  return (p.direccion_completa || '').toString();
}

async function fetchKpis(patrimonioId: string): Promise<Kpis | null> {
  try {
    const year = new Date().getFullYear();

    const resp = await api.get<Kpis>(
      `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/kpis`,
      {
        params: {
          year, // imprescindible para tu backend
          annualize: true,
          basis: 'total',
        },
      }
    );

    return resp.data ?? null;
  } catch {
    return null;
  }
}

async function fetchValorMercado(patrimonioId: string): Promise<number | null> {
  try {
    const resp = await api.get<Compra | null>(
      `/api/v1/patrimonios/${encodeURIComponent(patrimonioId)}/compra`
    );

    const raw =
      resp.data?.valor_mercado ??
      resp.data?.valorMercado ??
      resp.data?.valor_mercado_eur ??
      null;

    return safeNum(raw);
  } catch {
    return null;
  }
}

export const PropiedadesRankingScreen: React.FC<Props> = ({ navigation }) => {
  const [metric, setMetric] = useState<Metric>('bruto');

  const [rows, setRows] = useState<RowVM[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedRow, setSelectedRow] = useState<RowVM | null>(null);

  const metricLabel = useMemo(() => {
    if (metric === 'bruto') return 'Bruto';
    if (metric === 'cap') return 'Cap Rate';
    return 'NOI';
  }, [metric]);

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack();
  }, [navigation]);

  const handleAdd = useCallback(() => {
    navigation.navigate('PropiedadForm', { mode: 'create' });
  }, [navigation]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      // ✅ CAMBIO: ya NO filtramos por activas. Traemos activas + inactivas.
      const props = await patrimonioApi.listPatrimonios();

      const enriched: RowVM[] = await Promise.all(
        (props ?? []).map(async (p) => {
          const [kpis, vm] = await Promise.all([fetchKpis(p.id), fetchValorMercado(p.id)]);
          return { ...p, __kpis: kpis, __valor_mercado: vm };
        })
      );

      setRows(enriched);
    } catch (e) {
      console.error('[PropiedadesRanking] load error', e);
      setError('No se han podido cargar las propiedades. Inténtalo de nuevo.');
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
    const getMetricValue = (p: RowVM): number => {
      const k = p.__kpis;
      if (!k) return -Infinity;

      if (metric === 'bruto') return safeNum(k.rendimiento_bruto_pct) ?? -Infinity;
      if (metric === 'cap') return safeNum(k.cap_rate_pct) ?? -Infinity;
      return safeNum(k.noi) ?? -Infinity;
    };

    const isActive = (p: RowVM) => p.activo !== false;

    return [...rows].sort((a, b) => {
      // 1) PRIORIDAD: activas primero
      const aAct = isActive(a) ? 1 : 0;
      const bAct = isActive(b) ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;

      // 2) Dentro del grupo (activa/inactiva): ordenar por KPI desc
      return getMetricValue(b) - getMetricValue(a);
    });
  }, [rows, metric]);

  const openOptions = useCallback((row: RowVM) => {
    setSelectedRow(row);
    setSheetVisible(true);
  }, []);

  const confirmarEliminar = useCallback(
    (row: RowVM) => {
      Alert.alert('Eliminar propiedad', `¿Eliminar "${getTitle(row)}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/api/v1/patrimonios/${encodeURIComponent(row.id)}`);
              await load();
            } catch (err) {
              console.error('[PropiedadesRanking] delete error', err);
              Alert.alert('Error', 'No se ha podido eliminar la propiedad.');
            } finally {
              setSheetVisible(false);
            }
          },
        },
      ]);
    },
    [load]
  );

  const toggleActivo = useCallback(
    async (row: RowVM, activo: boolean) => {
      try {
        await patrimonioApi.setPatrimonioActivo(row.id, activo);
        await load();
      } catch (err) {
        console.error('[PropiedadesRanking] toggle activo error', err);
        Alert.alert('Error', `No se ha podido ${activo ? 'activar' : 'inactivar'} la propiedad.`);
      } finally {
        setSheetVisible(false);
      }
    },
    [load]
  );

  const accionesSheet: ActionSheetAction[] = useMemo(() => {
    if (!selectedRow) return [];

    const activo = selectedRow.activo !== false;

    const verde = '#16a34a';
    const rojo = '#b91c1c';
    const amarillo = '#eab308';
    const gris = '#4b5563';

    const acciones: ActionSheetAction[] = [
      {
        label: 'Ver detalle',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('PropiedadDetalle', { patrimonioId: selectedRow.id });
        },
        iconName: 'information-circle-outline',
        color: gris,
      },
      {
        label: 'Editar',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('PropiedadForm', { mode: 'edit', patrimonioId: selectedRow.id });
        },
        iconName: 'create-outline',
        color: amarillo,
      },
    ];

    if (activo) {
      acciones.push({
        label: 'Inactivar',
        onPress: async () => {
          await toggleActivo(selectedRow, false);
        },
        iconName: 'close-circle-outline',
        color: amarillo,
      });
    } else {
      acciones.push({
        label: 'Activar',
        onPress: async () => {
          await toggleActivo(selectedRow, true);
        },
        iconName: 'checkmark-circle-outline',
        color: verde,
      });
    }

    acciones.push({
      label: 'Eliminar',
      onPress: () => confirmarEliminar(selectedRow),
      iconName: 'trash-outline',
      color: rojo,
      destructive: true,
    });

    return acciones;
  }, [confirmarEliminar, navigation, selectedRow, toggleActivo]);

  const renderContenido = () => {
    if (loading && rows.length === 0) {
      return (
        <View style={screenStyles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={screenStyles.loadingText}>Cargando propiedades…</Text>
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
          <Text style={screenStyles.emptyText}>No hay propiedades todavía.</Text>
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
        {ranked.map((p, idx) => {
          const title = getTitle(p);
          const direccion = getDireccion(p);

          const participacion = safeNum(p.participacion_pct);
          const fechaAdq = p.fecha_adquisicion ? formatFechaCorta(p.fecha_adquisicion) : '—';

          const supUtil = safeNum(p.superficie_m2);
          const supConst = safeNum(p.superficie_construida);

          const valorMercado = safeNum(p.__valor_mercado);

          const metricValue =
            metric === 'noi'
              ? fmtEur(p.__kpis?.noi ?? null)
              : metric === 'bruto'
              ? fmtPct(p.__kpis?.rendimiento_bruto_pct ?? null)
              : fmtPct(p.__kpis?.cap_rate_pct ?? null);

          const isInactive = p.activo === false;

          return (
            <View key={p.id} style={styles.cardWrap}>
              {/* Badge fuera del contenido: no tapa KPI ni opciones */}
              {isInactive ? (
                <View pointerEvents="none" style={styles.inactiveBadgeWrap}>
                  <Text style={styles.inactiveBadgeText}>INACTIVA</Text>
                </View>
              ) : null}

              <View style={isInactive ? styles.cardDimmed : null}>
                <PropertyRankingCard
                  title={title}
                  kpiValue={metricValue}
                  rankPosition={idx + 1}
                  participacionValue={participacion == null ? '—' : `${participacion.toFixed(0)}%`}
                  supConstValue={supConst == null ? '—' : `${supConst.toFixed(2)} m²`}
                  adquisicionValue={fechaAdq}
                  supUtilValue={supUtil == null ? '—' : `${supUtil.toFixed(2)} m²`}
                  valorMercadoValue={
                    valorMercado == null ? '—' : EuroformatEuro(valorMercado, 'normal')
                  }
                  direccion={direccion || '—'}
                  onPress={() => navigation.navigate('PropiedadDetalle', { patrimonioId: p.id })}
                  onOptionsPress={() => openOptions(p)}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Ranking"
        subtitle="Rentabilidad de tus propiedades"
        showBack
        onBackPress={handleBack}
        onAddPress={handleAdd}
      />

      <View style={screenStyles.screen}>
        <View style={[screenStyles.topArea, { paddingHorizontal: spacing.sm }]}>
          <FilterRow columns={3} gap={spacing.sm}>
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
          title="Acciones sobre la propiedad"
          actions={accionesSheet}
        />
      </View>
    </>
  );
};

export default PropiedadesRankingScreen;

const styles = StyleSheet.create({
  cardWrap: {
    position: 'relative',
  },

  // Opacidad solo al contenido (no afecta al badge)
  cardDimmed: {
    opacity: 0.55,
  },

  // Badge “encima” (fuera del contenido)
  inactiveBadgeWrap: {
    position: 'absolute',
    top: -10,
    right: 10,
    zIndex: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    // sombra ligera (iOS) + elevación (Android)
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
});
