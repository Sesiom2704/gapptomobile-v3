/**
 * Archivo: mobile_app/screens/patrimonio/PropiedadFormScreen.tsx
 *
 * Responsabilidad:
 *   - Alta, edición, duplicado y consulta (readOnly) de una Propiedad (Patrimonio).
 *   - Orquesta un flujo por pasos (BASE / COMPRA), incluyendo carga inicial, validación y persistencia.
 *
 * Maneja:
 *   - UI:
 *       - Formulario basado en Screen + Header + FormSection.
 *       - Controles de selección tipo “pill” (segmentos/booleanos) con PillButton.
 *       - Búsqueda/selección de Localidad con sugerencias server-side y límite de 4 resultados.
 *       - Selectores de fecha para adquisición (control estándar FormDateButton).
 *   - Estado:
 *       - base (datos principales) y compra (datos de compra).
 *       - step (BASE/COMPRA) y flags de loading/saving/refreshing.
 *       - localidadQuery + localidadSelectedId para selección robusta (por ID y fallback por nombre normalizado).
 *   - Datos:
 *       - Lectura:
 *           - patrimonioApi.getPatrimonio(patrimonioId)
 *           - patrimonioApi.getPatrimonioCompra(patrimonioId)
 *           - listLocalidades({ search, limit: 4 })
 *       - Escritura:
 *           - patrimonioApi.createPatrimonio(payload)
 *           - patrimonioApi.updatePatrimonio(patrimonioId, payload)
 *           - patrimonioApi.upsertPatrimonioCompra(patrimonioId, compra)
 *   - Navegación:
 *       - Retorno condicionado: returnToTab / returnToScreen / returnToParams y fromHome.
 *       - Integración de retorno desde LocalidadForm (AuxEntityForm) vía route.params.auxResult con limpieza posterior.
 *       - Acción “+” para crear Localidad desde el propio campo (InlineAddButton).
 *
 * Cambios aplicados (patrón replicable):
 *   - BASE:
 *       - Campo Localidad en una sola fila (full width) con botón “+” integrado en la cabecera del campo.
 *       - Campo Referencia movido a una fila independiente (full width) para mejorar legibilidad.
 *       - Selección de Localidad con estado por ID (localidadSelectedId) y fallback por nombre normalizado.
 *   - COMPRA:
 *       - Eliminada la UI de “Fecha compra” (no se muestra ni se edita desde esta pantalla).
 *       - Reordenación de campos:
 *           - Fila 1: Valor compra | Valor referencia
 *           - Fila 2: Impuestos (%) | Reforma/Adecuamiento
 *           - Fila 3: Notaría | Agencia
 *           - Fila 4: Notas (full width)
 *       - Eliminados textos auxiliares tipo “Vista: xx.xxx,xx €”.
 *   - Fecha adquisición:
 *       - Estandarizada usando FormDateButton como control de fecha (consistencia con el resto de formularios).
 *
 * Notas:
 *   - Se preserva la lógica funcional existente (carga inicial, duplicado, validaciones, guardado, pull-to-refresh, auxResult).
 *   - compra.fecha_compra se mantiene en el modelo/persistencia si llega desde backend, pero no se expone en la UI.
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

type Basis = 'total' | 'compra' | 'referencia' | 'max';

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
  _info: Record<string, string>;
};

type Props = {
  route?: { params?: { patrimonioId: string; returnToTab?: string; returnToScreen?: string; returnToParams?: any } };
  navigation?: any;
};

type SegOption<T extends string> = { label: string; value: T };

export default function PropiedadKpisScreen({ route, navigation }: Props) {
  const patrimonioId = route?.params?.patrimonioId as string;

  // 1) Header back to DetallePropiedad (prioridad: returnTo* si existe)
  const returnToTab = route?.params?.returnToTab;
  const returnToScreen = route?.params?.returnToScreen;
  const returnToParams = route?.params?.returnToParams;

  const handleBack = () => {
    if (returnToTab) {
      if (returnToScreen) {
        navigation?.navigate(returnToTab, { screen: returnToScreen, params: returnToParams });
      } else {
        navigation?.navigate(returnToTab);
      }
      return;
    }

    // Fallback “detalle propiedad”
    // Ajusta el nombre exacto si tu screen se llama diferente.
    if (navigation?.navigate) {
      navigation.navigate('PropiedadDetalle', { patrimonioId });
      return;
    }
  };

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [basis, setBasis] = useState<Basis>('total');
  const [annualize, setAnnualize] = useState<boolean>(true);
  const [onlyKpiExpenses, setOnlyKpiExpenses] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KpiResponse | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState('');
  const [infoText, setInfoText] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get<KpiResponse>(`/api/v1/analytics/patrimonios/${patrimonioId}/kpis`, {
        params: { year, basis, annualize, only_kpi_expenses: onlyKpiExpenses },
      });
      setKpi(r.data);
    } catch {
      setErr('No se pudieron cargar los KPIs (pendiente analytics v3).');
      setKpi(null);
    }
  }, [patrimonioId, year, basis, annualize, onlyKpiExpenses]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openInfo = (title: string, key: string) => {
    const txt = kpi?._info?.[key] ?? '—';
    setInfoTitle(title);
    setInfoText(txt);
    setInfoOpen(true);
  };

  const basisOptions: SegOption<Basis>[] = useMemo(
    () => [
      { label: 'Total', value: 'total' },
      { label: 'Compra', value: 'compra' },
      { label: 'Ref.', value: 'referencia' },
      { label: 'Max', value: 'max' },
    ],
    []
  );

  return (
    <>
      {/* 6) Encabezado tipo (title/subtitle + back) */}
      <Header title="KPIs" subtitle="Ratios y rentabilidad" showBack onBackPress={handleBack} />

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 6) Bloque encabezado (card “Parámetros”) */}
        <View style={styles.card}>
          <View style={styles.blockHeader}>
            <View>
              <Text style={styles.blockTitle}>Parámetros</Text>
              <Text style={styles.blockSubtitle}>Configura el cálculo para {year}</Text>
            </View>
          </View>

          {/* 3) Botones de parámetros con componente */}
          <SegmentedControl<Basis> options={basisOptions} value={basis} onChange={setBasis} />

          <View style={styles.switchRow}>
            <SwitchPill label="Anualizar" value={annualize} onToggle={() => setAnnualize((v) => !v)} />
            <SwitchPill
              label="Solo gastos KPI"
              value={onlyKpiExpenses}
              onToggle={() => setOnlyKpiExpenses((v) => !v)}
            />
          </View>

          <YearStepper year={year} onPrev={() => setYear((y) => y - 1)} onNext={() => setYear((y) => y + 1)} />

          {/* 2) Botón actualizar eliminado: pull-to-refresh */}
          <Text style={styles.hintText}>Desliza hacia abajo para actualizar.</Text>
        </View>

        {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
        {loading && !kpi ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}

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

        {/* 4) Modal info sin “Entendido”: X o pulsar fuera */}
        <Modal
          visible={infoOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setInfoOpen(false)}
        >
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
   Components (puedes extraer a /components/ui)
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
    <TouchableOpacity onPress={onToggle} style={styles.switchBtn}>
      <View style={[styles.switchDot, value ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface }]} />
      <Text style={styles.switchLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function YearStepper({
  year,
  onPrev,
  onNext,
}: {
  year: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.yearRow}>
      <TouchableOpacity style={styles.yearBtn} onPress={onPrev}>
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.yearText}>{year}</Text>
      <TouchableOpacity style={styles.yearBtn} onPress={onNext}>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

function KpiCard({ title, value, onInfo }: { title: string; value: string; onInfo: () => void }) {
  return (
    <View style={styles.kpiCard}>
      <View style={styles.kpiHeader}>
        <Text style={styles.kpiTitle}>{title}</Text>
        <TouchableOpacity onPress={onInfo} hitSlop={6}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* 5) Valor: +1 size y sin negrita */}
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

  switchRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    flex: 1,
  },
  switchDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.borderColor, marginRight: 8 },
  switchLabel: { fontWeight: '800', color: colors.textPrimary, fontSize: 12 },

  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  yearBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center' },
  yearText: { fontSize: 16, fontWeight: '900', color: colors.textPrimary, minWidth: 70, textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiCard: { width: '48%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.lg, padding: spacing.md },
  kpiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kpiTitle: { fontWeight: '900', color: colors.textPrimary, fontSize: 12 },

  // 5) valores: sin negrita y +1 tamaño
  kpiValue: { marginTop: 6, fontSize: 15, fontWeight: '400', color: colors.textPrimary },

  // 4) modal: cerrar con X o fuera
  modalBackdrop: { flex: 1, backgroundColor: '#0007', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTitle: { fontSize: 16, fontWeight: '900', color: colors.textPrimary },
  modalText: { fontSize: 13, color: colors.textPrimary },
});
