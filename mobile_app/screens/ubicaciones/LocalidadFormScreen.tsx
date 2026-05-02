/**
 * Ruta: mobile_app/screens/ubicaciones/LocalidadFormScreen.tsx
 * Versión: 3.1.0
 *
 * Responsabilidad:
 *   - Buscar y seleccionar una localidad existente.
 *   - Crear una nueva localidad indicando región y país.
 *   - Permitir elegir país existente o crear país nuevo.
 *   - Permitir elegir región existente o crear región nueva.
 *
 * Maneja:
 *   - Flujo jerárquico país -> región -> localidad.
 *   - Listados buscables de localidades, regiones y países.
 *   - Alta idempotente mediante ensureLocalidadFlow.
 *
 * Notas:
 *   - El backend normaliza nombres a MAYÚSCULAS.
 *   - No se muestran ids al usuario.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';

import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';

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

type PaisOption = {
  id: number;
  nombre: string;
};

const LIMIT = 20;
const NOOP = () => {};

function buildLocLabel(loc: LocalidadWithContext): string {
  const r = loc.region?.nombre ? ` · ${loc.region.nombre}` : '';
  const p = loc.region?.pais?.nombre ? ` (${loc.region.pais.nombre})` : '';
  return `${loc.nombre}${r}${p}`;
}

function buildRegionLabel(r: RegionOption): string {
  return `${r.nombre}${r.paisNombre ? ` (${r.paisNombre})` : ''}`;
}

export default function LocalidadFormScreen({ navigation, route }: Props) {
  const styles = commonFormStyles;

  const returnRouteKey = route?.params?.returnRouteKey;
  const initialSearch = route?.params?.initialSearch ?? '';

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

  const [busquedaLocalidad, setBusquedaLocalidad] = useState(initialSearch);
  const [locOptions, setLocOptions] = useState<LocalidadWithContext[]>([]);
  const [locLoading, setLocLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newLocalidadText, setNewLocalidadText] = useState(initialSearch);
  const [newRegionText, setNewRegionText] = useState('');
  const [newPaisText, setNewPaisText] = useState('');

  const [regionId, setRegionId] = useState<number | null>(null);
  const [regionNombre, setRegionNombre] = useState('');
  const [paisId, setPaisId] = useState<number | null>(null);
  const [paisNombre, setPaisNombre] = useState('');

  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);

  const [busquedaRegion, setBusquedaRegion] = useState('');
  const [busquedaPais, setBusquedaPais] = useState('');

  const [regionLoading, setRegionLoading] = useState(false);
  const [paisLoading, setPaisLoading] = useState(false);

  const [creatingRegion, setCreatingRegion] = useState(false);
  const [creatingPais, setCreatingPais] = useState(false);

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

  const loadRegiones = useCallback(
    async (term: string, selectedPaisId?: number | null) => {
      try {
        setRegionLoading(true);
        const data = await listRegiones({
          search: term,
          paisId: selectedPaisId ?? undefined,
          limit: 100,
        });

        setRegionOptions(
          (data ?? []).map((r: RegionApi) => ({
            id: r.id,
            nombre: r.nombre,
            paisId: r.pais_id,
            paisNombre: r.pais?.nombre ?? null,
          }))
        );
      } catch {
        Alert.alert('Error', 'No se han podido cargar las regiones.');
      } finally {
        setRegionLoading(false);
      }
    },
    []
  );

  const loadPaises = useCallback(async (term: string) => {
    try {
      setPaisLoading(true);
      const data = await listPaises({ search: term, limit: 100 });
      setPaisOptions((data ?? []).map((p: PaisApi) => ({ id: p.id, nombre: p.nombre })));
    } catch {
      Alert.alert('Error', 'No se han podido cargar los países.');
    } finally {
      setPaisLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadLocalidades(busquedaLocalidad), 250);
    return () => clearTimeout(t);
  }, [busquedaLocalidad, loadLocalidades]);

  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => loadRegiones(busquedaRegion, paisId), 250);
    return () => clearTimeout(t);
  }, [creating, busquedaRegion, paisId, loadRegiones]);

  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => loadPaises(busquedaPais), 250);
    return () => clearTimeout(t);
  }, [creating, busquedaPais, loadPaises]);

  const selectedRegion = useMemo(() => {
    if (!regionId) return null;
    return (
      regionOptions.find((r) => r.id === regionId) ?? {
        id: regionId,
        nombre: regionNombre,
        paisId,
        paisNombre,
      }
    );
  }, [regionId, regionNombre, paisId, paisNombre, regionOptions]);

  const selectedPais = useMemo(() => {
    if (!paisId) return null;
    return paisOptions.find((p) => p.id === paisId) ?? { id: paisId, nombre: paisNombre };
  }, [paisId, paisNombre, paisOptions]);

  const handleSelectRegion = (r: RegionOption) => {
    setRegionId(r.id);
    setRegionNombre(r.nombre);
    setCreatingRegion(false);
    setNewRegionText('');
    setBusquedaRegion('');

    if (r.paisId) setPaisId(r.paisId);
    if (r.paisNombre) setPaisNombre(r.paisNombre);
  };

  const handleSelectPais = (p: PaisOption) => {
    setPaisId(p.id);
    setPaisNombre(p.nombre);
    setCreatingPais(false);
    setNewPaisText('');
    setBusquedaPais('');

    if (regionId) {
      const currentRegion = regionOptions.find((r) => r.id === regionId);
      if (currentRegion?.paisId && currentRegion.paisId !== p.id) {
        setRegionId(null);
        setRegionNombre('');
      }
    }
  };

  const confirmCreateLocalidad = async () => {
    const localidadNombre = newLocalidadText.trim();
    const regionNombreFinal = creatingRegion ? newRegionText.trim() : regionNombre.trim();
    const paisNombreFinal = creatingPais ? newPaisText.trim() : paisNombre.trim();

    if (!localidadNombre) {
      Alert.alert('Campo requerido', 'Debes escribir una localidad.');
      return;
    }

    if (!regionId && !regionNombreFinal) {
      Alert.alert('Campo requerido', 'Debes seleccionar o crear una región.');
      return;
    }

    if (!paisId && !paisNombreFinal) {
      Alert.alert('Campo requerido', 'Debes seleccionar o crear un país.');
      return;
    }

    try {
      setSaving(true);

      const result = await ensureLocalidadFlow({
        paisId,
        paisNombre: paisNombreFinal,

        regionId,
        regionNombre: regionNombreFinal,

        localidadNombre,
      });

      if (!result.localidad) {
        Alert.alert('Error', 'No se ha podido crear la localidad.');
        return;
      }

      sendResultAndClose(result.localidad);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se ha podido crear la localidad.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormScreen
      title="Localidad"
      onBackPress={() => navigation.goBack()}
      footer={
        creating ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={confirmCreateLocalidad}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>
                {saving ? 'Creando...' : 'Crear localidad'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
    >
      <FormSection title="Buscar localidad existente">
        <InlineSearchSelect
          label="Localidad"
          onAddPress={() => {
            setCreating(true);
            setNewLocalidadText(busquedaLocalidad);
          }}
          selected={null}
          selectedLabel={() => ''}
          onClear={NOOP}
          query={busquedaLocalidad}
          onChangeQuery={setBusquedaLocalidad}
          placeholder="Buscar localidad..."
          options={locOptions}
          optionKey={(l) => String(l.id)}
          optionLabel={(l) => buildLocLabel(l)}
          onSelect={(l) => sendResultAndClose(l)}
          emptyText="No hay localidades que coincidan con la búsqueda."
        />

        {locLoading ? <ActivityIndicator /> : null}
      </FormSection>

      {creating ? (
        <>
          <FormSection title="Nueva localidad">
            <View style={styles.field}>
              <Text style={styles.label}>Localidad</Text>
              <TextInput
                style={[
                  styles.input,
                  newLocalidadText.trim() !== '' ? styles.inputFilled : null,
                ]}
                placeholder="Ej: MADRID"
                value={newLocalidadText}
                onChangeText={setNewLocalidadText}
              />
            </View>
          </FormSection>

          <FormSection title="País">
            <InlineSearchSelect<PaisOption>
              label="País"
              onAddPress={() => {
                setCreatingPais(true);
                setPaisId(null);
                setPaisNombre('');
                setNewPaisText(busquedaPais);
              }}
              selected={selectedPais}
              selectedLabel={(p) => p.nombre}
              onClear={() => {
                setPaisId(null);
                setPaisNombre('');
                setRegionId(null);
                setRegionNombre('');
              }}
              query={busquedaPais}
              onChangeQuery={setBusquedaPais}
              placeholder="Buscar país..."
              options={paisOptions}
              optionKey={(p) => String(p.id)}
              optionLabel={(p) => p.nombre}
              onSelect={handleSelectPais}
              emptyText="No hay países que coincidan con la búsqueda."
            />

            {paisLoading ? <ActivityIndicator /> : null}

            {creatingPais ? (
              <View style={styles.field}>
                <Text style={styles.label}>Nuevo país</Text>
                <TextInput
                  style={[
                    styles.input,
                    newPaisText.trim() !== '' ? styles.inputFilled : null,
                  ]}
                  placeholder="Ej: ESPAÑA"
                  value={newPaisText}
                  onChangeText={setNewPaisText}
                />
              </View>
            ) : null}
          </FormSection>

          <FormSection title="Región">
            <InlineSearchSelect<RegionOption>
              label="Región"
              onAddPress={() => {
                setCreatingRegion(true);
                setRegionId(null);
                setRegionNombre('');
                setNewRegionText(busquedaRegion);
              }}
              selected={selectedRegion}
              selectedLabel={(r) => buildRegionLabel(r)}
              onClear={() => {
                setRegionId(null);
                setRegionNombre('');
              }}
              query={busquedaRegion}
              onChangeQuery={setBusquedaRegion}
              placeholder={
                paisId
                  ? 'Buscar región del país seleccionado...'
                  : 'Buscar región...'
              }
              options={regionOptions}
              optionKey={(r) => String(r.id)}
              optionLabel={(r) => buildRegionLabel(r)}
              onSelect={handleSelectRegion}
              emptyText="No hay regiones que coincidan con la búsqueda."
            />

            {regionLoading ? <ActivityIndicator /> : null}

            {creatingRegion ? (
              <View style={styles.field}>
                <Text style={styles.label}>Nueva región</Text>
                <TextInput
                  style={[
                    styles.input,
                    newRegionText.trim() !== '' ? styles.inputFilled : null,
                  ]}
                  placeholder="Ej: COMUNIDAD DE MADRID"
                  value={newRegionText}
                  onChangeText={setNewRegionText}
                />
                <Text style={styles.helperText}>
                  La región se creará asociada al país seleccionado o al nuevo país escrito.
                </Text>
              </View>
            ) : null}
          </FormSection>
        </>
      ) : null}
    </FormScreen>
  );
}
