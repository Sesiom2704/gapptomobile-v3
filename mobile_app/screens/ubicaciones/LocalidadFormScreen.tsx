/**
 * Ruta: mobile_app/screens/ubicaciones/LocalidadFormScreen.tsx
 * Versión: 3.0.0
 * Refactor:
 * - Uso de ubicacionesFlow.ts
 * - Eliminación de lógica duplicada
 * - Flujo jerárquico robusto
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';

import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { SelectedInlineValue } from '../../components/ui/SelectedInlineValue';

import {
  listLocalidades,
  listPaises,
  listRegiones,
  type LocalidadWithContext,
  type Pais as PaisApi,
  type Region as RegionApi,
} from '../../services/ubicacionesApi';

import { ensureLocalidadFlow } from '../../services/ubicacionesFlow';

import type { PropiedadesStackParamList } from '../../navigation/PropiedadesStack';

type Props = NativeStackScreenProps<PropiedadesStackParamList, 'LocalidadForm'>;

type RegionOption = {
  id: number;
  nombre: string;
  paisId: number | null;
  paisNombre: string | null;
};

type PaisOption = { id: number; nombre: string };

const LIMIT = 10;
const NOOP = () => {};

function buildLocLabel(loc: LocalidadWithContext): string {
  const r = loc.region?.nombre ? ` · ${loc.region.nombre}` : '';
  const p = loc.region?.pais?.nombre ? ` · ${loc.region.pais.nombre}` : '';
  return `${loc.nombre}${r}${p}`;
}

function buildRegionLabel(r: RegionOption): string {
  return `${r.nombre}${r.paisNombre ? ` (${r.paisNombre})` : ''}`;
}

export default function LocalidadFormScreen({ navigation, route }: Props) {
  const styles = commonFormStyles;

  const returnRouteKey = route?.params?.returnRouteKey;
  const initialSearch = route?.params?.initialSearch ?? '';

  // =========================
  // RETORNO
  // =========================

  const sendResultAndClose = (item: LocalidadWithContext) => {
    const auxResult = { type: 'localidad', item, mode: 'created' as const };

    if (returnRouteKey) {
      navigation.dispatch({
        ...(CommonActions.setParams({ auxResult }) as any),
        source: returnRouteKey,
      });
    }

    navigation.goBack();
  };

  // =========================
  // BUSCADOR
  // =========================

  const [busquedaLocalidad, setBusquedaLocalidad] = useState(initialSearch);
  const [locOptions, setLocOptions] = useState<LocalidadWithContext[]>([]);
  const [locLoading, setLocLoading] = useState(false);

  const loadLocalidades = useCallback(async (term: string) => {
    try {
      setLocLoading(true);
      const res = await listLocalidades({ search: term, limit: LIMIT });
      setLocOptions(res ?? []);
    } catch {
      Alert.alert('Error', 'No se han podido cargar las localidades.');
    } finally {
      setLocLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadLocalidades(busquedaLocalidad), 250);
    return () => clearTimeout(t);
  }, [busquedaLocalidad]);

  // =========================
  // CREACIÓN
  // =========================

  const [creating, setCreating] = useState(false);

  const [newLocalidadText, setNewLocalidadText] = useState('');
  const [newRegionText, setNewRegionText] = useState('');
  const [newPaisText, setNewPaisText] = useState('');

  const [regionId, setRegionId] = useState<number | null>(null);
  const [paisId, setPaisId] = useState<number | null>(null);

  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);

  const loadRegiones = async (term: string) => {
    const data = await listRegiones({ search: term, limit: LIMIT });
    setRegionOptions(
      (data ?? []).map((r: RegionApi) => ({
        id: r.id,
        nombre: r.nombre,
        paisId: r.pais_id,
        paisNombre: r.pais?.nombre ?? null,
      }))
    );
  };

  const loadPaises = async (term: string) => {
    const data = await listPaises({ search: term, limit: LIMIT });
    setPaisOptions(data.map((p: PaisApi) => ({ id: p.id, nombre: p.nombre })));
  };

  const confirmCreateLocalidad = async () => {
    try {
      const result = await ensureLocalidadFlow({
        paisId,
        paisNombre: newPaisText,

        regionId,
        regionNombre: newRegionText,

        localidadNombre: newLocalidadText,
      });

      if (!result.localidad) {
        Alert.alert('Error', 'No se ha podido crear la localidad.');
        return;
      }

      sendResultAndClose(result.localidad);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'No se ha podido crear.');
    }
  };

  // =========================
  // UI
  // =========================

  return (
    <FormScreen
      title="Localidad"
      onBackPress={() => navigation.goBack()}
      footer={
        creating ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.saveButton} onPress={confirmCreateLocalidad}>
              <Text style={styles.saveButtonText}>Crear localidad</Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
    >
      <FormSection title="Buscar">
        <InlineSearchSelect
          label="Localidad"
          onAddPress={() => setCreating(true)}
          selected={null}
          selectedLabel={() => ''}
          onClear={() => {}}
          query={busquedaLocalidad}
          onChangeQuery={setBusquedaLocalidad}
          options={locOptions}
          optionKey={(l) => String(l.id)}
          optionLabel={(l) => buildLocLabel(l)}
          onSelect={(l) => sendResultAndClose(l)}
        />

        {locLoading && <ActivityIndicator />}
      </FormSection>

      {creating && (
        <FormSection title="Nueva localidad">
          <TextInput
            style={styles.input}
            placeholder="Localidad"
            value={newLocalidadText}
            onChangeText={setNewLocalidadText}
          />

          <TextInput
            style={styles.input}
            placeholder="Región"
            value={newRegionText}
            onChangeText={setNewRegionText}
          />

          <TextInput
            style={styles.input}
            placeholder="País"
            value={newPaisText}
            onChangeText={setNewPaisText}
          />
        </FormSection>
      )}
    </FormScreen>
  );
}