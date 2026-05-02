/**
 * Ruta: mobile_app/screens/auxiliares/AuxEntityListScreen.tsx
 * Versión: 2.1.0
 * Descripción:
 * Pantalla de listado genérico de tablas auxiliares.
 *
 * Responsabilidades:
 * - Mostrar listados auxiliares, proveedores y ubicaciones.
 * - Permitir búsqueda por nombre.
 * - Navegar a formulario de creación/edición.
 * - Mostrar información contextual relacionada:
 *   * rama / segmento / subsegmento
 *   * localidad / región / país
 *   * contadores de registros asociados
 *
 * Ajustes:
 * - Añade soporte a pais, region y localidad.
 * - Mantiene compatibilidad con proveedores y resto de auxiliares.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { listProveedores, Proveedor } from '../../services/proveedoresApi';
import {
  listAux,
  AuxEntity,
} from '../../services/auxiliaresApi';

type Props = {
  navigation: any;
  route: any;
};

type Origin = 'config' | 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';

type SimpleAuxItem = {
  id: string;
  nombre: string;
  associated_count?: number | null;
  [k: string]: any;
};

type CountMap = Record<string, number>;

function countLabel(count?: number | null, singular = 'registro', plural = 'registros') {
  const safe = Number(count ?? 0);
  return `${safe} ${safe === 1 ? singular : plural} asociados`;
}

function getAssociatedCount(item: any, fallback?: number | null): number {
  const backendCount = item?.associated_count;
  if (typeof backendCount === 'number' && Number.isFinite(backendCount)) {
    return backendCount;
  }
  return Number(fallback ?? 0);
}

export const AuxEntityListScreen: React.FC<Props> = ({ navigation, route }) => {
  const auxType: AuxEntity | 'proveedor' = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<Proveedor | SimpleAuxItem>>([]);
  const [loading, setLoading] = useState(false);

  const [ramasGastoMap, setRamasGastoMap] = useState<Record<string, string>>({});
  const [segmentosMap, setSegmentosMap] = useState<Record<string, string>>({});
  const [ramasIngresoMap, setRamasIngresoMap] = useState<Record<string, string>>({});
  const [ramasProveedorMap, setRamasProveedorMap] = useState<Record<string, string>>({});

  const [proveedorCountByRama, setProveedorCountByRama] = useState<CountMap>({});
  const [proveedorCountBySubsegmento, setProveedorCountBySubsegmento] = useState<CountMap>({});
  const [gastoCountByTipo, setGastoCountByTipo] = useState<CountMap>({});
  const [ingresoCountByTipo, setIngresoCountByTipo] = useState<CountMap>({});

  const titleByType: Record<string, string> = {
    proveedor: 'Proveedores',
    tipo_gasto: 'Tipos de gasto',
    tipo_segmento_gasto: 'Segmentos de gasto',
    tipo_ramas_gasto: 'Ramas de gasto',
    tipo_ramas_ingreso: 'Ramas de ingreso',
    tipo_ramas_proveedores: 'Ramas de proveedores',
    tipo_ingreso: 'Tipos de ingreso',
    tipo_subsegmento_proveedor: 'Subsegmentos de proveedores',
    pais: 'Países',
    region: 'Regiones',
    localidad: 'Localidades',
  };

  const subtitleByType: Record<string, string> = {
    proveedor: 'Gestiona tus proveedores habituales.',
    tipo_gasto: 'Configura las categorías de gasto.',
    tipo_segmento_gasto: 'Segmenta los gastos por tipo.',
    tipo_ramas_gasto: 'Agrupa gastos por rama.',
    tipo_ramas_ingreso: 'Agrupa ingresos por rama.',
    tipo_ramas_proveedores: 'Agrupa proveedores por rama.',
    tipo_ingreso: 'Configura los tipos de ingreso.',
    tipo_subsegmento_proveedor: 'Clasifica proveedores dentro de cada rama.',
    pais: 'Gestiona países disponibles.',
    region: 'Gestiona regiones asociadas a país.',
    localidad: 'Gestiona localidades asociadas a región.',
  };

  const title = titleByType[auxType] ?? 'Tabla auxiliar';
  const subtitle = subtitleByType[auxType] ?? 'Configuración avanzada.';

  const clearContextMaps = () => {
    setRamasGastoMap({});
    setSegmentosMap({});
    setRamasIngresoMap({});
    setRamasProveedorMap({});
    setProveedorCountByRama({});
    setProveedorCountBySubsegmento({});
    setGastoCountByTipo({});
    setIngresoCountByTipo({});
  };

  const load = useCallback(async () => {
    setLoading(true);

    try {
      if (auxType === 'proveedor') {
        const data = await listProveedores();
        setItems(data);
        clearContextMaps();
        return;
      }

      const data = await listAux<SimpleAuxItem>(auxType as AuxEntity);
      setItems(data);

      if (auxType === 'tipo_gasto') {
        const [ramas, segmentos] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_gasto'),
          listAux<SimpleAuxItem>('tipo_segmento_gasto'),
        ]);

        const rMap: Record<string, string> = {};
        for (const r of ramas ?? []) rMap[String(r.id)] = String(r.nombre);

        const sMap: Record<string, string> = {};
        for (const s of segmentos ?? []) sMap[String(s.id)] = String(s.nombre);

        setRamasGastoMap(rMap);
        setSegmentosMap(sMap);
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        return;
      }

      if (auxType === 'tipo_ingreso') {
        const ramasIngreso = await listAux<SimpleAuxItem>('tipo_ramas_ingreso');

        const riMap: Record<string, string> = {};
        for (const r of ramasIngreso ?? []) riMap[String(r.id)] = String(r.nombre);

        setRamasIngresoMap(riMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasProveedorMap({});
        return;
      }

      if (auxType === 'tipo_subsegmento_proveedor') {
        const ramasProveedor = await listAux<SimpleAuxItem>('tipo_ramas_proveedores');

        const rpMap: Record<string, string> = {};
        for (const r of ramasProveedor ?? []) rpMap[String(r.id)] = String(r.nombre);

        setRamasProveedorMap(rpMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        return;
      }

      clearContextMaps();
    } catch (err) {
      console.error('[AuxEntityList] Error cargando', auxType, err);
      setItems([]);
      clearContextMaps();
    } finally {
      setLoading(false);
    }
  }, [auxType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void load();
    });
    return unsubscribe;
  }, [navigation, load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;

    return items.filter((item: any) => {
      const nombre = String(item?.nombre ?? '').toLowerCase();
      const pais = String(item?.pais?.nombre ?? item?.region?.pais?.nombre ?? '').toLowerCase();
      const region = String(item?.region?.nombre ?? '').toLowerCase();
      return nombre.includes(term) || pais.includes(term) || region.includes(term);
    });
  }, [items, search]);

  const handleAdd = () => {
    navigation.navigate('AuxEntityForm', {
      auxType,
      origin,
    });
  };

  const handleEdit = (item: any) => {
    navigation.navigate('AuxEntityForm', {
      auxType,
      origin,
      editingItem: item,
      editingProveedor: auxType === 'proveedor' ? item : undefined,
    });
  };

  return (
    <>
      <Header title={title} subtitle={subtitle} showBack onAddPress={handleAdd} />

      <View style={panelStyles.screen}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Ionicons
              name="search-outline"
              size={18}
              color={colors.textSecondary}
              style={{ marginRight: 8 }}
            />
            <TextInput
              placeholder={`Buscar ${title.toLowerCase()}...`}
              value={search}
              onChangeText={setSearch}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {loading && (
            <Text style={{ textAlign: 'center', marginTop: 16 }}>
              Cargando...
            </Text>
          )}

          {!loading &&
            filtered.map((item: any) => {
              const ramaGastoName =
                auxType === 'tipo_gasto' && item?.rama_id
                  ? (ramasGastoMap[String(item.rama_id)] ?? String(item.rama_id))
                  : null;

              const segmentoName =
                auxType === 'tipo_gasto' && item?.segmento_id
                  ? (segmentosMap[String(item.segmento_id)] ?? String(item.segmento_id))
                  : null;

              const ramaIngresoName =
                auxType === 'tipo_ingreso' && item?.rama_id
                  ? (ramasIngresoMap[String(item.rama_id)] ?? String(item.rama_id))
                  : null;

              const ramaProveedorName =
                auxType === 'tipo_subsegmento_proveedor' && item?.rama_id
                  ? (ramasProveedorMap[String(item.rama_id)] ?? String(item.rama_id))
                  : null;

              const proveedorOwnCount =
                auxType === 'proveedor'
                  ? getAssociatedCount(item, 0)
                  : null;

              const proveedorCount =
                auxType === 'tipo_ramas_proveedores'
                  ? getAssociatedCount(item, proveedorCountByRama[String(item.id)] ?? 0)
                  : null;

              const gastoTipoCount =
                auxType === 'tipo_gasto'
                  ? getAssociatedCount(item, gastoCountByTipo[String(item.id)] ?? 0)
                  : null;

              const ingresoTipoCount =
                auxType === 'tipo_ingreso'
                  ? getAssociatedCount(item, ingresoCountByTipo[String(item.id)] ?? 0)
                  : null;

              const proveedorSubsegmentoCount =
                auxType === 'tipo_subsegmento_proveedor'
                  ? getAssociatedCount(item, proveedorCountBySubsegmento[String(item.id)] ?? 0)
                  : null;

              const genericAssociatedCount =
                auxType === 'tipo_segmento_gasto' ||
                auxType === 'tipo_ramas_gasto' ||
                auxType === 'tipo_ramas_ingreso'
                  ? getAssociatedCount(item, 0)
                  : null;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={panelStyles.menuCard}
                  onPress={() => handleEdit(item)}
                >
                  <View style={panelStyles.menuTextContainer}>
                    <Text style={panelStyles.menuTitle}>{item.nombre}</Text>

                    {auxType === 'region' && item?.pais?.nombre ? (
                      <Text style={panelStyles.menuSubtitle}>
                        País: {item.pais.nombre}
                      </Text>
                    ) : null}

                    {auxType === 'localidad' && item?.region?.nombre ? (
                      <Text style={panelStyles.menuSubtitle}>
                        Región: {item.region.nombre}
                        {item.region?.pais?.nombre ? ` · ${item.region.pais.nombre}` : ''}
                      </Text>
                    ) : null}

                    {auxType === 'proveedor' && item?.rama_rel?.nombre && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {item.rama_rel.nombre}
                      </Text>
                    )}

                    {auxType === 'proveedor' && item?.localidad && (
                      <Text style={panelStyles.menuSubtitle}>
                        {item.localidad}
                        {item.pais ? ` · ${item.pais}` : ''}
                      </Text>
                    )}

                    {auxType === 'proveedor' && proveedorOwnCount !== null ? (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(proveedorOwnCount)}
                      </Text>
                    ) : null}

                    {auxType === 'tipo_gasto' && (ramaGastoName || segmentoName) && (
                      <Text style={panelStyles.menuSubtitle}>
                        {ramaGastoName ? `Rama: ${ramaGastoName}` : ''}
                        {segmentoName ? `${ramaGastoName ? ' · ' : ''}Segmento: ${segmentoName}` : ''}
                      </Text>
                    )}

                    {auxType === 'tipo_gasto' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(gastoTipoCount)}
                      </Text>
                    )}

                    {auxType === 'tipo_ingreso' && ramaIngresoName && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {ramaIngresoName}
                      </Text>
                    )}

                    {auxType === 'tipo_ingreso' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(ingresoTipoCount)}
                      </Text>
                    )}

                    {auxType === 'tipo_ramas_proveedores' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(proveedorCount)}
                      </Text>
                    )}

                    {auxType === 'tipo_subsegmento_proveedor' && (
                      <>
                        {ramaProveedorName ? (
                          <Text style={panelStyles.menuSubtitle}>
                            Rama: {ramaProveedorName}
                          </Text>
                        ) : null}

                        <Text style={panelStyles.menuSubtitle}>
                          {countLabel(proveedorSubsegmentoCount)}
                        </Text>
                      </>
                    )}

                    {auxType === 'tipo_segmento_gasto' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(genericAssociatedCount)}
                      </Text>
                    )}

                    {auxType === 'tipo_ramas_gasto' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(genericAssociatedCount)}
                      </Text>
                    )}

                    {auxType === 'tipo_ramas_ingreso' && (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel(genericAssociatedCount)}
                      </Text>
                    )}
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              );
            })}

          {!loading && filtered.length === 0 && (
            <Text style={{ textAlign: 'center', marginTop: 16, color: colors.textSecondary }}>
              No hay resultados.
            </Text>
          )}
        </ScrollView>
      </View>
    </>
  );
};

export default AuxEntityListScreen;
