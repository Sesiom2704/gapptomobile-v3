// mobile_app/screens/patrimonio/PropiedadDetalleScreen.tsx
//
// Detalle de propiedad (v5)
//
// Cambios incluidos:
// - Selector de periodo con flechas (UX tipo DayToDayKpisScreen).
// - Tres modos de análisis:
//     1) LAST_12  (default) -> "Últimos 12 meses"
//     2) ALL_TIME           -> "Todos los tiempos" (desde adquisición)
//     3) YEAR               -> "Resumen {YYYY}"
// - Nuevo bloque "Alquiler" dentro del detalle de propiedad.
//   - Muestra estado contractual de la vivienda.
//   - Permite crear contrato si no existe contrato activo.
//   - Permite ver contrato y gestionar participantes si existe.
//
// Cambios de esta versión:
// - El bloque Alquiler ya no usa llamada directa con api.get(...)
// - Se conecta con mobile_app/services/gestionAlquilerApi.ts
// - Se reutiliza el tipo ContratoResumenActivo del servicio
//
// Backend esperado:
// - GET /api/v1/gestion-alquiler/patrimonios/:patrimonioId/resumen-activo
//
// Notas:
// - Si no existe contrato activo, el backend devuelve null.
// - Las rutas de navegación activas son:
//     - ContratoCreate
//     - ContratoDetalle
//     - ContratoParticipantes

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

import {
  listContratos,
  getObjetoAlquilerLabel,
  type ContratoRow,
} from '../../services/gestionAlquilerApi';

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

  deuda_anual?: number | null;
  cashflow_anual?: number | null;
  cashflow_mensual?: number | null;
};

type Props = {
  route?: { params?: { patrimonioId: string } };
  navigation?: any;
};

type PeriodMode = 'LAST_12' | 'ALL_TIME' | 'YEAR';

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

function formatEstadoContrato(estado?: string | null): string {
  if (!estado) return 'Sin contrato activo';
  const e = String(estado).trim().toLowerCase();

  if (e === 'activo') return 'Activo';
  if (e === 'finalizado') return 'Finalizado';
  if (e === 'pendiente') return 'Pendiente';
  if (e === 'cancelado') return 'Cancelado';

  return estado.charAt(0).toUpperCase() + estado.slice(1);
}

function samePersonName(a?: string | null, b?: string | null): boolean {
  const na = String(a ?? '').trim().toLowerCase();
  const nb = String(b ?? '').trim().toLowerCase();
  return !!na && !!nb && na === nb;
}

function getEstadoBadgeStyle(estado?: string | null) {
  const e = String(estado || '').trim().toLowerCase();

  if (e === 'activo') {
    return {
      backgroundColor: colors.successSoft ?? '#EAF8EF',
      borderColor: colors.success ?? '#2E9B61',
      textColor: colors.success ?? '#2E9B61',
    };
  }

  if (e === 'finalizado' || e === 'cancelado') {
    return {
      backgroundColor: colors.neutralSoft,
      borderColor: colors.border,
      textColor: colors.textSecondary,
    };
  }

  return {
    backgroundColor: colors.warningSoft ?? '#FFF6E8',
    borderColor: colors.warning ?? '#D38A00',
    textColor: colors.warning ?? '#D38A00',
  };
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
      'Ocupación (%) = (Meses cobrados / Meses del periodo) × 100.\n\nAproximación basada en ingresos recurrentes registrados.',
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

function parseYearFromYYYYMMDD(s?: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const y = Number(String(s).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export default function PropiedadDetalleScreen({ route, navigation }: Props) {
  const patrimonioId = route?.params?.patrimonioId as string;

  const now = useMemo(() => new Date(), []);
  const currentYear = useMemo(() => now.getFullYear(), [now]);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [base, setBase] = useState<PatrimonioRow | null>(null);
  const [compra, setCompra] = useState<PatrimonioCompraOut | null>(null);

  const [resumen, setResumen] = useState<ResumenYTD | null>(null);
  const [breakdownG, setBreakdownG] = useState<Breakdown | null>(null);
  const [breakdownI, setBreakdownI] = useState<Breakdown | null>(null);
  const [kpi, setKpi] = useState<Kpis | null>(null);

  // ---- Alquiler ----
  const [alquilerLoading, setAlquilerLoading] = useState(false);
  const [contratosPropiedad, setContratosPropiedad] = useState<ContratoRow[]>([]);
  const [participantesExpanded, setParticipantesExpanded] = useState<Record<string, boolean>>({});
  // KPI info modal
  const [kpiInfoOpen, setKpiInfoOpen] = useState(false);
  const [kpiInfoKey, setKpiInfoKey] = useState<string>('cap_rate_pct');

  // -------------------------
  // Period selector state
  // -------------------------
  const [periodMode, setPeriodMode] = useState<PeriodMode>('LAST_12');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const adquisicionYear = useMemo(
    () => parseYearFromYYYYMMDD(base?.fecha_adquisicion) ?? null,
    [base?.fecha_adquisicion]
  );

  const minYear = useMemo(() => {
    return adquisicionYear ?? (currentYear - 10);
  }, [adquisicionYear, currentYear]);

  useEffect(() => {
    setSelectedYear((y) => {
      if (y < minYear) return minYear;
      if (y > currentYear) return currentYear;
      return y;
    });
  }, [minYear, currentYear]);

  const periodTitle = useMemo(() => {
    if (periodMode === 'LAST_12') return 'Últimos 12 meses';
    if (periodMode === 'ALL_TIME') return 'Todos los tiempos';
    return `Resumen ${selectedYear}`;
  }, [periodMode, selectedYear]);

  const analyticsYear = useMemo(() => {
    return periodMode === 'YEAR' ? selectedYear : currentYear;
  }, [periodMode, selectedYear, currentYear]);

  const analyticsParams = useMemo(() => {
    return { year: analyticsYear, mode: periodMode };
  }, [analyticsYear, periodMode]);

  const canGoLeft = useMemo(() => {
    if (periodMode === 'LAST_12') return true;
    if (periodMode === 'ALL_TIME') return true;
    return selectedYear > minYear;
  }, [periodMode, selectedYear, minYear]);

  const canGoRight = useMemo(() => {
    if (periodMode === 'LAST_12') return false;
    if (periodMode === 'ALL_TIME') return true;
    return true;
  }, [periodMode]);

  const goLeft = useCallback(() => {
    if (periodMode === 'LAST_12') {
      setPeriodMode('ALL_TIME');
      return;
    }
    if (periodMode === 'ALL_TIME') {
      setPeriodMode('YEAR');
      setSelectedYear(currentYear);
      return;
    }
    setSelectedYear((y) => Math.max(minYear, y - 1));
  }, [periodMode, currentYear, minYear]);

  const goRight = useCallback(() => {
    if (periodMode === 'ALL_TIME') {
      setPeriodMode('LAST_12');
      return;
    }
    if (periodMode === 'YEAR') {
      setSelectedYear((y) => {
        if (y < currentYear) return y + 1;
        setPeriodMode('ALL_TIME');
        return y;
      });
      return;
    }
  }, [periodMode, currentYear]);

  // -------------------------
  // KPI info modal handlers
  // -------------------------
  const openKpiInfo = (key: string) => {
    setKpiInfoKey(key);
    setKpiInfoOpen(true);
  };

  const headerTitle = useMemo(() => base?.referencia || base?.id || 'Propiedad', [base]);

  const loadAnalytics = useCallback(async () => {
    try {
      const r1 = await api.get<ResumenYTD>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/resumen`,
        { params: analyticsParams }
      );
      setResumen(r1.data);
    } catch {
      setResumen(null);
    }

    try {
      const r2 = await api.get<Breakdown>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/gastos_breakdown`,
        { params: analyticsParams }
      );
      setBreakdownG(r2.data);
    } catch {
      setBreakdownG(null);
    }

    try {
      const r3 = await api.get<Breakdown>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/ingresos_breakdown`,
        { params: analyticsParams }
      );
      setBreakdownI(r3.data);
    } catch {
      setBreakdownI(null);
    }

    try {
      const r4 = await api.get<Kpis>(
        `/api/v1/analytics/patrimonios/${encodeURIComponent(patrimonioId)}/kpis`,
        { params: { ...analyticsParams, basis: 'total', annualize: false } }
      );
      setKpi(r4.data);
    } catch {
      setKpi(null);
    }
  }, [patrimonioId, analyticsParams]);

  const loadAlquiler = useCallback(async () => {
    setAlquilerLoading(true);

    try {
      const response = await listContratos({ patrimonio_id: patrimonioId });
      setContratosPropiedad(Array.isArray(response) ? response : []);
    } catch {
      setContratosPropiedad([]);
    } finally {
      setAlquilerLoading(false);
    }
  }, [patrimonioId]);

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

        await Promise.all([loadAnalytics(), loadAlquiler()]);
      } catch {
        setErr('No se pudo cargar el detalle de la propiedad.');
      } finally {
        if (!isPull) setLoading(false);
        if (isPull) setRefreshing(false);
      }
    },
    [patrimonioId, loadAnalytics, loadAlquiler]
  );

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => {
    if (!base) return;
    loadAnalytics();
  }, [periodMode, selectedYear, base, loadAnalytics]);

  const goMasKpis = useCallback(() => {
    navigation?.navigate?.('PropiedadKpis', { patrimonioId });
  }, [navigation, patrimonioId]);

  const goCrearContrato = useCallback(() => {
    navigation?.navigate?.('ContratoCreate', { patrimonioId });
  }, [navigation, patrimonioId]);

  const goVerContrato = useCallback((contratoId: string) => {
    if (!contratoId) return;
    navigation?.navigate?.('ContratoDetalle', {
      patrimonioId,
      contratoId,
    });
  }, [navigation, patrimonioId]);

  const goParticipantes = useCallback((contratoId: string) => {
    if (!contratoId) return;
    navigation?.navigate?.('ContratoParticipantes', {
      patrimonioId,
      contratoId,
    });
  }, [navigation, patrimonioId]);

  const totalInv = safeNum(compra?.total_inversion) ?? null;

  const handleBack = () => {
    navigation.navigate('PropiedadesRanking');
  };

  const contratosOrdenados = useMemo(() => {
    return [...contratosPropiedad].sort((a, b) => {
      const aInicio = String(a.fecha_inicio ?? '');
      const bInicio = String(b.fecha_inicio ?? '');
      if (aInicio !== bInicio) return bInicio.localeCompare(aInicio);

      const aCreate = String(a.createon ?? '');
      const bCreate = String(b.createon ?? '');
      return bCreate.localeCompare(aCreate);
    });
  }, [contratosPropiedad]);

  const hasContratos = contratosOrdenados.length > 0;

  const toggleParticipantes = useCallback((contratoId: string) => {
    setParticipantesExpanded((prev) => ({
      ...prev,
      [contratoId]: !prev[contratoId],
    }));
  }, []);

  // -------------------------
  // Componentes UI locales
  // -------------------------
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

  const PeriodSelector = () => (
    <View style={styles.periodRow}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.periodIconBtn, !canGoLeft && styles.periodBtnDisabled]}
        disabled={!canGoLeft}
        onPress={goLeft}
      >
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.periodCenter}>
        <Text style={styles.periodTitle}>{periodTitle}</Text>
        <Text style={styles.periodHint}>
          Aplica a resumen, KPIs y detalle (ingresos/gastos).
        </Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.periodIconBtn, !canGoRight && styles.periodBtnDisabled]}
        disabled={!canGoRight}
        onPress={goRight}
      >
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  const ActionButton = ({
    label,
    icon,
    onPress,
    variant = 'secondary',
    disabled = false,
  }: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
  }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        variant === 'primary' ? styles.actionBtnPrimary : styles.actionBtnSecondary,
        disabled && styles.actionBtnDisabled,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={variant === 'primary' ? colors.surface : colors.primary}
      />
      <Text
        style={[
          styles.actionBtnText,
          variant === 'primary' ? styles.actionBtnTextPrimary : styles.actionBtnTextSecondary,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
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

        {/* ALQUILER */}
        <View style={styles.card}>
          <CardTitle icon="document-text-outline" text="Alquiler" />

          <View style={styles.actionsRow}>
            <ActionButton
              label="Crear contrato"
              icon="add-outline"
              onPress={goCrearContrato}
              variant="primary"
            />
          </View>
          <View style={styles.actionsRow}></View>

          {alquilerLoading ? (
            <ActivityIndicator style={{ marginVertical: spacing.sm }} />
          ) : !hasContratos ? (
            <View style={styles.emptyAlquilerBox}>
              <View
                style={[
                  styles.estadoBadge,
                  {
                    backgroundColor: colors.neutralSoft,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.estadoBadgeText, { color: colors.textSecondary }]}>
                  Sin contratos
                </Text>
              </View>

              <Text style={styles.emptyAlquilerText}>
                Esta propiedad todavía no tiene contratos registrados.
              </Text>
            </View>
          ) : (
            <View style={styles.contractsList}>
              {contratosOrdenados.map((contrato) => {
                const badgeStyle = getEstadoBadgeStyle(contrato.estado);
                const participantes = contrato.participantes_resumen;
                const expanded = !!participantesExpanded[contrato.id];

                const principal = participantes?.inquilino_principal ?? null;
                const otrosInquilinos = (participantes?.inquilinos ?? []).filter(
                  (nombre) => !samePersonName(nombre, principal)
                );

                return (
                  <View key={contrato.id} style={styles.contractCard}>
                    <View style={styles.alquilerHeaderRow}>
                      <View
                        style={[
                          styles.estadoBadge,
                          {
                            backgroundColor: badgeStyle.backgroundColor,
                            borderColor: badgeStyle.borderColor,
                          },
                        ]}
                      >
                        <Text style={[styles.estadoBadgeText, { color: badgeStyle.textColor }]}>
                          {formatEstadoContrato(contrato.estado)}
                        </Text>
                      </View>

                      <Text style={styles.alquilerRenta}>
                        {contrato.renta_mensual != null
                          ? `${EuroformatEuro(contrato.renta_mensual)} / mes`
                          : 'Renta no informada'}
                      </Text>
                    </View>

                    <View style={styles.metaGrid}>
                      <Meta
                        label="Contrato"
                        value={contrato.id}
                      />
                      <Meta
                        label="Objeto alquilado"
                        value={contrato.objeto_alquiler_label || getObjetoAlquilerLabel(contrato.objeto_alquiler)}
                      />
                      <Meta
                        label="Inicio"
                        value={contrato.fecha_inicio ? formatFechaCorta(contrato.fecha_inicio) : '—'}
                      />
                      <Meta
                        label="Fin"
                        value={contrato.fecha_fin ? formatFechaCorta(contrato.fecha_fin) : '—'}
                      />
                      <Meta
                        label="Fianza"
                        value={contrato.fianza != null ? EuroformatEuro(contrato.fianza) : '—'}
                      />
                    </View>

                    <TouchableOpacity
                      onPress={() => toggleParticipantes(contrato.id)}
                      activeOpacity={0.85}
                      style={styles.participantesToggle}
                    >
                      <View style={styles.participantesToggleLeft}>
                        <Ionicons name="people-outline" size={16} color={colors.primary} />
                        <Text style={styles.participantesToggleText}>Participantes</Text>
                      </View>

                      <Ionicons
                        name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                        size={18}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>

                    {expanded ? (
                      <View style={styles.alquilerParticipantesBox}>
                        <MiniRow
                          label="Inquilino principal"
                          value={participantes?.inquilino_principal || '—'}
                        />
                        <MiniRow
                          label="Otros inquilinos"
                          value={otrosInquilinos.length ? otrosInquilinos.join(', ') : '—'}
                        />
                        <MiniRow
                          label="Avalistas"
                          value={
                            participantes?.avalistas?.length
                              ? participantes.avalistas.join(', ')
                              : '—'
                          }
                        />
                        <MiniRow label="Gestor" value={participantes?.gestor || '—'} />
                      </View>
                    ) : null}

                    <View style={styles.actionsRow}>
                      <ActionButton
                        label="Ver contrato"
                        icon="eye-outline"
                        onPress={() => goVerContrato(contrato.id)}
                        variant="secondary"
                      />
                      <ActionButton
                        label="Participantes"
                        icon="people-outline"
                        onPress={() => goParticipantes(contrato.id)}
                        variant="primary"
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
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

        {/* PERIODO (selector global) */}
        <View style={styles.card}>
          <CardTitle icon="time-outline" text="Periodo" />
          <PeriodSelector />
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
                value={
                  kpi.rendimiento_bruto_pct != null
                    ? `${kpi.rendimiento_bruto_pct.toFixed(2)} %`
                    : '—'
                }
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
            <Text style={styles.smallMuted}>
              Sin KPIs (se activará cuando analytics v3 esté listo).
            </Text>
          )}
        </View>

        {/* Resumen */}
        <View style={styles.card}>
          <CardTitle
            icon="calendar-number-outline"
            text={periodMode === 'YEAR' ? `Resumen ${selectedYear}` : 'Resumen'}
          />

          {resumen ? (
            <>
              <View style={styles.kpiGrid}>
                <KpiTile
                  label="Ingresos"
                  value={EuroformatEuro(resumen.ingresos_ytd)}
                  infoKey="ingresos_ytd"
                />
                <KpiTile
                  label="Gastos"
                  value={EuroformatEuro(resumen.gastos_ytd)}
                  infoKey="gastos_ytd"
                />
                <KpiTile
                  label="Cash-flow"
                  value={EuroformatEuro(resumen.cashflow_ytd)}
                  infoKey="cashflow_ytd"
                />
                <KpiTile
                  label="Promedio"
                  value={EuroformatEuro(resumen.promedio_mensual)}
                  infoKey="promedio_mensual"
                />
              </View>
              <Text style={styles.smallMuted}>Meses contados: {resumen.meses_contados}</Text>
            </>
          ) : (
            <Text style={styles.smallMuted}>
              Sin resumen (se activará cuando analytics v3 esté listo).
            </Text>
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

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniRow}>
      <Text style={styles.miniRowLabel}>{label}</Text>
      <Text style={styles.miniRowValue}>{value || '—'}</Text>
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
          <Text style={[styles.td, { flex: 0.22, textAlign: 'right' }]}>
            {EuroformatEuro(r.cuota ?? 0)}
          </Text>
          <Text style={[styles.td, { flex: 0.10, textAlign: 'right' }]}>
            {String(r.meses ?? 0)}
          </Text>
          <Text style={[styles.td, { flex: 0.24, textAlign: 'right', fontWeight: '900' }]}>
            {EuroformatEuro(r.total ?? 0)}
          </Text>
        </View>
      ))}

      <View style={[styles.tableRow, styles.tableFooter]}>
        <Text style={[styles.th, { flex: 0.44 }]}>Total</Text>
        <Text style={[styles.th, { flex: 0.22, textAlign: 'right' }]}>—</Text>
        <Text style={[styles.th, { flex: 0.10, textAlign: 'right' }]}>—</Text>
        <Text style={[styles.th, { flex: 0.24, textAlign: 'right' }]}>
          {EuroformatEuro(totalYtd ?? 0)}
        </Text>
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

  // ---- Alquiler ----
  alquilerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  estadoBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  estadoBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  alquilerRenta: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  alquilerParticipantesBox: {
    marginTop: spacing.xs,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  alquilerSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  miniRow: {
    paddingVertical: 4,
  },
  miniRowLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 2,
  },
  miniRowValue: {
    fontSize: 12,
    color: colors.textPrimary,
  },
  emptyAlquilerBox: {
    gap: spacing.sm,
  },
  emptyAlquilerText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.sm,
    borderWidth: 1.25,
  },
  actionBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '900',
  },
  actionBtnTextPrimary: {
    color: colors.surface,
  },
  actionBtnTextSecondary: {
    color: colors.primary,
  },

  // fila adquisición alineada (label | [€ + %] con ancho fijo)
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
    width: 170,
    textAlign: 'right',
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '900',
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

  // KPIs
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

  // Period selector
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  periodIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.neutralSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodBtnDisabled: {
    opacity: 0.45,
  },
  periodCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  periodTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  periodHint: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: '700',
  },

  contractsList: {
    gap: spacing.sm,
  },
  contractCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  participantesToggle: {
    marginTop: spacing.xs,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  participantesToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  participantesToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  // Tabla breakdown
  tableRow: { flexDirection: 'row', paddingVertical: 6, alignItems: 'flex-start' },
  tableHeader: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 6 },
  tableFooter: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 },
  th: { fontSize: 11, fontWeight: '900', color: colors.textPrimary },
  td: { fontSize: 12, color: colors.textPrimary },
  tdMuted: { fontSize: 10, color: colors.textSecondary },
});