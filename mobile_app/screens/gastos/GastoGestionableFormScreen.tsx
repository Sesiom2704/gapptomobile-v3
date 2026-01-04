/**
 * Archivo: screens/gastos/GastoGestionableFormScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de alta/edición/duplicado y consulta (readOnly) de un Gasto Gestionable.
 *   - Gestiona la carga de catálogos (tipos de gasto, proveedores, cuentas, viviendas),
 *     la lógica de formulario (validaciones, cálculos de cuotas/importes) y el guardado.
 *
 * Maneja:
 *   - UI: formulario multipanel con secciones reutilizables (FormSection) y controles tipo “pill”.
 *   - Estado: local (useState) para campos del formulario y flags (readOnly/isEdit/duplicate).
 *   - Datos:
 *       - Lectura: fetchTiposGasto, fetchProveedores, fetchCuentas, fetchViviendas
 *       - Escritura: crearGastoGestionable, actualizarGasto
 *   - Navegación:
 *       - Soporta retorno condicionado (returnToTab/returnToScreen/returnToParams, fromHome).
 *       - Soporta alta auxiliar (AuxEntityForm) para tipo_gasto y proveedor.
 *
 * Entradas / Salidas:
 *   - route.params:
 *       - preset: 'standard' | 'extra'
 *       - duplicate: boolean
 *       - gasto: Gasto | null
 *       - readOnly: boolean
 *       - returnToTab/returnToScreen/returnToParams
 *       - fromHome/fromDiaADia
 *       - auxResult: resultado de alta auxiliar (tipo_gasto / proveedor)
 *   - Efectos:
 *       - Recalcula cuotasRestantes e importePendiente.
 *       - Refresca catálogos manualmente (pull-to-refresh).
 *
 * Dependencias clave:
 *   - UI interna: Screen, Header, FormSection, PillButton, AccountPill,
 *                InlineAddButton, InlineSearchSelect, FormDateButton, FormActionButton
 *   - Tema: colors (theme)
 *   - Utilidades: parseEuroToNumber, formatFechaCorta, appendMonthYearSuffix
 *
 * Cambios introducidos (objetivo actual):
 *   1) Debajo de "Nombre del gasto" añadimos campo "Comentarios" (solo UI; se usará más adelante).
 *   2) Al crear un proveedor desde AuxEntityForm, se selecciona automáticamente al volver:
 *      - Se hace merge en catálogo y se setea proveedorSeleccionado.
 *      - Además, se re-sincroniza proveedorSeleccionado con el catálogo tras refresh/carga.
 *
 * Notas:
 *   - Se mantiene el patrón commonFormStyles; cualquier variación específica debe extenderse localmente.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { colors } from '../../theme';

import FormScreen from '../../components/forms/FormScreen';
import { FormActionButton } from '../../components/ui/FormActionButton';

import { InlineAddButton } from '../../components/ui/InlineAddButton';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { FormDateButton } from '../../components/ui/FormDateButton';

import { useResetFormOnFocus } from '../../utils/formsUtils';

import {
  fetchTiposGasto,
  fetchProveedores,
  fetchCuentas,
  fetchViviendas,
  crearGastoGestionable,
  actualizarGasto,
  TipoGasto,
  Proveedor,
  Cuenta,
  Vivienda,
  Gasto,
} from '../../services/gastosApi';

import {
  SEGMENTOS,
  RANGOS_PAGO,
  VIVIENDAS_SEGMENTO_ID,
  MAX_PROVEEDORES_SUGERENCIAS,
} from '../../constants/general';

import { PERIODICIDADES } from '../../constants/finance';
import { parseEuroToNumber, formatFechaCorta, appendMonthYearSuffix } from '../../utils/format';

type Props = {
  navigation: any;
  route: any;
};

/**
 * Normaliza el valor de periodicidad para el caso particular "PAGO UNICO"
 * (algunas entradas podían venir con variaciones).
 */
function normalizePagoUnico(value: string): string {
  const v = (value || '').trim().toUpperCase();
  if (v === 'PAGO UNICO') return 'PAGO UNICO';
  return value;
}

/**
 * Calcula el rango de pago sugerido a partir de una fecha ISO (YYYY-MM-DD).
 */
function getRangoFromDateString(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '1-3';

  const day = d.getDate();
  if (day <= 3) return '1-3';
  if (day <= 7) return '4-7';
  if (day <= 11) return '8-11';
  if (day <= 15) return '12-15';
  if (day <= 19) return '16-19';
  if (day <= 23) return '20-23';
  if (day <= 27) return '24-27';
  return '28-31';
}

export const GastoGestionableFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  // ========================
  // Modo de pantalla
  // ========================
  const preset: 'standard' | 'extra' = route?.params?.preset ?? 'standard';
  const duplicate: boolean = route?.params?.duplicate === true;

  const gastoSource: Gasto | null = route?.params?.gasto ?? null;
  const gastoAny = gastoSource as any;

  const isEdit = !!gastoSource && !duplicate;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const fromHome: boolean = route?.params?.fromHome === true;
  const fromDiaADia: boolean = route?.params?.fromDiaADia === true;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  /**
   * Back coherente con navegación contextual:
   * - Si hay returnToTab/returnToScreen -> navegación dirigida.
   * - Si viene de Home -> volver a HomeTab.
   * - Si no, goBack().
   */
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
  // Estado del formulario (campos)
  // ========================
  const [nombre, setNombre] = useState<string>(gastoSource?.nombre ?? '');

  /**
   * Campo "Comentarios" (por ahora solo UI).
   * - No se envía al backend aún (se implementará posteriormente).
   * - Se resetea en alta y se mantiene en edición/duplicado según valores iniciales.
   */
  const [comentarios, setComentarios] = useState<string>((gastoAny?.comentarios ?? '') as string);

  const [segmentoId, setSegmentoId] = useState<string | null>(gastoSource?.segmento_id ?? null);
  const [tipoId, setTipoId] = useState<string | null>(gastoSource?.tipo_id ?? null);

  // ========================
  // Catálogos
  // ========================
  const [tipos, setTipos] = useState<TipoGasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  // ========================
  // Proveedor (selector con búsqueda)
  // ========================
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);
  const [busquedaProveedor, setBusquedaProveedor] = useState('');

  // Campo adicional
  const [tienda, setTienda] = useState<string>(gastoSource?.tienda ?? '');

  // Vinculaciones
  const [cuentaId, setCuentaId] = useState<string | null>(gastoSource?.cuenta_id ?? null);
  const [viviendaId, setViviendaId] = useState<string | null>(
    (gastoSource?.referencia_vivienda_id as string | null | undefined) ?? null
  );

  // Cuotas / importes
  const [numCuotas, setNumCuotas] = useState<number>(gastoSource?.cuotas ?? 1);
  const [importeCuota, setImporteCuota] = useState<string>(
    gastoSource?.importe_cuota != null ? String(gastoSource.importe_cuota) : ''
  );
  const [importeTotal, setImporteTotal] = useState<string>(
    gastoSource?.importe != null ? String(gastoSource.importe) : ''
  );

  // Periodicidad
  const [periodicidad, setPeriodicidad] = useState<string>(() => {
    if (gastoSource?.periodicidad) return normalizePagoUnico(gastoSource.periodicidad);
    if (!isEdit && preset === 'extra') return 'PAGO UNICO';
    return 'MENSUAL';
  });

  // Locks para evitar bucles de cálculo cuota/total
  const [lockImporteCuota, setLockImporteCuota] = useState(false);
  const [lockImporteTotal, setLockImporteTotal] = useState(false);

  // Campos “solo edición”
  const [cuotasPagadas, setCuotasPagadas] = useState<number>(gastoAny?.cuotas_pagadas ?? 0);
  const [cuotasRestantes, setCuotasRestantes] = useState<number>(
    gastoAny?.cuotas_restantes ??
      Math.max((gastoSource?.cuotas ?? 0) - (gastoAny?.cuotas_pagadas ?? 0), 0)
  );
  const [importePendiente, setImportePendiente] = useState<number>(gastoAny?.importe_pendiente ?? 0);
  const [prestamoId, setPrestamoId] = useState<string>(gastoAny?.prestamo_id ?? gastoAny?.prestamoId ?? '');
  const [numCuota, setNumCuota] = useState<number>(gastoAny?.num_cuota ?? 1);

  // Fecha / planificación
  const hoyIso = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState<string>(gastoSource?.fecha ?? hoyIso);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [rangoPago, setRangoPago] = useState<string>(gastoSource?.rango_pago ?? '1-3');

  // Avanzado
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [referenciaGasto, setReferenciaGasto] = useState<string>(
    (gastoSource?.referencia_gasto as string | null | undefined) ?? ''
  );

  // Estado (solo edición, pero se conserva el estado por compatibilidad)
  const [activo, setActivo] = useState<boolean>(gastoAny?.activo ?? true);
  const [pagado, setPagado] = useState<boolean>(gastoAny?.pagado ?? false);
  const [kpi, setKpi] = useState<boolean>(gastoAny?.kpi ?? false);

  // Auditoría
  const createOn: string | null = gastoAny?.createon ?? null;
  const modifiedOn: string | null = gastoAny?.modifiedon ?? null;
  const inactivatedOn: string | null = gastoAny?.inactivatedon ?? null;
  const ultimoPagoOn: string | null = gastoAny?.ultimo_pago_on ?? null;
  const userName: string | null =
    gastoAny?.user_nombre ?? gastoAny?.userName ?? gastoAny?.user_id ?? null;

  // Refresh UI
  const [refreshing, setRefreshing] = useState(false);

  // ========================
  // Reset centralizado al foco (solo Alta/Nuevo; NO duplicado)
  // ========================
  const resetFormToNew = React.useCallback(() => {
    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);

    setNombre('');
    setComentarios(''); // ✅ nuevo campo

    setSegmentoId(null);
    setTipoId(null);

    setProveedorSeleccionado(null);
    setBusquedaProveedor('');

    setTienda('');

    setCuentaId(null);
    setViviendaId(null);

    setNumCuotas(1);
    setImporteCuota('');
    setImporteTotal('');

    setPeriodicidad(preset === 'extra' ? 'PAGO UNICO' : 'MENSUAL');

    setLockImporteCuota(false);
    setLockImporteTotal(false);

    // Campos “solo edit”
    setCuotasPagadas(0);
    setCuotasRestantes(0);
    setImportePendiente(0);
    setPrestamoId('');
    setNumCuota(1);

    setFecha(hoy);
    setShowDatePicker(false);
    setRangoPago(getRangoFromDateString(hoy));

    setShowAdvanced(false);
    setReferenciaGasto('');

    // Estado (en alta)
    setActivo(true);
    setPagado(false);
    setKpi(false);
  }, [preset]);

  useResetFormOnFocus({
    readOnly,
    // IMPORTANTE: no queremos resetear en duplicado, porque duplicado trae valores intencionadamente
    isEdit: isEdit || duplicate,
    auxResult: route?.params?.auxResult,
    onReset: resetFormToNew,
  });

  // ========================
  // Duplicado
  // ========================
  useEffect(() => {
    if (!duplicate || !gastoSource) return;

    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);

    // Nombre con sufijo mes/año para diferenciar
    setNombre(appendMonthYearSuffix(gastoSource.nombre ?? '', now));

    // Comentarios: si existiesen en el futuro, aquí podrías copiar/ajustar
    // setComentarios(gastoAny?.comentarios ?? '');

    // Ajuste fecha y rango
    setFecha(hoy);
    setRangoPago(getRangoFromDateString(hoy));

    const per = normalizePagoUnico(gastoSource.periodicidad ?? '');
    if (per === 'PAGO UNICO') {
      setPagado(true);
      setActivo(false);
      setKpi(false);
      setNumCuotas(1);
      setCuotasPagadas(1);
      setNumCuota(1);
    }
  }, [duplicate, gastoSource, gastoAny?.comentarios]);

  // ========================
  // Retorno desde AuxEntityForm (alta auxiliar)
  //   - tipo_gasto: refresca catálogo de tipos y selecciona el nuevo
  //   - proveedor: refresca catálogo de proveedores y selecciona el nuevo ✅
  // ========================
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;
        if (!res) return;

        try {
          // ------------------------
          // Tipo de gasto creado
          // ------------------------
          if (res.type === 'tipo_gasto' && res.item) {
            const nuevoTipo = res.item as TipoGasto;

            const seg = nuevoTipo.segmento_id ?? segmentoId ?? null;
            if (nuevoTipo.segmento_id && nuevoTipo.segmento_id !== segmentoId) {
              setSegmentoId(nuevoTipo.segmento_id);
            }

            const tiposRes = await fetchTiposGasto(seg ?? undefined);
            if (!alive) return;

            // Merge estable: evita duplicados y garantiza que el nuevo está
            const mergedTipos = (() => {
              const map = new Map<string, TipoGasto>();
              map.set(nuevoTipo.id, nuevoTipo);
              for (const t of tiposRes ?? []) map.set(t.id, t);
              return Array.from(map.values());
            })();

            setTipos(mergedTipos);
            setTipoId(nuevoTipo.id);
          }

          // ------------------------
          // Proveedor creado ✅
          // ------------------------
          if (res.type === 'proveedor' && res.item) {
            const nuevoProv = res.item as Proveedor;

            // Refrescamos desde API (source of truth)
            const provRes = await fetchProveedores();
            if (!alive) return;

            // Merge estable: garantiza que el nuevo proveedor esté en la lista
            const mergedProv = (() => {
              const map = new Map<string, Proveedor>();
              map.set(nuevoProv.id, nuevoProv);
              for (const p of provRes ?? []) map.set(p.id, p);
              return Array.from(map.values());
            })();

            setProveedores(mergedProv);

            // ✅ Selección automática del proveedor recién creado
            setProveedorSeleccionado(nuevoProv);

            // Limpieza de búsqueda para evitar confusión en UI
            setBusquedaProveedor('');
          }
        } finally {
          // Limpieza del auxResult para evitar re-procesarlo al volver a foco
          navigation.setParams({ auxResult: undefined });
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation, segmentoId])
  );

  // ========================
  // Carga catálogos base (proveedores/cuentas/viviendas)
  // ========================
  useEffect(() => {
    const loadStatic = async () => {
      try {
        const [provRes, ctasRes, vivsRes] = await Promise.all([
          fetchProveedores(),
          fetchCuentas(),
          fetchViviendas(),
        ]);
        setProveedores(provRes);
        setCuentas(ctasRes);
        setViviendas(vivsRes);
      } catch (err) {
        console.error('[GastoGestionableForm] Error cargando proveedores/cuentas/viviendas', err);
      }
    };

    void loadStatic();
  }, []);

  // ========================
  // Preselección proveedor en edición (cuando gasto ya traía proveedor_id)
  // ========================
  useEffect(() => {
    if (!gastoSource || !gastoSource.proveedor_id) return;
    if (!proveedores.length) return;

    const found = proveedores.find((p) => p.id === gastoSource.proveedor_id);
    if (found) setProveedorSeleccionado(found);
  }, [gastoSource, proveedores]);

  /**
   * Re-sincroniza el objeto proveedorSeleccionado con el catálogo (si existe).
   * Esto evita tener un objeto “stale” tras:
   *   - refresh catálogos
   *   - retorno de AuxEntityForm (cuando luego se re-carga catálogo)
   */
  useEffect(() => {
    if (!proveedorSeleccionado) return;
    if (!proveedores.length) return;

    const found = proveedores.find((p) => p.id === proveedorSeleccionado.id);
    if (found && found !== proveedorSeleccionado) {
      setProveedorSeleccionado(found);
    }
  }, [proveedores, proveedorSeleccionado]);

  // ========================
  // Tipos por segmento
  // ========================
  useEffect(() => {
    const loadTipos = async () => {
      try {
        const data = await fetchTiposGasto(segmentoId ?? undefined);
        setTipos(data);

        // Si estamos editando y el segmento coincide con el original, rehidratar tipo
        if (segmentoId && gastoSource && gastoSource.segmento_id === segmentoId) {
          setTipoId(gastoSource.tipo_id ?? null);
        } else {
          // Si el tipo actual no existe en el nuevo set, limpiarlo
          setTipoId((prev) => (data.some((t) => t.id === prev) ? prev : null));
        }
      } catch (err) {
        console.error('[GastoGestionableForm] Error cargando tipos de gasto', err);
      }
    };
    void loadTipos();
  }, [segmentoId, gastoSource]);

  // ========================
  // Refresh manual (pull-to-refresh)
  // ========================
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [provRes, ctasRes, vivsRes, tiposRes] = await Promise.all([
        fetchProveedores(),
        fetchCuentas(),
        fetchViviendas(),
        fetchTiposGasto(segmentoId ?? undefined),
      ]);

      setProveedores(provRes);
      setCuentas(ctasRes);
      setViviendas(vivsRes);
      setTipos(tiposRes);
    } catch (err) {
      console.error('[GastoGestionableForm] Error al refrescar catálogos', err);
    } finally {
      setRefreshing(false);
    }
  };

  // ========================
  // Derived data (memo)
  // ========================
  const tiposFiltrados = useMemo(() => {
    if (!segmentoId) return tipos;
    return tipos.filter((t) => t.segmento_id === segmentoId);
  }, [segmentoId, tipos]);

  const viviendasActivas = useMemo(() => viviendas.filter((v) => v.activo !== false), [viviendas]);

  const proveedoresFiltrados = useMemo(() => {
    const term = busquedaProveedor.trim().toLowerCase();
    let base = proveedores ?? [];
    if (term) base = base.filter((p) => p.nombre.toLowerCase().includes(term));
    return base.slice(0, MAX_PROVEEDORES_SUGERENCIAS);
  }, [busquedaProveedor, proveedores]);

  // ========================
  // Handlers: cuotas/importes
  // ========================
  const handleChangeNumCuotas = (text: string) => {
    const n = Number(text.replace(/\D/g, ''));
    const cuotas = !n || n <= 0 ? 1 : n;
    setNumCuotas(cuotas);

    const totalNum = parseEuroToNumber(importeTotal) ?? 0;
    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;

    // Si el total no está bloqueado, recalculamos total desde cuota
    if (!lockImporteTotal && cuotaNum > 0) {
      setImporteTotal(String(cuotaNum * cuotas));
    } else if (!lockImporteCuota && totalNum > 0) {
      // Si la cuota no está bloqueada, recalculamos cuota desde total
      setImporteCuota(String(totalNum / cuotas));
    }
  };

  const handleChangeImporteCuota = (text: string) => {
    setImporteCuota(text);

    const cuotaNum = parseEuroToNumber(text) ?? 0;

    // Si se limpia, liberamos lock del total para que vuelva a autocalcular
    if (!text) {
      setLockImporteTotal(false);
      return;
    }

    if (cuotaNum <= 0 || numCuotas <= 0) return;

    setImporteTotal(String(cuotaNum * numCuotas));
    setLockImporteTotal(true);
    setLockImporteCuota(false);
  };

  const handleChangeImporteTotal = (text: string) => {
    setImporteTotal(text);

    const totalNum = parseEuroToNumber(text) ?? 0;

    // Si se limpia, liberamos lock de cuota para que vuelva a autocalcular
    if (!text) {
      setLockImporteCuota(false);
      return;
    }

    if (totalNum <= 0 || numCuotas <= 0) return;

    setImporteCuota(String(totalNum / numCuotas));
    setLockImporteCuota(true);
    setLockImporteTotal(false);
  };

  // Recalcular cuotasRestantes e importePendiente en base a numCuotas/cuotasPagadas/importeCuota
  useEffect(() => {
    const restantes = Math.max(numCuotas - cuotasPagadas, 0);
    setCuotasRestantes(restantes);

    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;
    setImportePendiente(restantes * cuotaNum);
  }, [numCuotas, cuotasPagadas, importeCuota]);

  // ========================
  // Fecha
  // ========================
  const handleOpenDatePicker = () => {
    if (readOnly) return;
    setShowDatePicker(true);
  };

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (!selectedDate) return;

    const iso = selectedDate.toISOString().slice(0, 10);
    setFecha(iso);

    // ✅ Mantener rangoPago consistente con la fecha elegida
    setRangoPago(getRangoFromDateString(iso));
  };

  // ========================
  // Proveedor
  // ========================
  const handleAddProveedor = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'gestionables',
      defaultRamaId: null,
      returnKey: 'gestionables-proveedor',
      returnRouteKey: route.key,
      defaultSegmentoId: segmentoId,
    });
  };

  const handleClearProveedor = () => {
    if (readOnly) return;
    setProveedorSeleccionado(null);
    setBusquedaProveedor('');
  };

  // ========================
  // Guardado
  // ========================
  const handleSave = async () => {
    if (readOnly) return;

    // Validaciones mínimas de UI
    if (!nombre.trim()) {
      Alert.alert('Campo requerido', 'El nombre del gasto es obligatorio.');
      return;
    }
    if (!segmentoId) {
      Alert.alert('Campo requerido', 'Debes seleccionar un segmento.');
      return;
    }
    if (!tipoId) {
      Alert.alert('Campo requerido', 'Debes seleccionar un tipo de gasto.');
      return;
    }
    if (!proveedorSeleccionado) {
      Alert.alert('Campo requerido', 'Debes seleccionar un proveedor.');
      return;
    }
    if (!cuentaId) {
      Alert.alert('Campo requerido', 'Debes seleccionar una cuenta de cargo.');
      return;
    }

    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;
    const totalNum = parseEuroToNumber(importeTotal) ?? 0;

    if (cuotaNum <= 0 && totalNum <= 0) {
      Alert.alert('Importe inválido', 'Debes indicar un importe de cuota o un importe total mayor que cero.');
      return;
    }

    // Payload base (se mantiene el mapping que ya existía)
    const basePayload: any = {
      nombre: nombre.trim(),
      segmentoId,
      tipoId,
      proveedorId: proveedorSeleccionado.id,
      tienda: tienda.trim() || undefined,
      numCuotas,
      importeCuota,
      importeTotal,
      periodicidad: normalizePagoUnico(periodicidad),
      cuentaId,
      viviendaId: segmentoId === VIVIENDAS_SEGMENTO_ID ? viviendaId : null,
      fecha,
      rangoPago,
      referenciaGasto: referenciaGasto.trim() || undefined,

      // Comentarios: se añade solo en UI por ahora.
      // Cuando se implemente en backend:
      // comentarios: comentarios.trim() || undefined,
    };

    try {
      if (isEdit && gastoSource?.id) {
        await actualizarGasto(gastoSource.id, {
          ...basePayload,
          cuotasPagadas,
          prestamoId: prestamoId || undefined,
          numCuota,
          activo,
          pagado,
          kpi,
        });

        Alert.alert('Éxito', 'Gasto actualizado correctamente.', [{ text: 'OK', onPress: handleBack }]);
      } else {
        const per = normalizePagoUnico(periodicidad);
        const nowIso = new Date().toISOString();

        // En duplicado mantenemos flags según lógica previa
        if (duplicate) {
          basePayload.pagado = pagado;
          basePayload.activo = activo;
          basePayload.kpi = kpi;
        }

        // Caso especial duplicado PAGO ÚNICO
        if (duplicate && per === 'PAGO UNICO') {
          basePayload.pagado = true;
          basePayload.activo = false;
          basePayload.kpi = false;

          basePayload.createOn = nowIso;
          basePayload.modifiedOn = nowIso;
          basePayload.inactivatedOn = nowIso;
          basePayload.ultimoPagoOn = nowIso;
        }

        await crearGastoGestionable(basePayload);

        Alert.alert('Éxito', 'Gasto guardado correctamente.', [{ text: 'OK', onPress: handleBack }]);
      }
    } catch (err) {
      console.error('[GastoGestionableForm] Error al guardar gasto', err);
      Alert.alert('Error', 'Ha ocurrido un error al guardar el gasto. Revisa los datos e inténtalo de nuevo.');
    }
  };

  // ========================
  // Título / subtítulo
  // ========================
  const title = 'Gasto gestionable';

  const subtitle =
    readOnly ? 'Consulta' :
    isEdit ? 'Edición de gasto' :
    duplicate ? 'Duplicado' :
    'Nuevo gasto gestionable';

  // ========================
  // Render
  // ========================
  return (
    <FormScreen
      title={title}
      subtitle={subtitle}
      onBackPress={handleBack}
      loading={false}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      footer={
        !readOnly ? (
          <FormActionButton
            label={isEdit ? 'Guardar cambios' : 'Guardar gasto'}
            onPress={handleSave}
            iconName="save-outline"
            disabled={false}
            variant="primary"
          />
        ) : null
      }
    >
      {/* =======================
          DATOS BÁSICOS
         ======================= */}
      <FormSection title="Datos básicos">
        {/* Nombre */}
        <View style={styles.field}>
          <Text style={styles.label}>Nombre del gasto</Text>
          <TextInput
            style={[styles.input, nombre.trim() !== '' && styles.inputFilled]}
            placeholder="Ej. LUZ PISO CENTRO"
            value={nombre}
            onChangeText={setNombre}
            editable={!readOnly}
          />
        </View>

        {/* ✅ NUEVO: Comentarios (por ahora solo UI) */}
        <View style={styles.field}>
          <Text style={styles.label}>Comentarios</Text>
          <TextInput
            style={[
              styles.input,
              // si tu commonFormStyles tiene multilineInput úsalo; si no, esto mantiene consistencia
              comentarios.trim() !== '' && styles.inputFilled,
            ]}
            placeholder="(Pendiente de implementar) Añade notas o comentarios..."
            value={comentarios}
            onChangeText={setComentarios}
            editable={!readOnly}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Segmento */}
        <View style={styles.field}>
          <Text style={styles.label}>Segmento</Text>
          <View style={styles.segmentosRow}>
            {SEGMENTOS.map((seg) => (
              <View key={seg.id} style={styles.segmentoWrapper}>
                <PillButton
                  label={seg.nombre}
                  selected={segmentoId === seg.id}
                  onPress={() => {
                    if (readOnly) return;
                    setSegmentoId((prev) => (prev === seg.id ? null : seg.id));
                  }}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Tipo de gasto */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Tipo de gasto</Text>

            <InlineAddButton
              onPress={() => {
                if (readOnly) return;

                if (!segmentoId) {
                  Alert.alert('Campo requerido', 'Selecciona primero un segmento.');
                  return;
                }
                navigation.navigate('AuxEntityForm', {
                  auxType: 'tipo_gasto',
                  origin: 'gestionables',
                  returnKey: 'gestionables-tipo_gasto',
                  returnRouteKey: route.key,
                  defaultSegmentoId: segmentoId,
                });
              }}
              disabled={readOnly}
              accessibilityLabel="Crear tipo de gasto"
            />
          </View>

          {!segmentoId && (
            <Text style={styles.helperText}>
              Selecciona primero un segmento para ver los tipos de gasto.
            </Text>
          )}

          {segmentoId && tiposFiltrados.length === 0 && (
            <Text style={styles.helperText}>No hay tipos de gasto para este segmento.</Text>
          )}

          {segmentoId && tiposFiltrados.length > 0 && (
            <View style={styles.segmentosRow}>
              {tiposFiltrados.map((tipo) => (
                <View key={tipo.id} style={styles.segmentoWrapper}>
                  <PillButton
                    label={tipo.nombre}
                    selected={tipoId === tipo.id}
                    onPress={() => {
                      if (readOnly) return;
                      setTipoId((prev) => (prev === tipo.id ? null : tipo.id));
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Proveedor (selector con búsqueda + alta auxiliar) */}
        <View style={styles.field}>
          <InlineSearchSelect<Proveedor>
            label="Proveedor"
            onAddPress={handleAddProveedor}
            addAccessibilityLabel="Crear proveedor"
            disabled={readOnly}
            selected={proveedorSeleccionado}
            selectedLabel={(p: Proveedor) => p.nombre}
            onClear={handleClearProveedor}
            query={busquedaProveedor}
            onChangeQuery={setBusquedaProveedor}
            placeholder="Escribe para buscar proveedor"
            options={proveedoresFiltrados}
            optionKey={(p: Proveedor) => p.id}
            optionLabel={(p: Proveedor) => p.nombre}
            onSelect={(p: Proveedor) => {
              if (readOnly) return;
              setProveedorSeleccionado(p);
            }}
            emptyText="No hay proveedores que coincidan con la búsqueda."
          />
        </View>

        {/* Tienda */}
        <View style={styles.field}>
          <Text style={styles.label}>Tienda (opcional)</Text>
          <TextInput
            style={[styles.input, tienda.trim() !== '' && styles.inputFilled]}
            placeholder="Ej. MERCADONA, AMAZON, etc."
            value={tienda}
            onChangeText={setTienda}
            editable={!readOnly}
          />
        </View>
      </FormSection>

      {/* =======================
          IMPORTE Y CONDICIONES
         ======================= */}
      <FormSection title="Importe y condiciones">
        <View style={styles.field}>
          <Text style={styles.label}>Número de cuotas</Text>
          <TextInput
            style={[styles.input, String(numCuotas) !== '' && styles.inputFilled]}
            keyboardType="number-pad"
            value={String(numCuotas)}
            onChangeText={handleChangeNumCuotas}
            editable={!readOnly}
          />
        </View>

        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>Importe cuota</Text>
            <TextInput
              style={[
                styles.input,
                styles.amountInputBig,
                importeCuota.trim() !== '' && styles.inputFilled,
                lockImporteCuota && styles.inputDisabled,
              ]}
              editable={!readOnly && !lockImporteCuota}
              keyboardType="decimal-pad"
              value={importeCuota}
              onChangeText={handleChangeImporteCuota}
              placeholder="Ej. 250,00"
            />
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Importe total</Text>
            <TextInput
              style={[
                styles.input,
                styles.amountInputBig,
                importeTotal.trim() !== '' && styles.inputFilled,
                lockImporteTotal && styles.inputDisabled,
              ]}
              editable={!readOnly && !lockImporteTotal}
              keyboardType="decimal-pad"
              value={importeTotal}
              onChangeText={handleChangeImporteTotal}
              placeholder="Ej. 1.500,00"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Periodicidad</Text>
          <View style={styles.periodicidadRow}>
            {PERIODICIDADES.map((p) => (
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

        {/* Campos que solo tienen sentido en edición */}
        {isEdit && (
          <>
            <View style={styles.fieldRowTwoCols}>
              <View style={styles.col}>
                <Text style={styles.label}>Cuotas pagadas</Text>
                <TextInput
                  style={[styles.input, styles.inputAdvanced]}
                  keyboardType="number-pad"
                  value={String(cuotasPagadas)}
                  onChangeText={(txt) => setCuotasPagadas(Number(txt.replace(/\D/g, '')) || 0)}
                  editable={!readOnly}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Cuotas restantes</Text>
                <TextInput
                  style={[styles.input, styles.inputAdvanced, styles.inputDisabled]}
                  editable={false}
                  value={String(cuotasRestantes)}
                />
              </View>
            </View>

            <View style={styles.fieldRowTwoCols}>
              <View style={styles.col}>
                <Text style={styles.label}>Importe pendiente</Text>
                <TextInput
                  style={[styles.input, styles.inputAdvanced, styles.inputDisabled]}
                  editable={false}
                  value={
                    importePendiente
                      ? importePendiente.toLocaleString('es-ES', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : '0,00'
                  }
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Préstamo ID</Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputAdvanced,
                    prestamoId.trim() !== '' && styles.inputFilled,
                  ]}
                  value={prestamoId}
                  onChangeText={setPrestamoId}
                  placeholder="ID del préstamo"
                  editable={false}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Número de cuota</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputAdvanced,
                  String(numCuota) !== '' && styles.inputFilled,
                ]}
                keyboardType="number-pad"
                value={String(numCuota)}
                onChangeText={(txt) => setNumCuota(Number(txt.replace(/\D/g, '')) || 1)}
                editable={!readOnly}
              />
            </View>
          </>
        )}
      </FormSection>

      {/* =======================
          VINCULACIONES
         ======================= */}
      <FormSection title="Vinculaciones">
        {segmentoId === VIVIENDAS_SEGMENTO_ID && (
          <View style={styles.field}>
            <Text style={styles.label}>Vivienda</Text>
            <View style={styles.accountsRow}>
              {viviendasActivas.map((v) => (
                <View key={v.id} style={styles.accountPillWrapper}>
                  <AccountPill
                    label={v.referencia}
                    subLabel={v.direccion_completa ?? ''}
                    selected={viviendaId === v.id}
                    onPress={() => {
                      if (readOnly) return;
                      setViviendaId((prev) => (prev === v.id ? null : v.id));
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Cuenta de cargo</Text>
            <InlineAddButton
              onPress={() => {
                if (readOnly) return;
                console.log('TODO: crear nueva cuenta de cargo');
              }}
              disabled={readOnly}
              accessibilityLabel="Crear cuenta de cargo"
            />
          </View>

          <View style={styles.accountsRow}>
            {cuentas.map((cta) => (
              <View key={cta.id} style={styles.accountPillWrapper}>
                <AccountPill
                  label={cta.anagrama}
                  subLabel={`${cta.liquidez.toLocaleString('es-ES', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} €`}
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
            valueText={formatFechaCorta(fecha)}
            onPress={handleOpenDatePicker}
            disabled={readOnly}
          />

          {showDatePicker && (
            <DateTimePicker
              value={new Date(fecha)}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Rango de pago</Text>
          <View style={styles.rangoRow}>
            {RANGOS_PAGO.map((rango) => (
              <View key={rango} style={styles.rangoPillWrapper}>
                <PillButton
                  label={rango}
                  selected={rangoPago === rango}
                  onPress={() => {
                    if (readOnly) return;
                    setRangoPago(rango);
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      </FormSection>

      {/* =======================
          OPCIONES AVANZADAS
         ======================= */}
      <FormSection title="Opciones avanzadas">
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced((prev) => !prev)}
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
            <View style={styles.field}>
              <Text style={styles.label}>Referencia del gasto (opcional)</Text>
              <TextInput
                style={[styles.input, referenciaGasto.trim() !== '' && styles.inputFilled]}
                placeholder="Ej. LUZ_CASA_CENTRO_2025"
                value={referenciaGasto}
                onChangeText={setReferenciaGasto}
                editable={!readOnly}
              />
            </View>

            {isEdit && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Estado</Text>
                  <View style={styles.segmentosRow}>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Activo"
                        selected={activo}
                        onPress={() => {
                          if (readOnly) return;
                          setActivo((prev) => !prev);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="Pagado"
                        selected={pagado}
                        onPress={() => {
                          if (readOnly) return;
                          setPagado((prev) => !prev);
                        }}
                      />
                    </View>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="KPI"
                        selected={kpi}
                        onPress={() => {
                          if (readOnly) return;
                          setKpi((prev) => !prev);
                        }}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Creado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={createOn ? formatFechaCorta(createOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Inactivado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={inactivatedOn ? formatFechaCorta(inactivatedOn) : ''}
                    />
                  </View>
                </View>

                <View style={styles.fieldRowTwoCols}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Último pago</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={ultimoPagoOn ? formatFechaCorta(ultimoPagoOn) : ''}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Modificado el</Text>
                    <TextInput
                      style={[styles.input, styles.inputAdvanced]}
                      editable={false}
                      value={modifiedOn ? formatFechaCorta(modifiedOn) : ''}
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
          </>
        )}
      </FormSection>
    </FormScreen>
  );
};

export default GastoGestionableFormScreen;
