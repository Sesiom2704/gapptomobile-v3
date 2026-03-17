/**
 * Ruta: mobile_app/screens/Alquiler/ContratoListScreen.tsx
 * Versión: 4.1.0
 * Descripción:
 * Pantalla mixta de contratos e incidencias del módulo de alquiler.
 *
 * Funcionalidades incluidas:
 * - Mantiene listado global de contratos.
 * - Añade navegación por pestañas internas: contratos / incidencias.
 * - Reutiliza buscador avanzado y patrón visual existente.
 * - Permite listar incidencias activas del gestor.
 * - Permite listar incidencias vinculadas a un contrato seleccionado.
 * - Mantiene acciones existentes del contrato.
 * - Añade navegación al detalle de incidencia.
 *
 * Notas de diseño:
 * - Se reutilizan Header, ExpenseCard, ActionSheet y listStyles actuales.
 * - No se rompe la lógica actual de contratos.
 * - gestorPersonaId se recibe de route.params de forma provisional hasta confirmar el origen real del dato en app.
 * - La pestaña incidencias permite dos vistas:
 *   - Activas del gestor
 *   - Por contrato seleccionado
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Header from '../../components/layout/Header';
import { FilterPill } from '../../components/ui/FilterPill';
import { TwoLineCompactPill } from '../../components/ui/TwoLineCompactPill';
import { ExpenseCard } from '../../components/cards/ExpenseCard';
import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import { listStyles as styles } from '../../components/list/listStyles';

import { colors } from '../../theme';
import { EuroformatEuro, formatFechaCorta } from '../../utils/format';

import {
  listContratos,
  inactivateContrato,
  getObjetoAlquilerLabel,
  getContratoDisplayTenantName,
  type ContratoRow,
} from '../../services/gestionAlquilerApi';

import {
  listIncidenciasActivas,
  listIncidenciasByContrato,
  getIncidenciaDisplaySubtitle,
  getIncidenciaEstadoColorToken,
  type IncidenciaListItem,
} from '../../services/gestionIncidenciasApi';

type Props = {
  navigation: any;
};

type EstadoFiltro =
  | 'todos'
  | 'activos'
  | 'inactivos'
  | 'activo'
  | 'pendiente'
  | 'finalizado'
  | 'cancelado';

type VigenciaFiltro = 'todos' | 'vigentes' | 'vencidos';

type ObjetoFiltro =
  | 'todos'
  | 'completo'
  | 'vivienda'
  | 'garaje'
  | 'trastero'
  | 'habitaciones';

type TabKey = 'contratos' | 'incidencias';
type IncidenciaScope = 'activas' | 'contrato';

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function sameOrBeforeToday(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const value = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return value.getTime() <= today.getTime();
}

function isAfterToday(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const value = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return value.getTime() > today.getTime();
}

function isContratoActivoRegla3(contrato: ContratoRow): boolean {
  const estadoOk = normalizeText(contrato.estado) === 'activo';
  const notInactivated = !contrato.inactivatedon;
  const started = sameOrBeforeToday(contrato.fecha_inicio);
  const notEnded = !contrato.fecha_fin || isAfterToday(contrato.fecha_fin);

  return estadoOk && notInactivated && started && notEnded;
}

function isContratoVencido(contrato: ContratoRow): boolean {
  if (contrato.inactivatedon) return true;
  if (!contrato.fecha_fin) return false;
  return !isAfterToday(contrato.fecha_fin);
}

function getContratoReferenciaLabel(contrato: ContratoRow): string {
  const ref = String(contrato.referencia_vivienda ?? '').trim();
  if (ref) return ref;
  return contrato.id;
}

function getContratoObjetoAgrupado(code?: string | null): ObjetoFiltro {
  const c = normalizeText(code);

  if (c === 'completa') return 'completo';
  if (c.startsWith('habitacion_')) return 'habitaciones';

  if (
    c === 'vivienda' ||
    c === 'vivienda_garaje' ||
    c === 'vivienda_trastero'
  ) {
    return 'vivienda';
  }

  if (c === 'garaje' || c === 'garaje_trastero' || c === 'vivienda_garaje') {
    return 'garaje';
  }

  if (c === 'trastero' || c === 'garaje_trastero' || c === 'vivienda_trastero') {
    return 'trastero';
  }

  return 'todos';
}

function formatEstadoContrato(contrato: ContratoRow): string {
  if (contrato.inactivatedon) return 'Inactivo';

  const e = normalizeText(contrato.estado);
  if (e === 'activo') return 'Activo';
  if (e === 'pendiente') return 'Pendiente';
  if (e === 'finalizado') return 'Finalizado';
  if (e === 'cancelado') return 'Cancelado';

  return contrato.estado ? String(contrato.estado) : 'Sin estado';
} 

export const ContratoListScreen: React.FC<Props> = ({ navigation }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('contratos');

  const [contratos, setContratos] = useState<ContratoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedContrato, setSelectedContrato] = useState<ContratoRow | null>(null);

  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [searchText, setSearchText] = useState('');

  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>('todos');
  const [filtroVigencia, setFiltroVigencia] = useState<VigenciaFiltro>('todos');
  const [filtroPropiedad, setFiltroPropiedad] = useState<string>('todos');
  const [filtroObjeto, setFiltroObjeto] = useState<ObjetoFiltro>('todos');

  const [showEstadoFilter, setShowEstadoFilter] = useState(false);
  const [showVigenciaFilter, setShowVigenciaFilter] = useState(false);
  const [showPropiedadFilter, setShowPropiedadFilter] = useState(false);
  const [showObjetoFilter, setShowObjetoFilter] = useState(false);

  const [incidencias, setIncidencias] = useState<IncidenciaListItem[]>([]);
  const [incidenciasLoading, setIncidenciasLoading] = useState(false);
  const [incidenciasError, setIncidenciasError] = useState<string | null>(null);
  const [incidenciaScope, setIncidenciaScope] = useState<IncidenciaScope>('activas');
  const [selectedContratoIncidenciasId, setSelectedContratoIncidenciasId] = useState<string>('todos');
  const [incidenciaSearchText, setIncidenciaSearchText] = useState('');

  const closeBuscador = useCallback(() => {
    Keyboard.dismiss();
    setBuscadorAbierto(false);
  }, []);

  const cargarContratos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await listContratos();

      const ordenados = [...(Array.isArray(data) ? data : [])].sort((a, b) => {
        const aInicio = String(a.fecha_inicio ?? '');
        const bInicio = String(b.fecha_inicio ?? '');

        if (aInicio !== bInicio) return bInicio.localeCompare(aInicio);

        const aCreate = String(a.createon ?? '');
        const bCreate = String(b.createon ?? '');

        return bCreate.localeCompare(aCreate);
      });

      setContratos(ordenados);
    } catch (err) {
      console.error('[ContratoList] Error cargando contratos', err);
      setError('No se han podido cargar los contratos. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const cargarIncidencias = useCallback(async () => {
    setIncidenciasLoading(true);
    setIncidenciasError(null);

    try {
      if (incidenciaScope === 'activas') {
        const data = await listIncidenciasActivas();
        setIncidencias(data);
        return;
      }

      if (selectedContratoIncidenciasId === 'todos') {
        setIncidencias([]);
        return;
      }

      const data = await listIncidenciasByContrato(selectedContratoIncidenciasId);
      setIncidencias(data);
    } catch (err) {
      console.error('[ContratoList] Error cargando incidencias', err);
      setIncidenciasError('No se han podido cargar las incidencias. Inténtalo de nuevo.');
    } finally {
      setIncidenciasLoading(false);
      setRefreshing(false);
    }
  }, [incidenciaScope, selectedContratoIncidenciasId]);

  useFocusEffect(
    useCallback(() => {
      void cargarContratos();
    }, [cargarContratos])
  );

  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'incidencias') {
        void cargarIncidencias();
      }
    }, [activeTab, cargarIncidencias])
  );

  const handleRefresh = async () => {
    setRefreshing(true);

    if (activeTab === 'contratos') {
      await cargarContratos();
      return;
    }

    await cargarIncidencias();
  };

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('PatrimonyTab', {
      screen: 'PatrimonyHomeScreen',
    });
  }, [navigation]);

  const handleEliminar = useCallback(
    async (contrato: ContratoRow) => {
      try {
        await inactivateContrato(contrato.id, { estadoCancelado: true });
        await cargarContratos();
      } catch (err) {
        console.error('[ContratoList] Error desactivando contrato', err);
        Alert.alert('Error', 'No se ha podido desactivar el contrato.');
      }
    },
    [cargarContratos]
  );

  const confirmarEliminar = useCallback(
    (contrato: ContratoRow) => {
      Alert.alert(
        'Eliminar contrato',
        `¿Quieres desactivar el contrato "${getContratoReferenciaLabel(contrato)}"?\n\nNo se eliminará físicamente. Se marcará como inactivo.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar contrato',
            style: 'destructive',
            onPress: () => void handleEliminar(contrato),
          },
        ]
      );
    },
    [handleEliminar]
  );

  const abrirMenuContrato = (contrato: ContratoRow) => {
    setSelectedContrato(contrato);
    setSheetVisible(true);
  };

  const getActionsForContrato = (contrato: ContratoRow | null): ActionSheetAction[] => {
    if (!contrato) return [];

    const rojo = colors.actionDanger ?? '#b91c1c';
    const amarillo = colors.actionWarning ?? '#eab308';
    const gris = colors.actionNeutral ?? '#4b5563';

    return [
      {
        label: 'Editar contrato',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('ContratoCreate', {
            patrimonioId: contrato.patrimonio_id,
            contrato,
            returnToScreen: 'ContratoList',
          });
        },
        iconName: 'create-outline',
        color: amarillo,
      },
      {
        label: 'Ver detalle',
        onPress: () => {
          setSheetVisible(false);
          navigation.navigate('ContratoDetalle', {
            patrimonioId: contrato.patrimonio_id,
            contratoId: contrato.id,
            contrato,
          });
        },
        iconName: 'information-circle-outline',
        color: gris,
      },
      {
        label: 'Eliminar contrato',
        onPress: () => {
          setSheetVisible(false);
          confirmarEliminar(contrato);
        },
        iconName: 'trash-outline',
        color: rojo,
        destructive: true,
      },
    ];
  };

  const accionesSheet = getActionsForContrato(selectedContrato);

  const resumenActivos = useMemo(() => {
    const activos = contratos.filter(isContratoActivoRegla3);
    const total = activos.reduce((acc, item) => acc + Number(item.renta_mensual ?? 0), 0);

    return {
      cantidad: activos.length,
      rentaMensual: total,
    };
  }, [contratos]);

  const propiedadesDisponibles = useMemo(() => {
    const map = new Map<string, string>();

    contratos.forEach((contrato) => {
      const ref = getContratoReferenciaLabel(contrato);
      const id = String(contrato.patrimonio_id ?? '').trim();
      if (!id) return;
      map.set(id, ref || id);
    });

    return Array.from(map.entries())
      .map(([id, referencia]) => ({ id, referencia }))
      .sort((a, b) => a.referencia.localeCompare(b.referencia, 'es'));
  }, [contratos]);

  const contratosFiltrados = useMemo(() => {
    const term = normalizeText(searchText);

    return contratos.filter((contrato) => {
      const tenant = normalizeText(getContratoDisplayTenantName(contrato));
      const referencia = normalizeText(contrato.referencia_vivienda);
      const contratoId = normalizeText(contrato.id);
      const objetoLabel = normalizeText(getObjetoAlquilerLabel(contrato.objeto_alquiler));
      const estado = normalizeText(contrato.estado);

      if (term.length > 0) {
        const match =
          referencia.includes(term) ||
          tenant.includes(term) ||
          contratoId.includes(term) ||
          objetoLabel.includes(term);

        if (!match) return false;
      }

      if (filtroEstado !== 'todos') {
        if (filtroEstado === 'activos') {
          if (!isContratoActivoRegla3(contrato)) return false;
        } else if (filtroEstado === 'inactivos') {
          if (isContratoActivoRegla3(contrato)) return false;
        } else if (filtroEstado === 'cancelado') {
          if (estado !== 'cancelado') return false;
        } else if (filtroEstado === 'finalizado') {
          if (estado !== 'finalizado') return false;
        } else if (filtroEstado === 'pendiente') {
          if (estado !== 'pendiente') return false;
        } else if (filtroEstado === 'activo') {
          if (estado !== 'activo') return false;
        }
      }

      if (filtroVigencia !== 'todos') {
        const vencido = isContratoVencido(contrato);

        if (filtroVigencia === 'vigentes' && vencido) return false;
        if (filtroVigencia === 'vencidos' && !vencido) return false;
      }

      if (filtroPropiedad !== 'todos') {
        if (String(contrato.patrimonio_id ?? '') !== String(filtroPropiedad)) return false;
      }

      if (filtroObjeto !== 'todos') {
        const agrupado = getContratoObjetoAgrupado(contrato.objeto_alquiler);
        if (agrupado !== filtroObjeto) return false;
      }

      return true;
    });
  }, [contratos, searchText, filtroEstado, filtroVigencia, filtroPropiedad, filtroObjeto]);

  const incidenciasFiltradas = useMemo(() => {
    const term = normalizeText(incidenciaSearchText);

    return incidencias.filter((item) => {
      if (!term) return true;

      const hayMatch =
        normalizeText(item.codigo).includes(term) ||
        normalizeText(item.titulo).includes(term) ||
        normalizeText(item.estado_label).includes(term) ||
        normalizeText(item.categoria).includes(term) ||
        normalizeText(item.proveedor_actual_nombre).includes(term) ||
        normalizeText(item.localidad).includes(term);

      return hayMatch;
    });
  }, [incidencias, incidenciaSearchText]);

  const renderTabs = () => {
    const baseTabStyle = {
      flex: 1 as const,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: colors.border,
    };

    return (
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 6,
          }}
        >
          <TouchableOpacity
            style={[
              baseTabStyle,
              activeTab === 'contratos'
                ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
                : { backgroundColor: colors.surface },
            ]}
            onPress={() => setActiveTab('contratos')}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: activeTab === 'contratos' ? colors.primary : colors.textSecondary,
              }}
            >
              Contratos
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              baseTabStyle,
              activeTab === 'incidencias'
                ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
                : { backgroundColor: colors.surface },
            ]}
            onPress={() => setActiveTab('incidencias')}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: activeTab === 'incidencias' ? colors.primary : colors.textSecondary,
              }}
            >
              Incidencias
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBuscadorContratos = () => {
    return (
      <View style={styles.searchPanel}>
        <Text style={styles.searchLabel}>Buscar</Text>

        <View style={styles.searchRow}>
          <Ionicons
            name="search-outline"
            size={16}
            color={colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Referencia, inquilino, contrato…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Estado</Text>
            <TouchableOpacity
              onPress={() => setShowEstadoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showEstadoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showEstadoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showEstadoFilter && (
            <View style={styles.pillsRow}>
              {[
                { label: 'Todos', value: 'todos' },
                { label: 'Activos', value: 'activos' },
                { label: 'Inactivos', value: 'inactivos' },
                { label: 'Activo', value: 'activo' },
                { label: 'Pendiente', value: 'pendiente' },
                { label: 'Finalizado', value: 'finalizado' },
                { label: 'Cancelado', value: 'cancelado' },
              ].map((item) => (
                <View style={styles.pillWrapper} key={item.value}>
                  <FilterPill
                    label={item.label}
                    selected={filtroEstado === (item.value as EstadoFiltro)}
                    onPress={() =>
                      setFiltroEstado((prev) =>
                        prev === item.value ? 'todos' : (item.value as EstadoFiltro)
                      )
                    }
                    style={styles.filterPill}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Vigencia</Text>
            <TouchableOpacity
              onPress={() => setShowVigenciaFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showVigenciaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showVigenciaFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showVigenciaFilter && (
            <View style={styles.pillsRow}>
              {[
                { label: 'Todos', value: 'todos' },
                { label: 'Vigentes', value: 'vigentes' },
                { label: 'Vencidos', value: 'vencidos' },
              ].map((item) => (
                <View style={styles.pillWrapper} key={item.value}>
                  <FilterPill
                    label={item.label}
                    selected={filtroVigencia === (item.value as VigenciaFiltro)}
                    onPress={() =>
                      setFiltroVigencia((prev) =>
                        prev === item.value ? 'todos' : (item.value as VigenciaFiltro)
                      )
                    }
                    style={styles.filterPill}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {propiedadesDisponibles.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={styles.searchLabel}>Propiedad</Text>
              <TouchableOpacity
                onPress={() => setShowPropiedadFilter((prev) => !prev)}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons
                  name={showPropiedadFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {showPropiedadFilter ? 'Ocultar' : 'Mostrar'}
                </Text>
              </TouchableOpacity>
            </View>

            {showPropiedadFilter && (
              <View style={styles.pillsRowWrap}>
                <View style={styles.pillWrapper}>
                  <TwoLineCompactPill
                    label="Todas"
                    selected={filtroPropiedad === 'todos'}
                    onPress={() => setFiltroPropiedad('todos')}
                    style={styles.filterPill}
                  />
                </View>

                {propiedadesDisponibles.map((item) => {
                  const selected = filtroPropiedad === item.id;
                  return (
                    <View style={styles.pillWrapper} key={item.id}>
                      <TwoLineCompactPill
                        label={item.referencia}
                        selected={selected}
                        onPress={() => setFiltroPropiedad(selected ? 'todos' : item.id)}
                        style={styles.filterPill}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.searchLabel}>Objeto alquilado</Text>
            <TouchableOpacity
              onPress={() => setShowObjetoFilter((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons
                name={showObjetoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {showObjetoFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showObjetoFilter && (
            <View style={styles.pillsRow}>
              {[
                { label: 'Todos', value: 'todos' },
                { label: 'Completo', value: 'completo' },
                { label: 'Vivienda', value: 'vivienda' },
                { label: 'Garaje', value: 'garaje' },
                { label: 'Trastero', value: 'trastero' },
                { label: 'Habitaciones', value: 'habitaciones' },
              ].map((item) => (
                <View style={styles.pillWrapper} key={item.value}>
                  <FilterPill
                    label={item.label}
                    selected={filtroObjeto === (item.value as ObjetoFiltro)}
                    onPress={() =>
                      setFiltroObjeto((prev) =>
                        prev === item.value ? 'todos' : (item.value as ObjetoFiltro)
                      )
                    }
                    style={styles.filterPill}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderBuscadorIncidencias = () => {
    const contratosActivos = contratos.filter(isContratoActivoRegla3);

    return (
      <View style={styles.searchPanel}>
        <Text style={styles.searchLabel}>Buscar incidencias</Text>

        <View style={styles.searchRow}>
          <Ionicons
            name="search-outline"
            size={16}
            color={colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            value={incidenciaSearchText}
            onChangeText={setIncidenciaSearchText}
            placeholder="Código, título, estado, proveedor…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        <View style={{ marginTop: 8 }}>
          <Text style={styles.searchLabel}>Ámbito</Text>

          <View style={styles.pillsRow}>
            <View style={styles.pillWrapper}>
              <FilterPill
                label="Activas"
                selected={incidenciaScope === 'activas'}
                onPress={() => {
                  setIncidenciaScope('activas');
                  setSelectedContratoIncidenciasId('todos');
                }}
                style={styles.filterPill}
              />
            </View>

            <View style={styles.pillWrapper}>
              <FilterPill
                label="Por contrato"
                selected={incidenciaScope === 'contrato'}
                onPress={() => setIncidenciaScope('contrato')}
                style={styles.filterPill}
              />
            </View>
          </View>
        </View>

        {incidenciaScope === 'contrato' && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.searchLabel}>Contrato</Text>

            <View style={styles.pillsRowWrap}>
              <View style={styles.pillWrapper}>
                <TwoLineCompactPill
                  label="Seleccionar"
                  selected={selectedContratoIncidenciasId === 'todos'}
                  onPress={() => setSelectedContratoIncidenciasId('todos')}
                  style={styles.filterPill}
                />
              </View>

              {contratosActivos.map((contrato) => {
                const referencia = getContratoReferenciaLabel(contrato);
                const selected = selectedContratoIncidenciasId === contrato.id;

                return (
                  <View style={styles.pillWrapper} key={contrato.id}>
                    <TwoLineCompactPill
                      label={referencia}
                      selected={selected}
                      onPress={() => setSelectedContratoIncidenciasId(selected ? 'todos' : contrato.id)}
                      style={styles.filterPill}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={() => void cargarIncidencias()}
          style={{
            marginTop: 12,
            alignSelf: 'flex-start',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
            Actualizar incidencias
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderContenidoContratos = () => {
    if (loading && contratos.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando contratos…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (contratosFiltrados.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No hay contratos que coincidan con el filtro.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onScrollBeginDrag={closeBuscador}
        onTouchStart={() => {
          if (buscadorAbierto) closeBuscador();
        }}
      >
        {contratosFiltrados.map((contrato) => {
          const referencia = getContratoReferenciaLabel(contrato);
          const tenant = getContratoDisplayTenantName(contrato);
          const objeto = getObjetoAlquilerLabel(contrato.objeto_alquiler);
          const estadoLabel = formatEstadoContrato(contrato);

          const category = tenant
            ? `${tenant} · ${objeto} · ${estadoLabel}`
            : `${objeto} · ${estadoLabel}`;

          const inicio = contrato.fecha_inicio ? formatFechaCorta(contrato.fecha_inicio) : '—';
          const fin = contrato.fecha_fin ? formatFechaCorta(contrato.fecha_fin) : 'Sin fin';
          const dateLabel = `Del ${inicio} al ${fin}`;

          return (
            <ExpenseCard
              key={contrato.id}
              title={referencia}
              category={category}
              dateLabel={dateLabel}
              amountLabel={
                contrato.renta_mensual != null
                  ? `${EuroformatEuro(contrato.renta_mensual)} / mes`
                  : 'Renta no informada'
              }
              segmentoId="INGRESO"
              inactive={!isContratoActivoRegla3(contrato)}
              onOptionsPress={() => abrirMenuContrato(contrato)}
              onPress={() =>
                navigation.navigate('ContratoDetalle', {
                  patrimonioId: contrato.patrimonio_id,
                  contratoId: contrato.id,
                  contrato,
                })
              }
            />
          );
        })}
      </ScrollView>
    );
  };

  const renderContenidoIncidencias = () => {
    if (incidenciasLoading && incidencias.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando incidencias…</Text>
        </View>
      );
    }

    if (incidenciasError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{incidenciasError}</Text>
        </View>
      );
    }

    if (incidenciaScope === 'contrato' && selectedContratoIncidenciasId === 'todos') {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            Selecciona un contrato para ver sus incidencias.
          </Text>
        </View>
      );
    }

    if (incidenciasFiltradas.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No hay incidencias que coincidan con el filtro.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onScrollBeginDrag={closeBuscador}
        onTouchStart={() => {
          if (buscadorAbierto) closeBuscador();
        }}
      >
        {incidenciasFiltradas.map((item) => {
          const subtitle = getIncidenciaDisplaySubtitle(item);
          const fechaLabel = item.fecha_creacion
            ? `Alta: ${formatFechaCorta(item.fecha_creacion)}`
            : 'Fecha no informada';

          return (
            <ExpenseCard
              key={item.id}
              title={item.codigo || item.titulo || item.id}
              category={subtitle || item.titulo || 'Incidencia'}
              dateLabel={fechaLabel}
              amountLabel={item.prioridad_label || 'Sin prioridad'}
              segmentoId="GEST-RESTO"
              iconNameOverride="construct-outline"
              backgroundColor={colors.surface}
              onPress={() =>
                navigation.navigate('IncidenciaDetalle', {
                  incidenciaId: item.id,
                  contratoId: item.contrato_id,
                  patrimonioId: item.patrimonio_id,
                  incidencia: item,
                })
              }
              onOptionsPress={() =>
                navigation.navigate('IncidenciaDetalle', {
                  incidenciaId: item.id,
                  contratoId: item.contrato_id,
                  patrimonioId: item.patrimonio_id,
                  incidencia: item,
                })
              }
            />
          );
        })}
      </ScrollView>
    );
  };

  return (
    <>
      <Header
        title="Contratos e incidencias"
        subtitle="Gestión global de contratos e incidencias de alquiler."
        showBack
        onBackPress={handleBack}
      />

      <View style={styles.screen}>
        {renderTabs()}

        {activeTab === 'contratos' && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
              }}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700' }}>
                  Contratos activos
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 18,
                    fontWeight: '900',
                    color: colors.textPrimary,
                  }}
                >
                  {resumenActivos.cantidad}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700' }}>
                  Ingreso mensual activo
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 4,
                    fontSize: 16,
                    fontWeight: '900',
                    color: colors.textPrimary,
                  }}
                >
                  {EuroformatEuro(resumenActivos.rentaMensual)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'incidencias' && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
              }}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700' }}>
                  Ámbito
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 16,
                    fontWeight: '900',
                    color: colors.textPrimary,
                  }}
                >
                  {incidenciaScope === 'activas' ? 'Activas' : 'Por contrato'}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700' }}>
                  Cargadas
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 18,
                    fontWeight: '900',
                    color: colors.textPrimary,
                  }}
                >
                  {incidenciasFiltradas.length}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.middleArea}>
          <TouchableOpacity
            style={styles.searchToggle}
            onPress={() => setBuscadorAbierto((prev) => !prev)}
          >
            <Ionicons
              name={buscadorAbierto ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.searchToggleText}>Buscador avanzado</Text>
          </TouchableOpacity>

          {buscadorAbierto && (
            <View style={{ maxHeight: 360 }}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {activeTab === 'contratos' ? renderBuscadorContratos() : renderBuscadorIncidencias()}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.bottomArea}>
          {activeTab === 'contratos' ? renderContenidoContratos() : renderContenidoIncidencias()}
        </View>

        <ActionSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          title="Acciones sobre el contrato"
          actions={accionesSheet}
        />
      </View>
    </>
  );
};

export default ContratoListScreen;