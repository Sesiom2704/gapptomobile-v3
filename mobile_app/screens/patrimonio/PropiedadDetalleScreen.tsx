//mobile_app\screens\patrimonio\PropiedadDetalleScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import patrimonioApi, {
  type PatrimonioRow,
  type PatrimonioCompraOut,
} from '../../services/patrimonioApi';

import { EuroformatEuro, formatFechaCorta } from '../../utils/format';
import { api } from '../../services/api';

import KpiInfoModal from '../../components/modals/KpiInfoModal';

// ---- Tipos analytics ----
type ResumenYTD = {
  year: number;
  ingresos_ytd: number;
  gastos_ytd: number;
  cashflow_ytd: number;
  promedio_mensual: number;
  meses_contados: number;
};

type BreakdownRow = {
  tipo: string;
  periodicidad: string;
  cuota: number | null;
  meses: number;
  total: number;
};

type Breakdown = {
  year: number;
  meses_contados: number;
  rows: BreakdownRow[];
  total_ytd: number;
};

type Kpis = {
  year: number;
  meses_contados: number;

  precio_m2: number | null;
  referencia_m2: number | null;
  renta_m2_anual: number | null;
  inversion_m2: number | null;
  rentab_m2_total_pct: number | null;

  cap_rate_pct: number | null;
  rendimiento_bruto_pct: number | null;
  noi: number | null;

  dscr: number | null;
  ocupacion_pct: number | null;

  // si tu backend lo trae:
  deuda_anual?: number | null;
  cashflow_anual?: number | null;
  cashflow_mensual?: number | null;
};

type Props = {
  route?: { params?: { patrimonioId: string } };
  navigation?: any;
};

function safeNum(n: any): number | null {
  const x = typeof n === 'number' ? n : n == null ? null : Number(n);
  return x == null || Number.isNaN(x) ? null : x;
}

function pctOf(value: number | null | undefined, total: number | null | undefined): string {
  const v = safeNum(value);
  const t = safeNum(total);
  if (v == null || t == null || t <= 0) return '—';
  return `${((v / t) * 100).toFixed(2)}%`;
}

// Textos KPI (modal)
const KPI_INFO: Record<string, { title: string; desc: string }> = {
  cap_rate_pct: {
    title: 'Cap Rate',
    desc:
      'Cap rate = (NOI / Valor base) × 100.\n\nNOI = Ingresos anuales − Gastos operativos anuales.\nEl “valor base” depende de la configuración (total inversión / compra / referencia).',
  },
  rendimiento_bruto_pct: {
    title: 'Rendimiento bruto',
    desc:
      'Rendimiento bruto = (Ingresos anuales / Valor base) × 100.\n\nNo descuenta gastos operativos, solo relaciona ingresos con el valor del activo.',
  },
  noi: {
    title: 'NOI',
    desc:
      'NOI (Net Operating Income) = Ingresos anuales − Gastos operativos anuales.\n\nNo incluye financiación (hipoteca) si se filtra como gasto no operativo.',
  },
  ocupacion_pct: {
    title: 'Ocupación',
    desc:
      'Ocupación (%) = (Meses cobrados / Meses del año contados) × 100.\n\nAproximación basada en ingresos recurrentes registrados y su contador de cobros.',
  },
  precio_m2: {
    title: 'Precio €/m²',
    desc: 'Precio €/m² = Valor compra / m² (útil o construida según se use en el backend).',
  },
  renta_m2_anual: {
    title: 'Renta anual €/m²',
    desc: 'Renta anual €/m² = Ingresos anuales / m².',
  },
  inversion_m2: {
    title: 'Inversión €/m²',
    desc: 'Inversión €/m² = Total inversión / m².',
  },
  rentab_m2_total_pct: {
    title: 'Rentabilidad por m²',
    desc: 'Rentabilidad por m² (%) = (Renta anual €/m² / Inversión €/m²) × 100.',
  },
  dscr: {
    title: 'DSCR',
    desc: 'DSCR = NOI / Deuda anual.\n\nIndicador de cobertura de deuda: >1 suele considerarse saludable.',
  },
};

export default function PropiedadDetalleScreen({ route, navigation }: Props) {
  const patrimonioId = route?.params?.patrimonioId as string;
  const year = new Date().getFullYear();

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [base, setBase] = useState<PatrimonioRow | null>(null);
  const [compra, setCompra] = useState<PatrimonioCompraOut | null>(null);

  const [resumen, setResumen] = useState<ResumenYTD | null>(null);
  const [breakdownG, setBreakdownG] = useState<Breakdown | null>(null);
  const [breakdownI, setBreakdownI] = useState<Breakdown | null>(null);
  const [kpi, setKpi] = useState<Kpis | null>(null);

  // KPI info modal
  const [kpiInfoOpen, setKpiInfoOpen] = useState(false);
  const [kpiInfoKey, setKpiInfoKey] = useState<string>('cap_rate_pct');

  const openKpiInfo = (key: string) => {
    setKpiInfoKey(key);
    setKpiInfoOpen(true);
  };

  const headerTitle = useMemo(() => base?.referencia || base?.id || 'Propiedad', [base]);

  const loadAnalytics = async () => {
    try {
      const r1 = await api.get<ResumenYTD>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/resumen`,
        { params: { year } }
      );
      setResumen(r1.data);
    } catch {
      setResumen(null);
    }

    try {
      const r2 = await api.get<Breakdown>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/gastos_breakdown`,
        { params: { year } }
      );
      setBreakdownG(r2.data);
    } catch {
      setBreakdownG(null);
    }

    try {
      const r3 = await api.get<Breakdown>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/ingresos_breakdown`,
        { params: { year } }
      );
      setBreakdownI(r3.data);
    } catch {
      setBreakdownI(null);
    }

    try {
      const r4 = await api.get<Kpis>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/kpis`,
        { params: { year, basis: 'total', annualize: true } }
      );
      setKpi(r4.data);
    } catch {
      setKpi(null);
    }
  };

  const reload = useCallback(
    async (isPull = false) => {
      if (!isPull) setLoading(true);
      if (isPull) setRefreshing(true);
      setErr(null);

      try {
        const [p, c] = await Promise.all([
          patrimonioApi.getPatrimonio(patrimonioId),
          patrimonioApi.getPatrimonioCompra(patrimonioId),
        ]);

        setBase(p);
        setCompra(c);

        await loadAnalytics();
      } catch {
        setErr('No se pudo cargar el detalle de la propiedad.');
      } finally {
        if (!isPull) setLoading(false);
        if (isPull) setRefreshing(false);
      }
    },
    [patrimonioId, year]
  );

  useEffect(() => {
    reload(false);
  }, [reload]);

  const goMasKpis = useCallback(() => {
    navigation?.navigate?.('PropiedadKpis', { patrimonioId });
  }, [navigation, patrimonioId]);

  const totalInv = safeNum(compra?.total_inversion) ?? null;

  const handleBack = () => {
    navigation.navigate('PropiedadesRanking');
  };

  // Componentes UI locales
  const CardTitle: React.FC<{ icon: any; text: string; right?: React.ReactNode }> = ({
    icon,
    text,
    right,
  }) => (
    <View style={styles.blockTitleRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={18} color={colors.primary} />
        <Text style={styles.blockTitle}>{text}</Text>
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );

  // --- NUEVO Row3: columnas alineadas (label | € | %)
  const Row3 = ({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct?: string;
}) => (
  <View style={styles.rowBetween3}>
    <Text style={styles.rowLabel} numberOfLines={1}>
      {label}
    </Text>

    <Text style={styles.rowValue} numberOfLines={1}>
      {value}
      {pct && pct !== '—' ? ` (${pct})` : ''}
    </Text>
  </View>
);


  const KpiTile = ({
    label,
    value,
    infoKey,
  }: {
    label: string;
    value: string;
    infoKey: string;
  }) => (
    <View style={styles.kpiBox}>
      <View style={styles.kpiTopRow}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <TouchableOpacity
          onPress={() => openKpiInfo(infoKey)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Información sobre ${label}`}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );

  return (
    <>
      <Header
        title={headerTitle}
        subtitle="Detalle de propiedad"
        showBack
        onBackPress={handleBack}
        rightIconName="eye-outline"
        onRightPress={goMasKpis}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload(true)} />}
      >
        {loading && !base ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
        {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }}>{err}</Text> : null}

        {/* VIVIENDA */}
        <View style={styles.card}>
          <CardTitle icon="home-outline" text="Vivienda" />

          <View style={{ marginTop: spacing.xs }}>
            <Text style={styles.smallLine}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />{' '}
              {base?.direccion_completa || '—'}
            </Text>
          </View>

          <View style={styles.metaGrid}>
            <Meta label="Útil (m²)" value={base?.superficie_m2} />
            <Meta label="Construida (m²)" value={base?.superficie_construida} />
            <Meta label="Habitaciones" value={base?.habitaciones} />
            <Meta label="Baños" value={base?.banos} />
            <Meta label="Garaje" value={base?.garaje ? 'Sí' : 'No'} />
            <Meta label="Trastero" value={base?.trastero ? 'Sí' : 'No'} />
          </View>

          {/* Participación + Adquisición en misma línea */}
          <View style={styles.metaRow2Cols}>
            <View style={styles.metaHalf}>
              <Text style={styles.metaLabel}>Participación</Text>
              <Text style={styles.metaValue}>
                {base?.participacion_pct == null ? '—' : `${Math.round(base.participacion_pct)}%`}
              </Text>
            </View>

            <View style={styles.metaHalf}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.metaLabel}>Adquisición</Text>
              </View>
              <Text style={styles.metaValue}>
                {base?.fecha_adquisicion ? formatFechaCorta(base.fecha_adquisicion) : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* ADQUISICIÓN */}
        <View style={styles.card}>
          <CardTitle icon="pricetag-outline" text="Adquisición" />

          {compra ? (
            <>
              <Row3
                label="Valor compra"
                value={EuroformatEuro(compra.valor_compra)}
                pct={pctOf(compra.valor_compra, totalInv)}
              />
              <Row3
                label="Valor referencia"
                value={EuroformatEuro(compra.valor_referencia ?? 0)}
                pct={pctOf(compra.valor_referencia ?? 0, totalInv)}
              />
              <Row3
                label="Impuestos"
                value={EuroformatEuro(compra.impuestos_eur ?? 0)}
                pct={pctOf(compra.impuestos_eur ?? 0, totalInv)}
              />
              <Row3
                label="Notaría"
                value={EuroformatEuro(compra.notaria ?? 0)}
                pct={pctOf(compra.notaria ?? 0, totalInv)}
              />
              <Row3
                label="Agencia"
                value={EuroformatEuro(compra.agencia ?? 0)}
                pct={pctOf(compra.agencia ?? 0, totalInv)}
              />
              <Row3
                label="Reforma"
                value={EuroformatEuro(compra.reforma_adecuamiento ?? 0)}
                pct={pctOf(compra.reforma_adecuamiento ?? 0, totalInv)}
              />

              <View style={styles.sep} />

              <Text style={styles.totalLabel}>Total inversión</Text>
              <Text style={styles.totalValue}>{EuroformatEuro(compra.total_inversion ?? 0)}</Text>
            </>
          ) : (
            <Text style={styles.smallMuted}>Sin datos de adquisición.</Text>
          )}
        </View>

        {/* KPIs */}
        <View style={styles.card}>
          <CardTitle icon="analytics-outline" text="KPIs" />

          {kpi ? (
            <View style={styles.kpiGrid}>
              <KpiTile
                label="Cap rate"
                value={kpi.cap_rate_pct != null ? `${kpi.cap_rate_pct.toFixed(2)} %` : '—'}
                infoKey="cap_rate_pct"
              />
              <KpiTile
                label="Rend. bruto"
                value={kpi.rendimiento_bruto_pct != null ? `${kpi.rendimiento_bruto_pct.toFixed(2)} %` : '—'}
                infoKey="rendimiento_bruto_pct"
              />
              <KpiTile
                label="NOI"
                value={kpi.noi != null ? EuroformatEuro(kpi.noi) : '—'}
                infoKey="noi"
              />
              <KpiTile
                label="Ocupación"
                value={kpi.ocupacion_pct != null ? `${kpi.ocupacion_pct.toFixed(1)} %` : '—'}
                infoKey="ocupacion_pct"
              />
            </View>
          ) : (
            <Text style={styles.smallMuted}>Sin KPIs (se activará cuando analytics v3 esté listo).</Text>
          )}
        </View>

        {/* Resumen 2025 (NO quitar) */}
        <View style={styles.card}>
          <CardTitle icon="calendar-number-outline" text={`Resumen ${resumen?.year ?? year}`} />

          {resumen ? (
            <>
              <View style={styles.kpiGrid}>
                <KpiTile label="Ingresos YTD" value={EuroformatEuro(resumen.ingresos_ytd)} infoKey="ingresos_ytd" />
                <KpiTile label="Gastos YTD" value={EuroformatEuro(resumen.gastos_ytd)} infoKey="gastos_ytd" />
                <KpiTile label="Cash-flow" value={EuroformatEuro(resumen.cashflow_ytd)} infoKey="cashflow_ytd" />
                <KpiTile label="Promedio mensual" value={EuroformatEuro(resumen.promedio_mensual)} infoKey="promedio_mensual" />
              </View>
              <Text style={styles.smallMuted}>Meses contados: {resumen.meses_contados}</Text>
            </>
          ) : (
            <Text style={styles.smallMuted}>Sin resumen (se activará cuando analytics v3 esté listo).</Text>
          )}
        </View>

        {/* Detalle gastos */}
        {breakdownG ? (
          <View style={styles.card}>
            <CardTitle icon="receipt-outline" text="Detalle gastos" />
            <BreakdownTable rows={breakdownG.rows || []} totalYtd={breakdownG.total_ytd} />
          </View>
        ) : null}

        {/* Detalle ingresos */}
        {breakdownI ? (
          <View style={styles.card}>
            <CardTitle icon="cash-outline" text="Detalle ingresos" />
            <BreakdownTable rows={breakdownI.rows || []} totalYtd={breakdownI.total_ytd} />
          </View>
        ) : null}
      </ScrollView>

      <KpiInfoModal
        visible={kpiInfoOpen}
        title={KPI_INFO[kpiInfoKey]?.title ?? 'KPI'}
        description={
          KPI_INFO[kpiInfoKey]?.desc ??
          'Este KPI no tiene descripción todavía. Se añadirá una vez definamos el estándar de cálculo.'
        }
        onClose={() => setKpiInfoOpen(false)}
      />
    </>
  );
}

function Meta({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value == null || value === '' ? '—' : String(value)}</Text>
    </View>
  );
}

function BreakdownTable({ rows, totalYtd }: { rows: BreakdownRow[]; totalYtd: number }) {
  return (
    <View>
      <View style={[styles.tableRow, styles.tableHeader]}>
        <Text style={[styles.th, { flex: 0.44 }]}>Tipo</Text>
        <Text style={[styles.th, { flex: 0.22, textAlign: 'right' }]}>Cuota</Text>
        <Text style={[styles.th, { flex: 0.10, textAlign: 'right' }]}>Mes</Text>
        <Text style={[styles.th, { flex: 0.24, textAlign: 'right' }]}>Total</Text>
      </View>

      {rows.map((r, idx) => (
        <View key={`${r.tipo}-${idx}`} style={styles.tableRow}>
          <View style={{ flex: 0.44 }}>
            <Text style={styles.td}>{r.tipo || '—'}</Text>
            {!!r.periodicidad && <Text style={styles.tdMuted}>{r.periodicidad}</Text>}
          </View>
          <Text style={[styles.td, { flex: 0.22, textAlign: 'right' }]}>{EuroformatEuro(r.cuota ?? 0)}</Text>
          <Text style={[styles.td, { flex: 0.10, textAlign: 'right' }]}>{String(r.meses ?? 0)}</Text>
          <Text style={[styles.td, { flex: 0.24, textAlign: 'right', fontWeight: '900' }]}>{EuroformatEuro(r.total ?? 0)}</Text>
        </View>
      ))}

      <View style={[styles.tableRow, styles.tableFooter]}>
        <Text style={[styles.th, { flex: 0.44 }]}>Total YTD</Text>
        <Text style={[styles.th, { flex: 0.22, textAlign: 'right' }]}>—</Text>
        <Text style={[styles.th, { flex: 0.10, textAlign: 'right' }]}>—</Text>
        <Text style={[styles.th, { flex: 0.24, textAlign: 'right' }]}>{EuroformatEuro(totalYtd ?? 0)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: spacing.md,
    marginBottom: spacing.md,
  },

  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textPrimary,
  },

  smallLine: {
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },

  smallMuted: { fontSize: 12, color: colors.textSecondary },
  smallStrong: { fontSize: 12, color: colors.textPrimary, fontWeight: '900' },

  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metaItem: { width: '48%', marginBottom: spacing.sm },
  metaLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '700' },
  metaValue: { fontSize: 12, color: colors.textPrimary },

  metaRow2Cols: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaHalf: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },

  // --- NUEVO: fila adquisición alineada (label | [€ + %] con ancho fijo)
  rowBetween3: {
  flexDirection: 'row',
  alignItems: 'baseline',
  paddingVertical: 4,
  },
  rowLabel: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    paddingRight: 10,
  },
  rowValue: {
    width: 170,            // ajusta 160–190 según tu fuente/pantallas
    textAlign: 'right',
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
  },

  rowPct: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
  },

  sep: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  totalLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '800',
    textAlign: 'center',
  },
  totalValue: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '900',
    textAlign: 'center',
  },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiBox: {
    width: '48%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  kpiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '800' },
  kpiValue: { marginTop: 4, fontSize: 14, color: colors.textPrimary, fontWeight: '900' },

  tableRow: { flexDirection: 'row', paddingVertical: 6, alignItems: 'flex-start' },
  tableHeader: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 6 },
  tableFooter: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 },
  th: { fontSize: 11, fontWeight: '900', color: colors.textPrimary },
  td: { fontSize: 12, color: colors.textPrimary },
  tdMuted: { fontSize: 10, color: colors.textSecondary },
});
