/**
 * Ruta: screens/gastos/GastoGestionableFormScreen.tsx
 * Versión: 1.8.0
 * Descripción:
 * Formulario de gasto gestionable para alta, edición, duplicado y consulta.
 *
 * Ajustes incluidos:
 * - Carga de detalle real del gasto mediante obtenerGasto(id) para no depender
 *   de objetos parciales recibidos por navegación.
 * - Visualización correcta de "Último pago" y del resto de metadatos avanzados.
 * - Filtro de proveedores por rama dentro de un desplegable.
 * - Mantiene toda la lógica previa: edición, duplicado, readonly, retorno desde
 *   AuxEntityForm, cálculo de importes/cuotas y guardado.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { colors, spacing } from '../../theme';

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
  obtenerGasto,
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
import {
  parseEuroToNumber,
  formatFechaCorta,
  formatDateTimeShort,
  appendMonthYearSuffix,
} from '../../utils/format';

type Props = {
  navigation: any;
  route: any;
};

const ALL_PROVIDER_RAMAS_KEY = '__ALL_PROVIDER_RAMAS__';

type ProviderRamaOption = {
  id: string;
  nombre: string;
};

function normalizePagoUnico(value: string): string {
  const v = (value || '').trim().toUpperCase();
  if (v === 'PAGO UNICO') return 'PAGO UNICO';
  return value;
}

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

function getProveedorRamaNombre(proveedor: Proveedor): string {
  const relName = proveedor?.rama_rel?.nombre?.trim();
  if (relName) return relName;
  const ramaId = proveedor?.rama_id?.trim();
  return ramaId || 'SIN RAMA';
}

export const GastoGestionableFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const skipResetOnNextFocusRef = useRef<boolean>(false);
  const hydratedFromGastoIdRef = useRef<string | null>(null);

  const preset: 'standard' | 'extra' = route?.params?.preset ?? 'standard';
  const duplicate: boolean = route?.params?.duplicate === true;

  const gastoSource: Gasto | null = route?.params?.gasto ?? null;
  const routeGastoId: string | null = gastoSource?.id ?? null;

  const [gastoDetalle, setGastoDetalle] = useState<Gasto | null>(gastoSource);
  const gastoActual: Gasto | null = gastoDetalle ?? gastoSource ?? null;
  const gastoAny = gastoActual as any;

  const isEdit = !!gastoSource && !duplicate;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const fromHome: boolean = route?.params?.fromHome === true;
  const fromDiaADia: boolean = route?.params?.fromDiaADia === true;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [loadingCatalogs, setLoadingCatalogs] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);

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
  // Estado del formulario
  // ========================
  const [nombre, setNombre] = useState<string>(gastoActual?.nombre ?? '');
  const [comentarios, setComentarios] = useState<string>((gastoAny?.comentarios ?? '') as string);
  const [comentariosDirty, setComentariosDirty] = useState<boolean>(false);

  const [segmentoId, setSegmentoId] = useState<string | null>(gastoActual?.segmento_id ?? null);
  const [tipoId, setTipoId] = useState<string | null>(gastoActual?.tipo_id ?? null);

  const [tipos, setTipos] = useState<TipoGasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);
  const [busquedaProveedor, setBusquedaProveedor] = useState('');
  const [ramaProveedorFiltroId, setRamaProveedorFiltroId] = useState<string>(ALL_PROVIDER_RAMAS_KEY);
  const [showProviderFilter, setShowProviderFilter] = useState<boolean>(false);

  const [tienda, setTienda] = useState<string>(gastoActual?.tienda ?? '');
  const [cuentaId, setCuentaId] = useState<string | null>(gastoActual?.cuenta_id ?? null);
  const [viviendaId, setViviendaId] = useState<string | null>(
    (gastoActual?.referencia_vivienda_id as string | null | undefined) ?? null
  );

  const [numCuotas, setNumCuotas] = useState<number>(gastoActual?.cuotas ?? 1);
  const [importeCuota, setImporteCuota] = useState<string>(
    gastoActual?.importe_cuota != null ? String(gastoActual.importe_cuota) : ''
  );
  const [importeTotal, setImporteTotal] = useState<string>(
    gastoActual?.importe != null ? String(gastoActual.importe) : ''
  );

  const [periodicidad, setPeriodicidad] = useState<string>(() => {
    if (gastoActual?.periodicidad) return normalizePagoUnico(gastoActual.periodicidad);
    if (!isEdit && preset === 'extra') return 'PAGO UNICO';
    return 'MENSUAL';
  });

  const [lockImporteCuota, setLockImporteCuota] = useState(false);
  const [lockImporteTotal, setLockImporteTotal] = useState(false);

  const [cuotasPagadas, setCuotasPagadas] = useState<number>(gastoAny?.cuotas_pagadas ?? 0);
  const [cuotasRestantes, setCuotasRestantes] = useState<number>(
    gastoAny?.cuotas_restantes ?? Math.max((gastoActual?.cuotas ?? 0) - (gastoAny?.cuotas_pagadas ?? 0), 0)
  );
  const [importePendiente, setImportePendiente] = useState<number>(gastoAny?.importe_pendiente ?? 0);
  const [prestamoId, setPrestamoId] = useState<string>(gastoAny?.prestamo_id ?? gastoAny?.prestamoId ?? '');
  const [numCuota, setNumCuota] = useState<number>(gastoAny?.num_cuota ?? 1);

  const hoyIso = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState<string>(gastoActual?.fecha ?? hoyIso);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [rangoPago, setRangoPago] = useState<string>(gastoActual?.rango_pago ?? '1-3');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [referenciaGasto, setReferenciaGasto] = useState<string>(
    (gastoActual?.referencia_gasto as string | null | undefined) ?? ''
  );

  const [activo, setActivo] = useState<boolean>(gastoAny?.activo ?? true);
  const [pagado, setPagado] = useState<boolean>(gastoAny?.pagado ?? false);
  const [kpi, setKpi] = useState<boolean>(gastoAny?.kpi ?? false);

  const isCotidiano = useMemo(() => segmentoId === 'COT-12345', [segmentoId]);

  const periodicidadesForPreset = useMemo<string[]>(() => {
    if (preset === 'extra') return ['PAGO UNICO'];
    return [...PERIODICIDADES];
  }, [preset]);

  const createOn: string | null = gastoAny?.createon ?? null;
  const modifiedOn: string | null = gastoAny?.modifiedon ?? null;
  const inactivatedOn: string | null = gastoAny?.inactivatedon ?? null;
  const ultimoPagoOn: string | null = gastoAny?.ultimo_pago_on ?? null;
  const userName: string | null = gastoAny?.user_nombre ?? gastoAny?.userName ?? gastoAny?.user_id ?? null;

  const proveedorRamaOptions = useMemo<ProviderRamaOption[]>(() => {
    const map = new Map<string, ProviderRamaOption>();

    for (const proveedor of proveedores ?? []) {
      const ramaId = proveedor?.rama_id?.trim();
      if (!ramaId) continue;

      if (!map.has(ramaId)) {
        map.set(ramaId, {
          id: ramaId,
          nombre: getProveedorRamaNombre(proveedor),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [proveedores]);

  const currentProviderFilterLabel = useMemo(() => {
    if (ramaProveedorFiltroId === ALL_PROVIDER_RAMAS_KEY) return 'TODOS';
    const found = proveedorRamaOptions.find((r) => r.id === ramaProveedorFiltroId);
    return found?.nombre ?? 'TODOS';
  }, [ramaProveedorFiltroId, proveedorRamaOptions]);

  // ========================
  // Helpers de hidratación
  // ========================
  const hydrateFormFromGasto = React.useCallback(
    (g: Gasto) => {
      const now = new Date();
      const hoy = now.toISOString().slice(0, 10);
      const per = normalizePagoUnico(g.periodicidad ?? '');

      setNombre(
        duplicate
          ? appendMonthYearSuffix(g.nombre ?? '', now)
          : (g.nombre ?? '')
      );

      setComentarios((g as any)?.comentarios ?? '');
      setComentariosDirty(false);

      setSegmentoId(g.segmento_id ?? null);
      setTipoId(g.tipo_id ?? null);

      setTienda(g.tienda ?? '');
      setCuentaId(g.cuenta_id ?? null);
      setViviendaId((g.referencia_vivienda_id as string | null | undefined) ?? null);

      setNumCuotas(g.cuotas ?? 1);
      setImporteCuota(g.importe_cuota != null ? String(g.importe_cuota) : '');
      setImporteTotal(g.importe != null ? String(g.importe) : '');

      setPeriodicidad(per || (preset === 'extra' ? 'PAGO UNICO' : 'MENSUAL'));

      setCuotasPagadas((g as any)?.cuotas_pagadas ?? 0);
      setCuotasRestantes(
        (g as any)?.cuotas_restantes ??
          Math.max((g?.cuotas ?? 0) - ((g as any)?.cuotas_pagadas ?? 0), 0)
      );
      setImportePendiente((g as any)?.importe_pendiente ?? 0);
      setPrestamoId((g as any)?.prestamo_id ?? (g as any)?.prestamoId ?? '');
      setNumCuota((g as any)?.num_cuota ?? 1);

      if (duplicate) {
        setFecha(hoy);
        setRangoPago(getRangoFromDateString(hoy));

        if (per === 'PAGO UNICO') {
          setPagado(true);
          setActivo(false);
          setKpi(false);
          setNumCuotas(1);
          setCuotasPagadas(1);
          setNumCuota(1);
        } else {
          setPagado((g as any)?.pagado ?? false);
          setActivo((g as any)?.activo ?? true);
          setKpi((g as any)?.kpi ?? false);
        }
      } else {
        setFecha(g.fecha ?? hoy);
        setRangoPago(g.rango_pago ?? '1-3');
        setPagado((g as any)?.pagado ?? false);
        setActivo((g as any)?.activo ?? true);
        setKpi((g as any)?.kpi ?? false);
      }

      setReferenciaGasto((g.referencia_gasto as string | null | undefined) ?? '');
      setLockImporteCuota(false);
      setLockImporteTotal(false);
    },
    [duplicate, preset]
  );

  // ========================
  // Carga de detalle real
  // ========================
  const loadDetalleGasto = React.useCallback(async () => {
    if (!routeGastoId) return;

    try {
      setLoadingDetail(true);
      const detalle = await obtenerGasto(routeGastoId);
      setGastoDetalle(detalle);
    } catch (err) {
      console.error('[GastoGestionableForm] Error cargando detalle del gasto', err);
    } finally {
      setLoadingDetail(false);
    }
  }, [routeGastoId]);

  useEffect(() => {
    void loadDetalleGasto();
  }, [loadDetalleGasto]);

  useEffect(() => {
    if (!gastoActual?.id) return;
    if (hydratedFromGastoIdRef.current === gastoActual.id) return;

    hydrateFormFromGasto(gastoActual);
    hydratedFromGastoIdRef.current = gastoActual.id;
  }, [gastoActual, hydrateFormFromGasto]);

  // ========================
  // Reset centralizado
  // ========================
  const resetFormToNew = React.useCallback(() => {
    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);

    hydratedFromGastoIdRef.current = null;

    setNombre('');
    setComentarios('');
    setComentariosDirty(false);

    setSegmentoId(null);
    setTipoId(null);

    setProveedorSeleccionado(null);
    setBusquedaProveedor('');
    setRamaProveedorFiltroId(ALL_PROVIDER_RAMAS_KEY);
    setShowProviderFilter(false);

    setTienda('');

    setCuentaId(null);
    setViviendaId(null);

    setNumCuotas(1);
    setImporteCuota('');
    setImporteTotal('');

    setPeriodicidad(preset === 'extra' ? 'PAGO UNICO' : 'MENSUAL');

    setLockImporteCuota(false);
    setLockImporteTotal(false);

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

    setActivo(true);
    setPagado(false);
    setKpi(false);

    console.log('[GastoGestionableForm][RESET] Form reseteado (Alta/Nuevo).');
  }, [preset]);

  const guardedResetOnFocus = React.useCallback(() => {
    const hasAuxResult = !!route?.params?.auxResult;

    if (hasAuxResult) {
      if (skipResetOnNextFocusRef.current) skipResetOnNextFocusRef.current = false;
      console.log('[GastoGestionableForm][RESET] Skip reset: auxResult pendiente (retorno AuxEntityForm).');
      return;
    }

    if (skipResetOnNextFocusRef.current) {
      skipResetOnNextFocusRef.current = false;
      console.log('[GastoGestionableForm][RESET] Skip reset: retorno inmediato desde pantalla hija (flag).');
      return;
    }

    resetFormToNew();
  }, [resetFormToNew, route?.params?.auxResult]);

  useResetFormOnFocus({
    readOnly,
    isEdit: isEdit || duplicate,
    auxResult: route?.params?.auxResult,
    onReset: guardedResetOnFocus,
  });

  // ========================
  // Retorno desde AuxEntityForm
  // ========================
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;
        if (!res) return;

        try {
          if (res.type === 'tipo_gasto' && res.item) {
            const nuevoTipo = res.item as TipoGasto;

            const seg = nuevoTipo.segmento_id ?? segmentoId ?? null;
            if (nuevoTipo.segmento_id && nuevoTipo.segmento_id !== segmentoId) {
              setSegmentoId(nuevoTipo.segmento_id);
            }

            const tiposRes = await fetchTiposGasto(seg ?? undefined);
            if (!alive) return;

            const mergedTipos = (() => {
              const map = new Map<string, TipoGasto>();
              map.set(nuevoTipo.id, nuevoTipo);
              for (const t of tiposRes ?? []) map.set(t.id, t);
              return Array.from(map.values());
            })();

            setTipos(mergedTipos);
            setTipoId(nuevoTipo.id);

            console.log('[GastoGestionableForm][AUX] Tipo gasto seleccionado:', nuevoTipo.id);
          }

          if (res.type === 'proveedor' && res.item) {
            const nuevoProv = res.item as Proveedor;

            const provRes = await fetchProveedores();
            if (!alive) return;

            const mergedProv = (() => {
              const map = new Map<string, Proveedor>();
              map.set(nuevoProv.id, nuevoProv);
              for (const p of provRes ?? []) map.set(p.id, p);
              return Array.from(map.values());
            })();

            setProveedores(mergedProv);
            setProveedorSeleccionado(nuevoProv);
            setBusquedaProveedor('');
            setRamaProveedorFiltroId(nuevoProv?.rama_id ?? ALL_PROVIDER_RAMAS_KEY);

            console.log('[GastoGestionableForm][AUX] Proveedor seleccionado:', nuevoProv.id);
          }
        } finally {
          navigation.setParams({ auxResult: undefined });
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation, segmentoId])
  );

  // ========================
  // Catálogos
  // ========================
  useEffect(() => {
    const loadStatic = async () => {
      try {
        setLoadingCatalogs(true);

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
      } finally {
        setLoadingCatalogs(false);
      }
    };

    void loadStatic();
  }, []);

  useEffect(() => {
    const loadTipos = async () => {
      try {
        const data = await fetchTiposGasto(segmentoId ?? undefined);
        setTipos(data);

        if (segmentoId && gastoActual && gastoActual.segmento_id === segmentoId) {
          setTipoId(gastoActual.tipo_id ?? null);
        } else {
          setTipoId((prev) => (data.some((t) => t.id === prev) ? prev : null));
        }
      } catch (err) {
        console.error('[GastoGestionableForm] Error cargando tipos de gasto', err);
      }
    };
    void loadTipos();
  }, [segmentoId, gastoActual]);

  useEffect(() => {
    if (!gastoActual || !gastoActual.proveedor_id) return;
    if (!proveedores.length) return;

    const found = proveedores.find((p) => p.id === gastoActual.proveedor_id);
    if (found) setProveedorSeleccionado(found);
  }, [gastoActual, proveedores]);

  useEffect(() => {
    if (!proveedorSeleccionado) return;
    if (!proveedores.length) return;

    const found = proveedores.find((p) => p.id === proveedorSeleccionado.id);
    if (found && found !== proveedorSeleccionado) setProveedorSeleccionado(found);
  }, [proveedores, proveedorSeleccionado]);

  useEffect(() => {
    if (preset !== 'extra') return;
    const per = normalizePagoUnico(periodicidad);
    if (per !== 'PAGO UNICO') {
      setPeriodicidad('PAGO UNICO');
    }
  }, [preset, periodicidad]);

  useEffect(() => {
    if (!isCotidiano) return;
    setLockImporteCuota(false);
    setLockImporteTotal(false);
  }, [isCotidiano]);

  useEffect(() => {
    const restantes = Math.max(numCuotas - cuotasPagadas, 0);
    setCuotasRestantes(restantes);

    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;
    setImportePendiente(restantes * cuotaNum);
  }, [numCuotas, cuotasPagadas, importeCuota]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const catalogPromises = [
        fetchProveedores(),
        fetchCuentas(),
        fetchViviendas(),
        fetchTiposGasto(segmentoId ?? undefined),
      ] as const;

      const [provRes, ctasRes, vivsRes, tiposRes] = await Promise.all(catalogPromises);

      setProveedores(provRes);
      setCuentas(ctasRes);
      setViviendas(vivsRes);
      setTipos(tiposRes);

      if (routeGastoId) {
        const detalle = await obtenerGasto(routeGastoId);
        setGastoDetalle(detalle);
        hydratedFromGastoIdRef.current = null;
      }
    } catch (err) {
      console.error('[GastoGestionableForm] Error al refrescar catálogos/detalle', err);
    } finally {
      setRefreshing(false);
    }
  };

  const tiposFiltrados = useMemo(() => {
    if (!segmentoId) return tipos;
    return tipos.filter((t) => t.segmento_id === segmentoId);
  }, [segmentoId, tipos]);

  const viviendasActivas = useMemo(() => viviendas.filter((v) => v.activo !== false), [viviendas]);

  const proveedoresFiltrados = useMemo(() => {
    const term = busquedaProveedor.trim().toLowerCase();

    let base = proveedores ?? [];

    if (ramaProveedorFiltroId !== ALL_PROVIDER_RAMAS_KEY) {
      base = base.filter((p) => (p.rama_id ?? null) === ramaProveedorFiltroId);
    }

    if (term) {
      base = base.filter((p) => p.nombre.toLowerCase().includes(term));
    }

    return base.slice(0, MAX_PROVEEDORES_SUGERENCIAS);
  }, [busquedaProveedor, proveedores, ramaProveedorFiltroId]);

  const handleChangeNumCuotas = (text: string) => {
    const n = Number(text.replace(/\D/g, ''));
    const cuotas = !n || n <= 0 ? 1 : n;
    setNumCuotas(cuotas);

    if (isCotidiano) {
      if (lockImporteCuota) setLockImporteCuota(false);
      if (lockImporteTotal) setLockImporteTotal(false);
      return;
    }

    const totalNum = parseEuroToNumber(importeTotal) ?? 0;
    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;

    if (!lockImporteTotal && cuotaNum > 0) {
      setImporteTotal(String(cuotaNum * cuotas));
    } else if (!lockImporteCuota && totalNum > 0) {
      setImporteCuota(String(totalNum / cuotas));
    }
  };

  const handleChangeImporteCuota = (text: string) => {
    setImporteCuota(text);

    if (isCotidiano) {
      if (lockImporteCuota) setLockImporteCuota(false);
      if (lockImporteTotal) setLockImporteTotal(false);
      return;
    }

    const cuotaNum = parseEuroToNumber(text) ?? 0;
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

    if (isCotidiano) {
      if (lockImporteCuota) setLockImporteCuota(false);
      if (lockImporteTotal) setLockImporteTotal(false);
      return;
    }

    const totalNum = parseEuroToNumber(text) ?? 0;
    if (!text) {
      setLockImporteCuota(false);
      return;
    }
    if (totalNum <= 0 || numCuotas <= 0) return;

    setImporteCuota(String(totalNum / numCuotas));
    setLockImporteCuota(true);
    setLockImporteTotal(false);
  };

  const handleOpenDatePicker = () => {
    if (readOnly) return;
    setShowDatePicker(true);
  };

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (!selectedDate) return;

    const iso = selectedDate.toISOString().slice(0, 10);
    setFecha(iso);
    setRangoPago(getRangoFromDateString(iso));
  };

  const handleAddProveedor = () => {
    if (readOnly) return;

    skipResetOnNextFocusRef.current = true;
    console.log('[GastoGestionableForm][NAV] Ir a AuxEntityForm(proveedor) -> skip reset on return.');

    navigation.navigate('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'gestionables',
      defaultRamaId: ramaProveedorFiltroId !== ALL_PROVIDER_RAMAS_KEY ? ramaProveedorFiltroId : null,
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

  const handleSave = async () => {
    if (readOnly) return;

    if (!nombre.trim()) return Alert.alert('Campo requerido', 'El nombre del gasto es obligatorio.');
    if (!segmentoId) return Alert.alert('Campo requerido', 'Debes seleccionar un segmento.');
    if (!tipoId) return Alert.alert('Campo requerido', 'Debes seleccionar un tipo de gasto.');
    if (!proveedorSeleccionado) return Alert.alert('Campo requerido', 'Debes seleccionar un proveedor.');
    if (!cuentaId) return Alert.alert('Campo requerido', 'Debes seleccionar una cuenta de cargo.');

    const cuotaNum = parseEuroToNumber(importeCuota) ?? 0;
    const totalNum = parseEuroToNumber(importeTotal) ?? 0;
    if (cuotaNum <= 0 && totalNum <= 0) {
      return Alert.alert(
        'Importe inválido',
        'Debes indicar un importe de cuota o un importe total mayor que cero.'
      );
    }

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
      comentarios,
      comentariosDirty,
    };

    try {
      if (isEdit && gastoActual?.id) {
        await actualizarGasto(gastoActual.id, {
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

        if (duplicate) {
          basePayload.pagado = pagado;
          basePayload.activo = activo;
          basePayload.kpi = kpi;
        }

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

  const title = 'Gasto gestionable';
  const subtitle = readOnly
    ? 'Consulta'
    : isEdit
      ? 'Edición de gasto'
      : duplicate
        ? 'Duplicado'
        : 'Nuevo gasto gestionable';

  const isScreenLoading = loadingCatalogs || loadingDetail;

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
      {isScreenLoading ? (
        <View style={stylesLocal.loader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={stylesLocal.loaderText}>Cargando datos del gasto…</Text>
        </View>
      ) : (
        <>
          <FormSection title="Datos básicos">
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

            <View style={styles.field}>
              <Text style={styles.label}>Comentarios</Text>
              <TextInput
                style={[styles.input, comentarios.trim() !== '' && styles.inputFilled]}
                placeholder="Añade notas o comentarios..."
                value={comentarios}
                onChangeText={(t) => {
                  setComentarios(t);
                  if (!comentariosDirty) setComentariosDirty(true);
                }}
                editable={!readOnly}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

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

                    skipResetOnNextFocusRef.current = true;
                    console.log('[GastoGestionableForm][NAV] Ir a AuxEntityForm(tipo_gasto) -> skip reset on return.');

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
                <Text style={styles.helperText}>Selecciona primero un segmento para ver los tipos de gasto.</Text>
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

            <View style={styles.field}>
              <TouchableOpacity
                style={stylesLocal.providerFilterToggle}
                onPress={() => setShowProviderFilter((prev) => !prev)}
              >
                <View style={stylesLocal.providerFilterToggleTextWrap}>
                  <Text style={styles.label}>Filtrar proveedores por rama</Text>
                  <Text style={styles.helperText}>
                    Filtro actual: {currentProviderFilterLabel}
                  </Text>
                </View>

                <Ionicons
                  name={showProviderFilter ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>

              {showProviderFilter && (
                <>
                  <View style={styles.segmentosRow}>
                    <View style={styles.segmentoWrapper}>
                      <PillButton
                        label="TODOS"
                        size="sm"
                        style={stylesLocal.providerFilterPill}
                        textStyle={stylesLocal.providerFilterPillText}
                        selected={ramaProveedorFiltroId === ALL_PROVIDER_RAMAS_KEY}
                        onPress={() => {
                          if (readOnly) return;
                          setRamaProveedorFiltroId(ALL_PROVIDER_RAMAS_KEY);
                        }}
                      />
                    </View>

                    {proveedorRamaOptions.map((rama) => (
                      <View key={rama.id} style={styles.segmentoWrapper}>
                        <PillButton
                          label={rama.nombre}
                          size="sm"
                          style={stylesLocal.providerFilterPill}
                          textStyle={stylesLocal.providerFilterPillText}
                          selected={ramaProveedorFiltroId === rama.id}
                          onPress={() => {
                            if (readOnly) return;
                            setRamaProveedorFiltroId(rama.id);
                          }}
                        />
                      </View>
                    ))}
                  </View>

                  <Text style={styles.helperText}>
                    Primero puedes acotar por rama y después buscar proveedor por nombre.
                  </Text>
                </>
              )}
            </View>

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
                {periodicidadesForPreset.map((p) => (
                  <View key={p} style={styles.periodicidadPillWrapper}>
                    <PillButton
                      label={p}
                      selected={normalizePagoUnico(periodicidad) === p}
                      onPress={() => {
                        if (readOnly) return;
                        setPeriodicidad(p);
                      }}
                    />
                  </View>
                ))}
              </View>
            </View>

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
                      style={[styles.input, styles.inputAdvanced, prestamoId.trim() !== '' && styles.inputFilled]}
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
                    style={[styles.input, styles.inputAdvanced, String(numCuota) !== '' && styles.inputFilled]}
                    keyboardType="number-pad"
                    value={String(numCuota)}
                    onChangeText={(txt) => setNumCuota(Number(txt.replace(/\D/g, '')) || 1)}
                    editable={!readOnly}
                  />
                </View>
              </>
            )}
          </FormSection>

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

          <FormSection title="Estado y planificación">
            <View style={styles.field}>
              <Text style={styles.label}>Fecha</Text>
              <FormDateButton valueText={formatFechaCorta(fecha)} onPress={handleOpenDatePicker} disabled={readOnly} />

              {showDatePicker && (
                <DateTimePicker value={new Date(fecha)} mode="date" display="default" onChange={handleDateChange} />
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

          <FormSection title="Opciones avanzadas">
            <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced((prev) => !prev)}>
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
                          value={createOn ? formatDateTimeShort(createOn) : ''}
                        />
                      </View>
                      <View style={styles.col}>
                        <Text style={styles.label}>Inactivado el</Text>
                        <TextInput
                          style={[styles.input, styles.inputAdvanced]}
                          editable={false}
                          value={inactivatedOn ? formatDateTimeShort(inactivatedOn) : ''}
                        />
                      </View>
                    </View>

                    <View style={styles.fieldRowTwoCols}>
                      <View style={styles.col}>
                        <Text style={styles.label}>Último pago</Text>
                        <TextInput
                          style={[styles.input, styles.inputAdvanced]}
                          editable={false}
                          value={ultimoPagoOn ? formatDateTimeShort(ultimoPagoOn) : ''}
                        />
                      </View>
                      <View style={styles.col}>
                        <Text style={styles.label}>Modificado el</Text>
                        <TextInput
                          style={[styles.input, styles.inputAdvanced]}
                          editable={false}
                          value={modifiedOn ? formatDateTimeShort(modifiedOn) : ''}
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
        </>
      )}
    </FormScreen>
  );
};

export default GastoGestionableFormScreen;

const stylesLocal = StyleSheet.create({
  loader: {
    flex: 1,
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 13,
  },
  providerFilterToggle: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerFilterToggleTextWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  providerFilterPill: {
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  providerFilterPillText: {
    fontSize: 11,
    lineHeight: 13,
  },
});