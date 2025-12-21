// screens/auxiliares/AuxEntityListScreen.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { listProveedores, Proveedor } from '../../services/proveedoresApi';
import { listAux, AuxEntity } from '../../services/auxiliaresApi';

type Props = {
  navigation: any;
  route: any;
};

type Origin = 'config' | 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';

type SimpleAuxItem = { id: string; nombre: string; [k: string]: any };

export const AuxEntityListScreen: React.FC<Props> = ({ navigation, route }) => {
  const auxType: AuxEntity | 'proveedor' = route?.params?.auxType ?? 'proveedor';
  const origin: Origin = route?.params?.origin ?? 'config';

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<Proveedor | SimpleAuxItem>>([]);
  const [loading, setLoading] = useState(false);

  // Para resolver nombres en tipo_gasto
  const [ramasGastoMap, setRamasGastoMap] = useState<Record<string, string>>({});
  const [segmentosMap, setSegmentosMap] = useState<Record<string, string>>({});

  const titleByType: Record<string, string> = {
    proveedor: 'Proveedores',
    tipo_gasto: 'Tipos de gasto',
    tipo_segmento_gasto: 'Segmentos de gasto',
    tipo_ramas_gasto: 'Ramas de gasto',
    tipo_ramas_proveedores: 'Ramas de proveedores',
    tipo_ingreso: 'Tipos de ingreso',
  };

  const subtitleByType: Record<string, string> = {
    proveedor: 'Gestiona tus proveedores habituales.',
    tipo_gasto: 'Configura las categorías de gasto.',
    tipo_segmento_gasto: 'Segmenta los gastos por tipo.',
    tipo_ramas_gasto: 'Agrupa gastos por rama.',
    tipo_ramas_proveedores: 'Agrupa proveedores por rama.',
    tipo_ingreso: 'Configura los tipos de ingreso.',
  };

  const title = titleByType[auxType] ?? 'Tabla auxiliar';
  const subtitle = subtitleByType[auxType] ?? 'Configuración avanzada.';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (auxType === 'proveedor') {
        const data = await listProveedores();
        setItems(data);
        return;
      }

      // Aux genérico
      const data = await listAux<SimpleAuxItem>(auxType as AuxEntity);
      setItems(data);

      // Si estamos en tipo_gasto, precargamos mapas para pintar nombres en vez de IDs
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
      } else {
        setRamasGastoMap({});
        setSegmentosMap({});
      }
    } catch (err) {
      console.error('[AuxEntityList] Error cargando', auxType, err);
      setItems([]);
      setRamasGastoMap({});
      setSegmentosMap({});
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
    return items.filter((item: any) => {
      const term = search.trim().toLowerCase();
      if (!term) return true;
      return String(item?.nombre ?? '').toLowerCase().includes(term);
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
      editingItem: item, // genérico
      editingProveedor: auxType === 'proveedor' ? item : undefined, // compatibilidad
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
              const ramaName =
                auxType === 'tipo_gasto' && item?.rama_id
                  ? (ramasGastoMap[String(item.rama_id)] ?? String(item.rama_id))
                  : null;

              const segmentoName =
                auxType === 'tipo_gasto' && item?.segmento_id
                  ? (segmentosMap[String(item.segmento_id)] ?? String(item.segmento_id))
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

                    {auxType === 'proveedor' && item?.localidad && (
                      <Text style={panelStyles.menuSubtitle}>
                        {item.localidad}
                        {item.pais ? ` · ${item.pais}` : ''}
                      </Text>
                    )}

                    {/* Extras para tipo_gasto (nombres, no IDs) */}
                    {auxType === 'tipo_gasto' && (ramaName || segmentoName) && (
                      <Text style={panelStyles.menuSubtitle}>
                        {ramaName ? `Rama: ${ramaName}` : ''}
                        {segmentoName ? `${ramaName ? ' · ' : ''}Segmento: ${segmentoName}` : ''}
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
        </ScrollView>
      </View>
    </>
  );
};
