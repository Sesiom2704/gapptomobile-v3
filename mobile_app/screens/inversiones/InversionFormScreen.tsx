/**
 * Archivo: screens/patrimonio/InversionFormScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de alta/edición/consulta (readOnly) de una Inversión.
 *   - Carga catálogos (tipos de gasto filtrados por segmento INVERSION, proveedores),
 *     gestiona la lógica de formulario (validaciones + cálculos ROI/Retorno) y guardado.
 *
 * Maneja:
 *   - UI: formulario multipanel con secciones reutilizables (FormSection) y controles tipo “pill”.
 *   - Estado: local (useState) para campos del formulario y flags (readOnly/isEdit/duplicate).
 *   - Datos:
 *       - Lectura catálogos: /api/v1/tipos/gastos, /api/v1/tipos/segmentos, /api/v1/proveedores
 *       - Escritura inversión: POST/PUT /api/v1/inversiones
 *   - Navegación:
 *       - Soporta retorno condicionado (returnToTab/returnToScreen/returnToParams, fromHome).
 *       - Soporta alta auxiliar (AuxEntityForm) para tipo_gasto y proveedor (proveedor/dealer).
 *
 * Entradas / Salidas:
 *   - route.params:
 *       - inversion?: Inversion | null
 *       - duplicate?: boolean
 *       - readOnly?: boolean
 *       - returnToTab/returnToScreen/returnToParams
 *       - fromHome/fromPatrimonio
 *       - auxResult?: resultado de alta auxiliar (tipo_gasto / proveedor) + key
 *
 * Notas:
 *   - Segmento fijo: INVERSION (no se muestra selector de segmento).
 *   - Tipo de inversión: SOLO tipos cuyo segmento sea INVERSION.
 *   - Proveedor y Dealer: buscador InlineSearchSelect + botón crear (sugerencias limitadas).
 *   - Fecha de creación/modificación: NO se muestra por defecto (NOW/auto en backend).
 *   - Rentabilidad/retorno: cálculo bidireccional con Aporte.
 *   - Resultado final: solo visible en edición cuando el estado sea CERRADA.
 *   - Descripción: se mantiene el formato actual (multilínea).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';

import { PillButton } from '../../components/ui/PillButton';
import { InlineAddButton } from '../../components/ui/InlineAddButton';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { FormDateButton } from '../../components/ui/FormDateButton';
import { FormActionButton } from '../../components/ui/FormActionButton';

import { colors } from '../../theme';

import { formatFechaCorta, parseEuroToNumber } from '../../utils/format';
import { useResetFormOnFocus } from '../../utils/formsUtils';

import { api } from '../../services/api';

type Props = {
  navigation: any;
  route: any;
};

type Proveedor = { id: string; nombre: string };
type TipoGasto = { id: string; nombre: string; segmento_id: string | null; rama_id?: string | null };
type Segmento = { id: string; nombre: string };

type Inversion = {
  id: string;
  nombre: string;
  descripcion?: string | null;

  estado?: string | null;

  tipo_gasto_id: string;

  proveedor_id?: string | null;
  dealer_id?: string | null;

  fecha_inicio?: string | null;
  fecha_objetivo_salida?: string | null;
  fecha_cierre_real?: string | null;

  aporte_estimado?: number | null;
  aporte_final?: number | null;

  retorno_esperado_total?: number | null;
  retorno_final_total?: number | null;

  roi_esperado_pct?: number | null;
  roi_final_pct?: number | null;

  created_at?: string | null;
  updated_at?: string | null;
  moneda?: string | null;
  fase?: string | null;
};

const ESTADOS = [
  { id: 'ACTIVA', label: 'Activa' },
  { id: 'EN_ESTUDIO', label: 'En estudio' },
  { id: 'CERRADA', label: 'Cerrada' },
];

// Segmento fijo: “INVERSION”. Resolver por nombre vía API para evitar mismatch de IDs.
const SEGMENTO_INVERSION_FALLBACK_ID = 'INVERSION';

// Proveedor/Dealer: sugerencias limitadas a 4
const MAX_PROVEEDORES_SUGERENCIAS = 4;

function toNumberLoose(input: string): number {
  if (!input) return 0;
  const v = String(input).trim();

  const parsed = parseEuroToNumber?.(v);
  if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;

  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toFixedES(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2).replace('.', ',');
}

async function fetchProveedores(): Promise<Proveedor[]> {
  const resp = await api.get<Proveedor[]>('/api/v1/proveedores');
  return resp.data ?? [];
}

async function fetchSegmentosGasto(): Promise<Segmento[]> {
  const resp = await api.get<Segmento[]>('/api/v1/tipos/segmentos');
  return resp.data ?? [];
}

async function fetchTiposGasto(): Promise<TipoGasto[]> {
  const resp = await api.get<TipoGasto[]>('/api/v1/tipos/gastos');
  return resp.data ?? [];
}

async function crearInversion(payload: any): Promise<any> {
  const resp = await api.post('/api/v1/inversiones', payload);
  return resp.data;
}

async function actualizarInversion(id: string, payload: any): Promise<any> {
  const resp = await api.put(`/api/v1/inversiones/${id}`, payload);
  return resp.data;
}

export const InversionFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const inversionSource: Inversion | null = route?.params?.inversion ?? null;
  const inversionAny = inversionSource as any;

  const duplicate: boolean = route?.params?.duplicate === true;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const isEdit = !!inversionSource && !duplicate;

  const fromHome: boolean = route?.params?.fromHome === true;
  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const handleBack = () => {
    if (returnToTab) {
      if (returnToScreen) {
        navigation.navigate(returnToTab, { screen: returnToScreen, params: returnToParams });
      } else {
        navigation.navigate(returnToTab);
      }
      return;
    }

    if (fromHome) {
      navigation.navigate('HomeTab');
      return;
    }

    navigation.goBack();
  };

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [tiposGasto, setTiposGasto] = useState<TipoGasto[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [segmentoInversionId, setSegmentoInversionId] = useState<string>(SEGMENTO_INVERSION_FALLBACK_ID);

  const [refreshing, setRefreshing] = useState(false);

  const [nombre, setNombre] = useState<string>(inversionSource?.nombre ?? '');
  const [descripcion, setDescripcion] = useState<string>(inversionSource?.descripcion ?? '');

  const [estado, setEstado] = useState<string>(inversionSource?.estado ?? 'ACTIVA');

  const [tipoGastoId, setTipoGastoId] = useState<string | null>(inversionSource?.tipo_gasto_id ?? null);

  const [proveedorSel, setProveedorSel] = useState<Proveedor | null>(null);
  const [dealerSel, setDealerSel] = useState<Proveedor | null>(null);

  const [qProv, setQProv] = useState('');
  const [qDealer, setQDealer] = useState('');

  const hoyIso = new Date().toISOString().slice(0, 10);

  const [fechaInicio, setFechaInicio] = useState<string>(inversionSource?.fecha_inicio ?? hoyIso);
  const [fechaObjetivoSalida, setFechaObjetivoSalida] = useState<string>(inversionSource?.fecha_objetivo_salida ?? '');
  const [fechaCierreReal, setFechaCierreReal] = useState<string>(inversionSource?.fecha_cierre_real ?? '');

  const [showPicker, setShowPicker] = useState<null | 'inicio' | 'objetivo' | 'cierre'>(null);

  type ProfitEdit = 'aporte' | 'roi' | 'retorno' | null;
  const lastProfitEdit = useRef<ProfitEdit>(null);

  const [aporteEstimado, setAporteEstimado] = useState<string>(
    inversionSource?.aporte_estimado != null ? String(inversionSource.aporte_estimado) : ''
  );
  const [roiEsperadoPct, setRoiEsperadoPct] = useState<string>(
    inversionSource?.roi_esperado_pct != null ? String(inversionSource.roi_esperado_pct) : ''
  );
  const [retornoEsperado, setRetornoEsperado] = useState<string>(
    inversionSource?.retorno_esperado_total != null ? String(inversionSource.retorno_esperado_total) : ''
  );

  const [aporteFinal, setAporteFinal] = useState<string>(
    inversionSource?.aporte_final != null ? String(inversionSource.aporte_final) : ''
  );
  const [roiFinalPct, setRoiFinalPct] = useState<string>(
    inversionSource?.roi_final_pct != null ? String(inversionSource.roi_final_pct) : ''
  );
  const [retornoFinal, setRetornoFinal] = useState<string>(
    inversionSource?.retorno_final_total != null ? String(inversionSource.retorno_final_total) : ''
  );

  // Opciones avanzadas (solo edición)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [moneda, setMoneda] = useState<string>(inversionAny?.moneda ?? inversionSource?.moneda ?? 'EUR');
  const [fase, setFase] = useState<string>(inversionAny?.fase ?? inversionSource?.fase ?? '');
  const createdAt: string | null = inversionAny?.created_at ?? inversionSource?.created_at ?? null;
  const updatedAt: string | null = inversionAny?.updated_at ?? inversionSource?.updated_at ?? null;

  // Override de updated_at (solo si lo quieres forzar en backend)
  const [overrideUpdatedAt, setOverrideUpdatedAt] = useState<string>('');
  const [showUpdatedAtPicker, setShowUpdatedAtPicker] = useState(false);

  const showFinalBlock = isEdit && estado === 'CERRADA';

  const resetFormToNew = React.useCallback(() => {
    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);

    setNombre('');
    setDescripcion('');

    setEstado('ACTIVA');

    setTipoGastoId(null);

    setProveedorSel(null);
    setDealerSel(null);
    setQProv('');
    setQDealer('');

    setFechaInicio(hoy);
    setFechaObjetivoSalida('');
    setFechaCierreReal('');
    setShowPicker(null);

    setAporteEstimado('');
    setRoiEsperadoPct('');
    setRetornoEsperado('');

    // Resultado final oculto en inserción: igual reseteamos a vacío
    setAporteFinal('');
    setRoiFinalPct('');
    setRetornoFinal('');

    // Advanced
    setShowAdvanced(false);
    setMoneda('EUR');
    setFase('');
    setOverrideUpdatedAt('');
    setShowUpdatedAtPicker(false);
  }, []);

  useResetFormOnFocus({
    readOnly,
    // ✅ si volvemos con auxResult, NO queremos resetear (si no, perdemos la preselección)
    isEdit: isEdit || duplicate || !!route?.params?.auxResult,
    auxResult: route?.params?.auxResult,
    onReset: resetFormToNew,
  });

  useEffect(() => {
    const loadStatic = async () => {
      try {
        const [provRes, segRes, tiposRes] = await Promise.all([
          fetchProveedores(),
          fetchSegmentosGasto(),
          fetchTiposGasto(),
        ]);

        setProveedores(provRes);
        setSegmentos(segRes);
        setTiposGasto(tiposRes);

        const invSeg =
          (segRes ?? []).find((s) => String(s.nombre ?? '').toUpperCase().includes('INVERSION')) ??
          (segRes ?? []).find((s) => String(s.id ?? '').toUpperCase().includes('INVERSION'));

        setSegmentoInversionId(invSeg?.id ?? SEGMENTO_INVERSION_FALLBACK_ID);
      } catch (err) {
        console.error('[InversionForm] Error cargando catálogos', err);
      }
    };

    void loadStatic();
  }, []);

  useEffect(() => {
    if (!isEdit || !inversionSource) return;
    if (!proveedores.length) return;

    if (inversionSource.proveedor_id) {
      const found = proveedores.find((p) => p.id === inversionSource.proveedor_id);
      if (found) setProveedorSel(found);
    }
    if (inversionSource.dealer_id) {
      const found = proveedores.find((p) => p.id === inversionSource.dealer_id);
      if (found) setDealerSel(found);
    }
  }, [isEdit, inversionSource, proveedores]);

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;
        if (!res) return;

        try {
          if (res.type === 'tipo_gasto' && res.item) {
            const nuevoTipo = res.item as TipoGasto;

            const tiposRes = await fetchTiposGasto();
            if (!alive) return;

            const merged = (() => {
              const map = new Map<string, TipoGasto>();
              map.set(nuevoTipo.id, nuevoTipo);
              for (const t of tiposRes ?? []) map.set(t.id, t);
              return Array.from(map.values());
            })();

            setTiposGasto(merged);

            if ((nuevoTipo.segmento_id ?? '') === segmentoInversionId) {
              setTipoGastoId(nuevoTipo.id);
            }
          }

          if (res.type === 'proveedor' && res.item) {
            const nuevoProv = res.item as Proveedor;

            // 1) Preselección inmediata (no depende de fetch)
            const key = String(res.key ?? '').toLowerCase();
            const isDealer = key.includes('dealer');

            if (isDealer) {
                setDealerSel(nuevoProv);
                setQDealer('');
            } else {
                setProveedorSel(nuevoProv);
                setQProv('');
            }

            // 2) Merge local inmediato para que el seleccionado “exista” en options
            setProveedores((prev) => {
                const map = new Map<string, Proveedor>();
                map.set(nuevoProv.id, nuevoProv);
                for (const p of prev ?? []) map.set(p.id, p);
                return Array.from(map.values());
            });

            // 3) Refresco catálogo (si falla, no rompe la preselección)
            try {
                const provRes = await fetchProveedores();
                if (!alive) return;

                setProveedores((prev) => {
                const map = new Map<string, Proveedor>();
                // siempre garantizamos que el nuevo está
                map.set(nuevoProv.id, nuevoProv);
                for (const p of provRes ?? []) map.set(p.id, p);
                for (const p of prev ?? []) map.set(p.id, p);
                return Array.from(map.values());
                });
            } catch (e) {
                // si falla, nos quedamos con el merge local
                console.warn('[InversionForm] fetchProveedores falló tras auxResult, se mantiene merge local');
            }
            }

        } finally {
          navigation.setParams({ auxResult: undefined });
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation, segmentoInversionId])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [provRes, segRes, tiposRes] = await Promise.all([
        fetchProveedores(),
        fetchSegmentosGasto(),
        fetchTiposGasto(),
      ]);

      setProveedores(provRes);
      setSegmentos(segRes);
      setTiposGasto(tiposRes);

      const invSeg =
        (segRes ?? []).find((s) => String(s.nombre ?? '').toUpperCase().includes('INVERSION')) ??
        (segRes ?? []).find((s) => String(s.id ?? '').toUpperCase().includes('INVERSION'));
      setSegmentoInversionId(invSeg?.id ?? SEGMENTO_INVERSION_FALLBACK_ID);
    } catch (err) {
      console.error('[InversionForm] Error al refrescar catálogos', err);
    } finally {
      setRefreshing(false);
    }
  };

  const tiposInversion = useMemo(() => {
    const segId = segmentoInversionId;
    return (tiposGasto ?? []).filter((t) => (t.segmento_id ?? '') === segId);
  }, [tiposGasto, segmentoInversionId]);

  const proveedoresFiltrados = useMemo(() => {
    const term = qProv.trim().toLowerCase();
    let base = proveedores ?? [];
    if (term) base = base.filter((p) => p.nombre.toLowerCase().includes(term));
    return base.slice(0, MAX_PROVEEDORES_SUGERENCIAS);
  }, [qProv, proveedores]);

  const dealersFiltrados = useMemo(() => {
    const term = qDealer.trim().toLowerCase();
    let base = proveedores ?? [];
    if (term) base = base.filter((p) => p.nombre.toLowerCase().includes(term));
    return base.slice(0, MAX_PROVEEDORES_SUGERENCIAS);
  }, [qDealer, proveedores]);

  const onChangeAporteEstimado = (txt: string) => {
    setAporteEstimado(txt);
    lastProfitEdit.current = 'aporte';

    const a = toNumberLoose(txt);
    if (a <= 0) return;

    const p = toNumberLoose(roiEsperadoPct);
    const r = toNumberLoose(retornoEsperado);

    if (roiEsperadoPct.trim() !== '') {
      const ret = a * (1 + p / 100);
      setRetornoEsperado(toFixedES(ret));
      return;
    }

    if (retornoEsperado.trim() !== '' && r > 0) {
      const pct = ((r / a) - 1) * 100;
      setRoiEsperadoPct(toFixedES(pct));
    }
  };

  const onChangeRoiEsperado = (txt: string) => {
    setRoiEsperadoPct(txt);
    lastProfitEdit.current = 'roi';

    const a = toNumberLoose(aporteEstimado);
    const p = toNumberLoose(txt);
    if (a <= 0) return;

    const ret = a * (1 + p / 100);
    setRetornoEsperado(toFixedES(ret));
  };

  const onChangeRetornoEsperado = (txt: string) => {
    setRetornoEsperado(txt);
    lastProfitEdit.current = 'retorno';

    const a = toNumberLoose(aporteEstimado);
    const r = toNumberLoose(txt);
    if (a <= 0 || r <= 0) return;

    const pct = ((r / a) - 1) * 100;
    setRoiEsperadoPct(toFixedES(pct));
  };

  const openPicker = (k: 'inicio' | 'objetivo' | 'cierre') => {
    if (readOnly) return;
    setShowPicker(k);
  };

  const onDateChange = (_e: DateTimePickerEvent, selectedDate?: Date) => {
    const key = showPicker;
    setShowPicker(null);
    if (!key) return;
    if (!selectedDate) return;

    const iso = selectedDate.toISOString().slice(0, 10);

    if (key === 'inicio') setFechaInicio(iso);
    if (key === 'objetivo') setFechaObjetivoSalida(iso);
    if (key === 'cierre') setFechaCierreReal(iso);
  };

  const handleAddTipoInversion = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'tipo_gasto',
      origin: 'patrimonio',
      returnKey: 'inversion-tipo_gasto',
      returnRouteKey: route.key,
      defaultSegmentoId: segmentoInversionId,
    });
  };

  const handleAddProveedor = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'patrimonio',
      returnKey: 'inversion-proveedor',
      returnRouteKey: route.key,
    });
  };

  const handleAddDealer = () => {
    if (readOnly) return;

    navigation.navigate('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'patrimonio',
      returnKey: 'inversion-dealer',
      returnRouteKey: route.key,
    });
  };

  const handleSave = async () => {
    if (readOnly) return;

    if (!nombre.trim()) {
      Alert.alert('Campo requerido', 'El nombre de la inversión es obligatorio.');
      return;
    }

    if (!tipoGastoId) {
      Alert.alert('Campo requerido', 'Debes seleccionar un tipo de inversión.');
      return;
    }

    if (!estado) {
      Alert.alert('Campo requerido', 'Debes seleccionar un estado.');
      return;
    }

    const aEst = aporteEstimado.trim() ? toNumberLoose(aporteEstimado) : null;
    const roiEst = roiEsperadoPct.trim() ? toNumberLoose(roiEsperadoPct) : null;
    const retEst = retornoEsperado.trim() ? toNumberLoose(retornoEsperado) : null;

    if ((roiEst != null || retEst != null) && (!aEst || aEst <= 0)) {
      Alert.alert('Datos incompletos', 'Si indicas rentabilidad o retorno, debes indicar Aporte estimado.');
      return;
    }

    const payload: any = {
      nombre: nombre.trim(),
      descripcion: descripcion,
      estado,

      tipo_gasto_id: tipoGastoId,

      proveedor_id: proveedorSel?.id ?? null,
      dealer_id: dealerSel?.id ?? null,

      fecha_inicio: fechaInicio || null,
      fecha_objetivo_salida: fechaObjetivoSalida || null,
      fecha_cierre_real: fechaCierreReal || null,

      aporte_estimado: aEst,
      roi_esperado_pct: roiEst,
      retorno_esperado_total: retEst,

      // Resultado final: solo si estamos editando y está cerrada
      aporte_final: showFinalBlock && aporteFinal.trim() ? toNumberLoose(aporteFinal) : null,
      roi_final_pct: showFinalBlock && roiFinalPct.trim() ? toNumberLoose(roiFinalPct) : null,
      retorno_final_total: showFinalBlock && retornoFinal.trim() ? toNumberLoose(retornoFinal) : null,

      // Avanzado (solo edición)
      moneda: isEdit ? (moneda || 'EUR') : undefined,
      fase: isEdit ? (fase?.trim() || null) : undefined,
    };

    // Override de updated_at (solo si se informa en edición)
    if (isEdit && overrideUpdatedAt.trim()) {
      payload.updated_at = overrideUpdatedAt; // backend puede ignorarlo si no lo permites
    }

    try {
      if (isEdit && inversionSource?.id) {
        await actualizarInversion(inversionSource.id, payload);
        Alert.alert('Éxito', 'Inversión actualizada correctamente.', [{ text: 'OK', onPress: handleBack }]);
      } else {
        await crearInversion(payload);
        Alert.alert('Éxito', 'Inversión guardada correctamente.', [{ text: 'OK', onPress: handleBack }]);
      }
    } catch (err) {
      console.error('[InversionForm] Error al guardar', err);
      Alert.alert('Error', 'Ha ocurrido un error al guardar la inversión. Revisa los datos e inténtalo de nuevo.');
    }
  };

  const title = 'Inversión';
  const subtitle =
    readOnly ? 'Consulta' :
    isEdit ? 'Edición de inversión' :
    duplicate ? 'Duplicado' :
    'Nueva inversión';

  const centeredAmountInputStyle = [
    styles.input,
    styles.amountInputBig,
    { textAlign: 'center', alignSelf: 'center', width: '78%' } as any,
  ];

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
            label={isEdit ? 'Guardar cambios' : 'Guardar inversión'}
            onPress={handleSave}
            iconName="save-outline"
            disabled={false}
            variant="primary"
          />
        ) : null
      }
    >
      <FormSection title="Datos básicos">
        <View style={styles.field}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={[styles.input, nombre.trim() !== '' && styles.inputFilled]}
            placeholder="Ej. JV NPL MADRID 2026"
            value={nombre}
            onChangeText={setNombre}
            editable={!readOnly}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Descripción (opcional)</Text>
          <TextInput
            style={[
              styles.input,
              { minHeight: 110, textAlignVertical: 'top' } as any,
              descripcion.trim() !== '' && styles.inputFilled,
            ]}
            placeholder="Detalles, notas, tesis, hitos, etc."
            value={descripcion}
            onChangeText={setDescripcion}
            editable={!readOnly}
            multiline
            numberOfLines={6}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Estado</Text>
          <View style={styles.segmentosRow}>
            {ESTADOS.map((st) => (
              <View key={st.id} style={styles.segmentoWrapper}>
                <PillButton
                  label={st.label}
                  selected={estado === st.id}
                  onPress={() => {
                    if (readOnly) return;
                    setEstado(st.id);
                  }}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Tipo de inversión</Text>
            <InlineAddButton
              onPress={handleAddTipoInversion}
              disabled={readOnly}
              accessibilityLabel="Crear tipo de inversión"
            />
          </View>

          {tiposInversion.length === 0 ? (
            <Text style={styles.helperText}>No hay tipos de inversión en el segmento INVERSION.</Text>
          ) : (
            <View style={styles.segmentosRow}>
              {tiposInversion.map((tipo) => (
                <View key={tipo.id} style={styles.segmentoWrapper}>
                  <PillButton
                    label={tipo.nombre}
                    selected={tipoGastoId === tipo.id}
                    onPress={() => {
                      if (readOnly) return;
                      setTipoGastoId((prev) => (prev === tipo.id ? null : tipo.id));
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </FormSection>

      <FormSection title="Contrapartes">
        <View style={styles.field}>
          <InlineSearchSelect<Proveedor>
            label="Proveedor"
            onAddPress={handleAddProveedor}
            addAccessibilityLabel="Crear proveedor"
            disabled={readOnly}
            selected={proveedorSel}
            selectedLabel={(p) => p.nombre}
            onClear={() => {
              if (readOnly) return;
              setProveedorSel(null);
              setQProv('');
            }}
            query={qProv}
            onChangeQuery={setQProv}
            placeholder="Escribe para buscar proveedor"
            options={proveedoresFiltrados}
            optionKey={(p) => p.id}
            optionLabel={(p) => p.nombre}
            onSelect={(p) => {
              if (readOnly) return;
              setProveedorSel(p);
            }}
            emptyText="No hay proveedores que coincidan con la búsqueda."
          />
        </View>

        <View style={styles.field}>
          <InlineSearchSelect<Proveedor>
            label="Dealer"
            onAddPress={handleAddDealer}
            addAccessibilityLabel="Crear dealer"
            disabled={readOnly}
            selected={dealerSel}
            selectedLabel={(p) => p.nombre}
            onClear={() => {
              if (readOnly) return;
              setDealerSel(null);
              setQDealer('');
            }}
            query={qDealer}
            onChangeQuery={setQDealer}
            placeholder="Escribe para buscar dealer"
            options={dealersFiltrados}
            optionKey={(p) => p.id}
            optionLabel={(p) => p.nombre}
            onSelect={(p) => {
              if (readOnly) return;
              setDealerSel(p);
            }}
            emptyText="No hay dealers que coincidan con la búsqueda."
          />
        </View>
      </FormSection>

      <FormSection title="Rentabilidad esperada">
        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>Aporte estimado</Text>
            <TextInput
              style={[
                styles.input,
                styles.amountInputBig,
                aporteEstimado.trim() !== '' && styles.inputFilled,
              ]}
              keyboardType="decimal-pad"
              value={aporteEstimado}
              onChangeText={onChangeAporteEstimado}
              editable={!readOnly}
              placeholder="Ej. 50.000,00"
            />
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Rentabilidad (%)</Text>
            <TextInput
              style={[
                styles.input,
                styles.amountInputBig,
                roiEsperadoPct.trim() !== '' && styles.inputFilled,
              ]}
              keyboardType="decimal-pad"
              value={roiEsperadoPct}
              onChangeText={onChangeRoiEsperado}
              editable={!readOnly}
              placeholder="Ej. 15,00"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Retorno esperado</Text>

          {/* Contenedor centrado */}
          <View style={{ alignItems: 'center' }}>
            <TextInput
              style={[
                ...centeredAmountInputStyle,
                retornoEsperado.trim() !== '' && styles.inputFilled,
              ]}
              keyboardType="decimal-pad"
              value={retornoEsperado}
              onChangeText={onChangeRetornoEsperado}
              editable={!readOnly}
              placeholder="Ej. 57.500,00"
            />
          </View>

          <Text style={styles.helperText}>
            Si rellenas Aporte + % se calcula el Retorno. Si rellenas Aporte + Retorno se calcula la %.
          </Text>
        </View>
      </FormSection>

      <FormSection title="Planificación">
        <View style={styles.field}>
          <Text style={styles.label}>Fecha inicio</Text>
          <FormDateButton
            valueText={fechaInicio ? formatFechaCorta(fechaInicio) : '—'}
            onPress={() => openPicker('inicio')}
            disabled={readOnly}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Fecha objetivo salida (opcional)</Text>
          <FormDateButton
            valueText={fechaObjetivoSalida ? formatFechaCorta(fechaObjetivoSalida) : '—'}
            onPress={() => openPicker('objetivo')}
            disabled={readOnly}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Fecha cierre real (opcional)</Text>
          <FormDateButton
            valueText={fechaCierreReal ? formatFechaCorta(fechaCierreReal) : '—'}
            onPress={() => openPicker('cierre')}
            disabled={readOnly}
          />
        </View>

        {showPicker && (
          <DateTimePicker
            value={
              new Date(
                (showPicker === 'inicio' ? fechaInicio :
                 showPicker === 'objetivo' ? (fechaObjetivoSalida || hoyIso) :
                 (fechaCierreReal || hoyIso))
              )
            }
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </FormSection>

      {/* Resultado final: oculto en inserción; solo aparece en edición y cuando está CERRADA */}
      {showFinalBlock && (
        <FormSection title="Resultado final">
          <View style={styles.fieldRowTwoCols}>
            <View style={styles.col}>
              <Text style={styles.label}>Aporte final</Text>
              <TextInput
                style={[styles.input, styles.amountInputBig, aporteFinal.trim() !== '' && styles.inputFilled]}
                keyboardType="decimal-pad"
                value={aporteFinal}
                onChangeText={setAporteFinal}
                editable={!readOnly}
                placeholder="Ej. 48.000,00"
              />
            </View>

            <View style={styles.col}>
              <Text style={styles.label}>ROI final (%)</Text>
              <TextInput
                style={[styles.input, styles.amountInputBig, roiFinalPct.trim() !== '' && styles.inputFilled]}
                keyboardType="decimal-pad"
                value={roiFinalPct}
                onChangeText={setRoiFinalPct}
                editable={!readOnly}
                placeholder="Ej. 22,50"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Retorno final</Text>

            {/* Contenedor centrado */}
            <View style={{ alignItems: 'center' }}>
              <TextInput
                style={[
                  ...centeredAmountInputStyle,
                  retornoFinal.trim() !== '' && styles.inputFilled,
                ]}
                keyboardType="decimal-pad"
                value={retornoFinal}
                onChangeText={setRetornoFinal}
                editable={!readOnly}
                placeholder="Ej. 58.800,00"
              />
            </View>
          </View>
        </FormSection>
      )}

      {/* Opciones avanzadas: solo edición */}
      {isEdit && (
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
              <View style={styles.fieldRowTwoCols}>
                <View style={styles.col}>
                  <Text style={styles.label}>Moneda</Text>
                  <TextInput
                    style={[styles.input, moneda.trim() !== '' && styles.inputFilled]}
                    value={moneda}
                    onChangeText={setMoneda}
                    editable={!readOnly}
                    placeholder="EUR"
                  />
                </View>

                <View style={styles.col}>
                  <Text style={styles.label}>Fase (opcional)</Text>
                  <TextInput
                    style={[styles.input, fase.trim() !== '' && styles.inputFilled]}
                    value={fase}
                    onChangeText={setFase}
                    editable={!readOnly}
                    placeholder="Ej. DUE DILIGENCE"
                  />
                </View>
              </View>

              <View style={styles.fieldRowTwoCols}>
                <View style={styles.col}>
                  <Text style={styles.label}>Creado el</Text>
                  <TextInput
                    style={[styles.input, styles.inputAdvanced]}
                    editable={false}
                    value={createdAt ? formatFechaCorta(createdAt) : ''}
                  />
                </View>

                <View style={styles.col}>
                  <Text style={styles.label}>Modificado el</Text>
                  <TextInput
                    style={[styles.input, styles.inputAdvanced]}
                    editable={false}
                    value={updatedAt ? formatFechaCorta(updatedAt) : ''}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Forzar “Modificado el” (override)</Text>
                <FormDateButton
                  valueText={overrideUpdatedAt ? formatFechaCorta(overrideUpdatedAt) : '—'}
                  onPress={() => {
                    if (readOnly) return;
                    setShowUpdatedAtPicker(true);
                  }}
                  disabled={readOnly}
                />

                {showUpdatedAtPicker && (
                  <DateTimePicker
                    value={new Date(overrideUpdatedAt || hoyIso)}
                    mode="date"
                    display="default"
                    onChange={(_e: DateTimePickerEvent, d?: Date) => {
                      setShowUpdatedAtPicker(false);
                      if (!d) return;
                      setOverrideUpdatedAt(d.toISOString().slice(0, 10));
                    }}
                  />
                )}

                <Text style={styles.helperText}>
                  Solo útil para depuración. Si el backend ignora updated_at, no tendrá efecto.
                </Text>
              </View>
            </>
          )}
        </FormSection>
      )}
    </FormScreen>
  );
};

export default InversionFormScreen;
