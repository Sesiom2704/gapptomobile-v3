/**
 * Archivo: mobile_app/screens/Alquiler/ContratoCreateScreen.tsx
 *
 * Formulario de contrato de alquiler (v3)
 *
 * Objetivo de esta versión:
 * - Mantener el diseño y la UX base del alta/edición de contratos.
 * - Conectar el formulario con backend real mediante gestionAlquilerApi.
 * - Mantener coherencia visual con formularios existentes como IngresoFormScreen.
 *
 * Cambios incluidos:
 * - Conexión real con backend:
 *     * createContrato(...)
 *     * updateContrato(...)
 * - Validación de datos obligatorios antes de guardar.
 * - Conversión segura de importes string -> number.
 * - Navegación al detalle del contrato tras crear/editar.
 * - Actualización del baseline tras guardado correcto.
 * - Nuevo campo funcional:
 *     * incremento_ipc
 *
 * Reglas funcionales:
 * - patrimonioId llega desde la ficha de propiedad.
 * - Si existe route.params.contrato y no es duplicate, se trabaja en edición.
 * - Si duplicate === true, se usa como base visual pero se crea un nuevo contrato.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { FormDateButton } from '../../components/ui/FormDateButton';
import { commonFormStyles } from '../../components/forms/formStyles';

import { colors } from '../../theme';

import {
  createContrato,
  updateContrato,
  type ContratoRow,
  type EstadoContrato,
} from '../../services/gestionAlquilerApi';

type Props = {
  navigation: any;
  route: {
    params?: {
      patrimonioId: string;
      contrato?: ContratoRow | any;
      readOnly?: boolean;
      duplicate?: boolean;
    };
  };
};

// ---- Helpers ----
function toApiDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateString(value: string | null | undefined): Date {
  if (!value) return new Date();

  const isoParts = value.split('-');
  if (isoParts.length === 3) {
    const [y, m, d] = isoParts;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day);
    }
  }

  const esParts = value.split('/');
  if (esParts.length === 3) {
    const [d, m, y] = esParts;
    const day = Number(d);
    const month = Number(m) - 1;
    const year = Number(y);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day);
    }
  }

  return new Date();
}

function formatDateDisplay(value: string): string {
  const isoParts = value.split('-');
  if (isoParts.length === 3) {
    const [y, m, d] = isoParts;
    return `${d}/${m}/${y}`;
  }
  return value;
}

function parseOptionalNumber(value: string): number | null {
  const raw = String(value ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');

  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const ContratoCreateScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const patrimonioId = String(route?.params?.patrimonioId ?? '');
  const contratoSource = route?.params?.contrato ?? null;
  const readOnly = route?.params?.readOnly === true;
  const duplicate = route?.params?.duplicate === true;

  const isEdit = !!contratoSource && !duplicate;
  const contratoId = contratoSource?.id ? String(contratoSource.id) : null;

  // -------------------------
  // Estado del formulario
  // -------------------------
  const [estado, setEstado] = useState<EstadoContrato>(
    contratoSource?.estado ?? 'activo'
  );

  const [fechaInicio, setFechaInicio] = useState<string>(() => {
    if (contratoSource?.fecha_inicio) return contratoSource.fecha_inicio;
    return toApiDate(new Date());
  });

  const [fechaFin, setFechaFin] = useState<string>(() => {
    if (contratoSource?.fecha_fin) return contratoSource.fecha_fin;
    return '';
  });

  const [rentaMensual, setRentaMensual] = useState<string>(
    contratoSource?.renta_mensual != null ? String(contratoSource.renta_mensual) : ''
  );

  const [fianza, setFianza] = useState<string>(
    contratoSource?.fianza != null ? String(contratoSource.fianza) : ''
  );

  const [incrementoIpc, setIncrementoIpc] = useState<boolean>(
    !!contratoSource?.incremento_ipc
  );

  const [incluyeLuz, setIncluyeLuz] = useState<boolean>(!!contratoSource?.incluye_luz);
  const [incluyeAgua, setIncluyeAgua] = useState<boolean>(!!contratoSource?.incluye_agua);
  const [incluyeInternet, setIncluyeInternet] = useState<boolean>(!!contratoSource?.incluye_internet);

  const [observaciones, setObservaciones] = useState<string>(
    contratoSource?.observaciones ?? ''
  );

  // Date pickers
  const [showInicioPicker, setShowInicioPicker] = useState(false);
  const [showFinPicker, setShowFinPicker] = useState(false);

  // Flags UI
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // -------------------------
  // Back / dirty control
  // -------------------------
  type Snapshot = {
    estado: EstadoContrato;
    fechaInicio: string;
    fechaFin: string;
    rentaMensual: string;
    fianza: string;
    incrementoIpc: boolean;
    incluyeLuz: boolean;
    incluyeAgua: boolean;
    incluyeInternet: boolean;
    observaciones: string;
  };

  const getSnapshot = useCallback((): Snapshot => {
    return {
      estado,
      fechaInicio,
      fechaFin,
      rentaMensual,
      fianza,
      incrementoIpc,
      incluyeLuz,
      incluyeAgua,
      incluyeInternet,
      observaciones,
    };
  }, [
    estado,
    fechaInicio,
    fechaFin,
    rentaMensual,
    fianza,
    incrementoIpc,
    incluyeLuz,
    incluyeAgua,
    incluyeInternet,
    observaciones,
  ]);

  const baselineRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    baselineRef.current = getSnapshot();
  }, [getSnapshot]);

  const isDirty = useCallback(() => {
    if (readOnly) return false;
    const base = baselineRef.current;
    if (!base) return false;
    return JSON.stringify(base) !== JSON.stringify(getSnapshot());
  }, [getSnapshot, readOnly]);

  const navigateBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  useEffect(() => {
    if (readOnly) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty()) return;

      e.preventDefault();

      Alert.alert('Salir del formulario', 'Tienes cambios sin guardar. Si sales, se perderán.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });

    return unsubscribe;
  }, [navigation, isDirty, readOnly]);

  const handleBackPress = () => {
    if (!isDirty()) {
      navigateBack();
      return;
    }

    Alert.alert('Salir del formulario', 'Tienes cambios sin guardar. Si sales, se perderán.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: navigateBack,
      },
    ]);
  };

  // -------------------------
  // Handlers fecha
  // -------------------------
  const handleChangeFechaInicio = (_event: any, selectedDate?: Date) => {
    setShowInicioPicker(false);
    if (!selectedDate) return;
    setFechaInicio(toApiDate(selectedDate));
  };

  const handleChangeFechaFin = (_event: any, selectedDate?: Date) => {
    setShowFinPicker(false);
    if (!selectedDate) return;
    setFechaFin(toApiDate(selectedDate));
  };

  // -------------------------
  // Refresh visual
  // -------------------------
  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 350);
  };

  // -------------------------
  // Save real
  // -------------------------
  const handleSave = async () => {
    if (readOnly) return;

    if (!patrimonioId) {
      Alert.alert('Error', 'No se ha recibido la vivienda asociada al contrato.');
      return;
    }

    if (!fechaInicio) {
      Alert.alert('Campo obligatorio', 'La fecha de inicio es obligatoria.');
      return;
    }

    if (!rentaMensual.trim()) {
      Alert.alert('Campo obligatorio', 'La renta mensual es obligatoria.');
      return;
    }

    const rentaMensualNum = parseOptionalNumber(rentaMensual);
    if (rentaMensualNum == null || rentaMensualNum <= 0) {
      Alert.alert('Importe inválido', 'La renta mensual debe ser un número mayor que 0.');
      return;
    }

    const fianzaNum = parseOptionalNumber(fianza);
    if (fianza.trim() !== '' && (fianzaNum == null || fianzaNum < 0)) {
      Alert.alert('Importe inválido', 'La fianza debe ser un número válido.');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        patrimonio_id: patrimonioId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
        renta_mensual: rentaMensualNum,
        fianza: fianzaNum,
        estado,
        incremento_ipc: incrementoIpc,
        incluye_luz: incluyeLuz,
        incluye_agua: incluyeAgua,
        incluye_internet: incluyeInternet,
        observaciones: observaciones.trim() || null,
      };

      let saved: ContratoRow;

      if (isEdit && contratoId) {
        saved = await updateContrato(contratoId, {
          fecha_inicio: payload.fecha_inicio,
          fecha_fin: payload.fecha_fin,
          renta_mensual: payload.renta_mensual,
          fianza: payload.fianza,
          estado: payload.estado,
          incremento_ipc: payload.incremento_ipc,
          incluye_luz: payload.incluye_luz,
          incluye_agua: payload.incluye_agua,
          incluye_internet: payload.incluye_internet,
          observaciones: payload.observaciones,
        });
      } else {
        saved = await createContrato(payload);
      }

      baselineRef.current = getSnapshot();

      Alert.alert(
        isEdit ? 'Contrato actualizado' : 'Contrato creado',
        isEdit
          ? 'Los cambios del contrato se han guardado correctamente.'
          : 'El contrato se ha creado correctamente.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.replace('ContratoDetalle', {
                patrimonioId,
                contratoId: saved.id,
                contrato: saved,
              });
            },
          },
        ]
      );
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        (isEdit
          ? 'No se pudo actualizar el contrato.'
          : 'No se pudo crear el contrato.');

      Alert.alert('Error', String(detail));
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = useMemo(() => 'Contrato de alquiler', []);
  const headerSubtitle = useMemo(() => {
    if (readOnly) return 'Consulta';
    if (duplicate) return 'Duplicado';
    if (isEdit) return 'Edición';
    return 'Alta nueva';
  }, [readOnly, duplicate, isEdit]);

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          showBack
          onBackPress={handleBackPress}
        />
      </View>

      <ScrollView
        style={styles.formArea}
        contentContainerStyle={styles.formContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <FormSection title="Vivienda asociada">
          <View style={styles.field}>
            <Text style={styles.label}>Referencia interna</Text>
            <TextInput
              value={String(patrimonioId ?? '')}
              editable={false}
              style={[styles.input, styles.inputAdvanced, styles.inputFilled]}
            />
            <Text style={styles.helperText}>
              En esta versión el contrato se crea sobre la vivienda seleccionada desde detalle de propiedad.
            </Text>
          </View>
        </FormSection>

        <FormSection title="Datos principales">
          <View style={styles.field}>
            <Text style={styles.label}>Estado del contrato</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Activo"
                  selected={estado === 'activo'}
                  onPress={() => {
                    if (readOnly) return;
                    setEstado('activo');
                  }}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Pendiente"
                  selected={estado === 'pendiente'}
                  onPress={() => {
                    if (readOnly) return;
                    setEstado('pendiente');
                  }}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Finalizado"
                  selected={estado === 'finalizado'}
                  onPress={() => {
                    if (readOnly) return;
                    setEstado('finalizado');
                  }}
                />
              </View>
            </View>
          </View>

          <View style={styles.fieldRowTwoCols}>
            <View style={styles.col}>
              <Text style={styles.label}>Fecha inicio</Text>
              <FormDateButton
                valueText={formatDateDisplay(fechaInicio)}
                onPress={() => {
                  if (readOnly) return;
                  setShowInicioPicker(true);
                }}
                disabled={readOnly}
              />
            </View>

            <View style={styles.col}>
              <Text style={styles.label}>Fecha fin</Text>
              <FormDateButton
                valueText={fechaFin ? formatDateDisplay(fechaFin) : 'Seleccionar fecha'}
                onPress={() => {
                  if (readOnly) return;
                  setShowFinPicker(true);
                }}
                disabled={readOnly}
              />
            </View>
          </View>

          {showInicioPicker && !readOnly && (
            <DateTimePicker
              value={parseDateString(fechaInicio)}
              mode="date"
              display="default"
              onChange={handleChangeFechaInicio}
            />
          )}

          {showFinPicker && !readOnly && (
            <DateTimePicker
              value={parseDateString(fechaFin || fechaInicio)}
              mode="date"
              display="default"
              onChange={handleChangeFechaFin}
            />
          )}
        </FormSection>

        <FormSection title="Importe y condiciones">
          <View style={styles.fieldRowTwoCols}>
            <View style={styles.col}>
              <Text style={styles.label}>Renta mensual</Text>
              <TextInput
                value={rentaMensual}
                onChangeText={setRentaMensual}
                placeholder="Ej. 850"
                keyboardType="decimal-pad"
                editable={!readOnly}
                style={[styles.input, rentaMensual.trim() !== '' && styles.inputFilled]}
              />
            </View>

            <View style={styles.col}>
              <Text style={styles.label}>Fianza</Text>
              <TextInput
                value={fianza}
                onChangeText={setFianza}
                placeholder="Ej. 850"
                keyboardType="decimal-pad"
                editable={!readOnly}
                style={[styles.input, fianza.trim() !== '' && styles.inputFilled]}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Actualización por IPC</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Sí"
                  selected={incrementoIpc}
                  onPress={() => {
                    if (readOnly) return;
                    setIncrementoIpc(true);
                  }}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="No"
                  selected={!incrementoIpc}
                  onPress={() => {
                    if (readOnly) return;
                    setIncrementoIpc(false);
                  }}
                />
              </View>
            </View>
          </View>
        </FormSection>

        <FormSection title="Suministros incluidos">
          <View style={styles.field}>
            <Text style={styles.label}>Luz</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Incluida"
                  selected={incluyeLuz}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeLuz(true);
                  }}
                />
              </View>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="No incluida"
                  selected={!incluyeLuz}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeLuz(false);
                  }}
                />
              </View>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Agua</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Incluida"
                  selected={incluyeAgua}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeAgua(true);
                  }}
                />
              </View>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="No incluida"
                  selected={!incluyeAgua}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeAgua(false);
                  }}
                />
              </View>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Internet</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Incluido"
                  selected={incluyeInternet}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeInternet(true);
                  }}
                />
              </View>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="No incluido"
                  selected={!incluyeInternet}
                  onPress={() => {
                    if (readOnly) return;
                    setIncluyeInternet(false);
                  }}
                />
              </View>
            </View>
          </View>
        </FormSection>

        <FormSection title="Observaciones">
          <View style={styles.field}>
            <Text style={styles.label}>Notas del contrato</Text>
            <TextInput
              value={observaciones}
              onChangeText={setObservaciones}
              placeholder="Ej: contrato inicial, observaciones internas, condiciones especiales..."
              editable={!readOnly}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                styles.inputFilled,
                stylesLocal.textArea,
                readOnly && styles.inputAdvanced,
              ]}
            />
          </View>
        </FormSection>

        <FormSection title="Siguiente paso">
          <View style={stylesLocal.infoBox}>
            <View style={stylesLocal.infoRow}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={stylesLocal.infoTitle}>Participantes del contrato</Text>
            </View>

            <Text style={styles.helperText}>
              Después de guardar este contrato podrás añadir o gestionar:
            </Text>

            <View style={stylesLocal.infoList}>
              <Text style={stylesLocal.infoItem}>• Inquilino principal</Text>
              <Text style={stylesLocal.infoItem}>• Otros inquilinos</Text>
              <Text style={stylesLocal.infoItem}>• Avalistas</Text>
              <Text style={stylesLocal.infoItem}>• Gestor asignado</Text>
            </View>

            <TouchableOpacity
              disabled
              activeOpacity={1}
              style={stylesLocal.secondaryPlaceholderBtn}
            >
              <Ionicons name="people-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={stylesLocal.secondaryPlaceholderBtnText}>
                Gestión de participantes (se activa tras guardar)
              </Text>
            </TouchableOpacity>
          </View>
        </FormSection>

        {!readOnly ? (
          <View style={{ marginTop: 12 }}>
            <FormActionButton
              label={saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear contrato'}
              onPress={handleSave}
              iconName="save-outline"
              variant="primary"
              disabled={saving}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

export default ContratoCreateScreen;

const stylesLocal = {
  textArea: {
    minHeight: 110,
    paddingTop: 14,
  },
  infoBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 14,
  },
  infoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: colors.textPrimary,
  },
  infoList: {
    marginTop: 8,
    gap: 4,
  },
  infoItem: {
    fontSize: 12,
    color: colors.textPrimary,
  },
  secondaryPlaceholderBtn: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    opacity: 0.85,
  },
  secondaryPlaceholderBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.textSecondary,
  },
} as const;