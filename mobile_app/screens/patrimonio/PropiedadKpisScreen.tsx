/**
 * Archivo: mobile_app/screens/patrimonio/PropiedadKpisScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de KPIs de una Propiedad (Patrimonio) con cálculo configurable.
 *
 * Periodos (nuevo router analytics):
 *   - LAST_12  -> Últimos 12 meses (por defecto)
 *   - ALL_TIME -> Todos los tiempos (desde adquisición)
 *   - YEAR     -> Resumen por año (2026, 2025, etc.)
 *
 * Navegación de periodos:
 *   LAST_12 <-> ALL_TIME <-> YEAR(current) <-> YEAR(current-1) <-> ...
 *
 * Regla de "Anualizar":
 *   - Solo aparece cuando: mode === 'YEAR' && year === currentYear
 *   - Si está activo, backend multiplica por factor = 12 / meses_contados (YTD -> 12m extrapolado).
 *   - En cualquier otro modo/año: annualize se fuerza a false (y se resetea el estado para evitar errores UX).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import { api } from '../../services/api';
import { EuroformatEuro } from '../../utils/format';

// ✅ Reutiliza el componente de flechas (no incluimos su código aquí)
import PeriodNavigator from '../../components/ui/PeriodNavigator';

type Basis = 'total' | 'compra' | 'referencia' | 'max';
type PeriodMode = 'LAST_12' | 'ALL_TIME' | 'YEAR';

type KpiResponse = {
  year: number;
  basis_used: Basis;
  valor_base: number;
  meses_contados: number;

  ingresos_anuales: number;
  gastos_operativos_anuales: number;
  noi: number;

  cap_rate_pct: number | null;
  rendimiento_bruto_pct: number | null;

  cashflow_anual: number;
  cashflow_mensual: number;

  payback_anios: number | null;

  precio_m2: number | null;
  referencia_m2: number | null;
  renta_m2_anual: number | null;
  inversion_m2: number | null;
  rentab_m2_total_pct: number | null;

  deuda_anual: number;
  dscr: number | null;
  ocupacion_pct: number | null;

  info: Record<string, string>;
};

type Props = {
  route?: {
    params?: {
      patrimonioId: string;
      returnToTab?: string;
      returnToScreen?: string;
      returnToParams?: any;
    };
  };
  navigation?: any;
};

type SegOption<T extends string> = { label: string; value: T };

function clampYear(y: number, minYear: number, maxYear: number) {
  if (y < minYear) return minYear;
  if (y > maxYear) return maxYear;
  return y;
}

function periodLabel(mode: PeriodMode, year: number) {
  if (mode === 'LAST_12') return 'Últimos 12 meses';
  if (mode === 'ALL_TIME') return 'Todos los tiempos';
  return `Resumen ${year}`;
}

export default function PropiedadKpisScreen({ route, navigation }: Props) {
  const patrimonioId = route?.params?.patrimonioId as string;

  // Back: prioridad returnTo* si existe
  const returnToTab = route?.params?.returnToTab;
  const returnToScreen = route?.params?.returnToScreen;
  const returnToParams = route?.params?.returnToParams;

  const handleBack = useCallback(() => {
    if (returnToTab) {
      if (returnToScreen) {
        navigation?.navigate?.(returnToTab, { screen: returnToScreen, params: returnToParams });
      } else {
        navigation?.navigate?.(returnToTab);
      }
      return;
    }
    navigation?.navigate?.('PropiedadDetalle', { patrimonioId });
  }, [navigation, patrimonioId, returnToTab, returnToScreen, returnToParams]);

  // ----------------------------
  // Periodo
  // ----------------------------
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [mode, setMode] = useState<PeriodMode>('LAST_12');
  const [year, setYear] = useState<number>(currentYear);

  // Nota: si no tenemos fecha adquisición aquí, dejamos un mínimo razonable.
  const minYear = useMemo(() => 2000, []);
  const maxYear = currentYear;

  // ----------------------------
  // Parámetros KPI
  // ----------------------------
  const [basis, setBasis] = useState<Basis>('total');

  /**
   * annualizeState:
   * - Solo se usa cuando (mode === 'YEAR' && year === currentYear)
   * - En el resto de casos, se fuerza a false (y además reseteamos el estado cuando deja de aplicar)
   */
  const [annualize, setAnnualize] = useState<boolean>(false);

  /**
   * Solo gastos KPI:
   * - Mantengo el switch porque tú lo pediste como posible utilidad.
   * - Si lo quieres ocultar también por periodo, se puede hacer similar a anualize.
   */
  const [onlyKpiExpenses, setOnlyKpiExpenses] = useState<boolean>(false);

  // ✅ Regla: anualizar solo en YEAR del año actual
  const canAnnualize = mode === 'YEAR' && year === currentYear;
  const effectiveAnnualize = canAnnualize ? annualize : false;

  // Cuando deja de aplicar, reseteamos el estado para evitar “quedarse en true” sin verse.
  useEffect(() => {
    if (!canAnnualize && annualize) {
      setAnnualize(false);
    }
  }, [canAnnualize, annualize]);

  // ----------------------------
  // Estado de carga
  // ----------------------------
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KpiResponse | null>(null);

  // ----------------------------
  // Modal info
  // ----------------------------
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState('');
  const [infoText, setInfoText] = useState('');

  const openInfo = useCallback(
    (title: string, key: string) => {
      const txt = kpi?.info?.[key] ?? '—';
      setInfoTitle(title);
      setInfoText(txt);
      setInfoOpen(true);
    },
    [kpi]
  );

  // ----------------------------
  // Carga KPI (router v3: mode)
  // ----------------------------
  const load = useCallback(async () => {
    setErr(null);

    const safeYear = clampYear(year, minYear, maxYear);

    try {
      const r = await api.get<KpiResponse>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/kpis`,
        {
          params: {
            year: safeYear,
            mode,
            basis,
            // ✅ anualize solo si YEAR del año actual y el usuario lo activó
            annualize: effectiveAnnualize,
            only_kpi_expenses: onlyKpiExpenses,
          },
        }
      );

      setKpi(r.data ?? null);
    } catch {
      setErr('No se pudieron cargar los KPIs.');
      setKpi(null);
    }
  }, [patrimonioId, year, minYear, maxYear, mode, basis, effectiveAnnualize, onlyKpiExpenses]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ----------------------------
  // PeriodNavigator: lógica de flechas
  //
  // Secuencia:
  //   LAST_12 <-> ALL_TIME <-> YEAR(current) <-> YEAR(current-1) <-> ...
  // ----------------------------
  const onPrevPeriod = useCallback(() => {
    if (mode === 'LAST_12') {
      setMode('ALL_TIME');
      return;
    }
    if (mode === 'ALL_TIME') {
      setMode('YEAR');
      setYear(maxYear);
      return;
    }
    setMode('YEAR');
    setYear((y) => clampYear(y - 1, minYear, maxYear));
  }, [mode, minYear, maxYear]);

  const onNextPeriod = useCallback(() => {
    if (mode === 'LAST_12') return;

    if (mode === 'YEAR') {
      if (year < maxYear) {
        setYear((y) => clampYear(y + 1, minYear, maxYear));
      } else {
        setMode('ALL_TIME');
      }
      return;
    }

    if (mode === 'ALL_TIME') {
      setMode('LAST_12');
    }
  }, [mode, year, minYear, maxYear]);

  // Si el usuario cambia a YEAR y el year quedó fuera, lo corregimos.
  useEffect(() => {
    if (mode === 'YEAR') {
      setYear((y) => clampYear(y, minYear, maxYear));
    }
  }, [mode, minYear, maxYear]);

  // ----------------------------
  // UI: opciones basis
  // ----------------------------
  const basisOptions: SegOption<Basis>[] = useMemo(
    () => [
      { label: 'Total', value: 'total' },
      { label: 'Compra', value: 'compra' },
      { label: 'Ref.', value: 'referencia' },
      { label: 'Max', value: 'max' },
    ],
    []
  );

  const subtitleText = useMemo(() => `Periodo: ${periodLabel(mode, year)}`, [mode, year]);

  return (
    <>
      <Header title="KPIs" subtitle="Ratios y rentabilidad" showBack onBackPress={handleBack} />

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Parámetros */}
        <View style={styles.card}>
          <View style={styles.blockHeader}>
            <View>
              <Text style={styles.blockTitle}>Parámetros</Text>
              <Text style={styles.blockSubtitle}>{subtitleText}</Text>
            </View>
          </View>

          {/* Flechas periodo */}
          <View style={{ marginTop: spacing.sm }}>
            <PeriodNavigator label={periodLabel(mode, year)} onPrev={onPrevPeriod} onNext={onNextPeriod} />
            <Text style={styles.hintText}>
              {mode === 'LAST_12'
                ? 'Cálculo en ventana móvil de 12 meses.'
                : mode === 'ALL_TIME'
                  ? 'Cálculo desde adquisición hasta hoy.'
                  : year === currentYear
                    ? 'Cálculo año actual (YTD). Puedes extrapolar a 12 meses con "Anualizar".'
                    : 'Cálculo por año natural (enero-diciembre).'}
            </Text>
          </View>

          {/* Basis */}
          <SegmentedControl<Basis> options={basisOptions} value={basis} onChange={setBasis} />

          {/* Switches */}
          <View style={styles.switchRow}>
            {/* ✅ Anualizar SOLO visible si YEAR del año actual */}
            {canAnnualize ? (
              <SwitchPill
                label="Anualizar"
                value={annualize}
                onToggle={() => setAnnualize((v) => !v)}
              />
            ) : null}

            <SwitchPill
              label="Solo gastos KPI"
              value={onlyKpiExpenses}
              onToggle={() => setOnlyKpiExpenses((v) => !v)}
            />
          </View>

          <Text style={styles.hintText}>Desliza hacia abajo para actualizar.</Text>
        </View>

        {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
        {loading && !kpi ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}

        {/* KPIs */}
        {kpi ? (
          <View style={styles.grid}>
            <KpiCard title="Valor base" value={EuroformatEuro(kpi.valor_base)} onInfo={() => openInfo('Valor base', 'valor_base')} />
            <KpiCard title="Meses contados" value={String(kpi.meses_contados)} onInfo={() => openInfo('Meses contados', 'meses_contados')} />

            <KpiCard title="Ingresos anuales" value={EuroformatEuro(kpi.ingresos_anuales)} onInfo={() => openInfo('Ingresos anuales', 'ingresos_anuales')} />
            <KpiCard title="Gastos anuales" value={EuroformatEuro(kpi.gastos_operativos_anuales)} onInfo={() => openInfo('Gastos anuales', 'gastos_operativos_anuales')} />

            <KpiCard title="NOI" value={EuroformatEuro(kpi.noi)} onInfo={() => openInfo('NOI', 'noi')} />
            <KpiCard title="Cap rate" value={kpi.cap_rate_pct != null ? `${kpi.cap_rate_pct.toFixed(2)} %` : '—'} onInfo={() => openInfo('Cap rate', 'cap_rate_pct')} />

            <KpiCard title="Rend. bruto" value={kpi.rendimiento_bruto_pct != null ? `${kpi.rendimiento_bruto_pct.toFixed(2)} %` : '—'} onInfo={() => openInfo('Rend. bruto', 'rendimiento_bruto_pct')} />
            <KpiCard title="Cash-flow anual" value={EuroformatEuro(kpi.cashflow_anual)} onInfo={() => openInfo('Cash-flow anual', 'cashflow_anual')} />

            <KpiCard title="Cash-flow mensual" value={EuroformatEuro(kpi.cashflow_mensual)} onInfo={() => openInfo('Cash-flow mensual', 'cashflow_mensual')} />
            <KpiCard title="Payback" value={kpi.payback_anios != null ? `${kpi.payback_anios.toFixed(2)} años` : '—'} onInfo={() => openInfo('Payback', 'payback_anios')} />

            <KpiCard title="€/m² (compra)" value={kpi.precio_m2 != null ? EuroformatEuro(kpi.precio_m2) : '—'} onInfo={() => openInfo('€/m² (compra)', 'precio_m2')} />
            <KpiCard title="€/m² (ref.)" value={kpi.referencia_m2 != null ? EuroformatEuro(kpi.referencia_m2) : '—'} onInfo={() => openInfo('€/m² (ref.)', 'referencia_m2')} />

            <KpiCard title="Renta €/m²/año" value={kpi.renta_m2_anual != null ? EuroformatEuro(kpi.renta_m2_anual) : '—'} onInfo={() => openInfo('Renta €/m²/año', 'renta_m2_anual')} />
            <KpiCard title="€/m² (inv. total)" value={kpi.inversion_m2 != null ? EuroformatEuro(kpi.inversion_m2) : '—'} onInfo={() => openInfo('€/m² (inv. total)', 'inversion_m2')} />

            <KpiCard title="Rentab % /m² (inv)" value={kpi.rentab_m2_total_pct != null ? `${kpi.rentab_m2_total_pct.toFixed(2)} %` : '—'} onInfo={() => openInfo('Rentab % /m² (inv)', 'rentab_m2_total_pct')} />

            <KpiCard title="Deuda anual" value={EuroformatEuro(kpi.deuda_anual)} onInfo={() => openInfo('Deuda anual', 'deuda_anual')} />
            <KpiCard title="DSCR" value={kpi.dscr != null ? kpi.dscr.toFixed(2) : '—'} onInfo={() => openInfo('DSCR', 'dscr')} />

            <KpiCard title="Ocupación" value={kpi.ocupacion_pct != null ? `${kpi.ocupacion_pct.toFixed(1)} %` : '—'} onInfo={() => openInfo('Ocupación', 'ocupacion_pct')} />
          </View>
        ) : null}

        {/* Modal info */}
        <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setInfoOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => null}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{infoTitle}</Text>
                <Pressable onPress={() => setInfoOpen(false)} hitSlop={10}>
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.modalText}>{infoText}</Text>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </>
  );
}

/* =========================
   Components locales
   ========================= */

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segBtn,
              active
                ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.borderColor },
            ]}
            activeOpacity={0.9}
          >
            <Text style={[styles.segLabel, active ? { color: colors.primary } : { color: colors.textPrimary }]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SwitchPill({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity onPress={onToggle} style={styles.switchBtn} activeOpacity={0.9}>
      <View
        style={[
          styles.switchDot,
          value ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface },
        ]}
      />
      <Text style={styles.switchLabel}>{label}</Text>
    </TouchableOpacity>
  );
}


function KpiCard({ title, value, onInfo }: { title: string; value: string; onInfo: () => void }) {
  return (
    <View style={styles.kpiCard}>
      <View style={styles.kpiHeader}>
        <Text style={styles.kpiTitle}>{title}</Text>
        <TouchableOpacity onPress={onInfo} hitSlop={6} activeOpacity={0.9}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
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

  blockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blockTitle: { fontSize: 14, fontWeight: '900', color: colors.textPrimary },
  blockSubtitle: { marginTop: 2, fontSize: 12, color: colors.textSecondary },

  hintText: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary },

  segRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  segBtn: { flex: 1, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 10, alignItems: 'center' },
  segLabel: { fontWeight: '900', fontSize: 12 },

  switchRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    flex: 1,
    gap: 10,
    minWidth: '48%',
  },
  switchDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  switchLabel: { fontWeight: '800', color: colors.textPrimary, fontSize: 12 },
  switchHelper: { marginTop: 2, fontSize: 11, color: colors.textSecondary },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  kpiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kpiTitle: { fontWeight: '900', color: colors.textPrimary, fontSize: 12 },
  kpiValue: { marginTop: 6, fontSize: 15, fontWeight: '400', color: colors.textPrimary },

  modalBackdrop: {
    flex: 1,
    backgroundColor: '#0007',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTitle: { fontSize: 16, fontWeight: '900', color: colors.textPrimary },
  modalText: { fontSize: 13, color: colors.textPrimary },
});
