// mobile_app/screens/inversiones/InversionFormScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Platform } from 'react-native';

import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import formLayoutStyles from '../../components/forms/formLayoutStyles';
import { PillButton } from '../../components/ui/PillButton';
import { FormDateButton } from '../../components/ui/FormDateButton';

import inversionesApi, { InversionCreate, InversionRow, InversionUpdate, MiniEntity, TipoGastoMini } from '../../services/inversionesApi';
import { api } from '../../services/api'; // para cargar proveedores / tipos si no tienes servicio ya

type Props = {
  navigation: any;
  route: {
    params?: {
      mode?: 'create' | 'edit';
      inversionId?: string;
      readOnly?: boolean;
    };
  };
};

function toApiDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateString(value: string | null | undefined): Date {
  if (!value) return new Date();
  const iso = value.split('-');
  if (iso.length === 3) {
    const [y, m, d] = iso;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) return new Date(year, month, day);
  }
  return new Date();
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

export default function InversionFormScreen({ route, navigation }: Props) {
  const styles = commonFormStyles;

  const mode = route?.params?.mode ?? 'create';
  const inversionId = route?.params?.inversionId;
  const readOnly: boolean = route?.params?.readOnly ?? false;

  const isEdit = mode === 'edit' && !!inversionId;

  const [loading, setLoading] = useState<boolean>(isEdit);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [tipos, setTipos] = useState<TipoGastoMini[]>([]);
  const [proveedores, setProveedores] = useState<MiniEntity[]>([]);

  const [showFechaCreacionPicker, setShowFechaCreacionPicker] = useState(false);
  const [showFechaInicioPicker, setShowFechaInicioPicker] = useState(false);
  const [showFechaSalidaPicker, setShowFechaSalidaPicker] = useState(false);

  const [form, setForm] = useState<InversionCreate>({
    tipo_gasto_id: '',
    proveedor_id: null,
    dealer_id: null,
    nombre: '',
    descripcion: '',
    estado: 'ACTIVA',
    fase: null,
    fecha_creacion: null,
    fecha_inicio: null,
    fecha_objetivo_salida: null,
    fecha_cierre_real: null,
    moneda: 'EUR',

    aporte_estimado: null,
    retorno_esperado_total: null,
    plazo_esperado_meses: null,

    aporte_final: null,
    retorno_final_total: null,
    plazo_final_meses: null,

    // opcional
    roi_esperado_pct: null,
    moic_esperado: null,
    irr_esperada_pct: null,
    roi_final_pct: null,
    moic_final: null,
    irr_final_pct: null,

    notas: '',
  });

  const title = useMemo(() => {
    if (readOnly) return 'Detalle inversión';
    return isEdit ? 'Editar inversión' : 'Nueva inversión';
  }, [readOnly, isEdit]);

  const subtitle = useMemo(() => (readOnly ? 'Consulta' : 'Alta / edición'), [readOnly]);

  // Cargar combos (tipos/proveedores)
  const loadCombos = useCallback(async () => {
    try {
      // TIPOS (tipo_gasto)
      // TODO: si ya tienes un servicio tipos_gastoApi, úsalo aquí.
      // Asumo endpoint existente. Ajusta si tu router expone otro path.
      const tiposRes = await api.get<TipoGastoMini[]>('/api/v1/tipos-gasto');
      const tiposRaw = Array.isArray(tiposRes.data) ? tiposRes.data : [];

      // Filtrar por "INVERSIÓN/INVERSION" si tu backend devuelve segmento_id.
      // (Si no devuelve nada, deja el filtro en blanco o filtra por nombre).
      const tiposInv = tiposRaw.filter((t) => {
        const name = String(t?.nombre ?? '').toUpperCase();
        return name.includes('INVERSION') || name.includes('INVERSIÓN') || true; // si quieres filtrar estrictamente, quita el "|| true"
      });

      setTipos(tiposInv);

      // PROVEEDORES
      // TODO: si ya tienes proveedoresApi.listProveedores(), úsalo aquí.
      const provRes = await api.get<any[]>('/api/v1/proveedores');
      const provRaw = Array.isArray(provRes.data) ? provRes.data : [];
      const mappedProv: MiniEntity[] = provRaw
        .map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? p.id) }))
        .filter((p) => p.id);

      setProveedores(mappedProv);
    } catch (e) {
      console.error('[InversionForm] loadCombos error', e);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      setLoading(!!isEdit);
      await loadCombos();

      if (!isEdit || !inversionId) {
        setLoading(false);
        return;
      }

      const inv = await inversionesApi.getInversion(inversionId);
      setForm((prev) => ({
        ...prev,
        ...inv,
        // normaliza nulls
        proveedor_id: inv.proveedor_id ?? null,
        dealer_id: inv.dealer_id ?? null,
        descripcion: inv.descripcion ?? '',
        notas: inv.notas ?? '',
      }));
    } catch (e) {
      console.error('[InversionForm] loadInitial error', e);
      Alert.alert('Error', 'No se pudo cargar la inversión.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isEdit, inversionId, loadCombos, navigation]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadInitial();
  };

  const validate = (): boolean => {
    if (!form.nombre?.trim()) return Alert.alert('Campo obligatorio', 'El nombre es obligatorio.'), false;
    if (!form.tipo_gasto_id?.trim()) return Alert.alert('Campo obligatorio', 'Selecciona el tipo de inversión.'), false;
    return true;
  };

  const onGuardar = async () => {
    if (readOnly) return;
    if (!validate()) return;

    try {
      setSaving(true);

      if (isEdit && inversionId) {
        await inversionesApi.updateInversion(inversionId, form as InversionUpdate);
        Alert.alert('Éxito', 'Inversión actualizada.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }

      const created = await inversionesApi.createInversion(form);
      Alert.alert('Éxito', 'Inversión creada.', [
        { text: 'OK', onPress: () => navigation.navigate('InversionDetalle', { inversionId: created.id }) },
      ]);
    } catch (e) {
      console.error('[InversionForm] save error', e);
      Alert.alert('Error', 'No se pudo guardar la inversión.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.topArea}>
          <Header title={title} subtitle="Cargando..." showBack onBackPress={() => navigation.goBack()} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topArea}>
        <Header title={title} subtitle={subtitle} showBack onBackPress={() => navigation.goBack()} />
      </View>

      <ScrollView
        style={styles.formArea}
        contentContainerStyle={styles.formContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <FormSection title="Básico">
          <FieldInput
            label="Nombre"
            value={form.nombre ?? ''}
            onChange={(v) => setForm((p) => ({ ...p, nombre: v }))}
            readOnly={readOnly}
          />

          <FieldInput
            label="Descripción"
            value={form.descripcion ?? ''}
            onChange={(v) => setForm((p) => ({ ...p, descripcion: v }))}
            readOnly={readOnly}
            multiline
          />

          <View style={styles.field}>
            <Text style={styles.label}>Estado</Text>
            <View style={styles.segmentosRow}>
              {['ACTIVA', 'CERRADA', 'DESCARTADA'].map((s) => (
                <View key={s} style={styles.segmentoWrapper}>
                  <PillButton
                    label={s}
                    selected={(form.estado ?? 'ACTIVA') === s}
                    onPress={() => !readOnly && setForm((p) => ({ ...p, estado: s }))}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection title="Tipo y contrapartes">
          <Text style={styles.helperText}>
            Tipo = tipo_gasto (segmento INVERSIÓN). Proveedor y dealer se eligen de proveedores.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Tipo de inversión</Text>
            <View style={formLayoutStyles.wrapList}>
              {tipos.map((t) => (
                <View key={t.id} style={formLayoutStyles.wrapItem}>
                  <PillButton
                    label={t.nombre}
                    selected={form.tipo_gasto_id === t.id}
                    onPress={() => !readOnly && setForm((p) => ({ ...p, tipo_gasto_id: t.id }))}
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Proveedor</Text>
            <View style={formLayoutStyles.wrapList}>
              {proveedores.map((p) => (
                <View key={p.id} style={formLayoutStyles.wrapItem}>
                  <PillButton
                    label={p.nombre}
                    selected={form.proveedor_id === p.id}
                    onPress={() => !readOnly && setForm((x) => ({ ...x, proveedor_id: x.proveedor_id === p.id ? null : p.id }))}
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Dealer</Text>
            <View style={formLayoutStyles.wrapList}>
              {proveedores.map((p) => (
                <View key={p.id} style={formLayoutStyles.wrapItem}>
                  <PillButton
                    label={p.nombre}
                    selected={form.dealer_id === p.id}
                    onPress={() => !readOnly && setForm((x) => ({ ...x, dealer_id: x.dealer_id === p.id ? null : p.id }))}
                  />
                </View>
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection title="Fechas">
          <View style={styles.field}>
            <Text style={styles.label}>Fecha creación</Text>
            <FormDateButton
              valueText={form.fecha_creacion ? form.fecha_creacion : 'Seleccionar fecha'}
              onPress={() => !readOnly && setShowFechaCreacionPicker(true)}
              disabled={readOnly}
            />
            {showFechaCreacionPicker && !readOnly ? (
              // En tu proyecto ya usas DateTimePicker; aquí dejo el patrón simple:
              <></>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Fecha inicio</Text>
            <FormDateButton
              valueText={form.fecha_inicio ? form.fecha_inicio : 'Seleccionar fecha'}
              onPress={() => !readOnly && setShowFechaInicioPicker(true)}
              disabled={readOnly}
            />
            {showFechaInicioPicker && !readOnly ? <></> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Fecha objetivo salida</Text>
            <FormDateButton
              valueText={form.fecha_objetivo_salida ? form.fecha_objetivo_salida : 'Seleccionar fecha'}
              onPress={() => !readOnly && setShowFechaSalidaPicker(true)}
              disabled={readOnly}
            />
            {showFechaSalidaPicker && !readOnly ? <></> : null}
          </View>
        </FormSection>

        <FormSection title="Esperado (para ranking y KPIs)">
          <View style={formLayoutStyles.row}>
            <View style={formLayoutStyles.col1of2}>
              <FieldInput
                label="Aporte estimado"
                value={form.aporte_estimado == null ? '' : String(form.aporte_estimado)}
                onChange={(v) => setForm((p) => ({ ...p, aporte_estimado: safeFloat(v) }))}
                readOnly={readOnly}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                inputMode="decimal"
              />
            </View>
            <View style={formLayoutStyles.col1of2}>
              <FieldInput
                label="Retorno esperado (total)"
                value={form.retorno_esperado_total == null ? '' : String(form.retorno_esperado_total)}
                onChange={(v) => setForm((p) => ({ ...p, retorno_esperado_total: safeFloat(v) }))}
                readOnly={readOnly}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                inputMode="decimal"
              />
            </View>
          </View>

          <FieldInput
            label="Plazo esperado (meses)"
            value={form.plazo_esperado_meses == null ? '' : String(form.plazo_esperado_meses)}
            onChange={(v) => setForm((p) => ({ ...p, plazo_esperado_meses: safeInt(v) }))}
            readOnly={readOnly}
            keyboardType="number-pad"
          />

          <Text style={styles.helperText}>
            Nota: IRR/ROI/MOIC se calculan automáticamente con aporte + retorno + plazo (si los informas).
          </Text>
        </FormSection>

        {!readOnly ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.saveButton} onPress={onGuardar} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear inversión'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

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
