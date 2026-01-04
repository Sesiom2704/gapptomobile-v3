/**
 * Archivo: screens/gastos/GastoCotidianoFormScreen.tsx
 *
 * Fix UX:
 *   - No resetear el formulario al volver de crear proveedor (se elimina reset al foco).
 *   - Confirmación al volver si hay datos sin guardar ("si sales perderás los datos").
 *   - Reset solo cuando:
 *       a) guardas gasto (antes de salir), o
 *       b) sales confirmando descarte.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { colors } from '../../theme';
import { commonFormStyles } from '../../components/forms/formStyles';

import FormScreen from '../../components/forms/FormScreen';
import { FormActionButton } from '../../components/ui/FormActionButton';
import RepartoRow from '../../components/forms/RepartoRow';
import { FormDateButton } from '../../components/ui/FormDateButton';

import {
  GastoCotidiano,
  CrearGastoCotidianoPayload,
  crearGastoCotidiano,
  actualizarGastoCotidiano,
  fetchProveedores,
  fetchCuentas,
  Proveedor,
  Cuenta,
} from '../../services/gastosCotidianosApi';

import {
  TIPOS_COTIDIANO,
  RAMA_POR_TIPO,
  EVENTO_OPTIONS,
  TIPO_RESTAURANTES_ID,
  TIPO_GASOLINA_ID,
} from '../../constants/gastosCotidianos';
import { MAX_PROVEEDORES_SUGERENCIAS } from '../../constants/general';
import { parseEuroToNumber, formatFechaCorta } from '../../utils/format';

type Props = {
  navigation: any;
  route: any;
};

export const GastoCotidianoFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const gastoEdit: GastoCotidiano | null = route?.params?.gasto ?? null;
  const isEdit = !!gastoEdit;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  // flags legacy + retorno explícito
  const fromHome: boolean = route?.params?.fromHome === true;
  const fromDiaADia: boolean = route?.params?.fromDiaADia === true;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const doNavigateBack = () => {
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

  const hoyIso = new Date().toISOString().slice(0, 10);

  // ========================
  // Estado principal
  // ========================
  const [fecha, setFecha] = useState<string>(gastoEdit?.fecha ?? hoyIso);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ========================
  // V3: Importe Total + TipoPago + Cantidad + Importe (mi parte) + Participo
  // ========================
  const initTipoPago = (() => {
    const tp = gastoEdit?.tipo_pago;
    if (tp === 1 || tp === 2 || tp === 3 || tp === 4) return tp;
    return (gastoEdit?.pagado ?? true) ? 1 : 2;
  })();

  const initImporteTotal = (() => {
    const it = gastoEdit?.importe_total;
    if (it != null) return String(it);
    const imp = gastoEdit?.importe;
    return imp != null ? String(imp) : '';
  })();

  const initCantidad = (() => {
    const c = gastoEdit?.cantidad;
    if (c != null) return String(c);
    if (initTipoPago === 3) return '2';
    return '1';
  })();

  const initImporteParte = (() => {
    const imp = gastoEdit?.importe;
    return imp != null ? String(imp) : '';
  })();

  const initParticipo = (() => {
    return gastoEdit?.pagado ?? (initTipoPago !== 2);
  })();

  const [importeTotal, setImporteTotal] = useState<string>(initImporteTotal);
  const [tipoPago, setTipoPago] = useState<1 | 2 | 3 | 4>(initTipoPago);
  const [cantidad, setCantidad] = useState<string>(initCantidad);

  const [importeParte, setImporteParte] = useState<string>(initImporteParte);
  const [participo, setParticipo] = useState<boolean>(initParticipo);

  // Tipo de gasto
  const [tipoId, setTipoId] = useState<string | null>(gastoEdit?.tipo_id ?? null);

  // Catálogos
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);

  // Proveedor seleccionado + búsqueda
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);
  const [busquedaProveedor, setBusquedaProveedor] = useState<string>('');

  // Cuenta seleccionada
  const [cuentaId, setCuentaId] = useState<string | null>(gastoEdit?.cuenta_id ?? null);

  // Campos extra
  const [evento, setEvento] = useState<string>(gastoEdit?.evento ?? '');
  const [observaciones, setObservaciones] = useState<string>(gastoEdit?.observaciones ?? '');

  // Localidad / Comunidad
  const [localidad, setLocalidad] = useState<string>((gastoEdit as any)?.localidad ?? '');
  const [comunidad, setComunidad] = useState<string>((gastoEdit as any)?.comunidad ?? '');

  // GASOLINA (opcional)
  const [precioLitro, setPrecioLitro] = useState<string>(gastoEdit?.precio_litro != null ? String(gastoEdit.precio_litro) : '');
  const [litros, setLitros] = useState<string>(gastoEdit?.litros != null ? String(gastoEdit.litros) : '');
  const [km, setKm] = useState<string>(gastoEdit?.km != null ? String(gastoEdit.km) : '');

  const [bloquearLitros, setBloquearLitros] = useState(false);
  const [bloquearPrecioLitro, setBloquearPrecioLitro] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // ========================
  // Reset explícito (solo cuando corresponde por UX)
  // ========================
  const resetFormToNew = React.useCallback(() => {
    const hoy = new Date().toISOString().slice(0, 10);

    setFecha(hoy);
    setShowDatePicker(false);

    setTipoPago(1);
    setImporteTotal('');
    setCantidad('1');
    setImporteParte('');
    setParticipo(true);

    setTipoId(null);

    setProveedorSeleccionado(null);
    setBusquedaProveedor('');

    setCuentaId(null);

    setEvento('');
    setObservaciones('');

    setLocalidad('');
    setComunidad('');

    setPrecioLitro('');
    setLitros('');
    setKm('');

    setBloquearLitros(false);
    setBloquearPrecioLitro(false);
  }, []);

  // ========================
  // Carga catálogos
  // ========================
  useEffect(() => {
    const loadStatic = async () => {
      try {
        const [provRes, ctasRes] = await Promise.all([fetchProveedores(), fetchCuentas()]);
        setProveedores(provRes ?? []);
        setCuentas(ctasRes ?? []);
      } catch (err) {
        console.error('[GastoCotidianoForm] Error cargando proveedores/cuentas', err);
      }
    };
    void loadStatic();
  }, []);

  // ========================
  // Retorno desde AuxEntityForm (proveedores)
  // ========================
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const res = route?.params?.auxResult;
        if (!res) return;

        try {
          if (res.type !== 'proveedor' || !res.item) return;

          const nuevoProveedor = res.item as Proveedor;
          const provRes = await fetchProveedores();
          if (!alive) return;

          const merged = (() => {
            const map = new Map<string, Proveedor>();
            map.set(nuevoProveedor.id, nuevoProveedor);
            for (const p of provRes ?? []) map.set(p.id, p);
            return Array.from(map.values());
          })();

          setProveedores(merged);

          // FIX: solo actualizamos lo relativo al proveedor; NO tocamos el resto del formulario.
          setProveedorSeleccionado(nuevoProveedor);
          setBusquedaProveedor('');
          setLocalidad(nuevoProveedor.localidad ?? '');
          setComunidad((nuevoProveedor as any).comunidad ?? '');
        } finally {
          navigation.setParams({ auxResult: undefined });
        }
      })();

      return () => {
        alive = false;
      };
    }, [route?.params?.auxResult, navigation])
  );

  // ========================
  // Refresh manual
  // ========================
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [provRes, ctasRes] = await Promise.all([fetchProveedores(), fetchCuentas()]);
      setProveedores(provRes ?? []);
      setCuentas(ctasRes ?? []);
    } catch (err) {
      console.error('[GastoCotidianoForm] Error al refrescar', err);
    } finally {
      setRefreshing(false);
    }
  };

  // ========================
  // Preselección proveedor edit
  // ========================
  useEffect(() => {
    if (!gastoEdit?.proveedor_id) return;
    if (!proveedores.length) return;

    const found = proveedores.find((p) => p.id === gastoEdit.proveedor_id);
    if (found) {
      setProveedorSeleccionado(found);
      setLocalidad(found.localidad ?? '');
      setComunidad((found as any).comunidad ?? '');
    }
  }, [gastoEdit, proveedores]);

  // ========================
  // Rama por tipo
  // ========================
  const ramaIdSeleccionada = useMemo(() => (tipoId ? RAMA_POR_TIPO[tipoId] : undefined), [tipoId]);

  // ========================
  // Proveedores filtrados
  // ========================
  const proveedoresFiltrados = useMemo(() => {
    if (!tipoId) return [];

    const term = busquedaProveedor.trim().toLowerCase();
    let base = proveedores ?? [];

    if (ramaIdSeleccionada) {
      base = base.filter((p: any) => {
        const pr = p.rama_id ?? p.ramaId ?? p.rama ?? p.rama_tipo_id ?? null;
        return pr === ramaIdSeleccionada;
      });
    }

    if (term) {
      base = base.filter((p) => p.nombre.toLowerCase().includes(term));
    }

    return base.slice(0, MAX_PROVEEDORES_SUGERENCIAS);
  }, [busquedaProveedor, proveedores, ramaIdSeleccionada, tipoId]);

  // ========================
  // Acciones proveedor
  // ========================
  const handleClearProveedor = () => {
    if (readOnly) return;
    setProveedorSeleccionado(null);
    setBusquedaProveedor('');
    setLocalidad('');
    setComunidad('');
  };

  const handleAddProveedor = () => {
    if (readOnly) return;

    if (!tipoId) {
      Alert.alert('Selecciona un tipo', 'Primero selecciona un tipo de gasto para poder crear un proveedor asociado.');
      return;
    }

    navigation.navigate('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'cotidianos',
      returnKey: 'cotidianos-proveedor',
      returnRouteKey: route.key,
      defaultRamaId: ramaIdSeleccionada ?? null,
    });
  };

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
    setFecha(selectedDate.toISOString().slice(0, 10));
  };

  const esRestaurante = tipoId === TIPO_RESTAURANTES_ID;
  const esGasolina = tipoId === TIPO_GASOLINA_ID;

  // ========================
  // Helpers GASOLINA
  // ========================
  const recalcularDesdePrecio = (nuevoPrecio: string, importeTotalStr: string) => {
    const precioNum = parseEuroToNumber(nuevoPrecio) ?? 0;
    const importeNum = parseEuroToNumber(importeTotalStr) ?? 0;

    if (precioNum > 0 && importeNum > 0) {
      const litrosCalc = importeNum / precioNum;
      setLitros(litrosCalc.toFixed(2).replace('.', ','));
    } else {
      setLitros('');
    }
  };

  const recalcularDesdeLitros = (nuevosLitros: string, importeTotalStr: string) => {
    const litrosNum = parseEuroToNumber(nuevosLitros) ?? 0;
    const importeNum = parseEuroToNumber(importeTotalStr) ?? 0;

    if (litrosNum > 0 && importeNum > 0) {
      const precioCalc = importeNum / litrosNum;
      setPrecioLitro(precioCalc.toFixed(3).replace('.', ','));
    } else {
      setPrecioLitro('');
    }
  };

  // ========================
  // Lógica V3 reparto
  // ========================
  const parseCantidadInt = (val: string): number | null => {
    const t = (val ?? '').trim();
    if (!t) return null;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  };

  const format2 = (n: number): string => {
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2).replace('.', ',');
  };

  const isTipo1 = tipoPago === 1;
  const isTipo2 = tipoPago === 2;
  const isTipo3 = tipoPago === 3;
  const isTipo4 = tipoPago === 4;

  const cantidadBloqueada = isTipo1 || isTipo2 || isTipo3;
  const importeParteBloqueado = isTipo1 || isTipo2;
  const participoBloqueado = true;

  useEffect(() => {
    if (isTipo1) {
      setCantidad('1');
      setParticipo(true);
      return;
    }
    if (isTipo2) {
      setCantidad('1');
      setParticipo(false);
      setCuentaId(null);
      return;
    }
    if (isTipo3) {
      setCantidad('2');
      setParticipo(true);
      return;
    }
    if (isTipo4) {
      if (!String(cantidad ?? '').trim()) setCantidad('3');
      setParticipo(true);
      return;
    }
  }, [tipoPago]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const totalNum = parseEuroToNumber(importeTotal) ?? 0;

    const cantEff =
      isTipo1 || isTipo2 ? 1 : isTipo3 ? 2 : (() => {
        const c = parseCantidadInt(cantidad);
        return c && c > 0 ? c : 0;
      })();

    if (totalNum > 0 && cantEff > 0) {
      const parte = totalNum / cantEff;
      setImporteParte(format2(parte));
    } else {
      setImporteParte('');
    }
  }, [importeTotal, cantidad, tipoPago]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChangeImporteParte = (text: string) => {
    if (readOnly) return;
    setImporteParte(text);

    if (!(isTipo3 || isTipo4)) return;

    const parteNum = parseEuroToNumber(text) ?? 0;
    if (parteNum <= 0) return;

    const cantEff = isTipo3 ? 2 : (() => {
      const c = parseCantidadInt(cantidad);
      return c && c > 0 ? c : 0;
    })();

    if (!cantEff || cantEff <= 0) return;

    const totalCalc = parteNum * cantEff;
    setImporteTotal(format2(totalCalc));
  };

  const handleChangeCantidad = (text: string) => {
    if (readOnly) return;
    setCantidad(text);
  };

  // ========================
  // Dirty check + confirmación al volver
  // ========================
  const norm = (v: any) => String(v ?? '').trim();

  const initialSnapshot = useMemo(() => {
    return {
      fecha: norm(gastoEdit?.fecha ?? hoyIso),
      tipoPago: initTipoPago,
      importeTotal: norm(initImporteTotal),
      cantidad: norm(initCantidad),
      importeParte: norm(initImporteParte),
      tipoId: norm(gastoEdit?.tipo_id ?? ''),
      proveedorId: norm(gastoEdit?.proveedor_id ?? ''),
      cuentaId: norm(gastoEdit?.cuenta_id ?? ''),
      evento: norm(gastoEdit?.evento ?? ''),
      observaciones: norm(gastoEdit?.observaciones ?? ''),
      precioLitro: norm(gastoEdit?.precio_litro ?? ''),
      litros: norm(gastoEdit?.litros ?? ''),
      km: norm(gastoEdit?.km ?? ''),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = useMemo(() => {
    if (readOnly) return false;

    return (
      norm(fecha) !== initialSnapshot.fecha ||
      tipoPago !== initialSnapshot.tipoPago ||
      norm(importeTotal) !== initialSnapshot.importeTotal ||
      norm(cantidad) !== initialSnapshot.cantidad ||
      norm(importeParte) !== initialSnapshot.importeParte ||
      norm(tipoId) !== initialSnapshot.tipoId ||
      norm(proveedorSeleccionado?.id ?? '') !== initialSnapshot.proveedorId ||
      norm(cuentaId ?? '') !== initialSnapshot.cuentaId ||
      norm(evento) !== initialSnapshot.evento ||
      norm(observaciones) !== initialSnapshot.observaciones ||
      norm(precioLitro) !== initialSnapshot.precioLitro ||
      norm(litros) !== initialSnapshot.litros ||
      norm(km) !== initialSnapshot.km
    );
  }, [
    readOnly,
    fecha,
    tipoPago,
    importeTotal,
    cantidad,
    importeParte,
    tipoId,
    proveedorSeleccionado,
    cuentaId,
    evento,
    observaciones,
    precioLitro,
    litros,
    km,
    initialSnapshot,
  ]);

  const handleBack = () => {
    if (!isDirty) {
      doNavigateBack();
      return;
    }

    Alert.alert(
      'Salir del formulario',
      'Si sales del formulario perderás los datos no guardados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: () => {
            // UX: al confirmar salida, dejamos limpio el formulario.
            resetFormToNew();
            doNavigateBack();
          },
        },
      ]
    );
  };

  // ========================
  // Guardar
  // ========================
  const handleSave = async () => {
    if (readOnly) return;

    if (!tipoId) {
      Alert.alert('Campo requerido', 'Debes seleccionar un tipo de gasto.');
      return;
    }
    if (!proveedorSeleccionado) {
      Alert.alert('Campo requerido', 'Debes seleccionar un proveedor.');
      return;
    }
    if (!importeTotal.trim()) {
      Alert.alert('Campo requerido', 'Debes indicar un importe total.');
      return;
    }
    if (esRestaurante && !evento) {
      Alert.alert('Campo requerido', 'Debes seleccionar un evento para RESTAURANTES.');
      return;
    }

    const totalNum = parseEuroToNumber(importeTotal) ?? 0;
    if (totalNum <= 0) {
      Alert.alert('Importe inválido', 'El importe total debe ser mayor que cero.');
      return;
    }

    let cantidadEff = 1;

    if (isTipo1) cantidadEff = 1;
    if (isTipo2) cantidadEff = 1;
    if (isTipo3) cantidadEff = 2;
    if (isTipo4) {
      const c = parseCantidadInt(cantidad) ?? 0;
      if (c < 3) {
        Alert.alert('Cantidad inválida', 'Para "ENTRE VARIOS", la cantidad debe ser un entero >= 3.');
        return;
      }
      cantidadEff = c;
    }

    if (participo && !cuentaId) {
      Alert.alert('Campo requerido', 'Debes seleccionar la cuenta desde la que pagas este gasto.');
      return;
    }

    const toUndef = (v: string): string | undefined => {
      const t = (v ?? '').trim();
      return t === '' ? undefined : t;
    };

    const payload: CrearGastoCotidianoPayload = {
      fecha,
      tipoId,
      proveedorId: proveedorSeleccionado.id,
      cuentaId: participo ? (cuentaId ?? null) : null,

      tipoPago,
      importeTotal,
      cantidad: cantidadEff,

      evento: toUndef(evento),
      observaciones: toUndef(observaciones),

      ...(esGasolina
        ? {
            precioLitro: toUndef(precioLitro),
            litros: toUndef(litros),
            km: toUndef(km),
          }
        : {}),
    };

    try {
      if (isEdit && gastoEdit?.id) {
        await actualizarGastoCotidiano(gastoEdit.id, payload);
        Alert.alert('Éxito', 'Gasto actualizado correctamente.', [
          {
            text: 'OK',
            onPress: () => {
              // reset al guardar (según regla) y salir
              resetFormToNew();
              doNavigateBack();
            },
          },
        ]);
      } else {
        await crearGastoCotidiano(payload);
        Alert.alert('Éxito', 'Gasto guardado correctamente.', [
          {
            text: 'OK',
            onPress: () => {
              // reset al guardar (según regla) y salir
              resetFormToNew();
              doNavigateBack();
            },
          },
        ]);
      }
    } catch (err) {
      console.error('[GastoCotidianoForm] Error al guardar', err);
      Alert.alert('Error', 'Ha ocurrido un error al guardar el gasto.');
    }
  };

  // ✅ Patrón “Gestionables”
  const title = 'Gasto cotidiano';
  const subtitle = readOnly ? 'Consulta' : isEdit ? 'Edición' : 'Nuevo Gasto';

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
            variant="primary"
            disabled={false}
          />
        ) : null
      }
    >
      {/* === TIPO === */}
      <FormSection title="Tipo de gasto">
        <View style={styles.field}>
          <View style={styles.segmentosRow}>
            {TIPOS_COTIDIANO.map((t) => (
              <View key={t.value} style={styles.segmentoWrapper}>
                <PillButton
                  label={t.label}
                  selected={tipoId === t.value}
                  onPress={() => {
                    if (readOnly) return;
                    const next = tipoId === t.value ? null : t.value;
                    setTipoId(next);

                    setProveedorSeleccionado(null);
                    setBusquedaProveedor('');
                    setLocalidad('');
                    setComunidad('');

                    if (next !== TIPO_GASOLINA_ID) {
                      setPrecioLitro('');
                      setLitros('');
                      setKm('');
                      setBloquearLitros(false);
                      setBloquearPrecioLitro(false);
                    }
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      </FormSection>

      {/* === PROVEEDOR === */}
      <FormSection title="Proveedor">
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Proveedor</Text>
            <TouchableOpacity style={styles.addInlineButton} onPress={handleAddProveedor}>
              <Text style={styles.addInlineButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          {proveedorSeleccionado ? (
            <View style={styles.selectedProvider}>
              <Ionicons name="storefront-outline" size={16} color={colors.primaryStrong} />
              <Text style={styles.selectedProviderText}>{proveedorSeleccionado.nombre}</Text>
              {!readOnly && (
                <TouchableOpacity onPress={handleClearProveedor}>
                  <Ionicons name="close-circle" size={18} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <TextInput
                style={[styles.input, busquedaProveedor.trim() !== '' && styles.inputFilled]}
                placeholder="Buscar proveedor..."
                value={busquedaProveedor}
                onChangeText={setBusquedaProveedor}
                editable={!readOnly}
              />
              <View style={styles.proveedoresList}>
                {proveedoresFiltrados.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.proveedorOption}
                    onPress={() => {
                      if (readOnly) return;
                      setProveedorSeleccionado(p);
                      setLocalidad(p.localidad ?? '');
                      setComunidad((p as any).comunidad ?? '');
                    }}
                  >
                    <Text style={styles.proveedorOptionText}>{p.nombre}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      </FormSection>

      {/* === IMPORTE Y PAGO === */}
      <FormSection title="Importe y pago">
        <View style={styles.field}>
          <Text style={styles.label}>Importe total</Text>
          <TextInput
            style={[styles.input, styles.amountInputBig, importeTotal && styles.inputFilled]}
            keyboardType="decimal-pad"
            value={importeTotal}
            onChangeText={(text) => {
              if (readOnly) return;
              setImporteTotal(text);

              if (esGasolina) {
                if (bloquearLitros && precioLitro) {
                  recalcularDesdePrecio(precioLitro, text);
                } else if (bloquearPrecioLitro && litros) {
                  recalcularDesdeLitros(litros, text);
                }
              }
            }}
            editable={!readOnly}
            placeholder="Ej. 70,00"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Pago</Text>
          <View style={styles.segmentosRow}>
            <View style={styles.segmentoWrapper}>
              <PillButton label="PAGADO POR MÍ (1)" selected={tipoPago === 1} onPress={() => !readOnly && setTipoPago(1)} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton label="INVITADO (2)" selected={tipoPago === 2} onPress={() => !readOnly && setTipoPago(2)} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton label="A PACHAS (3)" selected={tipoPago === 3} onPress={() => !readOnly && setTipoPago(3)} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton label="ENTRE VARIOS (4)" selected={tipoPago === 4} onPress={() => !readOnly && setTipoPago(4)} />
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Reparto</Text>

          <RepartoRow
            cantidad={cantidad}
            onChangeCantidad={handleChangeCantidad}
            cantidadDisabled={cantidadBloqueada}
            importe={importeParte}
            onChangeImporte={handleChangeImporteParte}
            importeDisabled={importeParteBloqueado}
            participo={participo}
            participoDisabled={participoBloqueado}
            readOnly={readOnly}
          />

          {participoBloqueado && (
            <Text style={styles.helperText}>
              Participo se determina automáticamente por el tipo de pago seleccionado.
            </Text>
          )}
        </View>

        <FormSection title="Cuenta de cargo">
          <View style={styles.field}>
            <View style={styles.accountsRow}>
              {cuentas.map((cta) => (
                <View key={cta.id} style={styles.accountPillWrapper}>
                  <AccountPill
                    label={cta.anagrama}
                    subLabel={`${cta.liquidez.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`}
                    selected={cuentaId === cta.id}
                    onPress={() => {
                      if (readOnly) return;
                      if (!participo) return;
                      setCuentaId(cta.id);
                    }}
                  />
                </View>
              ))}
            </View>

            {!participo && <Text style={styles.helperText}>Este gasto no lo pagas tú, no afecta a tu liquidez.</Text>}
          </View>
        </FormSection>
      </FormSection>

      {/* === GASOLINA === */}
      {esGasolina && (
        <FormSection title="Datos GASOLINA">
          <View style={styles.fieldRowTwoCols}>
            <View style={styles.col}>
              <Text style={styles.label}>Precio litro (€/L)</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputAdvanced,
                  precioLitro && styles.inputFilled,
                  bloquearPrecioLitro && styles.inputDisabled,
                ]}
                keyboardType="decimal-pad"
                placeholder="Ej. 1,589"
                value={precioLitro}
                editable={!readOnly && !bloquearPrecioLitro}
                onChangeText={(text) => {
                  if (readOnly) return;
                  setPrecioLitro(text);

                  if (text.trim() === '') {
                    setBloquearLitros(false);
                    setLitros('');
                    return;
                  }

                  setBloquearLitros(true);
                  setBloquearPrecioLitro(false);
                  recalcularDesdePrecio(text, importeTotal);
                }}
              />
            </View>

            <View style={styles.col}>
              <Text style={styles.label}>Litros</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputAdvanced,
                  litros && styles.inputFilled,
                  bloquearLitros && styles.inputDisabled,
                ]}
                keyboardType="decimal-pad"
                placeholder="Ej. 35,40"
                value={litros}
                editable={!readOnly && !bloquearLitros}
                onChangeText={(text) => {
                  if (readOnly) return;
                  setLitros(text);

                  if (text.trim() === '') {
                    setBloquearPrecioLitro(false);
                    setPrecioLitro('');
                    return;
                  }

                  setBloquearPrecioLitro(true);
                  setBloquearLitros(false);
                  recalcularDesdeLitros(text, importeTotal);
                }}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Km (opcional)</Text>
            <TextInput
              style={[styles.input, km && styles.inputFilled]}
              keyboardType="numeric"
              placeholder="Ej. 520"
              value={km}
              editable={!readOnly}
              onChangeText={setKm}
            />
          </View>

          <Text style={styles.helperText}>
            Estos campos son opcionales. Si indicas solo el precio o solo los litros, calcularemos automáticamente el
            otro usando el importe.
          </Text>
        </FormSection>
      )}

      {/* === FECHA Y DETALLE === */}
      <FormSection title="Fecha y detalle">
        <View style={styles.field}>
          <Text style={styles.label}>Fecha</Text>

          <FormDateButton valueText={formatFechaCorta(fecha)} onPress={handleOpenDatePicker} disabled={readOnly} />

          {showDatePicker && <DateTimePicker value={new Date(fecha)} mode="date" display="default" onChange={handleDateChange} />}
        </View>

        {esRestaurante && (
          <View style={styles.field}>
            <Text style={styles.label}>Evento</Text>
            <View style={styles.segmentosRow}>
              {EVENTO_OPTIONS.map((op) => (
                <View key={op.value} style={styles.segmentoWrapper}>
                  <PillButton
                    label={op.label}
                    selected={evento === op.value}
                    onPress={() => {
                      if (readOnly) return;
                      setEvento(op.value);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Observaciones (opcional)</Text>
          <TextInput
            style={[styles.input, observaciones && styles.inputFilled]}
            placeholder="Detalles adicionales..."
            value={observaciones}
            onChangeText={setObservaciones}
            editable={!readOnly}
            multiline
          />
        </View>

        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>Localidad</Text>
            <TextInput style={[styles.input, styles.inputAdvanced, styles.inputDisabled]} value={localidad} editable={false} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Comunidad</Text>
            <TextInput style={[styles.input, styles.inputAdvanced, styles.inputDisabled]} value={comunidad} editable={false} />
          </View>
        </View>
      </FormSection>
    </FormScreen>
  );
};

export default GastoCotidianoFormScreen;
