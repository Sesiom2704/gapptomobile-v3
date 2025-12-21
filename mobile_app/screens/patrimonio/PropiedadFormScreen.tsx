/**
 * Archivo: mobile_app/screens/patrimonio/PropiedadFormScreen.tsx
 *
 * Responsabilidad:
 *   - Alta/edición/duplicado y consulta (readOnly) de una Propiedad (Patrimonio).
 *   - Gestiona el flujo por pasos (BASE / COMPRA), carga inicial, validación y persistencia.
 *
 * Maneja:
 *   - UI: formulario con FormSection + controles tipo “pill”, búsqueda de localidad limitada a 4 resultados.
 *   - Estado: base/compra, control de pasos, loading/saving/refreshing.
 *   - Datos:
 *       - Lectura: patrimonioApi.getPatrimonio / getPatrimonioCompra
 *       - Escritura: patrimonioApi.createPatrimonio / updatePatrimonio / upsertPatrimonioCompra
 *   - Navegación:
 *       - Soporta retorno condicionado (returnToTab/returnToScreen/returnToParams, fromHome).
 *       - Soporta retorno desde LocalidadForm vía auxResult.
 *
 * Cambios aplicados (replicar patrón y ajustes solicitados):
 *   - BASE:
 *       - Localidad en una sola fila (full width) con botón + integrado en la cabecera del campo.
 *       - Referencia en otra fila independiente (full width).
 *   - COMPRA:
 *       - Eliminada UI de “Fecha compra” (no se muestra ni se edita desde esta pantalla).
 *       - Reordenación de campos:
 *           Fila 1: Valor compra | Valor referencia
 *           Fila 2: Impuestos (%) | Reforma/Adecuamiento
 *           Fila 3: Notaría | Agencia
 *           Fila 4: Notas (full width)
 *       - Eliminado todo lo de “Vista: xx.xxx,xx €”.
 *   - Fecha adquisición:
 *       - Se usa FormDateButton como control estándar de fecha.
 *
 * Notas:
 *   - Se mantiene toda la lógica funcional (carga, duplicado, validaciones, guardado, refresh, auxResult).
 *   - El campo compra.fecha_compra se conserva en el modelo/persistencia si viene cargado,
 *     pero ya no se presenta en UI (según requisito).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors } from '../../theme';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { PillButton } from '../../components/ui/PillButton';
import { commonFormStyles } from '../../components/forms/formStyles';

import formLayoutStyles from '../../components/forms/formLayoutStyles';

import patrimonioApi, {
  type PatrimonioCreate,
  type PatrimonioRow,
  type PatrimonioUpdate,
  type PatrimonioCompraIn,
  type PatrimonioCompraOut,
} from '../../services/patrimonioApi';

import { listLocalidades, type LocalidadWithContext } from '../../services/ubicacionesApi';

import { parseEuroToNumber } from '../../utils/format';
import { InlineAddButton } from '../../components/ui/InlineAddButton';
import { SelectedInlineValue } from '../../components/ui/SelectedInlineValue';
import { FormDateButton } from '../../components/ui/FormDateButton';

type Step = 'BASE' | 'COMPRA';

type Props = {
  navigation: any;
  route: {
    key?: string;
    params?: {
      patrimonioId?: string;

      readOnly?: boolean;
      duplicate?: boolean;

      returnToTab?: string;
      returnToScreen?: string;
      returnToParams?: any;

      fromHome?: boolean;

      auxResult?: {
        type: string;
        item: any;
        key?: string | null;
        mode: 'created' | 'updated';
      };
    };
  };
};

// ---- Helpers fecha ----
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

function formatDateDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const isoParts = value.split('-');
  if (isoParts.length === 3) {
    const [_y, m, d] = isoParts;
    const y = isoParts[0];
    return `${d}/${m}/${y}`;
  }
  return value;
}

// Normaliza para comparaciones de selección (evita problemas de mayúsculas/espacios)
function normalizeText(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function PropiedadFormScreen({ route, navigation }: Props) {
  const styles = commonFormStyles;

  const patrimonioIdParam = route?.params?.patrimonioId;
  const duplicate: boolean = route?.params?.duplicate === true;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const returnToTab: string | undefined = route?.params?.returnToTab;
  const returnToScreen: string | undefined = route?.params?.returnToScreen;
  const returnToParams: any | undefined = route?.params?.returnToParams;

  const fromHome: boolean = route?.params?.fromHome === true;

  const isEdit = !!patrimonioIdParam && !duplicate;

  const [step, setStep] = useState<Step>('BASE');

  const [loading, setLoading] = useState<boolean>(!!isEdit);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [patrimonioId, setPatrimonioId] = useState<string | null>(patrimonioIdParam || null);

  // Base + activo (extra)
  const [base, setBase] = useState<(PatrimonioCreate & { activo?: boolean })>({
    calle: '',
    numero: '',
    escalera: '',
    piso: '',
    puerta: '',
    localidad: '',
    referencia: '',
    tipo_inmueble: 'VIVIENDA',
    fecha_adquisicion: null,
    disponible: true,
    superficie_m2: null,
    superficie_construida: null,
    participacion_pct: 100,
    habitaciones: null,
    banos: null,
    garaje: false,
    trastero: false,
    activo: true,
  });

  // ---- Superficies como string (para permitir coma) ----
  const [superficieUtilTxt, setSuperficieUtilTxt] = useState<string>(
    base.superficie_m2 != null ? String(base.superficie_m2).replace('.', ',') : ''
  );
  const [superficieConstrTxt, setSuperficieConstrTxt] = useState<string>(
    base.superficie_construida != null ? String(base.superficie_construida).replace('.', ',') : ''
  );

  const normalizeDecimalText = (t: string): string => {
    // deja solo dígitos y separadores, y fuerza un solo separador
    const cleaned = String(t ?? '').replace(/[^0-9.,]/g, '').replace(/\./g, ',');
    const parts = cleaned.split(',');
    if (parts.length <= 1) return cleaned;
    return `${parts[0]},${parts.slice(1).join('')}`; // solo 1 coma
  };

  const toNumberOrNull = (t: string): number | null => {
    const n = safeFloat(t);
    return n == null ? null : n;
  };

  const [compra, setCompra] = useState<PatrimonioCompraIn>({
    valor_compra: 0,
    valor_referencia: null,
    impuestos_pct: null,
    notaria: null,
    agencia: null,
    reforma_adecuamiento: null,
    fecha_compra: null, // se conserva en el modelo si viene cargado, pero no se edita en UI
    notas: '',
  });

  const [showFechaAdqPicker, setShowFechaAdqPicker] = useState(false);

  // Localidades (server-side search) -> LIMIT 4
  const [localidades, setLocalidades] = useState<LocalidadWithContext[]>([]);
  const [localidadQuery, setLocalidadQuery] = useState<string>('');

  // Selección robusta por ID
  const [localidadSelectedId, setLocalidadSelectedId] = useState<number | null>(null);

  const title = useMemo(() => {
    if (readOnly) return 'Detalle propiedad';
    if (isEdit) return 'Editar propiedad';
    if (duplicate) return 'Duplicar propiedad';
    return 'Nueva propiedad';
  }, [readOnly, isEdit, duplicate]);

  const subtitle = useMemo(() => (step === 'BASE' ? 'Datos principales' : 'Datos de compra'), [step]);

  const handleBack = () => {
    // Requisito: la flecha del header debe llevar a BASE (no salir) si estás en COMPRA
    if (step === 'COMPRA') {
      setStep('BASE');
      return;
    }

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

  const fetchLocalidades = useCallback(async (search: string) => {
    try {
      const res = await listLocalidades({ search: search || undefined, limit: 4 });
      setLocalidades(res ?? []);
    } catch (e) {
      console.error('[PropiedadForm] Error listLocalidades', e);
    }
  }, []);

  // debounce simple
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchLocalidades(localidadQuery.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [localidadQuery, fetchLocalidades]);

  const loadInitial = useCallback(async () => {
    try {
      setLoading(!!isEdit);

      await fetchLocalidades('');

      if (!isEdit || !patrimonioIdParam) {
        setLoading(false);
        return;
      }

      const p = await patrimonioApi.getPatrimonio(patrimonioIdParam);
      const mapped = mapRowToCreate(p) as any;
      mapped.activo = (p as any)?.activo ?? true;
      setBase(mapped);

      setSuperficieUtilTxt(mapped.superficie_m2 != null ? String(mapped.superficie_m2).replace('.', ',') : '');
      setSuperficieConstrTxt(mapped.superficie_construida != null ? String(mapped.superficie_construida).replace('.', ',') : '');

      setLocalidadQuery(mapped.localidad ?? '');
      setLocalidadSelectedId(null);

      const c = await patrimonioApi.getPatrimonioCompra(patrimonioIdParam);
      if (c) setCompra(mapCompraOutToIn(c));
    } catch (e) {
      console.error('[PropiedadForm] Error loadInitial', e);
      Alert.alert('Error', 'No se pudo cargar la propiedad.', [{ text: 'OK', onPress: handleBack }]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isEdit, patrimonioIdParam, fetchLocalidades]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const onRefresh = () => {
    setRefreshing(true);
    loadInitial();
  };

  // Duplicado
  useEffect(() => {
    if (!duplicate || !patrimonioIdParam) return;

    (async () => {
      try {
        setLoading(true);

        await fetchLocalidades('');

        const p = await patrimonioApi.getPatrimonio(patrimonioIdParam);
        const baseLoaded = mapRowToCreate(p) as any;
        baseLoaded.activo = (p as any)?.activo ?? true;

        setBase({
          ...baseLoaded,
          referencia: '',
          disponible: true,
          activo: true,
        });

        setSuperficieUtilTxt(baseLoaded.superficie_m2 != null ? String(baseLoaded.superficie_m2).replace('.', ',') : '');
        setSuperficieConstrTxt(baseLoaded.superficie_construida != null ? String(baseLoaded.superficie_construida).replace('.', ',') : '');

        setLocalidadQuery(baseLoaded.localidad ?? '');
        setLocalidadSelectedId(null);

        const c = await patrimonioApi.getPatrimonioCompra(patrimonioIdParam);
        if (c) setCompra(mapCompraOutToIn(c));

        setPatrimonioId(null);
        setStep('BASE');
      } catch (e) {
        console.error('[PropiedadForm] Error duplicado', e);
        Alert.alert('Error', 'No se pudo preparar el duplicado.', [{ text: 'OK', onPress: handleBack }]);
      } finally {
        setLoading(false);
      }
    })();
  }, [duplicate, patrimonioIdParam, fetchLocalidades]);

  // Recepción desde LocalidadForm / AuxEntityForm
  useEffect(() => {
    const aux = route?.params?.auxResult;
    if (!aux) return;

    const newLocalidadNombre: string | null =
      aux?.type === 'localidad' && aux?.item?.nombre ? String(aux.item.nombre) :
      aux?.item?.localidad ? String(aux.item.localidad) :
      null;

    const newLocalidadId: number | null =
      aux?.type === 'localidad' && aux?.item?.id != null ? Number(aux.item.id) : null;

    if (newLocalidadNombre) {
      setBase((prev) => ({ ...prev, localidad: newLocalidadNombre }));
      setLocalidadQuery(newLocalidadNombre);
      setLocalidadSelectedId(Number.isFinite(newLocalidadId as any) ? newLocalidadId : null);
      void fetchLocalidades(newLocalidadNombre);
    }

    try {
      navigation.setParams?.({ auxResult: undefined });
    } catch {
      // no-op
    }
  }, [route?.params?.auxResult, fetchLocalidades, navigation]);

  const saveBase = async (): Promise<string> => {
    const payload: any = {
      ...base,
      activo: base.activo ?? true,
    };

    if (isEdit && patrimonioIdParam) {
      await patrimonioApi.updatePatrimonio(patrimonioIdParam, payload as PatrimonioUpdate);
      return patrimonioIdParam;
    }

    const created = await patrimonioApi.createPatrimonio(payload as PatrimonioCreate);
    setPatrimonioId(created.id);
    return created.id;
  };

  const validateBase = (): boolean => {
    if (!base.calle?.trim()) return Alert.alert('Campo obligatorio', 'La calle es obligatoria.'), false;
    if (!base.numero?.trim()) return Alert.alert('Campo obligatorio', 'El número es obligatorio.'), false;
    if (!base.localidad?.trim()) return Alert.alert('Campo obligatorio', 'Selecciona una localidad.'), false;

    if (base.participacion_pct != null && (base.participacion_pct <= 0 || base.participacion_pct > 100)) {
      Alert.alert('Valor inválido', 'La participación debe estar entre 1 y 100.');
      return false;
    }
    return true;
  };

  const onGuardarBase = async () => {
    if (readOnly) return;
    if (!validateBase()) return;

    try {
      setSaving(true);
      const id = await saveBase();
      Alert.alert('Éxito', isEdit ? 'Propiedad actualizada.' : 'Propiedad creada.', [
        { text: 'OK', onPress: () => navigation?.navigate?.('PropiedadDetalle', { patrimonioId: id }) },
      ]);
    } catch (e) {
      console.error('[PropiedadForm] Error guardar base', e);
      Alert.alert('Error', 'No se pudo guardar la propiedad.');
    } finally {
      setSaving(false);
    }
  };

  const onGuardarYCompra = async () => {
    if (readOnly) return;
    if (!validateBase()) return;

    try {
      setSaving(true);
      const id = await saveBase();
      setPatrimonioId(id);
      setStep('COMPRA');
    } catch (e) {
      console.error('[PropiedadForm] Error guardar y compra', e);
      Alert.alert('Error', 'No se pudo continuar a compra.');
    } finally {
      setSaving(false);
    }
  };

  const validateCompra = (): boolean => {
    if (compra.valor_compra == null || compra.valor_compra <= 0) {
      Alert.alert('Campo obligatorio', 'El valor de compra debe ser mayor que 0.');
      return false;
    }
    if (compra.impuestos_pct != null && (compra.impuestos_pct < 0 || compra.impuestos_pct > 100)) {
      Alert.alert('Valor inválido', 'Los impuestos deben estar entre 0 y 100.');
      return false;
    }
    return true;
  };

  const onGuardarCompra = async () => {
    if (readOnly) return;
    if (!patrimonioId) return Alert.alert('Error', 'Falta ID de la propiedad.');
    if (!validateCompra()) return;

    try {
      setSaving(true);
      await patrimonioApi.upsertPatrimonioCompra(patrimonioId, compra);
      Alert.alert('Éxito', 'Datos de compra guardados.', [
        { text: 'OK', onPress: () => navigation?.navigate?.('PropiedadDetalle', { patrimonioId }) },
      ]);
    } catch (e) {
      console.error('[PropiedadForm] Error guardar compra', e);
      Alert.alert('Error', 'No se pudieron guardar los datos de compra.');
    } finally {
      setSaving(false);
    }
  };

  const onChangeFechaAdquisicion = (_event: any, selectedDate?: Date) => {
    setShowFechaAdqPicker(false);
    if (!selectedDate) return;
    setBase((prev) => ({ ...prev, fecha_adquisicion: toApiDate(selectedDate) }));
  };

  const getLocalidadLabel = (l: LocalidadWithContext): string => {
    const nom = l.nombre ?? '';
    const region = l.region?.nombre ? ` · ${l.region.nombre}` : '';
    const pais = l.region?.pais?.nombre ? ` · ${l.region.pais.nombre}` : '';
    return `${nom}${region}${pais}`.trim();
  };

  const onAddLocalidad = () => {
    navigation.navigate('LocalidadForm', {
      returnRouteKey: route?.key,
      initialSearch: localidadQuery ?? '',
    });
  };

  const handleClearLocalidad = () => {
    if (readOnly) return;
    setBase((prev) => ({ ...prev, localidad: '' }));
    setLocalidadQuery('');
    setLocalidadSelectedId(null);
    void fetchLocalidades('');
  };

  const onChangeLocalidadQuery = (text: string) => {
    setLocalidadQuery(text);
    setLocalidadSelectedId(null);
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.topArea}>
          <Header title={title} subtitle="Cargando..." showBack onBackPress={handleBack} />
        </View>
        <View style={stylesLocal.loader}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header title={title} subtitle={subtitle} showBack onBackPress={handleBack} />
      </View>

      <ScrollView
        style={styles.formArea}
        contentContainerStyle={styles.formContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <FormSection title="Paso">
          <View style={styles.segmentosRow}>
            <View style={styles.segmentoWrapper}>
              <PillButton label="BASE" selected={step === 'BASE'} onPress={() => setStep('BASE')} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton
                label="COMPRA"
                selected={step === 'COMPRA'}
                onPress={() => {
                  if (!patrimonioId && !isEdit) {
                    Alert.alert('Acción requerida', 'Primero guarda los datos base para poder añadir compra.');
                    return;
                  }
                  setStep('COMPRA');
                }}
              />
            </View>
          </View>
        </FormSection>

        {step === 'BASE' ? (
          <>
            <FormSection title="Dirección">
              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col2of3}>
                  <FieldInput
                    label="Calle"
                    value={base.calle ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, calle: v }))}
                    readOnly={readOnly}
                  />
                </View>
                <View style={formLayoutStyles.col1of3}>
                  <FieldInput
                    label="Número"
                    value={base.numero ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, numero: v }))}
                    readOnly={readOnly}
                  />
                </View>
              </View>

              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of3}>
                  <FieldInput
                    label="Escalera"
                    value={base.escalera ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, escalera: v }))}
                    readOnly={readOnly}
                  />
                </View>
                <View style={formLayoutStyles.col1of3}>
                  <FieldInput
                    label="Piso"
                    value={base.piso ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, piso: v }))}
                    readOnly={readOnly}
                  />
                </View>
                <View style={formLayoutStyles.col1of3}>
                  <FieldInput
                    label="Puerta"
                    value={base.puerta ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, puerta: v }))}
                    readOnly={readOnly}
                  />
                </View>
              </View>

              {/* ✅ Localidad full width con botón + en labelRow */}
              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Localidad</Text>

                  <InlineAddButton
                    onPress={onAddLocalidad}
                    disabled={readOnly}
                    accessibilityLabel="Crear localidad"
                  />
                </View>

                {base.localidad?.trim() ? (
                  <SelectedInlineValue
                    value={base.localidad}
                    disabled={readOnly}
                    onClear={handleClearLocalidad}
                  />
                ) : (
                  <>
                    <TextInput
                      value={localidadQuery}
                      onChangeText={onChangeLocalidadQuery}
                      placeholder="Buscar localidad..."
                      style={[styles.input, localidadQuery.trim() !== '' ? styles.inputFilled : null]}
                      editable={!readOnly}
                    />

                    <View style={formLayoutStyles.wrapList}>
                      {localidades.slice(0, 4).map((l) => {
                        const label = getLocalidadLabel(l);
                        const selected =
                          (localidadSelectedId != null && Number(l.id) === Number(localidadSelectedId)) ||
                          (localidadSelectedId == null &&
                            normalizeText(base.localidad ?? '') === normalizeText(l.nombre ?? ''));

                        return (
                          <View key={String(l.id)} style={formLayoutStyles.wrapItem}>
                            <PillButton
                              label={label || String(l.id)}
                              selected={selected}
                              onPress={() => {
                                if (readOnly) return;
                                setBase((prev) => ({ ...prev, localidad: l.nombre ?? prev.localidad }));
                                setLocalidadSelectedId(Number(l.id));
                                setLocalidadQuery(l.nombre ?? '');
                              }}
                            />
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>

              {/* ✅ Referencia en su propia fila (full width) */}
              <FieldInput
                label="Referencia (opcional)"
                value={base.referencia ?? ''}
                onChange={(v) => setBase((prev) => ({ ...prev, referencia: v }))}
                readOnly={readOnly}
                placeholder="Ej: VIV-001"
              />
            </FormSection>

            <FormSection title="Características">
              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <FieldInput
                    label="Superficie útil (m²)"
                    value={superficieUtilTxt}
                    onChange={(v) => {
                      const txt = normalizeDecimalText(v);
                      setSuperficieUtilTxt(txt);
                      setBase((prev) => ({ ...prev, superficie_m2: toNumberOrNull(txt) }));
                    }}
                    readOnly={readOnly}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                    inputMode="decimal"
                  />
                </View>
                <View style={formLayoutStyles.col1of2}>
                  <FieldInput
                    label="Superficie construida (m²)"
                    value={superficieConstrTxt}
                    onChange={(v) => {
                      const txt = normalizeDecimalText(v);
                      setSuperficieConstrTxt(txt);
                      setBase((prev) => ({ ...prev, superficie_construida: toNumberOrNull(txt) }));
                    }}
                    readOnly={readOnly}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                    inputMode="decimal"
                  />
                </View>
              </View>

              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <FieldInput
                    label="Habitaciones"
                    value={base.habitaciones?.toString() ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, habitaciones: safeInt(v) }))}
                    readOnly={readOnly}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={formLayoutStyles.col1of2}>
                  <FieldInput
                    label="Baños"
                    value={base.banos?.toString() ?? ''}
                    onChange={(v) => setBase((prev) => ({ ...prev, banos: safeInt(v) }))}
                    readOnly={readOnly}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <View style={styles.field}>
                    <Text style={styles.label}>Garaje</Text>
                    <View style={styles.segmentosRow}>
                      <View style={styles.segmentoWrapper}>
                        <PillButton
                          label="Sí"
                          selected={!!base.garaje}
                          onPress={() => {
                            if (readOnly) return;
                            setBase((prev) => ({ ...prev, garaje: true }));
                          }}
                        />
                      </View>
                      <View style={styles.segmentoWrapper}>
                        <PillButton
                          label="No"
                          selected={!base.garaje}
                          onPress={() => {
                            if (readOnly) return;
                            setBase((prev) => ({ ...prev, garaje: false }));
                          }}
                        />
                      </View>
                    </View>
                  </View>
                </View>

                <View style={formLayoutStyles.col1of2}>
                  <View style={styles.field}>
                    <Text style={styles.label}>Trastero</Text>
                    <View style={styles.segmentosRow}>
                      <View style={styles.segmentoWrapper}>
                        <PillButton
                          label="Sí"
                          selected={!!base.trastero}
                          onPress={() => {
                            if (readOnly) return;
                            setBase((prev) => ({ ...prev, trastero: true }));
                          }}
                        />
                      </View>
                      <View style={styles.segmentoWrapper}>
                        <PillButton
                          label="No"
                          selected={!base.trastero}
                          onPress={() => {
                            if (readOnly) return;
                            setBase((prev) => ({ ...prev, trastero: false }));
                          }}
                        />
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              <FieldInput
                label="Participación (%)"
                value={base.participacion_pct?.toString() ?? ''}
                onChange={(v) => setBase((prev) => ({ ...prev, participacion_pct: safeFloat(v) }))}
                readOnly={readOnly}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </FormSection>

            <FormSection title="Disponibilidad y fechas">
              <View style={styles.field}>
                <Text style={styles.label}>Fecha adquisición</Text>

                {/* ✅ Control estándar */}
                <FormDateButton
                  valueText={base.fecha_adquisicion ? formatDateDisplay(base.fecha_adquisicion) : 'Seleccionar fecha'}
                  onPress={() => {
                    if (readOnly) return;
                    setShowFechaAdqPicker(true);
                  }}
                  disabled={readOnly}
                />

                {showFechaAdqPicker && !readOnly && (
                  <DateTimePicker
                    value={parseDateString(base.fecha_adquisicion)}
                    mode="date"
                    display="default"
                    onChange={onChangeFechaAdquisicion}
                  />
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Disponible</Text>
                <View style={styles.segmentosRow}>
                  <View style={styles.segmentoWrapper}>
                    <PillButton
                      label="Sí"
                      selected={!!base.disponible}
                      onPress={() => {
                        if (readOnly) return;
                        setBase((prev) => ({ ...prev, disponible: true }));
                      }}
                    />
                  </View>
                  <View style={styles.segmentoWrapper}>
                    <PillButton
                      label="No"
                      selected={!base.disponible}
                      onPress={() => {
                        if (readOnly) return;
                        setBase((prev) => ({ ...prev, disponible: false }));
                      }}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Activo</Text>
                <View style={styles.segmentosRow}>
                  <View style={styles.segmentoWrapper}>
                    <PillButton
                      label="Sí"
                      selected={base.activo !== false}
                      onPress={() => {
                        if (readOnly) return;
                        setBase((prev) => ({ ...prev, activo: true }));
                      }}
                    />
                  </View>
                  <View style={styles.segmentoWrapper}>
                    <PillButton
                      label="No"
                      selected={base.activo === false}
                      onPress={() => {
                        if (readOnly) return;
                        setBase((prev) => ({ ...prev, activo: false }));
                      }}
                    />
                  </View>
                </View>
              </View>
            </FormSection>

            {!readOnly && (
              <View style={styles.bottomActions}>
                <TouchableOpacity style={styles.saveButton} onPress={onGuardarBase} disabled={saving}>
                  <Text style={styles.saveButtonText}>
                    {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear propiedad'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 10 }]}
                  onPress={onGuardarYCompra}
                  disabled={saving}
                >
                  <Text style={styles.saveButtonText}>{saving ? 'Guardando...' : 'Guardar y añadir compra'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <>
            <FormSection title="Compra">
              {/* Fila 1: Valor compra | Valor referencia */}
              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <MoneyInput
                    label="Valor compra"
                    value={compra.valor_compra}
                    onChange={(n) => setCompra((prev) => ({ ...prev, valor_compra: n }))}
                    required
                    readOnly={readOnly}
                    hidePreview
                  />
                </View>

                <View style={formLayoutStyles.col1of2}>
                  <MoneyInput
                    label="Valor referencia"
                    value={compra.valor_referencia ?? null}
                    onChange={(n) => setCompra((prev) => ({ ...prev, valor_referencia: n }))}
                    readOnly={readOnly}
                    hidePreview
                  />
                </View>
              </View>

              {/* Fila 2: Impuestos | Reforma/Adecuamiento */}
              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <FieldInput
                    label="Impuestos (%)"
                    value={compra.impuestos_pct?.toString() ?? ''}
                    onChange={(v) => setCompra((prev) => ({ ...prev, impuestos_pct: safeFloat(v) }))}
                    readOnly={readOnly}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                  />
                </View>

                <View style={formLayoutStyles.col1of2}>
                  <MoneyInput
                    label="Reforma / Adecuamiento"
                    value={compra.reforma_adecuamiento ?? null}
                    onChange={(n) => setCompra((prev) => ({ ...prev, reforma_adecuamiento: n }))}
                    readOnly={readOnly}
                    hidePreview
                  />
                </View>
              </View>

              {/* Fila 3: Notaría | Agencia */}
              <View style={formLayoutStyles.row}>
                <View style={formLayoutStyles.col1of2}>
                  <MoneyInput
                    label="Notaría"
                    value={compra.notaria ?? null}
                    onChange={(n) => setCompra((prev) => ({ ...prev, notaria: n }))}
                    readOnly={readOnly}
                    hidePreview
                  />
                </View>

                <View style={formLayoutStyles.col1of2}>
                  <MoneyInput
                    label="Agencia"
                    value={compra.agencia ?? null}
                    onChange={(n) => setCompra((prev) => ({ ...prev, agencia: n }))}
                    readOnly={readOnly}
                    hidePreview
                  />
                </View>
              </View>

              {/* Fila 4: Notas */}
              <View style={styles.field}>
                <Text style={styles.label}>Notas</Text>
                <TextInput
                  value={compra.notas ?? ''}
                  onChangeText={(v) => setCompra((prev) => ({ ...prev, notas: v }))}
                  style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
                  multiline
                  editable={!readOnly}
                  placeholder="Notas sobre la compra..."
                />
              </View>
            </FormSection>

            {!readOnly && (
              <View style={styles.bottomActions}>
                <TouchableOpacity style={styles.saveButton} onPress={onGuardarCompra} disabled={saving}>
                  <Text style={styles.saveButtonText}>{saving ? 'Guardando...' : 'Guardar compra'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---- Subcomponentes ----
function FieldInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: any;
  inputMode?: any;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  const styles = commonFormStyles;
  const { label, value, onChange, keyboardType, inputMode, placeholder, multiline, readOnly } = props;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        inputMode={inputMode}
        placeholder={placeholder}
        multiline={multiline}
        style={[
          styles.input,
          multiline ? { minHeight: 90, textAlignVertical: 'top' } : null,
          value?.trim?.() ? styles.inputFilled : null,
        ]}
        editable={!readOnly}
      />
    </View>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  required,
  readOnly,
  hidePreview = false,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
  required?: boolean;
  readOnly?: boolean;
  hidePreview?: boolean;
}) {
  const styles = commonFormStyles;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: '#b00020' }}> *</Text> : null}
      </Text>

      <TextInput
        value={value == null ? '' : String(value)}
        onChangeText={(v) => {
          const parsed = parseEuroToNumber(v);
          onChange(parsed == null ? 0 : parsed);
        }}
        keyboardType="decimal-pad"
        inputMode="decimal"
        style={[styles.input, value != null && String(value).trim() !== '' ? styles.inputFilled : null]}
        placeholder="0"
        editable={!readOnly}
      />

      {!hidePreview ? (
        <Text style={styles.helperText}>{/* reservado por compatibilidad */}</Text>
      ) : null}
    </View>
  );
}

function safeFloat(v: string): number | null {
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return n;
}

function safeInt(v: string): number | null {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return n;
}

function mapRowToCreate(p: PatrimonioRow): PatrimonioCreate {
  return {
    calle: p.calle ?? '',
    numero: p.numero ?? '',
    escalera: p.escalera ?? '',
    piso: p.piso ?? '',
    puerta: p.puerta ?? '',
    localidad: p.localidad ?? '',
    referencia: p.referencia ?? '',
    tipo_inmueble: (p.tipo_inmueble as any) ?? 'VIVIENDA',
    fecha_adquisicion: p.fecha_adquisicion ?? null,
    disponible: p.disponible ?? true,
    superficie_m2: p.superficie_m2 ?? null,
    superficie_construida: p.superficie_construida ?? null,
    participacion_pct: p.participacion_pct ?? 100,
    habitaciones: p.habitaciones ?? null,
    banos: p.banos ?? null,
    garaje: !!p.garaje,
    trastero: !!p.trastero,
  };
}

function mapCompraOutToIn(c: PatrimonioCompraOut): PatrimonioCompraIn {
  return {
    valor_compra: c.valor_compra ?? 0,
    valor_referencia: c.valor_referencia ?? null,
    impuestos_pct: c.impuestos_pct ?? null,
    notaria: c.notaria ?? null,
    agencia: c.agencia ?? null,
    reforma_adecuamiento: c.reforma_adecuamiento ?? null,
    fecha_compra: c.fecha_compra ?? null, // se conserva aunque no se muestre
    notas: c.notas ?? '',
  };
}

const stylesLocal = {
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
} as const;
