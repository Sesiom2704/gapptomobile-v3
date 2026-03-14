// mobile_app/screens/personas/PersonaFormScreen.tsx
//
// Formulario de Personas (v2)
//
// Objetivo:
// - Crear/editar/eliminar personas.
// - Mostrar relaciones on-demand.
// - Renderizar el bloque de relaciones al final del formulario.
// - Ocultar relaciones con count = 0.

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
  getPersonaRelations,
  type PersonaRow,
  type RelationCountItem,
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

  const [showRelations, setShowRelations] = useState(false);
  const [loadingRelations, setLoadingRelations] = useState(false);
  const [relationCounts, setRelationCounts] = useState<RelationCountItem[]>(
    Array.isArray(editingPersona?.relationCounts) ? editingPersona!.relationCounts! : []
  );
  const [associatedCount, setAssociatedCount] = useState<number>(
    Number(editingPersona?.associatedCount ?? 0)
  );

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
        setAssociatedCount(Number(data.associatedCount ?? 0));
        setRelationCounts(
          Array.isArray(data.relationCounts)
            ? data.relationCounts.filter((x) => Number(x.count ?? 0) > 0)
            : []
        );
      } catch (err) {
        console.error('[PersonaForm] Error cargando persona', err);
        Alert.alert('Error', 'No se ha podido cargar la persona.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [personaId, editingPersona]);

  useEffect(() => {
    if (!editingPersona) return;
    setAssociatedCount(Number(editingPersona.associatedCount ?? 0));
    setRelationCounts(
      Array.isArray(editingPersona.relationCounts)
        ? editingPersona.relationCounts.filter((x) => Number(x.count ?? 0) > 0)
        : []
    );
  }, [editingPersona]);

  // -------------------------
  // Relaciones on-demand
  // -------------------------
  const handleToggleRelations = async () => {
    if (!personaId) return;

    const next = !showRelations;
    setShowRelations(next);

    if (!next) return;

    if (relationCounts.length > 0 || associatedCount > 0) return;

    try {
      setLoadingRelations(true);
      const data = await getPersonaRelations(personaId);
      const filtered = Array.isArray(data.relation_counts)
        ? data.relation_counts.filter((x) => Number(x.count ?? 0) > 0)
        : [];

      setRelationCounts(filtered);
      setAssociatedCount(Number(data.associated_count ?? 0));
    } catch (err) {
      console.error('[PersonaForm] Error cargando relaciones', err);
      Alert.alert('Error', 'No se han podido cargar las relaciones.');
    } finally {
      setLoadingRelations(false);
    }
  };

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

  const visibleRelationCounts = useMemo(
    () => relationCounts.filter((x) => Number(x.count ?? 0) > 0),
    [relationCounts]
  );

  const hasRelationsInfo = isEditMode && associatedCount > 0;

  return (
    <FormScreen
      title={title}
      onBackPress={handleBackPress}
      loading={loading}
      footer={
        !readOnly ? (
          <View style={styles.bottomActions}>
            {hasRelationsInfo ? (
              <TouchableOpacity style={ui.relationsButton} onPress={handleToggleRelations}>
                <Ionicons
                  name={showRelations ? 'layers' : 'layers-outline'}
                  size={18}
                  color={colors.textPrimary}
                  style={{ marginRight: 8 }}
                />
                <Text style={ui.relationsButtonText}>
                  {showRelations ? 'Ocultar relaciones' : `Relaciones (${associatedCount})`}
                </Text>
              </TouchableOpacity>
            ) : null}

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
        ) : hasRelationsInfo ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity style={ui.relationsButton} onPress={handleToggleRelations}>
              <Ionicons
                name={showRelations ? 'layers' : 'layers-outline'}
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 8 }}
              />
              <Text style={ui.relationsButtonText}>
                {showRelations ? 'Ocultar relaciones' : `Relaciones (${associatedCount})`}
              </Text>
            </TouchableOpacity>
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

      {showRelations ? (
        <FormSection title={`Relaciones (${associatedCount} registros)`}>
          {loadingRelations ? (
            <Text style={styles.helperText}>Cargando relaciones...</Text>
          ) : visibleRelationCounts.length > 0 ? (
            visibleRelationCounts.map((rel) => (
              <View key={rel.key} style={ui.relationRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.relationLabel}>{rel.label}</Text>
                  <Text style={ui.relationKey}>{rel.key}</Text>
                </View>

                <View style={ui.relationCountBadge}>
                  <Text style={ui.relationCountText}>{rel.count}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.helperText}>No hay relaciones con registros asociados.</Text>
          )}
        </FormSection>
      ) : null}
    </FormScreen>
  );
};

export default PersonaFormScreen;

const ui = StyleSheet.create({
  textArea: {
    minHeight: 120,
    paddingTop: 14,
  },
  relationsButton: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface ?? '#FFFFFF',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  relationsButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  relationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  relationLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  relationKey: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  relationCountBadge: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relationCountText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
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