// mobile_app/screens/auxiliares/AuxEntityListScreen.tsx

/**
 * Ruta: mobile_app/screens/auxiliares/AuxEntityListScreen.tsx
 * Versión: 1.3.0
 * Descripción:
 * Pantalla de listado de entidades auxiliares.
 *
 * Responsabilidades:
 * - Mostrar listados auxiliares y proveedores.
 * - Permitir búsqueda simple por nombre.
 * - Navegar a edición/creación.
 * - Mostrar información contextual adicional según el tipo.
 * - Mostrar conteos asociados por rama/segmento cuando aplica.
 *
 * Mejoras incluidas:
 * - Soporte para `tipo_subsegmento_proveedor`.
 * - Conteos visibles en los registros auxiliares:
 *     * rama gasto -> nº tipos de gasto asociados
 *     * rama ingreso -> nº tipos de ingreso asociados
 *     * rama proveedor -> nº proveedores asociados
 *     * subsegmento proveedor -> nº proveedores asociados
 *     * segmento gasto -> nº tipos de gasto asociados
 * - Se mantienen los extras visuales de proveedor/tipo_gasto/tipo_ingreso.
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
  TipoGastoItem,
  TipoIngresoItem,
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

  // Mapas de conteos asociados
  const [countTiposByRamaGasto, setCountTiposByRamaGasto] = useState<Record<string, number>>({});
  const [countTiposBySegmentoGasto, setCountTiposBySegmentoGasto] = useState<Record<string, number>>({});
  const [countTiposByRamaIngreso, setCountTiposByRamaIngreso] = useState<Record<string, number>>({});
  const [countProveedoresByRama, setCountProveedoresByRama] = useState<Record<string, number>>({});
  const [countProveedoresBySubsegmento, setCountProveedoresBySubsegmento] = useState<Record<string, number>>({});

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
    tipo_subsegmento_proveedor: 'Agrupa proveedores por subsegmento.',
  };

  const title = titleByType[auxType] ?? 'Tabla auxiliar';
  const subtitle = subtitleByType[auxType] ?? 'Configuración avanzada.';

  const load = useCallback(async () => {
    setLoading(true);

    try {
      // ---------------------------------------------------------------------
      // Proveedores
      // ---------------------------------------------------------------------
      if (auxType === 'proveedor') {
        const data = await listProveedores();

        setItems(data);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // Aux principal
      // ---------------------------------------------------------------------
      const data = await listAux<SimpleAuxItem>(auxType as AuxEntity);
      setItems(data);

      // ---------------------------------------------------------------------
      // tipo_gasto
      // ---------------------------------------------------------------------
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
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_ingreso
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_ingreso') {
        const ramasIngreso = await listAux<SimpleAuxItem>('tipo_ramas_ingreso');

        const riMap: Record<string, string> = {};
        for (const r of ramasIngreso ?? []) riMap[String(r.id)] = String(r.nombre);

        setRamasIngresoMap(riMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasProveedorMap({});
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_ramas_gasto -> contar tipos de gasto asociados
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_ramas_gasto') {
        const tipos = await listAux<TipoGastoItem>('tipo_gasto');

        const counts: Record<string, number> = {};
        for (const t of tipos ?? []) {
          const key = String(t.rama_id ?? '').trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }

        setCountTiposByRamaGasto(counts);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_segmento_gasto -> contar tipos de gasto asociados
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_segmento_gasto') {
        const tipos = await listAux<TipoGastoItem>('tipo_gasto');

        const counts: Record<string, number> = {};
        for (const t of tipos ?? []) {
          const key = String(t.segmento_id ?? '').trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }

        setCountTiposBySegmentoGasto(counts);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setCountTiposByRamaGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_ramas_ingreso -> contar tipos de ingreso asociados
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_ramas_ingreso') {
        const tiposIngreso = await listAux<TipoIngresoItem>('tipo_ingreso');

        const counts: Record<string, number> = {};
        for (const t of tiposIngreso ?? []) {
          const key = String(t.rama_id ?? '').trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }

        setCountTiposByRamaIngreso(counts);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountProveedoresByRama({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_ramas_proveedores -> contar proveedores asociados
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_ramas_proveedores') {
        const proveedores = await listProveedores();

        const counts: Record<string, number> = {};
        for (const p of proveedores ?? []) {
          const key = String(p.rama_id ?? '').trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }

        setCountProveedoresByRama(counts);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setRamasProveedorMap({});
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresBySubsegmento({});
        return;
      }

      // ---------------------------------------------------------------------
      // tipo_subsegmento_proveedor
      // ---------------------------------------------------------------------
      if (auxType === 'tipo_subsegmento_proveedor') {
        const [proveedores, ramasProveedor] = await Promise.all([
          listProveedores(),
          listAux<SimpleAuxItem>('tipo_ramas_proveedores'),
        ]);

        const counts: Record<string, number> = {};
        for (const p of proveedores ?? []) {
          const key = String((p as any).subsegmento_id ?? '').trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }

        const rpMap: Record<string, string> = {};
        for (const r of ramasProveedor ?? []) rpMap[String(r.id)] = String(r.nombre);

        setCountProveedoresBySubsegmento(counts);
        setRamasProveedorMap(rpMap);
        setRamasGastoMap({});
        setSegmentosMap({});
        setRamasIngresoMap({});
        setCountTiposByRamaGasto({});
        setCountTiposBySegmentoGasto({});
        setCountTiposByRamaIngreso({});
        setCountProveedoresByRama({});
        return;
      }

      // ---------------------------------------------------------------------
      // resto: limpiar
      // ---------------------------------------------------------------------
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setCountTiposByRamaGasto({});
      setCountTiposBySegmentoGasto({});
      setCountTiposByRamaIngreso({});
      setCountProveedoresByRama({});
      setCountProveedoresBySubsegmento({});
    } catch (err) {
      console.error('[AuxEntityList] Error cargando', auxType, err);

      setItems([]);
      setRamasGastoMap({});
      setSegmentosMap({});
      setRamasIngresoMap({});
      setRamasProveedorMap({});
      setCountTiposByRamaGasto({});
      setCountTiposBySegmentoGasto({});
      setCountTiposByRamaIngreso({});
      setCountProveedoresByRama({});
      setCountProveedoresBySubsegmento({});
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

              const countLabel =
                auxType === 'tipo_ramas_gasto'
                  ? `${countTiposByRamaGasto[String(item.id)] ?? 0} tipos asociados`
                  : auxType === 'tipo_segmento_gasto'
                  ? `${countTiposBySegmentoGasto[String(item.id)] ?? 0} tipos asociados`
                  : auxType === 'tipo_ramas_ingreso'
                  ? `${countTiposByRamaIngreso[String(item.id)] ?? 0} tipos asociados`
                  : auxType === 'tipo_ramas_proveedores'
                  ? `${countProveedoresByRama[String(item.id)] ?? 0} proveedores asociados`
                  : auxType === 'tipo_subsegmento_proveedor'
                  ? `${countProveedoresBySubsegmento[String(item.id)] ?? 0} proveedores asociados`
                  : null;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={panelStyles.menuCard}
                  onPress={() => handleEdit(item)}
                >
                  <View style={panelStyles.menuTextContainer}>
                    <Text style={panelStyles.menuTitle}>{item.nombre}</Text>

                    {countLabel ? (
                      <Text style={panelStyles.menuSubtitle}>
                        {countLabel}
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

                    {auxType === 'tipo_gasto' && (ramaGastoName || segmentoName) && (
                      <Text style={panelStyles.menuSubtitle}>
                        {ramaGastoName ? `Rama: ${ramaGastoName}` : ''}
                        {segmentoName ? `${ramaGastoName ? ' · ' : ''}Segmento: ${segmentoName}` : ''}
                      </Text>
                    )}

                    {auxType === 'tipo_ingreso' && ramaIngresoName && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {ramaIngresoName}
                      </Text>
                    )}

                    {auxType === 'tipo_subsegmento_proveedor' && ramaProveedorName && (
                      <Text style={panelStyles.menuSubtitle}>
                        Rama: {ramaProveedorName}
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