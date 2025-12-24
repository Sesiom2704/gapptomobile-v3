/**
 * Archivo: mobile_app/screens/patrimonio/PropiedadesRankingScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de propiedades (activas e inactivas) ordenadas por KPI (Bruto / Cap Rate / NOI).
 *   - Visualización tipo “ranking” con tarjeta unificada (PropertyRankingCard).
 *   - Acciones contextuales por propiedad mediante ActionSheet (ver detalle, editar, activar/inactivar, eliminar).
 *
 * Cambios solicitados (aplicados):
 *   1) El ranking PRIORIZA propiedades activas:
 *        - Primero activas, luego inactivas.
 *        - Dentro de cada grupo, ordena por el KPI seleccionado (desc).
 *   2) Estado inactiva:
 *        - No usamos badge/overlay.
 *        - La propiedad inactiva se muestra como subtítulo: "(INACTIVADA)" con fuente más pequeña.
 *        - La tarjeta tiene un estilo visual tenue (disabledStyle) sin romper navegación ni opciones.
 *   3) Valor de mercado:
 *        - Se obtiene desde patrimonio_compra (endpoint /patrimonios/{id}/compra).
 *        - Se muestra "a fecha: <valor_mercado_fecha>" si existe.
 *
 * Requisito de integración:
 *   - Este fichero asume que PropertyRankingCard ya soporta props:
 *       - subtitle?: string
 *       - disabledStyle?: boolean
 *     (tal como se preparó en el componente).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';

import Header from '../../components/layout/Header';
import { colors, spacing } from '../../theme';
import { EuroformatEuro, formatFechaCorta } from '../../utils/format';

import patrimonioApi, { PatrimonioRow, PatrimonioCompraOut } from '../../services/patrimonioApi';
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

type RowVM = PatrimonioRow & {
  __kpis?: Kpis | null;
  __valor_mercado?: number | null;
  __valor_mercado_fecha?: string | null; // "YYYY-MM-DD" en backend
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
  // En vuestro flujo se estaba usando referencia como “título humano”, con fallback al id.
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
          year,
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

/**
 * Compra (tabla patrimonio_compra):
 * - valor_mercado
 * - valor_mercado_fecha
 */
async function fetchCompra(patrimonioId: string): Promise<PatrimonioCompraOut | null> {
  try {
    return await patrimonioApi.getPatrimonioCompra(patrimonioId);
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
      // ✅ NO filtramos por activas: deben aparecer todas.
      const props = await patrimonioApi.listPatrimonios();

      // Enriquecemos con:
      // - KPIs (analytics)
      // - compra.valor_mercado y compra.valor_mercado_fecha (patrimonio_compra)
      const enriched: RowVM[] = await Promise.all(
        (props ?? []).map(async (p) => {
          const [kpis, compra] = await Promise.all([fetchKpis(p.id), fetchCompra(p.id)]);
          return {
            ...p,
            __kpis: kpis,
            __valor_mercado: safeNum(compra?.valor_mercado),
            __valor_mercado_fecha: compra?.valor_mercado_fecha ?? null,
          };
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

  /**
   * Ranking:
   *  1) Activas primero
   *  2) Dentro de cada grupo: KPI desc
   */
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
      const aActive = isActive(a);
      const bActive = isActive(b);

      // 1) priorizar activas
      if (aActive !== bActive) return aActive ? -1 : 1;

      // 2) dentro del grupo, ordenar por KPI desc
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

    // Acción activar/inactivar se mantiene en el ActionSheet (no es “badge/botón” en la tarjeta).
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

          const isInactive = p.activo === false;

          // ✅ Subtítulo (fuente más pequeña) si está inactiva
          const subtitle = isInactive ? '(INACTIVADA)' : undefined;

          const participacion = safeNum(p.participacion_pct);
          const fechaAdq = p.fecha_adquisicion ? formatFechaCorta(p.fecha_adquisicion) : '—';

          const supUtil = safeNum(p.superficie_m2);
          const supConst = safeNum(p.superficie_construida);

          // ✅ Valor mercado desde patrimonio_compra + fecha
          const valorMercado = safeNum(p.__valor_mercado);
          const valorMercadoFecha = p.__valor_mercado_fecha ? formatFechaCorta(p.__valor_mercado_fecha) : null;

          const valorMercadoValue =
            valorMercado == null
              ? '—'
              : `${EuroformatEuro(valorMercado, 'normal')}${valorMercadoFecha ? ` a fecha: ${valorMercadoFecha}` : ''}`;

          const metricValue =
            metric === 'noi'
              ? fmtEur(p.__kpis?.noi ?? null)
              : metric === 'bruto'
                ? fmtPct(p.__kpis?.rendimiento_bruto_pct ?? null)
                : fmtPct(p.__kpis?.cap_rate_pct ?? null);

          return (
            <PropertyRankingCard
              key={p.id}
              title={title}
              subtitle={subtitle}
              disabledStyle={isInactive}
              kpiValue={metricValue}
              rankPosition={idx + 1}
              participacionValue={participacion == null ? '—' : `${participacion.toFixed(0)}%`}
              supConstValue={supConst == null ? '—' : `${supConst.toFixed(2)} m²`}
              adquisicionValue={fechaAdq}
              supUtilValue={supUtil == null ? '—' : `${supUtil.toFixed(2)} m²`}
              valorMercadoValue={valorMercadoValue}
              direccion={direccion || '—'}
              onPress={() => navigation.navigate('PropiedadDetalle', { patrimonioId: p.id })}
              onOptionsPress={() => openOptions(p)}
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
