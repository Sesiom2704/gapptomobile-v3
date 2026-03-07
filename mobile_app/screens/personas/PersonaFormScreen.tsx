// mobile_app/screens/personas/PersonaFormScreen.tsx
//
// Formulario de Personas (v1)
//
// Objetivo:
// - Crear un formulario propio para el maestro de personas.
// - Mantener coherencia con AuxEntityFormScreen y formularios existentes.
// - Permitir alta, edición y eliminación.
// - Preparar reutilización futura desde contratos.
//
// Incluye:
// - Confirmación al salir si hay cambios sin guardar.
// - Guardado real con backend.
// - Eliminación real en modo edición.
// - Fecha de nacimiento con DatePicker.
// - Campos: nombre, dni, teléfono, email, fecha nacimiento, observaciones.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import { FormDateButton } from '../../components/ui/FormDateButton';

import { colors, spacing, radius } from '../../theme';

import {
  createPersona,
  updatePersona,
  getPersona,
  type PersonaRow,
} from '../../services/gestionAlquilerApi';
import { api } from '../../services/api';
import { formatFechaCorta } from '../../utils/format';

type Props = {
  navigation: any;
  route: {
    params?: {
      persona?: PersonaRow;
      personaId?: string;
      readOnly?: boolean;
    };
  };
};

type DirtySnapshot = {
  nombre_completo: string;
  dni: string;
  telefono: string;
  email: string;
  fecha_nacimiento: string;
  observaciones: string;
};

function normalize(v: any) {
  return String(v ?? '').trim();
}

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

const PersonaFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const editingPersona = route?.params?.persona;
  const personaId = route?.params?.personaId ?? editingPersona?.id ?? null;
  const readOnly = route?.params?.readOnly === true;
  const isEditMode = !!personaId;

  const [loading, setLoading] = useState<boolean>(!!personaId && !editingPersona);

  const [nombreCompleto, setNombreCompleto] = useState(editingPersona?.nombre_completo ?? '');
  const [dni, setDni] = useState(editingPersona?.dni ?? '');
  const [telefono, setTelefono] = useState(editingPersona?.telefono ?? '');
  const [email, setEmail] = useState(editingPersona?.email ?? '');
  const [fechaNacimiento, setFechaNacimiento] = useState(editingPersona?.fecha_nacimiento ?? '');
  const [observaciones, setObservaciones] = useState(editingPersona?.observaciones ?? '');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // -------------------------
  // Carga en edición si solo viene personaId
  // -------------------------
  useEffect(() => {
    const load = async () => {
      if (!personaId || editingPersona) return;

      try {
        setLoading(true);
        const data = await getPersona(personaId);
        setNombreCompleto(data.nombre_completo ?? '');
        setDni(data.dni ?? '');
        setTelefono(data.telefono ?? '');
        setEmail(data.email ?? '');
        setFechaNacimiento(data.fecha_nacimiento ?? '');
        setObservaciones(data.observaciones ?? '');
      } catch (err) {
        console.error('[PersonaForm] Error cargando persona', err);
        Alert.alert('Error', 'No se ha podido cargar la persona.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [personaId, editingPersona]);

  // -------------------------
  // Dirty control
  // -------------------------
  const initialSnapshot = useMemo<DirtySnapshot>(() => {
    return {
      nombre_completo: normalize(editingPersona?.nombre_completo),
      dni: normalize(editingPersona?.dni),
      telefono: normalize(editingPersona?.telefono),
      email: normalize(editingPersona?.email),
      fecha_nacimiento: normalize(editingPersona?.fecha_nacimiento),
      observaciones: normalize(editingPersona?.observaciones),
    };
  }, [editingPersona]);

  const isDirty = useMemo(() => {
    return (
      normalize(nombreCompleto) !== initialSnapshot.nombre_completo ||
      normalize(dni) !== initialSnapshot.dni ||
      normalize(telefono) !== initialSnapshot.telefono ||
      normalize(email) !== initialSnapshot.email ||
      normalize(fechaNacimiento) !== initialSnapshot.fecha_nacimiento ||
      normalize(observaciones) !== initialSnapshot.observaciones
    );
  }, [
    nombreCompleto,
    dni,
    telefono,
    email,
    fechaNacimiento,
    observaciones,
    initialSnapshot,
  ]);

  const handleBackPress = () => {
    if (!isDirty) {
      navigation.goBack();
      return;
    }

    Alert.alert(
      'Salir del formulario',
      'Si sales del formulario perderás los datos no guardados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty) return;

      e.preventDefault();

      Alert.alert(
        'Salir del formulario',
        'Si sales del formulario perderás los datos no guardados.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Salir',
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, isDirty]);

  // -------------------------
  // Fecha
  // -------------------------
  const handleChangeFechaNacimiento = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (!selectedDate) return;
    setFechaNacimiento(toApiDate(selectedDate));
  };

  // -------------------------
  // Guardar
  // -------------------------
  const handleSave = async () => {
    if (readOnly) return;

    const nombre = nombreCompleto.trim();
    if (!nombre) {
      Alert.alert('Campo requerido', 'Debes indicar el nombre completo.');
      return;
    }

    try {
      setSaving(true);

      if (isEditMode && personaId) {
        await updatePersona(personaId, {
          nombre_completo: nombre,
          dni: dni.trim() || null,
          telefono: telefono.trim() || null,
          email: email.trim() || null,
          fecha_nacimiento: fechaNacimiento || null,
          observaciones: observaciones.trim() || null,
        });

        Alert.alert('Persona actualizada', 'Los cambios se han guardado correctamente.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }

      await createPersona({
        nombre_completo: nombre,
        dni: dni.trim() || null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        fecha_nacimiento: fechaNacimiento || null,
        observaciones: observaciones.trim() || null,
      });

      Alert.alert('Persona creada', 'La persona se ha creado correctamente.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      console.error('[PersonaForm] Error guardando persona', err);
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se ha podido guardar la persona.');
    } finally {
      setSaving(false);
    }
  };

  // -------------------------
  // Eliminar
  // -------------------------
  const handleDelete = () => {
    if (!isEditMode || !personaId) return;

    Alert.alert(
      'Eliminar persona',
      `¿Seguro que quieres eliminar "${nombreCompleto || 'esta persona'}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/api/v1/gestion-alquiler/personas/${encodeURIComponent(personaId)}`);
              navigation.goBack();
            } catch (err) {
              console.error('[PersonaForm] Error eliminando persona', err);
              Alert.alert('Error', 'No se ha podido eliminar la persona.');
            }
          },
        },
      ]
    );
  };

  const title = readOnly
    ? 'Detalle persona'
    : isEditMode
    ? 'Editar persona'
    : 'Nueva persona';

  return (
    <FormScreen
      title={title}
      onBackPress={handleBackPress}
      loading={loading}
      footer={
        !readOnly ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
              <Ionicons name="save-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.saveButtonText}>
                {saving ? 'Guardando...' : isEditMode ? 'Guardar cambios' : 'Guardar'}
              </Text>
            </TouchableOpacity>

            {isEditMode ? (
              <TouchableOpacity style={ui.deleteButton} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={ui.deleteButtonText}>Eliminar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : undefined
      }
    >
      <FormSection title="Datos principales">
        <View style={styles.field}>
          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            style={[styles.input, nombreCompleto.trim() !== '' ? styles.inputFilled : null]}
            placeholder="Nombre completo..."
            value={nombreCompleto}
            onChangeText={setNombreCompleto}
            editable={!readOnly}
          />
        </View>

        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>DNI</Text>
            <TextInput
              style={[styles.input, dni.trim() !== '' ? styles.inputFilled : null]}
              placeholder="DNI..."
              value={dni}
              onChangeText={setDni}
              editable={!readOnly}
              autoCapitalize="characters"
            />
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Teléfono</Text>
            <TextInput
              style={[styles.input, telefono.trim() !== '' ? styles.inputFilled : null]}
              placeholder="Teléfono..."
              value={telefono}
              onChangeText={setTelefono}
              editable={!readOnly}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, email.trim() !== '' ? styles.inputFilled : null]}
            placeholder="correo@dominio.com"
            value={email}
            onChangeText={setEmail}
            editable={!readOnly}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Fecha nacimiento</Text>
          <FormDateButton
            valueText={fechaNacimiento ? formatFechaCorta(fechaNacimiento) : 'Seleccionar fecha'}
            onPress={() => {
              if (readOnly) return;
              setShowDatePicker(true);
            }}
            disabled={readOnly}
          />

          {showDatePicker && !readOnly && (
            <DateTimePicker
              value={parseDateString(fechaNacimiento)}
              mode="date"
              display="default"
              onChange={handleChangeFechaNacimiento}
            />
          )}
        </View>
      </FormSection>

      <FormSection title="Observaciones">
        <View style={styles.field}>
          <Text style={styles.label}>Notas</Text>
          <TextInput
            style={[
              styles.input,
              styles.inputFilled,
              ui.textArea,
              readOnly ? styles.inputAdvanced : null,
            ]}
            placeholder="Observaciones internas..."
            value={observaciones}
            onChangeText={setObservaciones}
            editable={!readOnly}
            multiline
            textAlignVertical="top"
          />
        </View>
      </FormSection>
    </FormScreen>
  );
};

export default PersonaFormScreen;

const ui = StyleSheet.create({
  textArea: {
    minHeight: 120,
    paddingTop: 14,
  },
  deleteButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
}); 