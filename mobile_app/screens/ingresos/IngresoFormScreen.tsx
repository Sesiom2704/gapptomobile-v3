/**
 * Archivo: mobile_app/screens/ingresos/IngresoFormScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de alta/edición/duplicado y consulta (readOnly) de un Ingreso.
 *   - Soporta dos modos:
 *       - 'gestionable': ingreso recurrente/planificable.
 *       - 'extraordinario': ingreso puntual (por defecto PAGO ÚNICO).
 *
 * Maneja:
 *   - UI: Header + secciones reutilizables (FormSection) y controles tipo “pill”.
 *   - Estado: local (useState) para campos del formulario y flags (readOnly/isEdit/duplicate).
 *   - Datos:
 *       - Lectura de catálogos: fetchTiposIngreso, fetchCuentas, fetchViviendas
 *       - Escritura: createIngreso, updateIngreso
 *   - Navegación:
 *       - Retorno explícito (returnToTab/returnToScreen/returnToParams) con prioridad.
 *       - Compatibilidad con flags legacy (fromHome/fromDiaADia).
 *       - Alta auxiliar (AuxEntityForm) para tipo_ingreso (con preselección al volver).
 *
 * Reglas funcionales relevantes:
 *   - Duplicado:
 *       - Cambia concepto con sufijo "- M/YY".
 *       - Setea fecha a hoy y recalcula rango de cobro según el día.
 *       - Si periodicidad = PAGO UNICO, precarga cobrado=true, activo=false, kpi=false.
 *   - Validación:
 *       - concepto, tipoId, cuentaId obligatorios.
 *       - importe debe ser number > 0 (parseImporte).
 *
 * Notas:
 *   - La selección de Vivienda se muestra solo si el tipo de ingreso contiene “VIVIENDA” (por nombre).
 *   - Metadatos (createOn/modifiedOn/etc.) se presentan solo en edición/consulta y en modo avanzado.
 *
 * Mejoras solicitadas en este paso:
 *   1) Tipo de ingreso:
 *      - Añadir botón "+" (InlineAddButton) para crear tipo de ingreso.
 *      - Al volver desde AuxEntityForm, el tipo recién creado debe quedar preseleccionado.
 *
 *   2) Opciones avanzadas:
 *      - Añadir “flecha” (chevron) para desplegar/ocultar.
 *      - Mostrar la sección SOLO cuando estamos editando/consultando un ingreso existente
 *        (es decir: existe ingresoSource y NO estamos en duplicado).
 *      - En creación (alta nueva) y duplicado: NO aparece la sección avanzada.
 *
 * Bugfix mantenido:
 *   - Unificación de estado del DateTimePicker (showDatePicker).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { commonFormStyles } from '../../components/forms/formStyles';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { InlineAddButton } from '../../components/ui/InlineAddButton';
import { FormDateButton } from '../../components/ui/FormDateButton';
import { colors } from '../../theme';

import { PERIODICIDADES } from '../../constants/finance';
import { RANGOS_PAGO } from '../../constants/general';

import { fetchTiposIngreso, fetchCuentas, fetchViviendas } from '../../services/utilsApi';
import { createIngreso, updateIngreso } from '../../services/ingresosApi';

import { EuroformatEuro, parseImporte, appendMonthYearSuffix, formatFechaCorta } from '../../utils/format';
import { useResetFormOnFocus } from '../../utils/formsUtils';

// ---- Tipos locales ----
type IngresoMode = 'gestionable' | 'extraordinario';

type TipoIngreso = {
  id: string;
  nombre: string;
};

type Cuenta = {
  id: string;
  nombre?: string;
  anagrama?: string;
  liquidez?: number | null;
};

type Vivienda = {
  id: string;
  referencia?: string;
  direccion_completa?: string;
};

type Props = {
  navigation: any;
  route: {
    key?: string;
    params?: {
      mode?: IngresoMode;
      ingreso?: any;
      readOnly?: boolean;
      duplicate?: boolean;

      returnToTab?: string;
      returnToScreen?: string;
      returnToParams?: any;

      fromHome?: boolean;
      fromDiaADia?: boolean;

      /**
       * Resultado de alta auxiliar (AuxEntityForm).
       * Esperamos la forma:
       *   { type: 'tipo_ingreso', item: TipoIngreso }
       * (mantenemos el mismo patrón que en otras pantallas).
       */
      auxResult?: any;
    };
  };
};

// ---- Helpers de fecha ----
function toApiDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateString(value: string | null | undefined): Date {
  if (!value) return new Date();

  // YYYY-MM-DD
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

  // DD/MM/YYYY
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

function getRangoFromDateString(dateStr: string): string {
  const d = parseDateString(dateStr);
  const day = d.getDate();

  if (day >= 1 && day <= 3) return '1-3';
  if (day <= 7) return '4-7';
  if (day <= 11) return '8-11';
  if (day <= 15) return '12-15';
  if (day <= 19) return '16-19';
  if (day <= 23) return '20-23';
  if (day <= 27) return '24-27';
  return '28-31';
}

function normalizePagoUnico(value: string): string {
  const v = (value || '').trim().toUpperCase();
  if (v === 'PAGO UNICO') return 'PAGO UNICO';
  return value;
}

// ---- Componente principal ----
const IngresoFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  // ========================
  // Modo de pantalla
  // ========================
  const mode: IngresoMode = route?.params?.mode ?? 'gestionable';
  const duplicate: boolean = route?.params?.duplicate === true;

  const ingresoSource = route?.params?.ingreso ?? null;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  /**
   * isEdit (concepto de “existe ingreso en backend y no estamos duplicando”).
   * Nota: readOnly puede ser true y seguir siendo “edición” en el sentido de que existe el ingreso;
   * lo usamos para mostrar metadatos/avanzado pero sin permitir cambios.
   */
  const isEdit = !!ingresoSource && !duplicate;
  const ingresoAny = ingresoSource as any;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const fromHome: boolean = route?.params?.fromHome === true;
  const fromDiaADia: boolean = route?.params?.fromDiaADia === true;

  const handleBack = () => {
    if (returnToTab) {
      if (returnToScreen) {
        navigation.navigate(returnToTab, {
          screen: returnToScreen,
          params: returnToParams,
        });
      } else {
        navigation.navigate(returnToTab);
      }
      return;
    }

    if (fromHome) {
      navigation.navigate('HomeTab');
      return;
    }
    void fromDiaADia;

    navigation.goBack();
  };

  // ========================
  // Catálogos
  // ========================
  const [tipos, setTipos] = useState<TipoIngreso[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  // ========================
  // 1) Datos básicos
  // ========================
  const [concepto, setConcepto] = useState<string>(ingresoSource?.concepto ?? '');
  const [tipoId, setTipoId] = useState<string | null>(ingresoSource?.tipo_id ?? null);

  // ========================
  // 2) Vinculaciones
  // ========================
  const [cuentaId, setCuentaId] = useState<string | null>(ingresoSource?.cuenta_id ?? null);
  const [viviendaId, setViviendaId] = useState<string | null>(ingresoSource?.referencia_vivienda_id ?? null);

  // Importe
  const [importe, setImporte] = useState<string>(
    ingresoSource?.importe != null ? String(ingresoSource.importe) : ''
  );

  // ========================
  // Fecha y rango
  // ========================
  const [fechaInicio, setFechaInicio] = useState<string>(() => {
    if (ingresoSource?.fecha_inicio) return ingresoSource.fecha_inicio;
    return toApiDate(new Date());
  });

  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleOpenDatePicker = () => {
    if (readOnly) return;
    setShowDatePicker(true);
  };

  const [rangoCobro, setRangoCobro] = useState<string>(() => {
    if (ingresoSource?.rango_cobro) return ingresoSource.rango_cobro;
    return getRangoFromDateString(ingresoSource?.fecha_inicio ?? toApiDate(new Date()));
  });

  const [periodicidad, setPeriodicidad] = useState<string>(() => {
    if (ingresoSource?.periodicidad) return ingresoSource.periodicidad;
    return mode === 'extraordinario' ? 'PAGO UNICO' : 'MENSUAL';
  });

  // ========================
  // Estado / meta
  // ========================
  const [activo, setActivo] = useState<boolean>(ingresoSource?.activo ?? mode === 'gestionable');
  const [cobrado, setCobrado] = useState<boolean>(ingresoSource?.cobrado ?? false);
  const [kpi, setKpi] = useState<boolean>(ingresoSource?.kpi ?? mode === 'gestionable');

  // Metadatos (solo visual; normalmente vienen en edición)
  const createOn: string | null = ingresoAny?.createon ?? null;
  const modifiedOn: string | null = ingresoAny?.modifiedon ?? null;
  const inactivatedOn: string | null = ingresoAny?.inactivatedon ?? null;
  const ultimoIngresoOn: string | null = ingresoAny?.ultimo_ingreso_on ?? null;
  const userName: string | null =
    ingresoAny?.user_nombre ?? ingresoAny?.userName ?? ingresoAny?.user_id ?? null;

  /**
   * Toggle de “avanzado”.
   * Importante: la sección avanzada SOLO se muestra cuando isEdit=true (existe ingreso y no duplicado).
   */
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Loading / saving / refresh
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // ========================
  // ✅ Reset centralizado al foco (solo Alta/Nuevo; NO duplicado)
  // ========================
  const resetFormToNew = React.useCallback(() => {
    const now = new Date();
    const hoy = toApiDate(now);

    setConcepto('');
    setTipoId(null);

    setCuentaId(null);
    setViviendaId(null);

    setImporte('');

    setFechaInicio(hoy);
    setShowDatePicker(false);
    setRangoCobro(getRangoFromDateString(hoy));

    setPeriodicidad(mode === 'extraordinario' ? 'PAGO UNICO' : 'MENSUAL');

    setActivo(mode === 'gestionable');
    setCobrado(false);
    setKpi(mode === 'gestionable');

    // En alta no queremos mantener el estado avanzado (aunque no se muestre)
    setShowAdvanced(false);
  }, [mode]);

  useResetFormOnFocus({
    readOnly,
    // IMPORTANTE: no resetear en duplicado, porque precarga valores intencionalmente
    isEdit: isEdit || duplicate,
    auxResult: route?.params?.auxResult,
    onReset: resetFormToNew,
  });

  // ========================
  // Duplicado: comportamiento
  // ========================
  useEffect(() => {
    if (!duplicate || !ingresoSource) return;

    const now = new Date();
    const hoy = toApiDate(now);

    setConcepto(appendMonthYearSuffix(ingresoSource.concepto ?? '', now));
    setFechaInicio(hoy);
    setRangoCobro(getRangoFromDateString(hoy));

    const per = normalizePagoUnico(ingresoSource.periodicidad ?? '');
    if (per === 'PAGO UNICO') {
      setCobrado(true);
      setActivo(false);
      setKpi(false);
    }
  }, [duplicate, ingresoSource]);

  // ========================
  // Carga catálogos base
  // ========================
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [tiposRes, cuentasRes, viviendasRes] = await Promise.all([
        fetchTiposIngreso(),
        fetchCuentas(),
        fetchViviendas(),
      ]);

      setTipos(tiposRes || []);
      setCuentas(cuentasRes || []);
      setViviendas(viviendasRes || []);
    } catch (err) {
      console.error('[IngresoForm] Error cargando datos base', err);
      Alert.alert('Error', 'No se pudieron cargar tipos, cuentas o viviendas. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  // ========================
  // ✅ Retorno desde AuxEntityForm: tipo_ingreso
  //   - Refresca tipos
  //   - Hace merge
  //   - Preselecciona el nuevo tipo
  // ========================
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;
        if (!res) return;

        try {
          if (res.type === 'tipo_ingreso' && res.item) {
            const nuevoTipo = res.item as TipoIngreso;

            const tiposRes = await fetchTiposIngreso();
            if (!alive) return;

            // Merge estable: asegura que el nuevo tipo esté disponible en la lista
            const merged = (() => {
              const map = new Map<string, TipoIngreso>();
              map.set(nuevoTipo.id, nuevoTipo);
              for (const t of tiposRes ?? []) map.set(t.id, t);
              return Array.from(map.values());
            })();

            setTipos(merged);

            // ✅ Preselección automática del tipo recién creado
            setTipoId(nuevoTipo.id);
          }
        } finally {
          // Limpieza para evitar reprocesado al volver a foco
          navigation.setParams({ auxResult: undefined });
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation])
  );

  // ========================
  // Helpers UI
  // ========================
  const getCuentaLabel = (cta: Cuenta): string => cta.anagrama || cta.nombre || cta.id;
  const getViviendaLabel = (viv: Vivienda): string => viv.referencia || viv.id;

  const periodicidadesForMode = (): string[] => {
    if (mode === 'extraordinario') return ['PAGO UNICO'];
    return [...PERIODICIDADES];
  };

  const handleChangeFecha = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (!selectedDate) return;

    const apiDate = toApiDate(selectedDate);
    setFechaInicio(apiDate);
    setRangoCobro(getRangoFromDateString(apiDate));
  };

  const tipoSeleccionado = tipos.find((t) => t.id === tipoId) || null;
  const isTipoVivienda =
    !!tipoSeleccionado && tipoSeleccionado.nombre.toUpperCase().includes('VIVIENDA');

  // ========================
  // Acción: crear tipo ingreso (AuxEntityForm)
  // ========================
  const handleAddTipoIngreso = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'tipo_ingreso',
      origin: 'ingresos',
      returnKey: 'ingresos-tipo_ingreso',
      returnRouteKey: route.key,
    });
  };

  // ========================
  // Guardado
  // ========================
  const handleSave = async () => {
    if (readOnly) return;

    if (!concepto.trim()) {
      Alert.alert('Campo obligatorio', 'El nombre del ingreso es obligatorio.');
      return;
    }

    if (!tipoId) {
      Alert.alert('Campo obligatorio', 'Selecciona un tipo de ingreso.');
      return;
    }

    if (!cuentaId) {
      Alert.alert('Campo obligatorio', 'Selecciona una cuenta de cargo.');
      return;
    }

    const importeNumber = parseImporte(importe);
    if (importeNumber == null || importeNumber <= 0) {
      Alert.alert('Importe inválido', 'El importe debe ser mayor que 0.');
      return;
    }

    const rangoCobroNormalized = rangoCobro?.trim() || '';

    const payload: any = {
      concepto: concepto.trim(),
      importe: importeNumber,
      periodicidad: normalizePagoUnico(periodicidad),
      rango_cobro: rangoCobroNormalized,
      fecha_inicio: fechaInicio,
      tipo_id: tipoId,
      referencia_vivienda_id: viviendaId,
      cuenta_id: cuentaId,
      activo,
      cobrado,
      kpi,
    };

    setSaving(true);
    try {
      if (isEdit && ingresoSource?.id) {
        await updateIngreso(ingresoSource.id, payload);
        Alert.alert('Ingreso actualizado', 'Los cambios se han guardado correctamente.', [
          { text: 'OK', onPress: handleBack },
        ]);
      } else {
        const per = normalizePagoUnico(periodicidad);
        const nowIso = new Date().toISOString();

        // En duplicado mantenemos flags según lógica previa
        if (duplicate) {
          payload.activo = activo;
          payload.cobrado = cobrado;
          payload.kpi = kpi;
        }

        // Caso especial duplicado PAGO ÚNICO
        if (duplicate && per === 'PAGO UNICO') {
          payload.cobrado = true;
          payload.activo = false;
          payload.kpi = false;

          payload.createon = nowIso;
          payload.modifiedon = nowIso;
          payload.inactivatedon = nowIso;
          payload.ultimo_ingreso_on = nowIso;
        }

        await createIngreso(payload);

        Alert.alert(
          'Ingreso creado',
          mode === 'extraordinario'
            ? 'Ingreso extraordinario creado correctamente.'
            : 'Ingreso gestionable creado correctamente.',
          [{ text: 'OK', onPress: handleBack }]
        );
      }
    } catch (err) {
      console.error('[IngresoForm] Error guardando ingreso', err);
      Alert.alert('Error', 'No se pudo guardar el ingreso. Revisa los datos e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  // ========================
  // Header
  // ========================
  const headerTitle = useMemo(() => {
    // Título base (estable); el modo va en subtitle
    return mode === 'extraordinario' ? 'Ingreso extraordinario' : 'Ingreso gestionable';
  }, [mode]);

  const headerSubtitle = useMemo(() => {
    if (readOnly) return 'Consulta';
    if (duplicate) return 'Duplicado';
    if (isEdit) return 'Edición';
    return 'Alta nueva';
  }, [readOnly, duplicate, isEdit]);

  // ========================
  // Loading state
  // ========================
  if (loading) {
    return (
      <Screen>
        <View style={styles.topArea}>
          <Header title={headerTitle} subtitle={headerSubtitle} showBack onBackPress={handleBack} />
        </View>
        <View style={stylesLocal.loader}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  /**
   * La sección avanzada SOLO se muestra en edición/consulta de ingreso existente.
   * - Alta nueva: NO
   * - Duplicado: NO
   */
  const canShowAdvancedSection = !!ingresoSource && !duplicate;

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header title={headerTitle} subtitle={headerSubtitle} showBack onBackPress={handleBack} />
      </View>

      <ScrollView
        style={styles.formArea}
        contentContainerStyle={styles.formContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* =======================
            DATOS BÁSICOS
           ======================= */}
        <FormSection title="Datos básicos">
          <View style={styles.field}>
            <Text style={styles.label}>Nombre del ingreso</Text>
            <TextInput
              value={concepto}
              onChangeText={setConcepto}
              placeholder="Ej: NÓMINA EMPRESA X"
              style={[styles.input, concepto.trim() !== '' && styles.inputFilled]}
              editable={!readOnly}
            />
          </View>

          {/* Tipo de ingreso + botón "+" */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Tipo de ingreso</Text>

              {/* ✅ Mejora 1: botón + que abre AuxEntityForm */}
              <InlineAddButton
                onPress={handleAddTipoIngreso}
                disabled={readOnly}
                accessibilityLabel="Crear tipo de ingreso"
              />
            </View>

            <View style={styles.segmentosRow}>
              {tipos.map((t) => (
                <View key={t.id} style={styles.segmentoWrapper}>
                  <PillButton
                    label={t.nombre}
                    selected={tipoId === t.id}
                    onPress={() => {
                      if (readOnly) return;
                      setTipoId(t.id);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        {/* =======================
            IMPORTE Y CONDICIONES
           ======================= */}
        <FormSection title="Importe y condiciones">
          <View style={styles.field}>
            <Text style={styles.label}>Importe</Text>
            <TextInput
              value={importe}
              onChangeText={setImporte}
              placeholder="Ej. 1.000,00"
              keyboardType="decimal-pad"
              style={[styles.input, styles.amountInputBig, importe.trim() !== '' && styles.inputFilled]}
              editable={!readOnly}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Periodicidad</Text>
            <View style={styles.periodicidadRow}>
              {periodicidadesForMode().map((p) => (
                <View key={p} style={styles.periodicidadPillWrapper}>
                  <PillButton
                    label={p}
                    selected={periodicidad === p}
                    onPress={() => {
                      if (readOnly) return;
                      setPeriodicidad(p);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        {/* =======================
            VINCULACIONES
           ======================= */}
        <FormSection title="Vinculaciones">
          {isTipoVivienda && (
            <View style={styles.field}>
              <Text style={styles.label}>Vivienda</Text>
              <View style={styles.accountsRow}>
                {viviendas.map((viv) => (
                  <View key={viv.id} style={styles.accountPillWrapper}>
                    <AccountPill
                      label={getViviendaLabel(viv)}
                      subLabel={viv.direccion_completa ?? ''}
                      selected={viviendaId === viv.id}
                      onPress={() => {
                        if (readOnly) return;
                        setViviendaId(viv.id);
                      }}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Cuenta de cargo</Text>
            <View style={styles.accountsRow}>
              {cuentas.map((cta) => (
                <View key={cta.id} style={styles.accountPillWrapper}>
                  <AccountPill
                    label={getCuentaLabel(cta)}
                    subLabel={cta.liquidez != null ? EuroformatEuro(cta.liquidez, 'normal') : undefined}
                    selected={cuentaId === cta.id}
                    onPress={() => {
                      if (readOnly) return;
                      setCuentaId(cta.id);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        {/* =======================
            ESTADO Y PLANIFICACIÓN
           ======================= */}
        <FormSection title="Estado y planificación">
          <View style={styles.field}>
            <Text style={styles.label}>Fecha</Text>

            <FormDateButton
              valueText={formatFechaCorta(fechaInicio)}
              onPress={handleOpenDatePicker}
              disabled={readOnly}
            />

            {showDatePicker && !readOnly && (
              <DateTimePicker
                value={parseDateString(fechaInicio)}
                mode="date"
                display="default"
                onChange={handleChangeFecha}
              />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Rango de cobro</Text>
            <View style={styles.rangoRow}>
              {RANGOS_PAGO.map((r) => (
                <View key={r} style={styles.rangoPillWrapper}>
                  <PillButton
                    label={r}
                    selected={rangoCobro === r}
                    onPress={() => {
                      if (readOnly) return;
                      setRangoCobro(r);
                    }}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.helperText}>
              El rango se ajusta automáticamente según la fecha, pero puedes cambiarlo si lo necesitas.
            </Text>
          </View>
        </FormSection>

        {/* =======================
            OPCIONES AVANZADAS (solo edición/consulta de existente)
           ======================= */}
        {canShowAdvancedSection && (
          <FormSection title="Opciones avanzadas">
            {/* ✅ Mejora 2: toggle con flecha (chevron) */}
            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced((v) => !v)}
            >
              <Ionicons
                name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textSecondary}
              />
              <Text style={styles.advancedToggleText}>
                {showAdvanced ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas'}
              </Text>
            </TouchableOpacity>

            {showAdvanced && (
              <>
                {/* Estado (editable solo si no es readOnly) */}
                <View style={styles.field}>
                  <Text style={styles.label}>Estado</Text>
                  <View style={styles.segmentosRow}>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Activo"
                        selected={activo}
                        onPress={() => {
                          if (readOnly) return;
                          setActivo((v) => !v);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Cobrado"
                        selected={cobrado}
                        onPress={() => {
                          if (readOnly) return;
                          setCobrado((v) => !v);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="KPI"
                        selected={kpi}
                        onPress={() => {
                          if (readOnly) return;
                          setKpi((v) => !v);
                        }}
                      />
                    </View>
                  </View>
                </View>

                {/* Metadatos (solo visual; ya estamos en existente) */}
                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Creado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={createOn ? formatDateDisplay(createOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Inactivado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={inactivatedOn ? formatDateDisplay(inactivatedOn) : ''}
                    />
                  </View>
                </View>

                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Último cobro</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={ultimoIngresoOn ? formatDateDisplay(ultimoIngresoOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Modificado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={modifiedOn ? formatDateDisplay(modifiedOn) : ''}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Usuario</Text>
                  <TextInput
                    style={[styles.input, styles.inputAdvanced]}
                    editable={false}
                    value={userName ?? ''}
                  />
                </View>
              </>
            )}
          </FormSection>
        )}

        {/* =======================
            ACCIÓN GUARDAR
           ======================= */}
        {!readOnly ? (
          <View style={{ marginTop: 12 }}>
            <FormActionButton
              label={saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear ingreso'}
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

export default IngresoFormScreen;

const stylesLocal = {
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
} as const;
