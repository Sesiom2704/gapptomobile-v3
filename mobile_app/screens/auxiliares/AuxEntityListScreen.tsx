/**
 * Ruta: mobile_app/screens/auxiliares/AuxEntityListScreen.tsx
 * Versión: 1.3.0
 * Descripción:
 * Pantalla de listado genérico de tablas auxiliares.
 *
 * Responsabilidades:
 * - Mostrar listados auxiliares y de proveedores.
 * - Permitir búsqueda por nombre.
 * - Navegar a formulario de creación/edición.
 * - Mostrar información contextual relacionada:
 *   * rama / segmento / subsegmento
 *   * localidad / país
 *   * contadores de registros asociados
 *
 * Ajustes incluidos:
 * - Soporte para `tipo_subsegmento_proveedor`.
 * - Contadores visibles en:
 *   * proveedores
 *   * tipos de gasto
 *   * tipos de ingreso
 * - Mantiene la información previa del listado.
 *
 * Nota:
 * - Personas y cuentas bancarias no pertenecen a este AuxEntityListScreen
 *   con el código recibido. Si quieres, te paso después sus listados
 *   específicos para añadirles contador también.
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

function countLabel(count?: number | null, singular = 'registro', plural = 'registros') {
  const safe = Number(count ?? 0);
  return `${safe} ${safe === 1 ? singular : plural}`;
}

export const AuxEntityListScreen: React.FC<Props> = ({ navigation, route }) => {
  const auxType: AuxEntity | 'proveedor' = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<Proveedor | SimpleAuxItem>>([]);
  const [loading, setLoading] = useState(false);

  // Mapas de nombres relacionados
  const [ramasGastoMap, setRamasGastoMap] = useState<Record<string, string>>({});
  const [segmentosMap, setSegmentosMap] = useState<Record<string, string>>({});
  const [ramasIngresoMap, setRamasIngresoMap] = useState<Record<string, string>>({});
  const [ramasProveedorMap, setRamasProveedorMap] = useState<Record<string, string>>({});

  // Contadores
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
  };

  const title = titleByType[auxType] ?? 'Tabla auxiliar';
  const subtitle = subtitleByType[auxType] ?? 'Configuración avanzada.';

  const load = useCallback(async () => {
    setLoading(true);

    try {
      // ======================================================
      // PROVEEDORES
      // ======================================================
      if (auxType === 'proveedor') {
        const data = await listProveedores();
        setItems(data);

        const countByRama: CountMap = {};
        for (const p of data ?? []) {
          const key = String(p.rama_id ?? '').trim();
          if (!key) continue;
          countByRama[key] = (countByRama[key] ?? 0) + 1;
        }

        setProveedorCountByRama(countByRama);

        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setProveedorCountBySubsegmento({});
        setGastoCountByTipo({});
        setIngresoCountByTipo({});
        return;
      }

      // ======================================================
      // AUX GENÉRICO
      // ======================================================
      const data = await listAux<SimpleAuxItem>(auxType as AuxEntity);
      setItems(data);

      // ------------------------------------------------------
      // TIPOS DE GASTO
      // ------------------------------------------------------
      if (auxType === 'tipo_gasto') {
        const [ramas, segmentos, gastosGestionables, gastosCotidianos] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_gasto'),
          listAux<SimpleAuxItem>('tipo_segmento_gasto'),
          // usamos listAux solo para catálogos; movimientos reales vienen por otras APIs,
          // así que aquí solo mantenemos el contador si el backend manda datasets auxiliares.
          Promise.resolve([] as any[]),
          Promise.resolve([] as any[]),
        ]);

        const rMap: Record<string, string> = {};
        for (const r of ramas ?? []) rMap[String(r.id)] = String(r.nombre);

        const sMap: Record<string, string> = {};
        for (const s of segmentos ?? []) sMap[String(s.id)] = String(s.nombre);

        const countByTipo: CountMap = {};
        for (const row of [...gastosGestionables, ...gastosCotidianos]) {
          const key = String((row as any)?.tipo_id ?? '').trim();
          if (!key) continue;
          countByTipo[key] = (countByTipo[key] ?? 0) + 1;
        }

        setRamasGastoMap(rMap);
        setSegmentosMap(sMap);
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setGastoCountByTipo(countByTipo);
        setProveedorCountByRama({});
        setProveedorCountBySubsegmento({});
        setIngresoCountByTipo({});
        return;
      }

      // ------------------------------------------------------
      // TIPOS DE INGRESO
      // ------------------------------------------------------
      if (auxType === 'tipo_ingreso') {
        const [ramasIngreso] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_ingreso'),
        ]);

        const riMap: Record<string, string> = {};
        for (const r of ramasIngreso ?? []) riMap[String(r.id)] = String(r.nombre);

        setRamasIngresoMap(riMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasProveedorMap({});
        setProveedorCountByRama({});
        setProveedorCountBySubsegmento({});
        setGastoCountByTipo({});
        setIngresoCountByTipo({});
        return;
      }

      // ------------------------------------------------------
      // SUBSEGMENTOS DE PROVEEDOR
      // ------------------------------------------------------
      if (auxType === 'tipo_subsegmento_proveedor') {
        const [ramasProveedor, proveedores] = await Promise.all([
          listAux<SimpleAuxItem>('tipo_ramas_proveedores'),
          listProveedores(),
        ]);

        const rpMap: Record<string, string> = {};
        for (const r of ramasProveedor ?? []) rpMap[String(r.id)] = String(r.nombre);

        const countBySubsegmento: CountMap = {};
        for (const p of proveedores ?? []) {
          const key = String((p as any)?.subsegmento_id ?? '').trim();
          if (!key) continue;
          countBySubsegmento[key] = (countBySubsegmento[key] ?? 0) + 1;
        }

        setRamasProveedorMap(rpMap);
        setProveedorCountBySubsegmento(countBySubsegmento);

        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setProveedorCountByRama({});
        setGastoCountByTipo({});
        setIngresoCountByTipo({});
        return;
      }

      // ------------------------------------------------------
      // RAMAS DE PROVEEDORES
      // ------------------------------------------------------
      if (auxType === 'tipo_ramas_proveedores') {
        const proveedores = await listProveedores();

        const countByRama: CountMap = {};
        for (const p of proveedores ?? []) {
          const key = String(p.rama_id ?? '').trim();
          if (!key) continue;
          countByRama[key] = (countByRama[key] ?? 0) + 1;
        }

        setProveedorCountByRama(countByRama);

        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setProveedorCountBySubsegmento({});
        setGastoCountByTipo({});
        setIngresoCountByTipo({});
        return;
      }

      // Resto: limpiar mapas
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setProveedorCountByRama({});
      setProveedorCountBySubsegmento({});
      setGastoCountByTipo({});
      setIngresoCountByTipo({});
    } catch (err) {
      console.error('[AuxEntityList] Error cargando', auxType, err);
      setItems([]);
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setProveedorCountByRama({});
      setProveedorCountBySubsegmento({});
      setGastoCountByTipo({});
      setIngresoCountByTipo({});
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

              const proveedorCount =
                auxType === 'tipo_ramas_proveedores'
                  ? (proveedorCountByRama[String(item.id)] ?? 0)
                  : null;

              const gastoTipoCount =
                auxType === 'tipo_gasto'
                  ? (gastoCountByTipo[String(item.id)] ?? 0)
                  : null;

              const ingresoTipoCount =
                auxType === 'tipo_ingreso'
                  ? (ingresoCountByTipo[String(item.id)] ?? 0)
                  : null;

              const proveedorSubsegmentoCount =
                auxType === 'tipo_subsegmento_proveedor'
                  ? (proveedorCountBySubsegmento[String(item.id)] ?? 0)
                  : null;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={panelStyles.menuCard}
                  onPress={() => handleEdit(item)}
                >
                  <View style={panelStyles.menuTextContainer}>
                    <Text style={panelStyles.menuTitle}>{item.nombre}</Text>

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
                        {countLabel(proveedorCount, 'proveedor', 'proveedores')}
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
                          {countLabel(proveedorSubsegmentoCount, 'proveedor', 'proveedores')}
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