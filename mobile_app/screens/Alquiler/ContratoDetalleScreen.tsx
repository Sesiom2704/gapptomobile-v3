/**
 * Archivo: mobile_app/screens/Alquiler/ContratoDetalleScreen.tsx
 *
 * Detalle de contrato de alquiler (v2)
 *
 * Objetivo de esta versión:
 * - Mantener la pantalla de detalle de contrato dentro del flujo de patrimonio.
 * - Conectar carga real desde backend por contratoId.
 * - Mantener coherencia visual con PropiedadDetalleScreen y ContratoCreateScreen.
 *
 * Cambios incluidos:
 * - Carga real con getContrato(...)
 * - Refresh real contra backend
 * - Estado loading / error
 * - Soporte a dato inicial recibido por navegación para transición más fluida
 * - Enlace real a edición y participantes
 *
 * Próximo paso previsto:
 * - Conectar participantes reales.
 * - Añadir acción real de finalizar contrato.
 * - Añadir histórico contractual de la vivienda si se decide.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import { EuroformatEuro, formatFechaCorta } from '../../utils/format';
import {
  getContrato,
  type ContratoRow,
  type ParticipantesResumen,
} from '../../services/gestionAlquilerApi';

type ContratoDetalleView = {
  contrato_id: string;
  patrimonio_id: string;
  referencia_vivienda?: string | null;
  direccion_completa?: string | null;

  estado: 'activo' | 'pendiente' | 'finalizado' | 'cancelado' | string;
  fecha_inicio: string | null;
  fecha_fin: string | null;

  renta_mensual: number | null;
  fianza: number | null;

  incluye_luz: boolean;
  incluye_agua: boolean;
  incluye_internet: boolean;

  observaciones?: string | null;

  participantes_resumen?: ParticipantesResumen | null;
};

type Props = {
  navigation: any;
  route: {
    params?: {
      patrimonioId: string;
      contratoId: string;
      contrato?: Partial<ContratoRow>;
    };
  };
};

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

function formatEstadoContrato(estado?: string | null): string {
  if (!estado) return 'Sin estado';

  const e = String(estado).trim().toLowerCase();

  if (e === 'activo') return 'Activo';
  if (e === 'pendiente') return 'Pendiente';
  if (e === 'finalizado') return 'Finalizado';
  if (e === 'cancelado') return 'Cancelado';

  return estado.charAt(0).toUpperCase() + estado.slice(1);
}

function yesNo(value: boolean): string {
  return value ? 'Sí' : 'No';
}

function mapContratoToView(
  contratoId: string,
  patrimonioId: string,
  incoming?: Partial<ContratoRow> | null
): ContratoDetalleView {
  return {
    contrato_id: contratoId,
    patrimonio_id: incoming?.patrimonio_id ?? patrimonioId,
    referencia_vivienda: incoming?.referencia_vivienda ?? `PAT-${patrimonioId}`,
    direccion_completa:
      incoming?.direccion_completa ?? 'Dirección de la vivienda pendiente de cargar',
    estado: incoming?.estado ?? 'activo',
    fecha_inicio: incoming?.fecha_inicio ?? null,
    fecha_fin: incoming?.fecha_fin ?? null,
    renta_mensual: incoming?.renta_mensual ?? null,
    fianza: incoming?.fianza ?? null,
    incluye_luz: incoming?.incluye_luz ?? false,
    incluye_agua: incoming?.incluye_agua ?? false,
    incluye_internet: incoming?.incluye_internet ?? false,
    observaciones: incoming?.observaciones ?? null,
    participantes_resumen: incoming?.participantes_resumen ?? {
      inquilino_principal: null,
      inquilinos: [],
      avalistas: [],
      gestor: null,
    },
  };
}

export default function ContratoDetalleScreen({ navigation, route }: Props) {
  const patrimonioId = String(route?.params?.patrimonioId ?? '');
  const contratoId = String(route?.params?.contratoId ?? '');
  const contratoInicial = route?.params?.contrato ?? null;

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [contrato, setContrato] = useState<ContratoDetalleView>(() =>
    mapContratoToView(contratoId, patrimonioId, contratoInicial)
  );

  const loadContrato = useCallback(async (isPull = false) => {
    if (!contratoId) {
      setErr('No se ha recibido el identificador del contrato.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isPull) setLoading(true);
    if (isPull) setRefreshing(true);
    setErr(null);

    try {
      const data = await getContrato(contratoId);
      setContrato(mapContratoToView(contratoId, patrimonioId, data));
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudo cargar el detalle del contrato.';

      setErr(String(detail));

      // mantenemos lo que venga por navegación si existía
      if (!contratoInicial) {
        setContrato(mapContratoToView(contratoId, patrimonioId, null));
      }
    } finally {
      if (!isPull) setLoading(false);
      if (isPull) setRefreshing(false);
    }
  }, [contratoId, patrimonioId, contratoInicial]);

  useEffect(() => {
    void loadContrato(false);
  }, [loadContrato]);

  const badgeStyle = useMemo(() => getEstadoBadgeStyle(contrato.estado), [contrato.estado]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleEditarContrato = useCallback(() => {
    navigation.navigate('ContratoCreate', {
      patrimonioId,
      contrato: {
        id: contrato.contrato_id,
        patrimonio_id: contrato.patrimonio_id,
        referencia_vivienda: contrato.referencia_vivienda,
        direccion_completa: contrato.direccion_completa,
        estado: contrato.estado,
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: contrato.fecha_fin,
        renta_mensual: contrato.renta_mensual,
        fianza: contrato.fianza,
        incluye_luz: contrato.incluye_luz,
        incluye_agua: contrato.incluye_agua,
        incluye_internet: contrato.incluye_internet,
        observaciones: contrato.observaciones,
        participantes_resumen: contrato.participantes_resumen,
      },
    });
  }, [navigation, patrimonioId, contrato]);

  const handleParticipantes = useCallback(() => {
    navigation.navigate('ContratoParticipantes', {
      patrimonioId,
      contratoId,
    });
  }, [navigation, patrimonioId, contratoId]);

  const handleFinalizarContrato = useCallback(() => {
    Alert.alert(
      'Finalizar contrato',
      'La acción de finalización se conectará en el siguiente paso del backend.'
    );
  }, []);

  const onRefresh = () => {
    void loadContrato(true);
  };

  const CardTitle: React.FC<{ icon: any; text: string; right?: React.ReactNode }> = ({
    icon,
    text,
    right,
  }) => (
    <View style={styles.blockTitleRow}>
      <View style={styles.blockTitleLeft}>
        <Ionicons name={icon} size={18} color={colors.primary} />
        <Text style={styles.blockTitle}>{text}</Text>
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );

  const ActionButton = ({
    label,
    icon,
    onPress,
    variant = 'secondary',
  }: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
  }) => {
    const isPrimary = variant === 'primary';
    const isDanger = variant === 'danger';

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[
          styles.actionBtn,
          isPrimary && styles.actionBtnPrimary,
          !isPrimary && !isDanger && styles.actionBtnSecondary,
          isDanger && styles.actionBtnDanger,
        ]}
      >
        <Ionicons
          name={icon}
          size={16}
          color={
            isPrimary
              ? colors.surface
              : isDanger
              ? colors.danger
              : colors.primary
          }
        />
        <Text
          style={[
            styles.actionBtnText,
            isPrimary && styles.actionBtnTextPrimary,
            !isPrimary && !isDanger && styles.actionBtnTextSecondary,
            isDanger && styles.actionBtnTextDanger,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Header
        title={`Contrato ${contrato.contrato_id}`}
        subtitle="Detalle contrato"
        showBack
        onBackPress={handleBack}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
        {err ? <Text style={styles.errorText}>{err}</Text> : null}

        {/* Estado */}
        <View style={styles.card}>
          <CardTitle icon="document-text-outline" text="Estado contractual" />

          <View style={styles.estadoHeaderRow}>
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

            <Text style={styles.rentaDestacada}>
              {contrato.renta_mensual != null
                ? `${EuroformatEuro(contrato.renta_mensual)} / mes`
                : 'Renta no informada'}
            </Text>
          </View>

          <Text style={styles.helperText}>
            Esta pantalla muestra el estado operativo del contrato asociado a la vivienda.
          </Text>
        </View>

        {/* Vivienda */}
        <View style={styles.card}>
          <CardTitle icon="home-outline" text="Vivienda vinculada" />

          <View style={styles.metaGrid}>
            <Meta label="Patrimonio ID" value={contrato.patrimonio_id} />
            <Meta label="Referencia" value={contrato.referencia_vivienda} />
          </View>

          <View style={{ marginTop: spacing.xs }}>
            <Text style={styles.metaLabel}>Dirección</Text>
            <Text style={styles.textValue}>
              {contrato.direccion_completa || '—'}
            </Text>
          </View>
        </View>

        {/* Fechas e importes */}
        <View style={styles.card}>
          <CardTitle icon="calendar-outline" text="Fechas e importes" />

          <View style={styles.metaGrid}>
            <Meta
              label="Inicio"
              value={contrato.fecha_inicio ? formatFechaCorta(contrato.fecha_inicio) : '—'}
            />
            <Meta
              label="Fin"
              value={contrato.fecha_fin ? formatFechaCorta(contrato.fecha_fin) : '—'}
            />
            <Meta
              label="Renta mensual"
              value={contrato.renta_mensual != null ? EuroformatEuro(contrato.renta_mensual) : '—'}
            />
            <Meta
              label="Fianza"
              value={contrato.fianza != null ? EuroformatEuro(contrato.fianza) : '—'}
            />
          </View>
        </View>

        {/* Suministros */}
        <View style={styles.card}>
          <CardTitle icon="flash-outline" text="Suministros incluidos" />

          <View style={styles.metaGrid}>
            <Meta label="Luz" value={yesNo(contrato.incluye_luz)} />
            <Meta label="Agua" value={yesNo(contrato.incluye_agua)} />
            <Meta label="Internet" value={yesNo(contrato.incluye_internet)} />
          </View>
        </View>

        {/* Participantes */}
        <View style={styles.card}>
          <CardTitle
            icon="people-outline"
            text="Participantes"
            right={
              <TouchableOpacity
                onPress={handleParticipantes}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.linkText}>Gestionar</Text>
              </TouchableOpacity>
            }
          />

          <MiniRow
            label="Inquilino principal"
            value={contrato.participantes_resumen?.inquilino_principal || '—'}
          />
          <MiniRow
            label="Otros inquilinos"
            value={
              contrato.participantes_resumen?.inquilinos?.length
                ? contrato.participantes_resumen.inquilinos.join(', ')
                : '—'
            }
          />
          <MiniRow
            label="Avalistas"
            value={
              contrato.participantes_resumen?.avalistas?.length
                ? contrato.participantes_resumen.avalistas.join(', ')
                : '—'
            }
          />
          <MiniRow
            label="Gestor"
            value={contrato.participantes_resumen?.gestor || '—'}
          />
        </View>

        {/* Observaciones */}
        <View style={styles.card}>
          <CardTitle icon="create-outline" text="Observaciones" />
          <Text style={styles.textValue}>
            {contrato.observaciones?.trim() || 'Sin observaciones.'}
          </Text>
        </View>

        {/* Acciones */}
        <View style={styles.card}>
          <CardTitle icon="settings-outline" text="Acciones" />

          <View style={styles.actionsColumn}>
            <ActionButton
              label="Editar contrato"
              icon="create-outline"
              onPress={handleEditarContrato}
              variant="primary"
            />

            <ActionButton
              label="Gestionar participantes"
              icon="people-outline"
              onPress={handleParticipantes}
              variant="secondary"
            />

            <ActionButton
              label="Finalizar contrato"
              icon="close-circle-outline"
              onPress={handleFinalizarContrato}
              variant="danger"
            />
          </View>
        </View>
      </ScrollView>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },

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
  blockTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textPrimary,
  },

  estadoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  rentaDestacada: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '900',
    color: colors.textPrimary,
  },

  helperText: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  errorText: {
    color: colors.danger,
    marginBottom: spacing.sm,
    fontSize: 12,
  },

  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metaItem: {
    width: '48%',
    marginBottom: spacing.sm,
  },
  metaLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 12,
    color: colors.textPrimary,
  },

  textValue: {
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 18,
  },

  miniRow: {
    paddingVertical: 5,
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

  linkText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },

  actionsColumn: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    minHeight: 46,
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
  actionBtnDanger: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
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
  actionBtnTextDanger: {
    color: colors.danger,
  },
});