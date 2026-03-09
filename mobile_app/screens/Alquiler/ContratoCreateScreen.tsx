/**
 * Archivo: mobile_app/screens/Alquiler/ContratoCreateScreen.tsx
 * Versión: 3.2.0
 *
 * Formulario de alta/edición de contratos.
 *
 * Mejoras:
 * - Nuevo selector de objeto de alquiler
 * - Carga dinámica de opciones válidas desde backend
 * - Opciones incompatibles visibles pero deshabilitadas
 * - Envío y edición del nuevo campo objeto_alquiler
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
  ActivityIndicator,
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
  listOpcionesContratoPorPatrimonio,
  type ContratoRow,
  type EstadoContrato,
  type ContratoObjetoOpcionRow,
  type ObjetoAlquilerCode,
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

  const [estado, setEstado] = useState<EstadoContrato>(
    contratoSource?.estado ?? 'activo'
  );

  const [objetoAlquiler, setObjetoAlquiler] = useState<ObjetoAlquilerCode>(
    contratoSource?.objeto_alquiler ?? 'completa'
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

  const [showInicioPicker, setShowInicioPicker] = useState(false);
  const [showFinPicker, setShowFinPicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [loadingOpciones, setLoadingOpciones] = useState(false);
  const [opcionesObjeto, setOpcionesObjeto] = useState<ContratoObjetoOpcionRow[]>([]);

  type Snapshot = {
    estado: EstadoContrato;
    objetoAlquiler: string;
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
      objetoAlquiler: String(objetoAlquiler ?? ''),
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
    objetoAlquiler,
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

  const loadOpciones = useCallback(async () => {
    if (!patrimonioId) return;

    setLoadingOpciones(true);
    try {
      const data = await listOpcionesContratoPorPatrimonio({
        patrimonioId,
        contratoIdExclude: isEdit ? contratoId : null,
      });

      const opciones = Array.isArray(data?.opciones) ? data.opciones : [];
      setOpcionesObjeto(opciones);

      const currentExists = opciones.some((o) => o.code === objetoAlquiler);

      if (!currentExists) {
        const firstEnabled = opciones.find((o) => o.enabled);
        if (firstEnabled) {
          setObjetoAlquiler(firstEnabled.code);
        }
      }
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudieron cargar las opciones del objeto de alquiler.';
      Alert.alert('Error', String(detail));
      setOpcionesObjeto([]);
    } finally {
      setLoadingOpciones(false);
    }
  }, [patrimonioId, isEdit, contratoId, objetoAlquiler]);

  useEffect(() => {
    void loadOpciones();
  }, [loadOpciones]);

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

  const onRefresh = () => {
    setRefreshing(true);
    Promise.resolve(loadOpciones()).finally(() => {
      setTimeout(() => setRefreshing(false), 250);
    });
  };

  const handleSave = async () => {
    if (readOnly) return;

    if (!patrimonioId) {
      Alert.alert('Error', 'No se ha recibido la vivienda asociada al contrato.');
      return;
    }

    if (!objetoAlquiler) {
      Alert.alert('Campo obligatorio', 'Debes seleccionar qué se alquila en este contrato.');
      return;
    }

    const opcionSeleccionada = opcionesObjeto.find((o) => o.code === objetoAlquiler);
    if (!opcionSeleccionada) {
      Alert.alert('Validación', 'La opción seleccionada no es válida para este patrimonio.');
      return;
    }

    if (!opcionSeleccionada.enabled) {
      Alert.alert('No disponible', String(opcionSeleccionada.disabled_reason || 'Esta opción no está disponible.'));
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
        objeto_alquiler: objetoAlquiler,
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
          objeto_alquiler: payload.objeto_alquiler,
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
          </View>
        </FormSection>

        <FormSection title="Objeto del alquiler">
          {loadingOpciones ? (
            <ActivityIndicator style={{ marginVertical: 8 }} />
          ) : (
            <>
              <Text style={styles.helperText}>
                Se muestran todas las opciones válidas. Las incompatibles con contratos activos aparecen deshabilitadas.
              </Text>

              <View style={stylesLocal.optionGrid}>
                {opcionesObjeto.map((item) => {
                  const selected = objetoAlquiler === item.code;
                  const disabled = !item.enabled || readOnly;

                  return (
                    <TouchableOpacity
                      key={String(item.code)}
                      activeOpacity={disabled ? 1 : 0.9}
                      disabled={disabled}
                      onPress={() => setObjetoAlquiler(item.code)}
                      style={[
                        stylesLocal.optionCard,
                        selected && stylesLocal.optionCardSelected,
                        disabled && stylesLocal.optionCardDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          stylesLocal.optionCardTitle,
                          selected && stylesLocal.optionCardTitleSelected,
                          disabled && stylesLocal.optionCardTitleDisabled,
                        ]}
                      >
                        {item.label}
                      </Text>

                      {!item.enabled && item.disabled_reason ? (
                        <Text style={stylesLocal.optionCardHint}>{item.disabled_reason}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
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

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Cancelado"
                  selected={estado === 'cancelado'}
                  onPress={() => {
                    if (readOnly) return;
                    setEstado('cancelado');
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

        {!readOnly ? (
          <View style={{ marginTop: 12 }}>
            <FormActionButton
              label={saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear contrato'}
              onPress={handleSave}
              iconName="save-outline"
              variant="primary"
              disabled={saving || loadingOpciones}
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
  optionGrid: {
    marginTop: 10,
    gap: 10,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  optionCardDisabled: {
    opacity: 0.55,
    backgroundColor: colors.background,
  },
  optionCardTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: colors.textPrimary,
  },
  optionCardTitleSelected: {
    color: colors.primary,
  },
  optionCardTitleDisabled: {
    color: colors.textSecondary,
  },
  optionCardHint: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
} as const;