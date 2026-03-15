// mobile_app/screens/personas/PersonasListScreen.tsx
//
// Maestro de Personas (v3)
//
// Objetivo:
// - Mantener el mismo patrón visual que CuentasBancariasListScreen.
// - Servir como maestro reutilizable para contratos.
// - Mostrar el contador real de registros asociados sin badge lateral.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import {
  listPersonas,
  type PersonaRow,
} from '../../services/gestionAlquilerApi';

type Props = {
  navigation: any;
};

function countLabel(count?: number | null, singular = 'registro', plural = 'registros') {
  const safe = Number(count ?? 0);
  return `${safe} ${safe === 1 ? singular : plural} asociados`;
}

export const PersonasListScreen: React.FC<Props> = ({ navigation }) => {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PersonaRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPersonas({ activas: true });
      setItems(data ?? []);
    } catch (err) {
      console.error('[PersonasList] Error cargando personas', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {};
    }, [load])
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;

    return items.filter((item) => {
      const nombre = String(item?.nombre_completo ?? '').toLowerCase();
      const dni = String(item?.dni ?? '').toLowerCase();
      const telefono = String(item?.telefono ?? '').toLowerCase();
      const email = String(item?.email ?? '').toLowerCase();

      return (
        nombre.includes(term) ||
        dni.includes(term) ||
        telefono.includes(term) ||
        email.includes(term)
      );
    });
  }, [items, search]);

  const handleAdd = () => {
    navigation.navigate('PersonaForm', {});
  };

  const handleEdit = (item: PersonaRow) => {
    navigation.navigate('PersonaForm', {
      persona: item,
    });
  };

  const renderSecondaryLine = (item: PersonaRow): string | null => {
    const parts: string[] = [];

    if (item.dni?.trim()) parts.push(`DNI: ${item.dni.trim()}`);
    if (item.telefono?.trim()) parts.push(item.telefono.trim());

    return parts.length ? parts.join(' · ') : null;
  };

  return (
    <>
      <Header
        title="Personas"
        subtitle="Inquilinos, avalistas y gestores."
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
              placeholder="Buscar persona..."
              value={search}
              onChangeText={setSearch}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {loading ? (
            <Text style={{ textAlign: 'center', marginTop: 16 }}>Cargando...</Text>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 16, color: colors.textSecondary }}>
              No hay personas.
            </Text>
          ) : null}

          {!loading &&
            filtered.map((item) => {
              const line2 = renderSecondaryLine(item);
              const line3 = item.email?.trim() ? item.email.trim() : null;
              const associatedCount = Number(item?.associatedCount ?? 0);

              return (
                <TouchableOpacity
                  key={item.id}
                  style={panelStyles.menuCard}
                  onPress={() => handleEdit(item)}
                  activeOpacity={0.9}
                >
                  <View style={panelStyles.menuTextContainer}>
                    <Text style={panelStyles.menuTitle}>
                      {(item.nombre_completo ?? '').toUpperCase()}
                    </Text>

                    {line2 ? (
                      <Text style={panelStyles.menuSubtitle}>{line2}</Text>
                    ) : null}

                    {line3 ? (
                      <Text style={panelStyles.menuSubtitle}>{line3}</Text>
                    ) : null}

                    <Text style={panelStyles.menuSubtitle}>
                      {countLabel(associatedCount)}
                    </Text>
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

export default PersonasListScreen;