/**
 * Ruta: mobile_app/screens/Alquiler/IncidenciaDetalleScreen.tsx
 * Versión: 1.2.0
 * Descripción:
 * Pantalla de detalle de incidencia para GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Carga detalle completo de la incidencia.
 * - Muestra datos operativos principales.
 * - Permite refresco manual.
 * - Permite asignar proveedor.
 * - Permite programar o reprogramar visita.
 * - Permite edición controlada de:
 *   - titulo
 *   - descripcion
 *   - telefono_inquilino_snapshot
 *   - notas_acceso
 * - Guarda cambios mediante updateIncidencia().
 * - NUEVO: muestra historial de cambios.
 * - NUEVO: muestra historial de citas registradas.
 *
 * Notas de diseño:
 * - Esta versión mantiene la UI simple y estable.
 * - No permite cambiar estado/prioridad por edición libre.
 * - La edición controlada queda separada de las acciones operativas.
 * - Historial y citas se renderizan en formato timeline simple reutilizable.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
  TextInput,
  Modal,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Header from '../../components/layout/Header';
import { listStyles } from '../../components/list/listStyles';
import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';

import { colors, spacing, radius } from '../../theme';

import {
  getIncidencia,
  updateIncidencia,
  listProveedoresIncidencias,
  assignProveedorIncidencia,
  scheduleVisitIncidencia,
  getIncidenciaEstadoColorToken,
  type IncidenciaDetailResponse,
  type ProveedorListItem,
} from '../../services/gestionIncidenciasApi';

type Props = {
  navigation: any;
  route: {
    params: {
      incidenciaId: string;
      contratoId?: string;
      patrimonioId?: string;
      incidencia?: any;
    };
  };
};

type ProviderModalMode = 'assign' | 'schedule';

function safeText(value: unknown, fallback = '—'): string {
  const v = String(value ?? '').trim();
  return v || fallback;
}

function formatDateTimeLabel(value?: string | null): string {
  if (!value) return '—';

  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return safeText(value);

    return dt.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return safeText(value);
  }
}

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
  rightAction?: React.ReactNode;
}> = ({ title, children, rightAction }) => {
  return (
    <View style={localStyles.card}>
      <View style={localStyles.cardHeader}>
        <Text style={localStyles.cardTitle}>{title}</Text>
        {rightAction}
      </View>
      <View>{children}</View>
    </View>
  );
};

const FieldRow: React.FC<{
  label: string;
  value?: string | null;
  multiline?: boolean;
}> = ({ label, value, multiline }) => {
  return (
    <View style={localStyles.fieldRow}>
      <Text style={localStyles.fieldLabel}>{label}</Text>
      <Text style={[localStyles.fieldValue, multiline && { lineHeight: 20 }]}>
        {safeText(value)}
      </Text>
    </View>
  );
};

const EditableField: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}> = ({ label, value, onChangeText, multiline, placeholder }) => {
  return (
    <View style={localStyles.fieldRow}>
      <Text style={localStyles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          localStyles.editInput,
          multiline && localStyles.editInputMultiline,
        ]}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
};

const TimelineItem: React.FC<{
  title: string;
  subtitle?: string;
  meta?: string;
  note?: string | null;
}> = ({ title, subtitle, meta, note }) => {
  return (
    <View style={localStyles.timelineItem}>
      <View style={localStyles.timelineDot} />
      <View style={{ flex: 1 }}>
        <Text style={localStyles.timelineTitle}>{title}</Text>
        {!!subtitle && <Text style={localStyles.timelineSubtitle}>{subtitle}</Text>}
        {!!meta && <Text style={localStyles.timelineMeta}>{meta}</Text>}
        {!!note && <Text style={localStyles.timelineNote}>{note}</Text>}
      </View>
    </View>
  );
};

const ProviderPickerModal: React.FC<{
  visible: boolean;
  mode: ProviderModalMode;
  loading: boolean;
  providers: ProveedorListItem[];
  selectedProviderId: string | null;
  onClose: () => void;
  onSelectProvider: (id: string) => void;
  dateStart: string;
  dateEnd: string;
  note: string;
  reason: string;
  onChangeDateStart: (v: string) => void;
  onChangeDateEnd: (v: string) => void;
  onChangeNote: (v: string) => void;
  onChangeReason: (v: string) => void;
  onConfirm: () => void;
}> = ({
  visible,
  mode,
  loading,
  providers,
  selectedProviderId,
  onClose,
  onSelectProvider,
  dateStart,
  dateEnd,
  note,
  reason,
  onChangeDateStart,
  onChangeDateEnd,
  onChangeNote,
  onChangeReason,
  onConfirm,
}) => {
  if (!visible) return null;

  const title =
    mode === 'assign' ? 'Asignar proveedor' : 'Programar o reprogramar visita';

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={localStyles.modalBackdrop}>
          <TouchableWithoutFeedback>
            <View style={localStyles.modalSheet}>
              <Text style={localStyles.modalTitle}>{title}</Text>

              <Text style={localStyles.modalLabel}>Proveedor</Text>
              <ScrollView
                style={{ maxHeight: 220 }}
                contentContainerStyle={{ paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
              >
                {providers.map((provider) => {
                  const selected = provider.id === selectedProviderId;
                  return (
                    <TouchableOpacity
                      key={provider.id}
                      style={[
                        localStyles.providerRow,
                        selected && localStyles.providerRowSelected,
                      ]}
                      onPress={() => onSelectProvider(provider.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={localStyles.providerName}>{provider.nombre}</Text>
                        <Text style={localStyles.providerMeta}>
                          {safeText(provider.localidad)}
                        </Text>
                      </View>

                      {selected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {mode === 'schedule' && (
                <>
                  <Text style={localStyles.modalLabel}>Inicio programado</Text>
                  <TextInput
                    value={dateStart}
                    onChangeText={onChangeDateStart}
                    placeholder="2026-03-18T10:00:00"
                    placeholderTextColor={colors.textMuted}
                    style={localStyles.input}
                    autoCapitalize="none"
                  />

                  <Text style={localStyles.modalLabel}>Fin programado</Text>
                  <TextInput
                    value={dateEnd}
                    onChangeText={onChangeDateEnd}
                    placeholder="2026-03-18T11:00:00"
                    placeholderTextColor={colors.textMuted}
                    style={localStyles.input}
                    autoCapitalize="none"
                  />

                  <Text style={localStyles.modalLabel}>Motivo reprogramación</Text>
                  <TextInput
                    value={reason}
                    onChangeText={onChangeReason}
                    placeholder="Opcional"
                    placeholderTextColor={colors.textMuted}
                    style={[localStyles.input, { minHeight: 70 }]}
                    multiline
                  />
                </>
              )}

              <Text style={localStyles.modalLabel}>Nota operativa</Text>
              <TextInput
                value={note}
                onChangeText={onChangeNote}
                placeholder="Opcional"
                placeholderTextColor={colors.textMuted}
                style={[localStyles.input, { minHeight: 70 }]}
                multiline
              />

              <View style={localStyles.modalActions}>
                <TouchableOpacity
                  style={localStyles.secondaryButton}
                  onPress={onClose}
                  disabled={loading}
                >
                  <Text style={localStyles.secondaryButtonText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    localStyles.primaryButton,
                    loading && { opacity: 0.6 },
                  ]}
                  onPress={onConfirm}
                  disabled={loading}
                >
                  <Text style={localStyles.primaryButtonText}>
                    {loading ? 'Procesando…' : 'Guardar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export const IncidenciaDetalleScreen: React.FC<Props> = ({ navigation, route }) => {
  const incidenciaId = String(route?.params?.incidenciaId ?? '').trim();

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detalle, setDetalle] = useState<IncidenciaDetailResponse | null>(null);

  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providers, setProviders] = useState<ProveedorListItem[]>([]);

  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [providerModalMode, setProviderModalMode] = useState<ProviderModalMode>('assign');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const [scheduleDateStart, setScheduleDateStart] = useState('');
  const [scheduleDateEnd, setScheduleDateEnd] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editTitulo, setEditTitulo] = useState('');
  const [editDescripcion, setEditDescripcion] = useState('');
  const [editTelefonoSnapshot, setEditTelefonoSnapshot] = useState('');
  const [editNotasAcceso, setEditNotasAcceso] = useState('');
  const [editNotaOperativa, setEditNotaOperativa] = useState('');

  const hydrateEditState = useCallback((data: IncidenciaDetailResponse | null) => {
    setEditTitulo(String(data?.titulo ?? ''));
    setEditDescripcion(String(data?.descripcion ?? ''));
    setEditTelefonoSnapshot(String(data?.telefono_inquilino_snapshot ?? ''));
    setEditNotasAcceso(String(data?.notas_acceso ?? ''));
    setEditNotaOperativa('');
  }, []);

  const cargarDetalle = useCallback(async () => {
    if (!incidenciaId) {
      setError('No se ha recibido incidenciaId.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getIncidencia(incidenciaId);
      setDetalle(data);
      hydrateEditState(data);
    } catch (err) {
      console.error('[IncidenciaDetalle] Error cargando detalle', err);
      setError('No se ha podido cargar el detalle de la incidencia.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [incidenciaId, hydrateEditState]);

  useFocusEffect(
    useCallback(() => {
      void cargarDetalle();
    }, [cargarDetalle])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await cargarDetalle();
  };

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('ContratoList');
  }, [navigation]);

  const cargarProviders = useCallback(async () => {
    if (providersLoaded) return;

    setProvidersLoading(true);
    try {
      const data = await listProveedoresIncidencias();
      setProviders(data);
      setProvidersLoaded(true);
    } catch (err) {
      console.error('[IncidenciaDetalle] Error cargando proveedores', err);
      Alert.alert('Error', 'No se han podido cargar los proveedores.');
    } finally {
      setProvidersLoading(false);
    }
  }, [providersLoaded]);

  const openAssignProviderModal = useCallback(async () => {
    setActionSheetVisible(false);
    await cargarProviders();

    setProviderModalMode('assign');
    setSelectedProviderId(
      detalle?.responsable_actual?.tipo === 'proveedor'
        ? detalle?.responsable_actual?.id ?? null
        : null
    );
    setActionNote('');
    setRescheduleReason('');
    setScheduleDateStart('');
    setScheduleDateEnd('');
    setProviderModalVisible(true);
  }, [cargarProviders, detalle]);

  const openScheduleVisitModal = useCallback(async () => {
    setActionSheetVisible(false);
    await cargarProviders();

    setProviderModalMode('schedule');
    setSelectedProviderId(
      detalle?.ultima_cita?.proveedor_id ?? detalle?.responsable_actual?.id ?? null
    );
    setScheduleDateStart('');
    setScheduleDateEnd('');
    setActionNote('');
    setRescheduleReason('');
    setProviderModalVisible(true);
  }, [cargarProviders, detalle]);

  const handleConfirmProviderModal = useCallback(async () => {
    if (!detalle?.id) return;

    if (!selectedProviderId) {
      Alert.alert('Falta proveedor', 'Debes seleccionar un proveedor.');
      return;
    }

    try {
      setSubmitting(true);

      if (providerModalMode === 'assign') {
        await assignProveedorIncidencia(detalle.id, {
          proveedor_id: selectedProviderId,
          nota: actionNote.trim() || undefined,
        });

        setProviderModalVisible(false);
        await cargarDetalle();
        Alert.alert('Correcto', 'Proveedor asignado correctamente.');
        return;
      }

      if (!scheduleDateStart.trim()) {
        Alert.alert('Falta fecha', 'Debes indicar la fecha/hora de inicio.');
        return;
      }

      await scheduleVisitIncidencia(detalle.id, {
        proveedor_id: selectedProviderId,
        fecha_inicio_programada: scheduleDateStart.trim(),
        fecha_fin_programada: scheduleDateEnd.trim() || undefined,
        motivo_reprogramacion: rescheduleReason.trim() || undefined,
        nota: actionNote.trim() || undefined,
      });

      setProviderModalVisible(false);
      await cargarDetalle();
      Alert.alert('Correcto', 'Visita programada correctamente.');
    } catch (err: any) {
      console.error('[IncidenciaDetalle] Error ejecutando acción', err);

      const apiDetail =
        err?.response?.data?.detail ||
        err?.message ||
        'No se ha podido completar la operación.';

      Alert.alert('Error', String(apiDetail));
    } finally {
      setSubmitting(false);
    }
  }, [
    detalle,
    selectedProviderId,
    providerModalMode,
    actionNote,
    scheduleDateStart,
    scheduleDateEnd,
    rescheduleReason,
    cargarDetalle,
  ]);

  const handleStartEdit = useCallback(() => {
    hydrateEditState(detalle);
    setEditMode(true);
    setActionSheetVisible(false);
  }, [detalle, hydrateEditState]);

  const handleCancelEdit = useCallback(() => {
    hydrateEditState(detalle);
    setEditMode(false);
  }, [detalle, hydrateEditState]);

  const handleSaveEdit = useCallback(async () => {
    if (!detalle?.id) return;

    try {
      setSubmitting(true);

      const res = await updateIncidencia(detalle.id, {
        titulo: editTitulo.trim() || null,
        descripcion: editDescripcion,
        telefono_inquilino_snapshot: editTelefonoSnapshot.trim() || null,
        notas_acceso: editNotasAcceso.trim() || null,
        nota_operativa: editNotaOperativa.trim() || undefined,
      });

      setDetalle(res.incidencia);
      hydrateEditState(res.incidencia);
      setEditMode(false);

      Alert.alert('Correcto', res.mensaje || 'Incidencia actualizada correctamente.');
    } catch (err: any) {
      console.error('[IncidenciaDetalle] Error guardando edición', err);

      const apiDetail =
        err?.response?.data?.detail ||
        err?.message ||
        'No se ha podido guardar la incidencia.';

      Alert.alert('Error', String(apiDetail));
    } finally {
      setSubmitting(false);
    }
  }, [
    detalle,
    editTitulo,
    editDescripcion,
    editTelefonoSnapshot,
    editNotasAcceso,
    editNotaOperativa,
    hydrateEditState,
  ]);

  const estadoColor = useMemo(
    () => getIncidenciaEstadoColorToken(detalle?.estado),
    [detalle?.estado]
  );

  const accionesSheet = useMemo<ActionSheetAction[]>(() => {
    return [
      {
        label: 'Editar incidencia',
        onPress: () => handleStartEdit(),
        iconName: 'create-outline',
        color: colors.actionWarning ?? '#eab308',
      },
      {
        label: 'Asignar proveedor',
        onPress: () => void openAssignProviderModal(),
        iconName: 'person-add-outline',
        color: colors.actionWarning ?? '#eab308',
      },
      {
        label: 'Programar / reprogramar visita',
        onPress: () => void openScheduleVisitModal(),
        iconName: 'calendar-outline',
        color: colors.actionNeutral ?? '#4b5563',
      },
    ];
  }, [handleStartEdit, openAssignProviderModal, openScheduleVisitModal]);

  const renderLoading = () => (
    <View style={listStyles.centered}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={listStyles.loadingText}>Cargando incidencia…</Text>
    </View>
  );

  const renderError = () => (
    <View style={listStyles.centered}>
      <Text style={listStyles.errorText}>{error}</Text>
    </View>
  );

  const renderDescripcionSection = () => {
    if (editMode) {
      return (
        <SectionCard
          title="Descripción operativa"
          rightAction={
            <TouchableOpacity
              onPress={handleCancelEdit}
              style={localStyles.inlineActionButton}
            >
              <Ionicons name="close-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          }
        >
          <EditableField
            label="Título"
            value={editTitulo}
            onChangeText={setEditTitulo}
            placeholder="Título opcional"
          />

          <EditableField
            label="Descripción"
            value={editDescripcion}
            onChangeText={setEditDescripcion}
            placeholder="Describe la incidencia"
            multiline
          />

          <EditableField
            label="Teléfono snapshot"
            value={editTelefonoSnapshot}
            onChangeText={setEditTelefonoSnapshot}
            placeholder="Teléfono operativo"
          />

          <EditableField
            label="Notas de acceso"
            value={editNotasAcceso}
            onChangeText={setEditNotasAcceso}
            placeholder="Instrucciones de acceso"
            multiline
          />

          <EditableField
            label="Nota operativa"
            value={editNotaOperativa}
            onChangeText={setEditNotaOperativa}
            placeholder="Opcional. Se guardará en historial."
            multiline
          />

          <View style={localStyles.editActionsRow}>
            <TouchableOpacity
              style={localStyles.secondaryButtonInline}
              onPress={handleCancelEdit}
              disabled={submitting}
            >
              <Text style={localStyles.secondaryButtonInlineText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                localStyles.primaryButtonInline,
                submitting && { opacity: 0.6 },
              ]}
              onPress={() => void handleSaveEdit()}
              disabled={submitting}
            >
              <Text style={localStyles.primaryButtonInlineText}>
                {submitting ? 'Guardando…' : 'Guardar cambios'}
              </Text>
            </TouchableOpacity>
          </View>
        </SectionCard>
      );
    }

    return (
      <SectionCard
        title="Descripción operativa"
        rightAction={
          <TouchableOpacity
            onPress={handleStartEdit}
            style={localStyles.inlineActionButton}
          >
            <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      >
        <FieldRow label="Título" value={detalle?.titulo} />
        <FieldRow label="Descripción" value={detalle?.descripcion} multiline />
        <FieldRow label="Teléfono snapshot" value={detalle?.telefono_inquilino_snapshot} />
        <FieldRow label="Notas de acceso" value={detalle?.notas_acceso} multiline />
      </SectionCard>
    );
  };

  const renderHistorialSection = () => {
    const items = detalle?.historial ?? [];

    return (
      <SectionCard title="Historial de cambios">
        {items.length === 0 ? (
          <Text style={listStyles.emptyText}>No hay movimientos registrados.</Text>
        ) : (
          items.map((item) => {
            const title = item.estado_anterior_label
              ? `${safeText(item.estado_anterior_label)} → ${safeText(item.estado_nuevo_label)}`
              : safeText(item.estado_nuevo_label);

            const subtitleParts = [
              item.persona_cambia_nombre ? String(item.persona_cambia_nombre) : '',
              item.rol_cambia ? String(item.rol_cambia) : '',
            ].filter(Boolean);

            return (
              <TimelineItem
                key={item.id}
                title={title}
                subtitle={subtitleParts.join(' · ') || undefined}
                meta={formatDateTimeLabel(item.fecha_creacion)}
                note={item.nota}
              />
            );
          })
        )}
      </SectionCard>
    );
  };

  const renderCitasSection = () => {
    const items = detalle?.citas ?? [];

    return (
      <SectionCard title="Historial de citas">
        {items.length === 0 ? (
          <Text style={listStyles.emptyText}>No hay citas registradas.</Text>
        ) : (
          items.map((item) => {
            const title = item.proveedor_nombre
              ? `${item.proveedor_nombre}`
              : `Cita ${item.id}`;

            const subtitleParts = [
              item.estado_cita_label ? String(item.estado_cita_label) : '',
              item.estado_inquilino_label ? String(item.estado_inquilino_label) : '',
            ].filter(Boolean);

            const noteParts = [
              item.motivo_reprogramacion ? `Motivo: ${item.motivo_reprogramacion}` : '',
              item.propuesta_por_persona_nombre
                ? `Propuesta por: ${item.propuesta_por_persona_nombre}`
                : '',
              item.confirmada_por_persona_nombre
                ? `Confirmada por: ${item.confirmada_por_persona_nombre}`
                : '',
            ].filter(Boolean);

            return (
              <TimelineItem
                key={item.id}
                title={title}
                subtitle={subtitleParts.join(' · ') || undefined}
                meta={`Inicio: ${formatDateTimeLabel(item.fecha_inicio_programada)}`}
                note={noteParts.join('\n') || null}
              />
            );
          })
        )}
      </SectionCard>
    );
  };

  const renderContent = () => {
    if (!detalle) {
      return (
        <View style={listStyles.centered}>
          <Text style={listStyles.emptyText}>No hay detalle disponible.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={listStyles.list}
        contentContainerStyle={localStyles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <SectionCard
          title="Resumen"
          rightAction={
            !editMode ? (
              <TouchableOpacity
                onPress={() => setActionSheetVisible(true)}
                style={localStyles.inlineActionButton}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : undefined
          }
        >
          <View style={localStyles.badgesRow}>
            <View
              style={[
                localStyles.badge,
                { backgroundColor: `${estadoColor}18`, borderColor: estadoColor },
              ]}
            >
              <Text style={[localStyles.badgeText, { color: estadoColor }]}>
                {safeText(detalle.estado_label)}
              </Text>
            </View>

            <View style={localStyles.badgeNeutral}>
              <Text style={localStyles.badgeNeutralText}>
                {safeText(detalle.prioridad_label)}
              </Text>
            </View>
          </View>

          <FieldRow label="Código" value={detalle.codigo} />
          <FieldRow label="Categoría" value={detalle.categoria} />
          <FieldRow label="Contrato" value={detalle.contrato_id} />
          <FieldRow label="Patrimonio" value={detalle.patrimonio_id} />
          <FieldRow label="Fecha creación" value={formatDateTimeLabel(detalle.fecha_creacion)} />
          <FieldRow
            label="Última actualización"
            value={formatDateTimeLabel(detalle.fecha_actualizacion)}
          />
        </SectionCard>

        {renderDescripcionSection()}

        <SectionCard title="Responsable actual">
          <FieldRow label="Tipo" value={detalle.responsable_actual?.tipo} />
          <FieldRow label="Identificador" value={detalle.responsable_actual?.id} />
          <FieldRow label="Nombre" value={detalle.responsable_actual?.nombre} />
        </SectionCard>

        <SectionCard title="Última cita">
          <FieldRow label="Proveedor" value={detalle.ultima_cita?.proveedor_nombre} />
          <FieldRow
            label="Inicio programado"
            value={formatDateTimeLabel(detalle.ultima_cita?.fecha_inicio_programada)}
          />
          <FieldRow
            label="Fin programado"
            value={formatDateTimeLabel(detalle.ultima_cita?.fecha_fin_programada)}
          />
          <FieldRow label="Estado cita" value={detalle.ultima_cita?.estado_cita_label} />
          <FieldRow label="Estado inquilino" value={detalle.ultima_cita?.estado_inquilino_label} />
        </SectionCard>

        {renderHistorialSection()}

        {renderCitasSection()}

        {!editMode && (
          <SectionCard title="Acciones">
            <View style={localStyles.actionButtonsColumn}>
              <TouchableOpacity
                style={localStyles.primaryActionRow}
                onPress={() => void openAssignProviderModal()}
                disabled={providersLoading || submitting}
              >
                <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                <Text style={localStyles.primaryActionRowText}>Asignar proveedor</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={localStyles.secondaryActionRow}
                onPress={() => void openScheduleVisitModal()}
                disabled={providersLoading || submitting}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={localStyles.secondaryActionRowText}>
                  Programar o reprogramar visita
                </Text>
              </TouchableOpacity>
            </View>
          </SectionCard>
        )}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Detalle incidencia"
        subtitle={detalle?.codigo ? `Incidencia ${detalle.codigo}` : 'Gestión operativa de incidencia.'}
        showBack
        onBackPress={handleBack}
      />

      <View style={listStyles.screen}>
        <View style={listStyles.bottomArea}>
          {loading && !detalle ? renderLoading() : error ? renderError() : renderContent()}
        </View>

        <ActionSheet
          visible={actionSheetVisible}
          onClose={() => setActionSheetVisible(false)}
          title="Acciones sobre la incidencia"
          actions={accionesSheet}
        />

        <ProviderPickerModal
          visible={providerModalVisible}
          mode={providerModalMode}
          loading={submitting}
          providers={providers}
          selectedProviderId={selectedProviderId}
          onClose={() => setProviderModalVisible(false)}
          onSelectProvider={setSelectedProviderId}
          dateStart={scheduleDateStart}
          dateEnd={scheduleDateEnd}
          note={actionNote}
          reason={rescheduleReason}
          onChangeDateStart={setScheduleDateStart}
          onChangeDateEnd={setScheduleDateEnd}
          onChangeNote={setActionNote}
          onChangeReason={setRescheduleReason}
          onConfirm={() => void handleConfirmProviderModal()}
        />
      </View>
    </>
  );
};

const localStyles = StyleSheet.create({
  contentContainer: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  inlineActionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  fieldRow: {
    marginTop: spacing.sm,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  editInputMultiline: {
    minHeight: 90,
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeNeutral: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  badgeNeutralText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionButtonsColumn: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
    gap: 8,
  },
  primaryActionRowText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryActionRowText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  providerRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  providerName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  providerMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  primaryButton: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryButtonInline: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonInlineText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  primaryButtonInline: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonInlineText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  timelineSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  timelineMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  timelineNote: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});

export default IncidenciaDetalleScreen;