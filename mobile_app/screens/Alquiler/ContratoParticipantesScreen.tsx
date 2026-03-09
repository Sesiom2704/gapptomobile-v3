/**
 * Archivo: mobile_app/screens/Alquiler/ContratoParticipantesScreen.tsx
 *
 * Participantes de contrato de alquiler (v5)
 *
 * Cambios incluidos:
 * - Selector/buscador de personas existentes.
 * - Alta rápida oculta por defecto.
 * - Acceso al maestro de personas.
 * - Exclusión de personas ya añadidas.
 * - Límite de 3 personas en selector.
 * - Edición inline real de participante:
 *     * rol
 *     * es_principal
 * - Edición de persona vía PersonaForm.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { SelectedInlineValue } from '../../components/ui/SelectedInlineValue';
import { commonFormStyles } from '../../components/forms/formStyles';

import { colors } from '../../theme';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import {
  listContratoParticipantes,
  createContratoParticipante,
  updateContratoParticipante,
  deleteContratoParticipante,
  createPersona,
  listPersonas,
  type ContratoParticipanteRow,
  type RolParticipante,
  type PersonaRow,
} from '../../services/gestionAlquilerApi';

type ParticipanteItem = {
  id: string;
  nombre: string;
  rol: RolParticipante;
  es_principal: boolean;
  telefono?: string | null;
  email?: string | null;
  persona_id?: string | null;
  origen?: 'route' | 'backend' | 'local';
};

type Props = {
  navigation: any;
  route: {
    params?: {
      patrimonioId: string;
      contratoId: string;
      participantes?: ParticipanteItem[];
    };
  };
};

type EditState = {
  participanteId: string;
  rol: RolParticipante;
  es_principal: boolean;
};

function formatRol(rol: RolParticipante): string {
  if (rol === 'inquilino') return 'Inquilino';
  if (rol === 'avalista') return 'Avalista';
  return 'Gestor';
}

function mapBackendParticipanteToItem(p: ContratoParticipanteRow): ParticipanteItem {
  return {
    id: String(p.id),
    nombre: p.nombre_completo || p.persona_id,
    rol: p.rol,
    es_principal: !!p.es_principal,
    telefono: p.telefono ?? null,
    email: p.email ?? null,
    persona_id: p.persona_id ?? null,
    origen: 'backend',
  };
}

const NOOP = () => {};

const ContratoParticipantesScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const patrimonioId = String(route?.params?.patrimonioId ?? '');
  const contratoId = String(route?.params?.contratoId ?? '');

  const initialRouteParticipantes = useMemo<ParticipanteItem[]>(() => {
    if (route?.params?.participantes?.length) {
      return route.params.participantes.map((p) => ({
        ...p,
        id: String(p.id),
        origen: 'route',
      }));
    }
    return [];
  }, [route?.params?.participantes]);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [participantes, setParticipantes] = useState<ParticipanteItem[]>(initialRouteParticipantes);

  // -------------------------
  // Maestro personas
  // -------------------------
  const [personasLoading, setPersonasLoading] = useState(false);
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [personaSearch, setPersonaSearch] = useState('');
  const [personaSeleccionada, setPersonaSeleccionada] = useState<PersonaRow | null>(null);

  // -------------------------
  // Formulario alta / relación
  // -------------------------
  const [showAltaRapida, setShowAltaRapida] = useState(false);

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolParticipante>('inquilino');
  const [esPrincipal, setEsPrincipal] = useState(false);

  // -------------------------
  // Edición inline participante
  // -------------------------
  const [editing, setEditing] = useState<EditState | null>(null);

  // -------------------------
  // Dirty control
  // -------------------------
  type Snapshot = {
    participantes: ParticipanteItem[];
    nombre: string;
    telefono: string;
    email: string;
    rol: RolParticipante;
    esPrincipal: boolean;
    personaSeleccionadaId: string;
    personaSearch: string;
    showAltaRapida: boolean;
    editingId: string;
    editingRol: string;
    editingPrincipal: boolean;
  };

  const getSnapshot = useCallback((): Snapshot => {
    return {
      participantes,
      nombre,
      telefono,
      email,
      rol,
      esPrincipal,
      personaSeleccionadaId: String(personaSeleccionada?.id ?? ''),
      personaSearch,
      showAltaRapida,
      editingId: String(editing?.participanteId ?? ''),
      editingRol: String(editing?.rol ?? ''),
      editingPrincipal: !!editing?.es_principal,
    };
  }, [
    participantes,
    nombre,
    telefono,
    email,
    rol,
    esPrincipal,
    personaSeleccionada,
    personaSearch,
    showAltaRapida,
    editing,
  ]);

  const baselineRef = useRef<Snapshot>({
    participantes: initialRouteParticipantes,
    nombre: '',
    telefono: '',
    email: '',
    rol: 'inquilino',
    esPrincipal: false,
    personaSeleccionadaId: '',
    personaSearch: '',
    showAltaRapida: false,
    editingId: '',
    editingRol: '',
    editingPrincipal: false,
  });

  const isDirty = useCallback(() => {
    return JSON.stringify(baselineRef.current) !== JSON.stringify(getSnapshot());
  }, [getSnapshot]);

  const navigateBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty()) return;

      e.preventDefault();

      Alert.alert('Salir de participantes', 'Tienes cambios sin guardar. Si sales, se perderán.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });

    return unsubscribe;
  }, [navigation, isDirty]);

  const handleBackPress = () => {
    if (!isDirty()) {
      navigateBack();
      return;
    }

    Alert.alert('Salir de participantes', 'Tienes cambios sin guardar. Si sales, se perderán.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: navigateBack,
      },
    ]);
  };

  // -------------------------
  // Carga participantes
  // -------------------------
  const loadParticipantes = useCallback(async (isPull = false) => {
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
      const data = await listContratoParticipantes(contratoId);
      const mapped = data.map(mapBackendParticipanteToItem);
      setParticipantes(mapped);

      baselineRef.current = {
        participantes: mapped,
        nombre: '',
        telefono: '',
        email: '',
        rol: 'inquilino',
        esPrincipal: false,
        personaSeleccionadaId: '',
        personaSearch: '',
        showAltaRapida: false,
        editingId: '',
        editingRol: '',
        editingPrincipal: false,
      };
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudieron cargar los participantes del contrato.';
      setErr(String(detail));

      if (initialRouteParticipantes.length === 0) {
        setParticipantes([]);
      }
    } finally {
      if (!isPull) setLoading(false);
      if (isPull) setRefreshing(false);
    }
  }, [contratoId, initialRouteParticipantes]);

  // -------------------------
  // Carga personas
  // -------------------------
  const loadPersonas = useCallback(async () => {
    try {
      setPersonasLoading(true);
      const data = await listPersonas({ activas: true });
      setPersonas(data ?? []);
    } catch (error) {
      console.error('[ContratoParticipantes] Error cargando personas', error);
      setPersonas([]);
    } finally {
      setPersonasLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParticipantes(false);
    void loadPersonas();
  }, [loadParticipantes, loadPersonas]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void loadParticipantes(true);
      void loadPersonas();
    });
    return unsubscribe;
  }, [navigation, loadParticipantes, loadPersonas]);

  const onRefresh = () => {
    void Promise.all([loadParticipantes(true), loadPersonas()]);
  };

  // -------------------------
  // Selector personas existentes
  // -------------------------
  const personaIdsYaAnadidos = useMemo(() => {
    return new Set(
      participantes
        .map((p) => String(p.persona_id ?? '').trim())
        .filter(Boolean)
    );
  }, [participantes]);

  const personasDisponibles = useMemo(() => {
    return personas.filter((p) => !personaIdsYaAnadidos.has(String(p.id)));
  }, [personas, personaIdsYaAnadidos]);

  const personasFiltradas = useMemo(() => {
    const term = personaSearch.trim().toLowerCase();
    const base = personasDisponibles;

    if (!term) return base.slice(0, 3);

    return base
      .filter((p) => {
        const nombre = String(p.nombre_completo ?? '').toLowerCase();
        const dni = String(p.dni ?? '').toLowerCase();
        const telefono = String(p.telefono ?? '').toLowerCase();
        const email = String(p.email ?? '').toLowerCase();

        return (
          nombre.includes(term) ||
          dni.includes(term) ||
          telefono.includes(term) ||
          email.includes(term)
        );
      })
      .slice(0, 3);
  }, [personasDisponibles, personaSearch]);

  const handleSelectPersona = (persona: PersonaRow) => {
    setPersonaSeleccionada(persona);
    setNombre(persona.nombre_completo ?? '');
    setTelefono(persona.telefono ?? '');
    setEmail(persona.email ?? '');
    setPersonaSearch('');
    setShowAltaRapida(false);
  };

  const clearPersonaSeleccionada = () => {
    setPersonaSeleccionada(null);
    setNombre('');
    setTelefono('');
    setEmail('');
    setPersonaSearch('');
  };

  // -------------------------
  // Alta / vinculación
  // -------------------------
  const resetLocalForm = useCallback(() => {
    setNombre('');
    setTelefono('');
    setEmail('');
    setRol('inquilino');
    setEsPrincipal(false);
    setPersonaSeleccionada(null);
    setPersonaSearch('');
    setShowAltaRapida(false);
  }, []);

  const handleAddParticipante = async () => {
    const nombreFinal = nombre.trim();

    if (!personaSeleccionada && !showAltaRapida) {
      Alert.alert('Acción requerida', 'Selecciona una persona existente o abre el formulario de alta rápida.');
      return;
    }

    if (!personaSeleccionada && !nombreFinal) {
      Alert.alert('Campo obligatorio', 'El nombre del participante es obligatorio.');
      return;
    }

    if (esPrincipal && rol !== 'inquilino') {
      Alert.alert('Validación', 'Solo un inquilino puede marcarse como principal.');
      return;
    }

    setSaving(true);

    try {
      let personaId = personaSeleccionada?.id ?? null;

      if (personaId && personaIdsYaAnadidos.has(String(personaId))) {
        Alert.alert('Duplicado', 'Esta persona ya está añadida al contrato.');
        return;
      }

      if (!personaId) {
        const persona = await createPersona({
          nombre_completo: nombreFinal,
          telefono: telefono.trim() || null,
          email: email.trim() || null,
        });

        personaId = persona.id;
      }

      await createContratoParticipante(contratoId, {
        persona_id: personaId,
        rol,
        es_principal: esPrincipal,
        observaciones: null,
      });

      resetLocalForm();
      await Promise.all([loadParticipantes(true), loadPersonas()]);
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudo añadir el participante.';
      Alert.alert('Error', String(detail));
    } finally {
      setSaving(false);
    }
  };

  // -------------------------
  // Editar relación participante
  // -------------------------
  const startEditParticipante = useCallback((item: ParticipanteItem) => {
    setEditing({
      participanteId: item.id,
      rol: item.rol,
      es_principal: !!item.es_principal,
    });
  }, []);

  const cancelEditParticipante = useCallback(() => {
    setEditing(null);
  }, []);

  const handleSaveEditParticipante = useCallback(async () => {
    if (!editing) return;

    if (editing.es_principal && editing.rol !== 'inquilino') {
      Alert.alert('Validación', 'Solo un inquilino puede marcarse como principal.');
      return;
    }

    setSavingEdit(true);
    try {
      await updateContratoParticipante(editing.participanteId, {
        rol: editing.rol,
        es_principal: editing.es_principal,
      });

      setEditing(null);
      await loadParticipantes(true);
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudo actualizar el participante.';
      Alert.alert('Error', String(detail));
    } finally {
      setSavingEdit(false);
    }
  }, [editing, loadParticipantes]);

  const handleRemoveParticipante = useCallback((id: string) => {
    Alert.alert(
      'Eliminar participante',
      '¿Seguro que quieres eliminar este participante del contrato?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteContratoParticipante(id);
              await Promise.all([loadParticipantes(true), loadPersonas()]);
            } catch (error: any) {
              const detail =
                error?.response?.data?.detail ||
                'No se pudo eliminar el participante.';
              Alert.alert('Error', String(detail));
            }
          },
        },
      ]
    );
  }, [loadParticipantes, loadPersonas]);

  const handleOpenPersonasMaestro = useCallback(() => {
    navigation.navigate('HomeTab', {
      screen: 'PersonasList',
    });
  }, [navigation]);

  const handleEditPersona = useCallback((personaId?: string | null) => {
    if (!personaId) {
      Alert.alert('No disponible', 'Este participante no tiene persona vinculada editable.');
      return;
    }

    navigation.navigate('HomeTab', {
      screen: 'PersonaForm',
      params: { personaId },
    });
  }, [navigation]);

  const handleSaveVisual = useCallback(() => {
    baselineRef.current = getSnapshot();

    Alert.alert(
      'Participantes actualizados',
      'Los cambios visibles de participantes están sincronizados con el backend.'
    );
  }, [getSnapshot]);

  const participantesOrdenados = useMemo(() => {
    const priority = (p: ParticipanteItem) => {
      if (p.rol === 'inquilino' && p.es_principal) return 0;
      if (p.rol === 'inquilino') return 1;
      if (p.rol === 'avalista') return 2;
      return 3;
    };

    return [...participantes].sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);

      if (pa !== pb) return pa - pb;
      return a.nombre.localeCompare(b.nombre);
    });
  }, [participantes]);

  const resumenPorRol = useMemo(() => {
    const inquilinos = participantes.filter((p) => p.rol === 'inquilino').length;
    const avalistas = participantes.filter((p) => p.rol === 'avalista').length;
    const gestores = participantes.filter((p) => p.rol === 'gestor').length;

    return { inquilinos, avalistas, gestores };
  }, [participantes]);

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header
          title={`Participantes ${contratoId}`}
          subtitle="Gestión contrato"
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
        {loading ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
        {err ? <Text style={styles.helperText}>{err}</Text> : null}

        <FormSection title="Resumen del contrato">
          <View style={stylesLocal.summaryCard}>
            <View style={stylesLocal.summaryRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={stylesLocal.summaryTitle}>Contrato en gestión</Text>
            </View>

            <View style={stylesLocal.summaryGrid}>
              <View style={stylesLocal.summaryItem}>
                <Text style={stylesLocal.summaryLabel}>Contrato</Text>
                <Text style={stylesLocal.summaryValue}>{contratoId || '—'}</Text>
              </View>

              <View style={stylesLocal.summaryItem}>
                <Text style={stylesLocal.summaryLabel}>Patrimonio</Text>
                <Text style={stylesLocal.summaryValue}>{patrimonioId || '—'}</Text>
              </View>

              <View style={stylesLocal.summaryItem}>
                <Text style={stylesLocal.summaryLabel}>Inquilinos</Text>
                <Text style={stylesLocal.summaryValue}>{resumenPorRol.inquilinos}</Text>
              </View>

              <View style={stylesLocal.summaryItem}>
                <Text style={stylesLocal.summaryLabel}>Avalistas</Text>
                <Text style={stylesLocal.summaryValue}>{resumenPorRol.avalistas}</Text>
              </View>

              <View style={stylesLocal.summaryItem}>
                <Text style={stylesLocal.summaryLabel}>Gestores</Text>
                <Text style={stylesLocal.summaryValue}>{resumenPorRol.gestores}</Text>
              </View>
            </View>
          </View>
        </FormSection>

        <FormSection title="Participantes actuales">
          {participantesOrdenados.length === 0 ? (
            <View style={stylesLocal.emptyBox}>
              <Text style={styles.helperText}>
                Todavía no hay participantes activos en este contrato.
              </Text>
            </View>
          ) : (
            <View style={stylesLocal.participantsList}>
              {participantesOrdenados.map((item) => {
                const isEditingThis = editing?.participanteId === item.id;

                return (
                  <View key={item.id} style={stylesLocal.participantCard}>
                    <View style={stylesLocal.participantHeader}>
                      <View style={stylesLocal.participantHeaderLeft}>
                        <Text style={stylesLocal.participantName}>{item.nombre}</Text>

                        {!isEditingThis ? (
                          <View style={stylesLocal.badgesRow}>
                            <View style={stylesLocal.roleBadge}>
                              <Text style={stylesLocal.roleBadgeText}>{formatRol(item.rol)}</Text>
                            </View>

                            {item.es_principal ? (
                              <View style={stylesLocal.primaryBadge}>
                                <Text style={stylesLocal.primaryBadgeText}>Principal</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>

                      <View style={stylesLocal.participantActions}>
                        <TouchableOpacity
                          onPress={() => handleEditPersona(item.persona_id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
                        </TouchableOpacity>

                        {!isEditingThis ? (
                          <TouchableOpacity
                            onPress={() => startEditParticipante(item)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="create-outline" size={18} color={colors.primary} />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={cancelEditParticipante}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close-outline" size={20} color={colors.textSecondary} />
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          onPress={() => handleRemoveParticipante(item.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={stylesLocal.participantMetaRow}>
                      <View style={stylesLocal.participantMetaItem}>
                        <Text style={stylesLocal.participantMetaLabel}>Teléfono</Text>
                        <Text style={stylesLocal.participantMetaValue}>{item.telefono || '—'}</Text>
                      </View>

                      <View style={stylesLocal.participantMetaItem}>
                        <Text style={stylesLocal.participantMetaLabel}>Email</Text>
                        <Text style={stylesLocal.participantMetaValue}>{item.email || '—'}</Text>
                      </View>
                    </View>

                    {isEditingThis ? (
                      <View style={stylesLocal.editBox}>
                        <Text style={styles.label}>Rol</Text>
                        <View style={styles.segmentosRow}>
                          <View style={styles.segmentoWrapper}>
                            <PillButton
                              label="Inquilino"
                              selected={editing?.rol === 'inquilino'}
                              onPress={() =>
                                setEditing((prev) =>
                                  prev
                                    ? { ...prev, rol: 'inquilino' }
                                    : prev
                                )
                              }
                            />
                          </View>

                          <View style={styles.segmentoWrapper}>
                            <PillButton
                              label="Avalista"
                              selected={editing?.rol === 'avalista'}
                              onPress={() =>
                                setEditing((prev) =>
                                  prev
                                    ? { ...prev, rol: 'avalista', es_principal: false }
                                    : prev
                                )
                              }
                            />
                          </View>

                          <View style={styles.segmentoWrapper}>
                            <PillButton
                              label="Gestor"
                              selected={editing?.rol === 'gestor'}
                              onPress={() =>
                                setEditing((prev) =>
                                  prev
                                    ? { ...prev, rol: 'gestor', es_principal: false }
                                    : prev
                                )
                              }
                            />
                          </View>
                        </View>

                        <View style={[styles.field, { marginTop: spacing.sm }]}>
                          <Text style={styles.label}>Participante principal</Text>
                          <View style={styles.segmentosRow}>
                            <View style={styles.segmentoWrapper}>
                              <PillButton
                                label="Sí"
                                selected={!!editing?.es_principal}
                                onPress={() => {
                                  if (editing?.rol !== 'inquilino') {
                                    Alert.alert('Validación', 'Solo un inquilino puede marcarse como principal.');
                                    return;
                                  }
                                  setEditing((prev) =>
                                    prev
                                      ? { ...prev, es_principal: true }
                                      : prev
                                  );
                                }}
                              />
                            </View>

                            <View style={styles.segmentoWrapper}>
                              <PillButton
                                label="No"
                                selected={!editing?.es_principal}
                                onPress={() =>
                                  setEditing((prev) =>
                                    prev
                                      ? { ...prev, es_principal: false }
                                      : prev
                                  )
                                }
                              />
                            </View>
                          </View>
                        </View>

                        <View style={{ marginTop: spacing.sm }}>
                          <FormActionButton
                            label={savingEdit ? 'Guardando…' : 'Guardar participante'}
                            onPress={handleSaveEditParticipante}
                            iconName="save-outline"
                            variant="primary"
                            disabled={savingEdit}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </FormSection>

        <FormSection title="Añadir participante">
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Persona existente</Text>

              <TouchableOpacity
                onPress={handleOpenPersonasMaestro}
                style={stylesLocal.inlineAddButton}
                activeOpacity={0.85}
              >
                <Ionicons name="people-outline" size={16} color={colors.primary} />
                <Text style={stylesLocal.inlineAddButtonText}>Ir a Personas</Text>
              </TouchableOpacity>
            </View>

            <InlineSearchSelect<PersonaRow>
              label=""
              onAddPress={NOOP}
              addAccessibilityLabel="No aplica"
              disabled={false}
              selected={personaSeleccionada}
              selectedLabel={(p) => p.nombre_completo}
              onClear={clearPersonaSeleccionada}
              query={personaSearch}
              onChangeQuery={setPersonaSearch}
              placeholder="Buscar persona existente..."
              options={personasFiltradas}
              optionKey={(p) => String(p.id)}
              optionLabel={(p) => {
                const telefonoTxt = p.telefono ? ` · ${p.telefono}` : '';
                const dniTxt = p.dni ? ` · DNI ${p.dni}` : '';
                return `${p.nombre_completo}${telefonoTxt}${dniTxt}`;
              }}
              onSelect={handleSelectPersona}
              emptyText={
                personasLoading
                  ? 'Cargando personas...'
                  : personasDisponibles.length === 0
                  ? 'No hay más personas disponibles para añadir.'
                  : 'No hay personas que coincidan con la búsqueda.'
              }
            />

            <Text style={styles.helperText}>
              Se muestran hasta 3 personas y no aparecen las ya añadidas al contrato.
            </Text>
          </View>

          {personaSeleccionada ? (
            <View style={styles.field}>
              <SelectedInlineValue
                value={personaSeleccionada.nombre_completo}
                leftIconName="person-outline"
                onClear={clearPersonaSeleccionada}
              />
              <Text style={styles.helperText}>
                Se usará una persona ya existente del maestro.
              </Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <TouchableOpacity
              style={stylesLocal.toggleQuickAddBtn}
              onPress={() => setShowAltaRapida((v) => !v)}
              activeOpacity={0.9}
            >
              <Ionicons
                name={showAltaRapida ? 'chevron-up-outline' : 'chevron-down-outline'}
                size={16}
                color={colors.primary}
              />
              <Text style={stylesLocal.toggleQuickAddText}>
                {showAltaRapida ? 'Ocultar alta rápida' : 'Mostrar alta rápida'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.helperText}>
              Usa alta rápida solo si la persona todavía no existe en el maestro.
            </Text>
          </View>

          {showAltaRapida ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Nombre completo</Text>
                <TextInput
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Ej: Juan Pérez García"
                  editable={!personaSeleccionada}
                  style={[
                    styles.input,
                    nombre.trim() !== '' && styles.inputFilled,
                    personaSeleccionada ? styles.inputAdvanced : null,
                  ]}
                />
              </View>

              <View style={styles.fieldRowTwoCols}>
                <View style={styles.col}>
                  <Text style={styles.label}>Teléfono</Text>
                  <TextInput
                    value={telefono}
                    onChangeText={setTelefono}
                    placeholder="Ej: 600123123"
                    keyboardType="phone-pad"
                    editable={!personaSeleccionada}
                    style={[
                      styles.input,
                      telefono.trim() !== '' && styles.inputFilled,
                      personaSeleccionada ? styles.inputAdvanced : null,
                    ]}
                  />
                </View>

                <View style={styles.col}>
                  <Text style={styles.label}>Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Ej: correo@dominio.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={!personaSeleccionada}
                    style={[
                      styles.input,
                      email.trim() !== '' && styles.inputFilled,
                      personaSeleccionada ? styles.inputAdvanced : null,
                    ]}
                  />
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Rol</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Inquilino"
                  selected={rol === 'inquilino'}
                  onPress={() => setRol('inquilino')}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Avalista"
                  selected={rol === 'avalista'}
                  onPress={() => {
                    setRol('avalista');
                    setEsPrincipal(false);
                  }}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Gestor"
                  selected={rol === 'gestor'}
                  onPress={() => {
                    setRol('gestor');
                    setEsPrincipal(false);
                  }}
                />
              </View>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Participante principal</Text>
            <View style={styles.segmentosRow}>
              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="Sí"
                  selected={esPrincipal}
                  onPress={() => {
                    if (rol !== 'inquilino') {
                      Alert.alert('Validación', 'Solo un inquilino puede marcarse como principal.');
                      return;
                    }
                    setEsPrincipal(true);
                  }}
                />
              </View>

              <View style={styles.segmentoWrapper}>
                <PillButton
                  label="No"
                  selected={!esPrincipal}
                  onPress={() => setEsPrincipal(false)}
                />
              </View>
            </View>

            <Text style={styles.helperText}>
              Solo puede existir un inquilino principal activo por contrato.
            </Text>
          </View>

          <View style={{ marginTop: 8 }}>
            <FormActionButton
              label={saving ? 'Añadiendo…' : 'Añadir participante'}
              onPress={handleAddParticipante}
              iconName="person-add-outline"
              variant="primary"
              disabled={saving}
            />
          </View>
          <View style={{ marginTop: 12 }}>
          <FormActionButton
            label="Confirmar pantalla"
            onPress={handleSaveVisual}
            iconName="save-outline"
            variant="primary"
          />
        </View>
        </FormSection>
      </ScrollView>
    </Screen>
  );
};

export default ContratoParticipantesScreen;

const stylesLocal = StyleSheet.create({
  summaryCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryItem: {
    width: '48%',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
  },

  emptyBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },

  participantsList: {
    gap: spacing.sm,
  },
  participantCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  participantHeaderLeft: {
    flex: 1,
  },
  participantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  participantName: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
  primaryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.success ?? '#2E9B61',
    backgroundColor: colors.successSoft ?? '#EAF8EF',
    alignSelf: 'flex-start',
  },
  primaryBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.success ?? '#2E9B61',
  },
  participantMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  participantMetaItem: {
    flex: 1,
  },
  participantMetaLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  participantMetaValue: {
    fontSize: 12,
    color: colors.textPrimary,
  },

  editBox: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },

  inlineAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineAddButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },

  toggleQuickAddBtn: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.sm,
  },
  toggleQuickAddText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },

  infoBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  infoList: {
    marginTop: spacing.sm,
    gap: 4,
  },
  infoItem: {
    fontSize: 12,
    color: colors.textPrimary,
  },
});