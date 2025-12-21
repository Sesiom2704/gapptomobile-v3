// mobile_app/screens/cuentasbancarias/CuentasBancariasListScreen.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { EuroformatEuro } from '../../utils/format';
import { listCuentas, CuentaBancaria } from '../../services/cuentasApi';

type Props = { navigation: any };

export const CuentasBancariasListScreen: React.FC<Props> = ({ navigation }) => {
  const [items, setItems] = useState<CuentaBancaria[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      console.log('[CuentasBancariasList] load()');
      const data = await listCuentas();
      setItems(data ?? []);
    } catch (e) {
      console.error('[CuentasBancariasList] Error cargando cuentas', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresca SIEMPRE al entrar/volver a esta pantalla
  useFocusEffect(
    useCallback(() => {
      console.log('[CuentasBancariasList] focus -> reload');
      void load();
      return () => {};
    }, [load])
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;

    return items.filter((x) => {
      const haystack = `${x.anagrama ?? ''} ${x.referencia ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search]);

  const handleAdd = () => navigation.navigate('CuentaBancariaForm', { mode: 'create' });
  const handleEdit = (item: CuentaBancaria) =>
    navigation.navigate('CuentaBancariaForm', { mode: 'edit', item });

  return (
    <>
      <Header
        title="Cuentas bancarias"
        subtitle="Gestiona tus cuentas y su configuración."
        showBack
        onAddPress={handleAdd}
      />

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
              placeholder="Buscar cuenta..."
              value={search}
              onChangeText={setSearch}
              style={{ flex: 1 }}
              autoCapitalize="characters"
            />
          </View>
        </View>

        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {loading ? (
            <Text style={{ textAlign: 'center', marginTop: 16 }}>Cargando...</Text>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 16, color: colors.textSecondary }}>
              No hay cuentas.
            </Text>
          ) : null}

          {!loading &&
            filtered.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={panelStyles.menuCard}
                onPress={() => handleEdit(c)}
                activeOpacity={0.9}
              >
                <View style={panelStyles.menuTextContainer}>
                  {/* “Nombre” funcional: ANAGRAMA */}
                  <Text style={panelStyles.menuTitle}>{(c.anagrama ?? '').toUpperCase()}</Text>

                  {/* Subtítulo: referencia */}
                  {c.referencia ? (
                    <Text style={panelStyles.menuSubtitle}>
                      {(c.referencia ?? '').toUpperCase()}
                    </Text>
                  ) : null}

                  <Text style={panelStyles.menuSubtitle}>
                    Liquidez: {EuroformatEuro(c.liquidez ?? 0, 'signed')}
                  </Text>

                  {/* Estado activo */}
                  <Text style={panelStyles.menuSubtitle}>
                    Estado: {c.activo ? 'ACTIVO' : 'INACTIVO'}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
        </ScrollView>
      </View>
    </>
  );
};
