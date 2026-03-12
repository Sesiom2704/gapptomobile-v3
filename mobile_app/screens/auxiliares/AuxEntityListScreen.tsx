// screens/auxiliares/AuxEntityListScreen.tsx

/**
 * Ruta: screens/auxiliares/AuxEntityListScreen.tsx
 * Versión: 1.4.0
 * Descripción:
 * Pantalla de listado genérico para tablas auxiliares y proveedores.
 *
 * Responsabilidades:
 * - Mostrar listados auxiliares reutilizables.
 * - Permitir búsqueda local por nombre.
 * - Navegar a alta/edición.
 * - Mostrar metadatos relevantes de cada registro.
 * - Mostrar el recuento de registros relacionados por segmento/rama cuando aplica.
 *
 * Cambios de esta versión:
 * - NUEVO: soporte para `tipo_subsegmentos_proveedores`
 * - NUEVO: cabecera con contador total de registros cargados
 * - NUEVO: en tipos de gasto se muestra nº de registros asociados al segmento
 * - NUEVO: en tipos de ingreso se muestra nº de registros asociados a la rama
 * - NUEVO: en ramas de proveedores se muestra nº de proveedores asociados
 * - NUEVO: en subsegmentos de proveedores se muestra rama asociada y nº de proveedores
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
  TipoSubsegmentoProveedorItem,
} from '../../services/auxiliaresApi';

type Props = {
  navigation: any;
  route: any;
};

type Origin = 'config' | 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';

type SimpleAuxItem = {
  id: string;
  nombre: string;
  [k: string]: any;
};

type CountMap = Record<string, number>;

export const AuxEntityListScreen: React.FC<Props> = ({ navigation, route }) => {
  const auxType: AuxEntity | 'proveedor' = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<Proveedor | SimpleAuxItem>>([]);
  const [loading, setLoading] = useState(false);

  // Mapas auxiliares para resolver nombres relacionados
  const [ramasGastoMap, setRamasGastoMap] = useState<Record<string, string>>({});
  const [segmentosMap, setSegmentosMap] = useState<Record<string, string>>({});
  const [ramasIngresoMap, setRamasIngresoMap] = useState<Record<string, string>>({});
  const [ramasProveedorMap, setRamasProveedorMap] = useState<Record<string, string>>({});

  // Contadores de asociaciones
  const [tiposGastoPorSegmentoCount, setTiposGastoPorSegmentoCount] = useState<CountMap>({});
  const [tiposIngresoPorRamaCount, setTiposIngresoPorRamaCount] = useState<CountMap>({});
  const [proveedoresPorRamaCount, setProveedoresPorRamaCount] = useState<CountMap>({});
  const [proveedoresPorSubsegmentoCount, setProveedoresPorSubsegmentoCount] = useState<CountMap>({});

  const titleByType: Record<string, string> = {
    proveedor: 'Proveedores',
    tipo_gasto: 'Tipos de gasto',
    tipo_segmento_gasto: 'Segmentos de gasto',
    tipo_ramas_gasto: 'Ramas de gasto',
    tipo_ramas_ingreso: 'Ramas de ingreso',
    tipo_ramas_proveedores: 'Ramas de proveedores',
    tipo_ingreso: 'Tipos de ingreso',
    tipo_subsegmentos_proveedores: 'Subsegmentos de proveedores',
  };

  const subtitleByType: Record<string, string> = {
    proveedor: 'Gestiona tus proveedores habituales.',
    tipo_gasto: 'Configura las categorías de gasto.',
    tipo_segmento_gasto: 'Segmenta los gastos por tipo.',
    tipo_ramas_gasto: 'Agrupa gastos por rama.',
    tipo_ramas_ingreso: 'Agrupa ingresos por rama.',
    tipo_ramas_proveedores: 'Agrupa proveedores por rama.',
    tipo_ingreso: 'Configura los tipos de ingreso.',
    tipo_subsegmentos_proveedores: 'Clasifica proveedores con un nivel adicional.',
  };

  const title = titleByType[auxType] ?? 'Tabla auxiliar';
  const subtitle = subtitleByType[auxType] ?? 'Configuración avanzada.';

  const load = useCallback(async () => {
    setLoading(true);

    try {
      if (auxType === 'proveedor') {
        const data = await listProveedores();

        setItems(data);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setTiposGastoPorSegmentoCount({});
        setTiposIngresoPorRamaCount({});
        setProveedoresPorRamaCount({});
        setProveedoresPorSubsegmentoCount({});
        return;
      }

      const data = await listAux<SimpleAuxItem>(auxType as AuxEntity);
      setItems(data);

      // --------------------------------------------------
      // tipo_gasto: resolver rama + segmento + contadores
      // --------------------------------------------------
      if (auxType === 'tipo_gasto') {
        const [ramas, segmentos, tipos] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_gasto'),
          listAux<SimpleAuxItem>('tipo_segmento_gasto'),
          listAux<SimpleAuxItem>('tipo_gasto'),
        ]);

        const rMap: Record<string, string> = {};
        for (const r of ramas ?? []) rMap[String(r.id)] = String(r.nombre);

        const sMap: Record<string, string> = {};
        for (const s of segmentos ?? []) sMap[String(s.id)] = String(s.nombre);

        const bySegmento: CountMap = {};
        for (const t of tipos ?? []) {
          const key = t?.segmento_id ? String(t.segmento_id) : '';
          if (!key) continue;
          bySegmento[key] = (bySegmento[key] ?? 0) + 1;
        }

        setRamasGastoMap(rMap);
        setSegmentosMap(sMap);
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setTiposGastoPorSegmentoCount(bySegmento);
        setTiposIngresoPorRamaCount({});
        setProveedoresPorRamaCount({});
        setProveedoresPorSubsegmentoCount({});
        return;
      }

      // --------------------------------------------------
      // tipo_ingreso: resolver rama + contadores
      // --------------------------------------------------
      if (auxType === 'tipo_ingreso') {
        const [ramasIngreso, tiposIngreso] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_ingreso'),
          listAux<SimpleAuxItem>('tipo_ingreso'),
        ]);

        const riMap: Record<string, string> = {};
        for (const r of ramasIngreso ?? []) riMap[String(r.id)] = String(r.nombre);

        const byRama: CountMap = {};
        for (const t of tiposIngreso ?? []) {
          const key = t?.rama_id ? String(t.rama_id) : '';
          if (!key) continue;
          byRama[key] = (byRama[key] ?? 0) + 1;
        }

        setRamasIngresoMap(riMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasProveedorMap({});
        setTiposGastoPorSegmentoCount({});
        setTiposIngresoPorRamaCount(byRama);
        setProveedoresPorRamaCount({});
        setProveedoresPorSubsegmentoCount({});
        return;
      }

      // --------------------------------------------------
      // ramas proveedores: contar proveedores por rama
      // --------------------------------------------------
      if (auxType === 'tipo_ramas_proveedores') {
        const proveedores = await listProveedores();

        const byRama: CountMap = {};
        for (const p of proveedores ?? []) {
          const key = p?.rama_id ? String(p.rama_id) : '';
          if (!key) continue;
          byRama[key] = (byRama[key] ?? 0) + 1;
        }

        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setTiposGastoPorSegmentoCount({});
        setTiposIngresoPorRamaCount({});
        setProveedoresPorRamaCount(byRama);
        setProveedoresPorSubsegmentoCount({});
        return;
      }

      // --------------------------------------------------
      // subsegmentos proveedores: resolver rama + contador
      // --------------------------------------------------
      if (auxType === 'tipo_subsegmentos_proveedores') {
        const [ramasProveedor, proveedores] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_proveedores'),
          listProveedores(),
        ]);

        const rpMap: Record<string, string> = {};
        for (const r of ramasProveedor ?? []) rpMap[String(r.id)] = String(r.nombre);

        const bySubsegmento: CountMap = {};
        for (const p of proveedores ?? []) {
          const key = p?.subsegmento_id ? String(p.subsegmento_id) : '';
          if (!key) continue;
          bySubsegmento[key] = (bySubsegmento[key] ?? 0) + 1;
        }

        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap(rpMap);
        setTiposGastoPorSegmentoCount({});
        setTiposIngresoPorRamaCount({});
        setProveedoresPorRamaCount({});
        setProveedoresPorSubsegmentoCount(bySubsegmento);
        return;
      }

      // resto: limpiar mapas y contadores
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setTiposGastoPorSegmentoCount({});
      setTiposIngresoPorRamaCount({});
      setProveedoresPorRamaCount({});
      setProveedoresPorSubsegmentoCount({});
    } catch (err) {
      console.error('[AuxEntityList] Error cargando', auxType, err);

      setItems([]);
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setTiposGastoPorSegmentoCount({});
      setTiposIngresoPorRamaCount({});
      setProveedoresPorRamaCount({});
      setProveedoresPorSubsegmentoCount({});
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
      return nombre.includes(term);
    });
  }, [items, search]);

  const totalCountLabel = useMemo(() => {
    const n = items.length;
    return `${n} registro${n === 1 ? '' : 's'}`;
  }, [items.length]);

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
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
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

          <Text
            style={{
              marginTop: 10,
              fontSize: 12,
              color: colors.textSecondary,
            }}
          >
            {loading ? 'Cargando registros...' : totalCountLabel}
          </Text>
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
                auxType === 'tipo_subsegmentos_proveedores' && item?.rama_id
                  ? (ramasProveedorMap[String(item.rama_id)] ?? String(item.rama_id))
                  : null;

              const countSegmento =
                auxType === 'tipo_segmento_gasto'
                  ? (tiposGastoPorSegmentoCount[String(item.id)] ?? 0)
                  : null;

              const countRamaIngreso =
                auxType === 'tipo_ramas_ingreso'
                  ? (tiposIngresoPorRamaCount[String(item.id)] ?? 0)
                  : null;

              const countRamaProveedor =
                auxType === 'tipo_ramas_proveedores'
                  ? (proveedoresPorRamaCount[String(item.id)] ?? 0)
                  : null;

              const countSubsegmentoProveedor =
                auxType === 'tipo_subsegmentos_proveedores'
                  ? (proveedoresPorSubsegmentoCount[String(item.id)] ?? 0)
                  : null;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={panelStyles.menuCard}
                  onPress={() => handleEdit(item)}
                >
                  <View style={panelStyles.menuTextContainer}>
                    <Text style={panelStyles.menuTitle}>{item.nombre}</Text>

                    {/* Extras para proveedor */}
                    {auxType === 'proveedor' && item?.rama_rel?.nombre && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {item.rama_rel.nombre}
                      </Text>
                    )}

                    {auxType === 'proveedor' && item?.subsegmento_rel?.nombre && (
                      <Text style={panelStyles.menuSubtitle}>
                        Subsegmento: {item.subsegmento_rel.nombre}
                      </Text>
                    )}

                    {auxType === 'proveedor' && item?.localidad && (
                      <Text style={panelStyles.menuSubtitle}>
                        {item.localidad}
                        {item.pais ? ` · ${item.pais}` : ''}
                      </Text>
                    )}

                    {/* Extras para tipo_gasto */}
                    {auxType === 'tipo_gasto' && (ramaGastoName || segmentoName) && (
                      <Text style={panelStyles.menuSubtitle}>
                        {ramaGastoName ? `Rama: ${ramaGastoName}` : ''}
                        {segmentoName ? `${ramaGastoName ? ' · ' : ''}Segmento: ${segmentoName}` : ''}
                      </Text>
                    )}

                    {/* Extras para tipo_ingreso */}
                    {auxType === 'tipo_ingreso' && ramaIngresoName && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {ramaIngresoName}
                      </Text>
                    )}

                    {/* Segmentos de gasto: nº asociados */}
                    {auxType === 'tipo_segmento_gasto' && countSegmento !== null && (
                      <Text style={panelStyles.menuSubtitle}>
                        Tipos de gasto asociados: {countSegmento}
                      </Text>
                    )}

                    {/* Ramas de ingreso: nº asociados */}
                    {auxType === 'tipo_ramas_ingreso' && countRamaIngreso !== null && (
                      <Text style={panelStyles.menuSubtitle}>
                        Tipos de ingreso asociados: {countRamaIngreso}
                      </Text>
                    )}

                    {/* Ramas de proveedores: nº asociados */}
                    {auxType === 'tipo_ramas_proveedores' && countRamaProveedor !== null && (
                      <Text style={panelStyles.menuSubtitle}>
                        Proveedores asociados: {countRamaProveedor}
                      </Text>
                    )}

                    {/* Subsegmentos de proveedores */}
                    {auxType === 'tipo_subsegmentos_proveedores' && (
                      <>
                        {ramaProveedorName && (
                          <Text style={panelStyles.menuSubtitle}>
                            Rama: {ramaProveedorName}
                          </Text>
                        )}

                        <Text style={panelStyles.menuSubtitle}>
                          Proveedores asociados: {countSubsegmentoProveedor ?? 0}
                        </Text>
                      </>
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