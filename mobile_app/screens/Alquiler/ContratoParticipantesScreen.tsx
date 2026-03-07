/**
 * Archivo: mobile_app/screens/Alquiler/ContratoParticipantesScreen.tsx
 *
 * Participantes de contrato de alquiler (v2)
 *
 * Objetivo de esta versión:
 * - Mantener la pantalla de gestión de participantes del contrato.
 * - Conectar la carga y gestión real con backend.
 * - Mantener coherencia visual con ContratoCreateScreen y ContratoDetalleScreen.
 *
 * Cambios incluidos:
 * - Carga real de participantes desde backend.
 * - Alta rápida real:
 *     1) crea persona
 *     2) crea relación contrato-persona
 * - Eliminación real de participante.
 * - Refresh real.
 * - Soporte de transición suave si llegan participantes por navegación.
 *
 * Próximo paso previsto:
 * - Añadir selector/buscador de personas existentes.
 * - Añadir edición real de participante.
 * - Añadir acceso al maestro global de personas.
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
import { commonFormStyles } from '../../components/forms/formStyles';

import { colors } from '../../theme';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

import {
  listContratoParticipantes,
  createContratoParticipante,
  deleteContratoParticipante,
  createPersona,
  type ContratoParticipanteRow,
  type RolParticipante,
} from '../../services/gestionAlquilerApi';

type ParticipanteItem = {
  id: string;
  nombre: string;
  rol: RolParticipante;
  es_principal: boolean;
  telefono?: string | null;
  email?: string | null;
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
    origen: 'backend',
  };
}

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
  const [err, setErr] = useState<string | null>(null);

  const [participantes, setParticipantes] = useState<ParticipanteItem[]>(initialRouteParticipantes);

  // -------------------------
  // Formulario de alta rápida
  // -------------------------
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolParticipante>('inquilino');
  const [esPrincipal, setEsPrincipal] = useState(false);

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
  };

  const getSnapshot = useCallback((): Snapshot => {
    return {
      participantes,
      nombre,
      telefono,
      email,
      rol,
      esPrincipal,
    };
  }, [participantes, nombre, telefono, email, rol, esPrincipal]);

  const baselineRef = useRef<Snapshot>({
    participantes: initialRouteParticipantes,
    nombre: '',
    telefono: '',
    email: '',
    rol: 'inquilino',
    esPrincipal: false,
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
  // Carga real
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

  useEffect(() => {
    void loadParticipantes(false);
  }, [loadParticipantes]);

  const onRefresh = () => {
    void loadParticipantes(true);
  };

  // -------------------------
  // Alta rápida real
  // -------------------------
  const resetLocalForm = useCallback(() => {
    setNombre('');
    setTelefono('');
    setEmail('');
    setRol('inquilino');
    setEsPrincipal(false);
  }, []);

  const handleAddParticipante = async () => {
    if (!nombre.trim()) {
      Alert.alert('Campo obligatorio', 'El nombre del participante es obligatorio.');
      return;
    }

    if (esPrincipal && rol !== 'inquilino') {
      Alert.alert('Validación', 'Solo un inquilino puede marcarse como principal.');
      return;
    }

    setSaving(true);

    try {
      const persona = await createPersona({
        nombre_completo: nombre.trim(),
        telefono: telefono.trim() || null,
        email: email.trim() || null,
      });

      await createContratoParticipante(contratoId, {
        persona_id: persona.id,
        rol,
        es_principal: esPrincipal,
        observaciones: null,
      });

      resetLocalForm();
      await loadParticipantes(true);
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        'No se pudo añadir el participante.';
      Alert.alert('Error', String(detail));
    } finally {
      setSaving(false);
    }
  };

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
              await loadParticipantes(true);
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
  }, [loadParticipantes]);

  const handleOpenCreatePersona = useCallback(() => {
    Alert.alert(
      'Alta rápida de persona',
      'En esta versión, al añadir participante se crea primero la persona y después se vincula automáticamente al contrato.'
    );
  }, []);

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
              {participantesOrdenados.map((item) => (
                <View key={item.id} style={stylesLocal.participantCard}>
                  <View style={stylesLocal.participantHeader}>
                    <View style={stylesLocal.participantHeaderLeft}>
                      <Text style={stylesLocal.participantName}>{item.nombre}</Text>

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
                    </View>

                    <TouchableOpacity
                      onPress={() => handleRemoveParticipante(item.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
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
                </View>
              ))}
            </View>
          )}
        </FormSection>

        <FormSection title="Añadir participante">
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Nombre completo</Text>

              <TouchableOpacity
                onPress={handleOpenCreatePersona}
                style={stylesLocal.inlineAddButton}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                <Text style={stylesLocal.inlineAddButtonText}>Alta rápida</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              value={nombre}
              onChangeText={setNombre}
              placeholder="Ej: Juan Pérez García"
              style={[styles.input, nombre.trim() !== '' && styles.inputFilled]}
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
                style={[styles.input, telefono.trim() !== '' && styles.inputFilled]}
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
                style={[styles.input, email.trim() !== '' && styles.inputFilled]}
              />
            </View>
          </View>

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
        </FormSection>

        <FormSection title="Siguiente paso">
          <View style={stylesLocal.infoBox}>
            <View style={stylesLocal.infoRow}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={stylesLocal.infoTitle}>Evolución prevista</Text>
            </View>

            <Text style={styles.helperText}>
              En el siguiente paso podemos añadir:
            </Text>

            <View style={stylesLocal.infoList}>
              <Text style={stylesLocal.infoItem}>• selector de personas existentes</Text>
              <Text style={stylesLocal.infoItem}>• edición de participante</Text>
              <Text style={stylesLocal.infoItem}>• acceso al maestro global de personas</Text>
              <Text style={stylesLocal.infoItem}>• filtros y buscador</Text>
            </View>
          </View>
        </FormSection>

        <View style={{ marginTop: 12 }}>
          <FormActionButton
            label="Confirmar pantalla"
            onPress={handleSaveVisual}
            iconName="save-outline"
            variant="primary"
          />
        </View>
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