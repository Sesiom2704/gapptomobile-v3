/**
 * Archivo: mobile_app/screens/ubicaciones/LocalidadFormScreen.tsx
 *
 * Objetivo UI/UX:
 *   - El desplegable de Localidad use InlineSearchSelect (igual que Proveedor en gastos).
 *
 * Nota TS:
 *   - InlineSearchSelect requiere onAddPress y onClear obligatorios.
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
  createPais,
  createRegion,
  createLocalidad,
  type LocalidadWithContext,
  type Pais as PaisApi,
  type Region as RegionApi,
} from '../../services/ubicacionesApi';

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

  const returnRouteKey: string | undefined = route?.params?.returnRouteKey;
  const returnTo: string | undefined = route?.params?.returnTo;
  const initialSearch: string = route?.params?.initialSearch ?? '';

  // =========================
  // Retorno robusto (auxResult)
  // =========================
  const findOwningNavigatorByRouteKey = (nav: any, targetRouteKey: string) => {
    let current = nav;
    while (current) {
      try {
        const state = current.getState?.();
        const routes = state?.routes ?? [];
        const found = routes.some((r: any) => r?.key === targetRouteKey);
        if (found) return current;
      } catch {
        // ignore
      }
      current = current.getParent?.() ?? null;
    }
    return null;
  };

  const sendResultAndClose = (item: LocalidadWithContext) => {
    const auxResult = { type: 'localidad', item, key: 'localidad', mode: 'created' as const };

    if (returnRouteKey) {
      const ownerNav = findOwningNavigatorByRouteKey(navigation, returnRouteKey);
      if (ownerNav) {
        try {
          ownerNav.dispatch({
            ...(CommonActions.setParams({ auxResult }) as any),
            source: returnRouteKey,
          });
          navigation.goBack();
          return;
        } catch (e) {
          console.warn('[LocalidadForm] setParams(source) falló', e);
        }
      }
    }

    if (returnTo) {
      try {
        navigation.navigate({ name: returnTo as any, params: { auxResult }, merge: true } as any);
        return;
      } catch (e) {
        console.warn('[LocalidadForm] navigate(returnTo) falló', e);
      }
    }

    navigation.goBack();
  };

  // =========================
  // Selección localidad (InlineSearchSelect)
  // =========================
  const [busquedaLocalidad, setBusquedaLocalidad] = useState<string>(initialSearch);
  const [locLoading, setLocLoading] = useState<boolean>(false);
  const [locOptions, setLocOptions] = useState<LocalidadWithContext[]>([]);
  const [selectedLoc, setSelectedLoc] = useState<LocalidadWithContext | null>(null);

  const loadLocalidades = useCallback(async (term: string) => {
    try {
      setLocLoading(true);
      const res = await listLocalidades({
        search: term?.trim() ? term.trim() : undefined,
        limit: LIMIT,
      });
      setLocOptions(res ?? []);
    } catch (e) {
      console.error('[LocalidadForm] listLocalidades error', e);
      Alert.alert('Error', 'No se han podido cargar las localidades.');
    } finally {
      setLocLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadLocalidades(busquedaLocalidad), 220);
    return () => clearTimeout(t);
  }, [busquedaLocalidad, loadLocalidades]);

  const localidadesFiltradas = useMemo(() => {
    const term = busquedaLocalidad.trim().toLowerCase();
    const base = locOptions ?? [];
    if (!term) return base.slice(0, LIMIT);
    return base.filter((l) => (l.nombre ?? '').toLowerCase().includes(term)).slice(0, LIMIT);
  }, [locOptions, busquedaLocalidad]);

  // =========================
  // Crear localidad (jerárquico)
  // =========================
  const [creating, setCreating] = useState<boolean>(false);
  const [newLocalidadText, setNewLocalidadText] = useState<string>('');

  const [regionId, setRegionId] = useState<number | null>(null);
  const [selectedRegionLabel, setSelectedRegionLabel] = useState<string>('');
  const [searchRegion, setSearchRegion] = useState<string>('');
  const [regionLoading, setRegionLoading] = useState<boolean>(false);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [creatingRegion, setCreatingRegion] = useState<boolean>(false);
  const [newRegionText, setNewRegionText] = useState<string>('');

  const [paisId, setPaisId] = useState<number | null>(null);
  const [selectedPaisLabel, setSelectedPaisLabel] = useState<string>('');
  const [searchPais, setSearchPais] = useState<string>('');
  const [paisLoading, setPaisLoading] = useState<boolean>(false);
  const [paisOptions, setPaisOptions] = useState<PaisOption[]>([]);
  const [creatingPais, setCreatingPais] = useState<boolean>(false);
  const [newPaisText, setNewPaisText] = useState<string>('');

  const loadRegiones = useCallback(
    async (term: string) => {
      try {
        setRegionLoading(true);
        const data = await listRegiones({
          search: term?.trim() ? term.trim() : undefined,
          limit: LIMIT,
          paisId: paisId ?? undefined,
        });
        const mapped = (data ?? []).map((r: RegionApi) => ({
          id: r.id,
          nombre: r.nombre,
          paisId: r.pais_id ?? null,
          paisNombre: r.pais?.nombre ?? null,
        }));
        setRegionOptions(mapped);
      } catch (e) {
        console.error('[LocalidadForm] listRegiones error', e);
        Alert.alert('Error', 'No se han podido cargar las regiones.');
      } finally {
        setRegionLoading(false);
      }
    },
    [paisId]
  );

  const loadPaises = useCallback(async (term: string) => {
    try {
      setPaisLoading(true);
      const data = await listPaises({ search: term?.trim() ? term.trim() : undefined, limit: LIMIT });
      setPaisOptions((data ?? []).map((p: PaisApi) => ({ id: p.id, nombre: p.nombre })));
    } catch (e) {
      console.error('[LocalidadForm] listPaises error', e);
      Alert.alert('Error', 'No se han podido cargar los países.');
    } finally {
      setPaisLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => void loadRegiones(searchRegion), 220);
    return () => clearTimeout(t);
  }, [creating, searchRegion, loadRegiones]);

  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => void loadPaises(searchPais), 220);
    return () => clearTimeout(t);
  }, [creating, searchPais, loadPaises]);

  const ensurePaisCreatedIfNeeded = async (): Promise<number | null> => {
    if (paisId) return paisId;

    const nombrePais = (creatingPais ? newPaisText : '').trim();
    if (!nombrePais) return null;

    const creado = await createPais({ nombre: nombrePais, codigo_iso: null });
    setPaisId(creado.id);
    setSelectedPaisLabel(creado.nombre);
    setCreatingPais(false);
    setNewPaisText('');
    return creado.id;
  };

  const ensureRegionCreatedIfNeeded = async (): Promise<number | null> => {
    if (regionId) return regionId;

    const nombreRegion = (creatingRegion ? newRegionText : '').trim();
    if (!nombreRegion) return null;

    const pid = await ensurePaisCreatedIfNeeded();
    if (!pid) {
      Alert.alert('Campo requerido', 'Para crear una región necesitas indicar un país.');
      return null;
    }

    const creado = await createRegion({ nombre: nombreRegion, pais_id: pid });
    setRegionId(creado.id);
    setSelectedRegionLabel(creado.nombre);
    setCreatingRegion(false);
    setNewRegionText('');
    if (creado.pais?.nombre) setSelectedPaisLabel(creado.pais.nombre);
    setPaisId(creado.pais_id ?? pid);
    return creado.id;
  };

  const confirmCreateLocalidad = async () => {
    const nombreLoc = newLocalidadText.trim();
    if (!nombreLoc) {
      Alert.alert('Campo requerido', 'Debes escribir una localidad.');
      return;
    }

    try {
      const rid = await ensureRegionCreatedIfNeeded();
      if (!rid) {
        Alert.alert('Campo requerido', 'Debes seleccionar o crear una región.');
        return;
      }

      const creado = await createLocalidad({ nombre: nombreLoc, region_id: rid });
      sendResultAndClose(creado);
    } catch (e) {
      console.error('[LocalidadForm] createLocalidad error', e);
      Alert.alert('Error', 'No se ha podido crear la localidad.');
    }
  };

  const toggleCreate = () => {
    setCreating(true);

    setNewLocalidadText('');
    setRegionId(null);
    setSelectedRegionLabel('');
    setCreatingRegion(false);
    setNewRegionText('');

    setPaisId(null);
    setSelectedPaisLabel('');
    setCreatingPais(false);
    setNewPaisText('');

    setSearchRegion('');
    setSearchPais('');

    void loadRegiones('');
    void loadPaises('');
  };

  const closeCreate = () => {
    setCreating(false);
  };

  // =========================
  // RENDER
  // =========================
  return (
    <FormScreen
      title="Localidad"
      onBackPress={() => navigation.goBack()}
      loading={false}
      footer={
        creating ? (
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.saveButton} onPress={confirmCreateLocalidad}>
              <Text style={styles.saveButtonText}>Crear y usar localidad</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={closeCreate}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
    >
      <FormSection title="Buscar y seleccionar">
        <View style={styles.field}>
          <InlineSearchSelect<LocalidadWithContext>
            label="Localidad"
            onAddPress={NOOP}
            addAccessibilityLabel="Añadir (no aplica)"
            disabled={false}
            selected={selectedLoc}
            selectedLabel={(l) => buildLocLabel(l)}
            onClear={() => {
              setSelectedLoc(null);
              setBusquedaLocalidad('');
            }}
            query={busquedaLocalidad}
            onChangeQuery={(v) => setBusquedaLocalidad(v)}
            placeholder="Escribe para buscar localidad"
            options={localidadesFiltradas}
            optionKey={(l) => String(l.id)}
            optionLabel={(l) => buildLocLabel(l)}
            onSelect={(l) => {
              setSelectedLoc(l);
              sendResultAndClose(l);
            }}
            emptyText="No hay localidades que coincidan con la búsqueda."
          />

          {locLoading ? (
            <View style={{ marginTop: 8 }}>
              <ActivityIndicator />
            </View>
          ) : null}

          <Text style={styles.helperText}>Resultados limitados a {LIMIT}.</Text>
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={toggleCreate}>
          <Text style={styles.saveButtonText}>+ Crear nueva localidad</Text>
        </TouchableOpacity>
      </FormSection>

      {creating ? (
        <FormSection title="Crear localidad">
          <View style={styles.field}>
            <Text style={styles.label}>Nombre de la localidad</Text>
            <TextInput
              value={newLocalidadText}
              onChangeText={setNewLocalidadText}
              placeholder="Ej: Pozuelo de Alarcón"
              style={[styles.input, newLocalidadText.trim() ? styles.inputFilled : null]}
            />
          </View>

          <View style={styles.field}>
            <InlineSearchSelect<RegionOption>
              label="Región"
              onAddPress={() => {
                setCreatingRegion(true);
                setNewRegionText('');
                setRegionId(null);
                setSelectedRegionLabel('');
              }}
              addAccessibilityLabel="Crear región"
              disabled={false}
              selected={
                regionId && selectedRegionLabel
                  ? ({ id: regionId, nombre: selectedRegionLabel, paisId, paisNombre: selectedPaisLabel || null } as any)
                  : null
              }
              selectedLabel={(r) => r.nombre}
              onClear={() => {
                setRegionId(null);
                setSelectedRegionLabel('');
              }}
              query={searchRegion}
              onChangeQuery={(v) => {
                setSearchRegion(v);
                void loadRegiones(v);
              }}
              placeholder="Escribe para buscar región"
              options={regionOptions}
              optionKey={(r) => String(r.id)}
              optionLabel={(r) => buildRegionLabel(r)}
              onSelect={(r) => {
                setRegionId(r.id);
                setSelectedRegionLabel(r.nombre);

                if (r.paisId) {
                  setPaisId(r.paisId);
                  if (r.paisNombre) setSelectedPaisLabel(r.paisNombre);
                }
              }}
              emptyText="No hay regiones que coincidan con la búsqueda."
            />

            {regionLoading ? (
              <View style={{ marginTop: 8 }}>
                <ActivityIndicator />
              </View>
            ) : null}

            {creatingRegion ? (
              <View style={{ marginTop: 10 }}>
                <SelectedInlineValue
                  value="Creando nueva región (inline)"
                  leftIconName="layers-outline"
                  onClear={() => {
                    setCreatingRegion(false);
                    setNewRegionText('');
                  }}
                />

                <TextInput
                  value={newRegionText}
                  onChangeText={setNewRegionText}
                  placeholder="Nombre de la región..."
                  style={[styles.input, newRegionText.trim() ? styles.inputFilled : null]}
                />

                <Text style={[styles.helperText, { marginTop: 6 }]}>
                  Para crear una región necesitas indicar un país (abajo).
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.field}>
            <InlineSearchSelect<PaisOption>
              label="País"
              onAddPress={() => {
                setCreatingPais(true);
                setNewPaisText('');
                setPaisId(null);
                setSelectedPaisLabel('');
              }}
              addAccessibilityLabel="Crear país"
              disabled={false}
              selected={paisId && selectedPaisLabel ? ({ id: paisId, nombre: selectedPaisLabel } as any) : null}
              selectedLabel={(p) => p.nombre}
              onClear={() => {
                setPaisId(null);
                setSelectedPaisLabel('');
              }}
              query={searchPais}
              onChangeQuery={(v) => {
                setSearchPais(v);
                void loadPaises(v);
              }}
              placeholder="Escribe para buscar país"
              options={paisOptions}
              optionKey={(p) => String(p.id)}
              optionLabel={(p) => p.nombre}
              onSelect={(p) => {
                setPaisId(p.id);
                setSelectedPaisLabel(p.nombre);

                if (regionId) {
                  setRegionId(null);
                  setSelectedRegionLabel('');
                }
              }}
              emptyText="No hay países que coincidan con la búsqueda."
            />

            {paisLoading ? (
              <View style={{ marginTop: 8 }}>
                <ActivityIndicator />
              </View>
            ) : null}

            {creatingPais ? (
              <View style={{ marginTop: 10 }}>
                <SelectedInlineValue
                  value="Creando nuevo país (inline)"
                  leftIconName="flag-outline"
                  onClear={() => {
                    setCreatingPais(false);
                    setNewPaisText('');
                  }}
                />

                <TextInput
                  value={newPaisText}
                  onChangeText={setNewPaisText}
                  placeholder="Nombre del país..."
                  style={[styles.input, newPaisText.trim() ? styles.inputFilled : null]}
                />

                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 10 }]}
                  onPress={async () => {
                    const v = newPaisText.trim();
                    if (!v) {
                      Alert.alert('Campo requerido', 'Debes escribir un país.');
                      return;
                    }
                    try {
                      await ensurePaisCreatedIfNeeded();
                    } catch (e) {
                      console.error('[LocalidadForm] createPais error', e);
                      Alert.alert('Error', 'No se ha podido crear el país.');
                    }
                  }}
                >
                  <Text style={styles.saveButtonText}>Crear país</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={confirmCreateLocalidad}>
            <Text style={styles.saveButtonText}>Crear y usar localidad</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={closeCreate}>
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </TouchableOpacity>
        </FormSection>
      ) : null}
    </FormScreen>
  );
}
