/**
 * Ruta: mobile_app/screens/Alquiler/ContratoListScreen.tsx
 * Versión: 5.0.0
 * Descripción:
 * Pantalla mixta de contratos e incidencias para GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Pestañas internas en el mismo screen:
 *   - Contratos
 *   - Incidencias
 * - Listado global de contratos.
 * - Listado global de incidencias activas visibles para el usuario autenticado.
 * - Buscador avanzado independiente por pestaña.
 * - Resumen superior de contratos activos:
 *   - número de contratos activos
 *   - suma de renta mensual activa
 * - Coloreado semáforo para incidencias:
 *   - rojo
 *   - amarillo
 *   - verde
 *
 * Reglas funcionales:
 * - "Activo" en contratos se calcula con la Regla 3:
 *   - estado = activo
 *   - inactivatedon vacío
 *   - fecha_inicio <= hoy
 *   - fecha_fin vacía o futura
 *
 * Notas de diseño:
 * - Se mantiene navegación actual de contratos.
 * - Incidencias se integran en el mismo screen sin rehacer navegación global.
 * - El color de incidencias se agrupa en 3 estados visuales para simplificar lectura.
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
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Header from '../../components/layout/Header';
import { Chip } from '../../components/ui/Chip';
import { FilterPill } from '../../components/ui/FilterPill';
import { TwoLineCompactPill } from '../../components/ui/TwoLineCompactPill';
import { FilterRow } from '../../components/ui/FilterRow';
import { ExpenseCard } from '../../components/cards/ExpenseCard';
import { ActionSheet, ActionSheetAction } from '../../components/modals/ActionSheet';
import { listStyles as styles } from '../../components/list/listStyles';

import { colors, spacing, radius } from '../../theme';
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
  getIncidenciaEstadoColorToken,
  getIncidenciaDisplaySubtitle,
  type IncidenciaListItem,
} from '../../services/gestionIncidenciasApi';

type Props = {
  navigation: any;
  route?: {
    params?: {
      gestorPersonaId?: string;
    };
  };
};

type TabValue = 'contratos' | 'incidencias';

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

type IncidenciaColorGroup = 'red' | 'yellow' | 'green' | 'all';

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

function getIncidenciaColorGroup(estado?: string | null): IncidenciaColorGroup {
  const value = normalizeText(estado);

  const redStates = new Set([
    'new',
    'awaiting_provider_assignment',
    'tenant_reschedule_requested',
    'awaiting_parts',
    'pending_follow_up',
    'cancelled',
  ]);

  const yellowStates = new Set([
    'under_review',
    'awaiting_quote',
    'quote_submitted',
    'quote_approved',
    'scheduled',
    'in_progress',
  ]);

  const greenStates = new Set([
    'tenant_confirmed',
    'resolved',
    'closed',
  ]);

  if (redStates.has(value)) return 'red';
  if (yellowStates.has(value)) return 'yellow';
  if (greenStates.has(value)) return 'green';
  return 'all';
}

function getIncidenciaCardBackground(estado?: string | null): string {
  const group = getIncidenciaColorGroup(estado);
  if (group === 'red') return colors.dangerSoft;
  if (group === 'yellow') return colors.warningSoft;
  if (group === 'green') return colors.successSoft;
  return colors.surface;
}

export const ContratoListScreen: React.FC<Props> = ({ navigation }) => {
  const [tab, setTab] = useState<TabValue>('contratos');

  const [contratos, setContratos] = useState<ContratoRow[]>([]);
  const [contratosLoading, setContratosLoading] = useState(false);
  const [contratosError, setContratosError] = useState<string | null>(null);

  const [incidencias, setIncidencias] = useState<IncidenciaListItem[]>([]);
  const [incidenciasLoading, setIncidenciasLoading] = useState(false);
  const [incidenciasError, setIncidenciasError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedContrato, setSelectedContrato] = useState<ContratoRow | null>(null);

  const [buscadorAbierto, setBuscadorAbierto] = useState(false);

  // =========================
  // CONTRATOS: filtros
  // =========================
  const [searchText, setSearchText] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>('todos');
  const [filtroVigencia, setFiltroVigencia] = useState<VigenciaFiltro>('todos');
  const [filtroPropiedad, setFiltroPropiedad] = useState<string>('todos');
  const [filtroObjeto, setFiltroObjeto] = useState<ObjetoFiltro>('todos');

  const [showEstadoFilter, setShowEstadoFilter] = useState(false);
  const [showVigenciaFilter, setShowVigenciaFilter] = useState(false);
  const [showPropiedadFilter, setShowPropiedadFilter] = useState(false);
  const [showObjetoFilter, setShowObjetoFilter] = useState(false);

  // =========================
  // INCIDENCIAS: filtros
  // =========================
  const [incSearchText, setIncSearchText] = useState('');
  const [incColorFilter, setIncColorFilter] = useState<IncidenciaColorGroup>('all');
  const [incCategoriaFilter, setIncCategoriaFilter] = useState<string>('todos');

  const [showIncColorFilter, setShowIncColorFilter] = useState(false);
  const [showIncCategoriaFilter, setShowIncCategoriaFilter] = useState(false);

  const closeBuscador = useCallback(() => {
    Keyboard.dismiss();
    setBuscadorAbierto(false);
  }, []);

  const cargarContratos = useCallback(async () => {
    setContratosLoading(true);
    setContratosError(null);

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
      setContratosError('No se han podido cargar los contratos.');
    } finally {
      setContratosLoading(false);
    }
  }, []);

  const cargarIncidencias = useCallback(async () => {
    setIncidenciasLoading(true);
    setIncidenciasError(null);

    try {
      const data = await listIncidenciasActivas();
      setIncidencias(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[ContratoList] Error cargando incidencias', err);
      setIncidenciasError('No se han podido cargar las incidencias.');
    } finally {
      setIncidenciasLoading(false);
    }
  }, []);

  const cargarTodo = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([cargarContratos(), cargarIncidencias()]);
    } finally {
      setRefreshing(false);
    }
  }, [cargarContratos, cargarIncidencias]);

  useFocusEffect(
    useCallback(() => {
      void cargarTodo();
    }, [cargarTodo])
  );

  const handleRefresh = async () => {
    await cargarTodo();
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

  const incidenciasCategoriasDisponibles = useMemo(() => {
    const map = new Map<string, string>();

    incidencias.forEach((item) => {
      const key = String(item.categoria ?? '').trim();
      if (!key) return;
      map.set(key, key);
    });

    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'es'));
  }, [incidencias]);

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
    const term = normalizeText(incSearchText);

    return incidencias.filter((item) => {
      const hayTexto =
        normalizeText(item.codigo).includes(term) ||
        normalizeText(item.titulo).includes(term) ||
        normalizeText(item.categoria).includes(term) ||
        normalizeText(item.estado_label).includes(term) ||
        normalizeText(item.proveedor_actual_nombre).includes(term) ||
        normalizeText(item.gestor_actual_nombre).includes(term) ||
        normalizeText(item.localidad).includes(term);

      if (term.length > 0 && !hayTexto) return false;

      if (incColorFilter !== 'all') {
        if (getIncidenciaColorGroup(item.estado) !== incColorFilter) return false;
      }

      if (incCategoriaFilter !== 'todos') {
        if (normalizeText(item.categoria) !== normalizeText(incCategoriaFilter)) return false;
      }

      return true;
    });
  }, [incidencias, incSearchText, incColorFilter, incCategoriaFilter]);

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
          <View style={localStyles.filterHeaderRow}>
            <Text style={styles.searchLabel}>Estado</Text>
            <TouchableOpacity
              onPress={() => setShowEstadoFilter((prev) => !prev)}
              style={localStyles.filterHeaderAction}
            >
              <Ionicons
                name={showEstadoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={localStyles.filterHeaderActionText}>
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
          <View style={localStyles.filterHeaderRow}>
            <Text style={styles.searchLabel}>Vigencia</Text>
            <TouchableOpacity
              onPress={() => setShowVigenciaFilter((prev) => !prev)}
              style={localStyles.filterHeaderAction}
            >
              <Ionicons
                name={showVigenciaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={localStyles.filterHeaderActionText}>
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
            <View style={localStyles.filterHeaderRow}>
              <Text style={styles.searchLabel}>Propiedad</Text>
              <TouchableOpacity
                onPress={() => setShowPropiedadFilter((prev) => !prev)}
                style={localStyles.filterHeaderAction}
              >
                <Ionicons
                  name={showPropiedadFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={localStyles.filterHeaderActionText}>
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
          <View style={localStyles.filterHeaderRow}>
            <Text style={styles.searchLabel}>Objeto alquilado</Text>
            <TouchableOpacity
              onPress={() => setShowObjetoFilter((prev) => !prev)}
              style={localStyles.filterHeaderAction}
            >
              <Ionicons
                name={showObjetoFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={localStyles.filterHeaderActionText}>
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
            value={incSearchText}
            onChangeText={setIncSearchText}
            placeholder="Código, título, categoría, proveedor…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>

        <View style={{ marginTop: 16 }}>
          <View style={localStyles.filterHeaderRow}>
            <Text style={styles.searchLabel}>Semáforo</Text>
            <TouchableOpacity
              onPress={() => setShowIncColorFilter((prev) => !prev)}
              style={localStyles.filterHeaderAction}
            >
              <Ionicons
                name={showIncColorFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={localStyles.filterHeaderActionText}>
                {showIncColorFilter ? 'Ocultar' : 'Mostrar'}
              </Text>
            </TouchableOpacity>
          </View>

          {showIncColorFilter && (
            <View style={styles.pillsRow}>
              {[
                { label: 'Todas', value: 'all' },
                { label: 'Rojo', value: 'red' },
                { label: 'Amarillo', value: 'yellow' },
                { label: 'Verde', value: 'green' },
              ].map((item) => (
                <View style={styles.pillWrapper} key={item.value}>
                  <FilterPill
                    label={item.label}
                    selected={incColorFilter === (item.value as IncidenciaColorGroup)}
                    onPress={() =>
                      setIncColorFilter((prev) =>
                        prev === item.value ? 'all' : (item.value as IncidenciaColorGroup)
                      )
                    }
                    style={styles.filterPill}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {incidenciasCategoriasDisponibles.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <View style={localStyles.filterHeaderRow}>
              <Text style={styles.searchLabel}>Categoría</Text>
              <TouchableOpacity
                onPress={() => setShowIncCategoriaFilter((prev) => !prev)}
                style={localStyles.filterHeaderAction}
              >
                <Ionicons
                  name={showIncCategoriaFilter ? 'remove-circle-outline' : 'add-circle-outline'}
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={localStyles.filterHeaderActionText}>
                  {showIncCategoriaFilter ? 'Ocultar' : 'Mostrar'}
                </Text>
              </TouchableOpacity>
            </View>

            {showIncCategoriaFilter && (
              <View style={styles.pillsRowWrap}>
                <View style={styles.pillWrapper}>
                  <FilterPill
                    label="Todas"
                    selected={incCategoriaFilter === 'todos'}
                    onPress={() => setIncCategoriaFilter('todos')}
                    style={styles.filterPill}
                  />
                </View>

                {incidenciasCategoriasDisponibles.map((item) => {
                  const selected = incCategoriaFilter === item;
                  return (
                    <View style={styles.pillWrapper} key={item}>
                      <FilterPill
                        label={item}
                        selected={selected}
                        onPress={() => setIncCategoriaFilter(selected ? 'todos' : item)}
                        style={styles.filterPill}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderContenidoContratos = () => {
    if (contratosLoading && contratos.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando contratos…</Text>
        </View>
      );
    }

    if (contratosError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{contratosError}</Text>
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
          const estadoColor = getIncidenciaEstadoColorToken(item.estado);
          const subtitleBase = getIncidenciaDisplaySubtitle(item);
          const category = subtitleBase || 'Incidencia';
          const dateLabel = item.fecha_creacion
            ? `Creada el ${formatFechaCorta(item.fecha_creacion)}`
            : 'Fecha no disponible';

          const badgeLabel = item.estado_label || 'Sin estado';

          return (
            <View key={item.id} style={localStyles.incidenciaCardWrapper}>
              <ExpenseCard
                backgroundColor={getIncidenciaCardBackground(item.estado)}
                title={item.codigo || item.id}
                category={item.titulo ? `${item.titulo} · ${category}` : category}
                dateLabel={dateLabel}
                amountLabel={item.localidad ? item.localidad : 'Incidencia'}
                segmentoId="GEST-RESTO"
                inactive={false}
                iconNameOverride="warning-outline"
                onPress={() =>
                  navigation.navigate('IncidenciaDetalle', {
                    incidenciaId: item.id,
                    contratoId: item.contrato_id,
                    patrimonioId: item.patrimonio_id,
                    incidencia: item,
                  })
                }
              />

              <View style={localStyles.estadoBadgeOverlay}>
                <View
                  style={[
                    localStyles.estadoBadge,
                    {
                      borderColor: estadoColor,
                      backgroundColor: `${estadoColor}18`,
                    },
                  ]}
                >
                  <Text style={[localStyles.estadoBadgeText, { color: estadoColor }]}>
                    {badgeLabel}
                  </Text>
                </View>
              </View>
            </View>
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
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
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
                style={{ marginTop: 4, fontSize: 18, fontWeight: '900', color: colors.textPrimary }}
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
                style={{ marginTop: 4, fontSize: 16, fontWeight: '900', color: colors.textPrimary }}
              >
                {EuroformatEuro(resumenActivos.rentaMensual)}
              </Text>
            </View>
          </View>
        </View>

        <View style={localStyles.tabsArea}>
          <FilterRow columns={2} gap={spacing.sm}>
            <Chip
              label="Contratos"
              selected={tab === 'contratos'}
              onPress={() => setTab('contratos')}
              fullWidth
              centerText
            />
            <Chip
              label="Incidencias"
              selected={tab === 'incidencias'}
              onPress={() => setTab('incidencias')}
              fullWidth
              centerText
            />
          </FilterRow>
        </View>

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
            <View style={{ maxHeight: 340 }}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {tab === 'contratos' ? renderBuscadorContratos() : renderBuscadorIncidencias()}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.bottomArea}>
          {tab === 'contratos' ? renderContenidoContratos() : renderContenidoIncidencias()}
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

const localStyles = StyleSheet.create({
  tabsArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterHeaderActionText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  incidenciaCardWrapper: {
    position: 'relative',
  },
  estadoBadgeOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  estadoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  estadoBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
});

export default ContratoListScreen;