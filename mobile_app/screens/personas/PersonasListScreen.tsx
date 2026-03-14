// mobile_app/screens/personas/PersonasListScreen.tsx
//
// Maestro de Personas (v3)
//
// Objetivo:
// - Crear un módulo propio de Personas, separado del sistema genérico AuxEntity.
// - Mantener un patrón visual homogéneo con CuentasBancariasListScreen.
// - Servir como maestro reutilizable para contratos (inquilinos, avalistas, gestores).
//
// Cambios incluidos:
// - Diseño alineado con CuentasBancariasListScreen.
// - Listado real de personas desde gestionAlquilerApi.
// - Buscador local por nombre, DNI, teléfono y email.
// - Recarga automática al volver al foco.
// - Navegación preparada a PersonaForm.
// - Botón añadir en cabecera.
// - Muestra `associatedCount` en cada fila.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import {
  listPersonas,
  type PersonaRow,
} from '../../services/gestionAlquilerApi';

type Props = {
  navigation: any;
  route?: any;
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
            <Text style={{ textAlign: 'center', marginTop: 16 }}>
              Cargando...
            </Text>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 16, color: colors.textSecondary }}>
              No hay personas.
            </Text>
          ) : null}

          {!loading &&
            filtered.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={panelStyles.menuCard}
                onPress={() => handleEdit(p)}
                activeOpacity={0.9}
              >
                <View style={panelStyles.menuTextContainer}>
                  <Text style={panelStyles.menuTitle}>{p.nombre_completo}</Text>

                  {p.dni ? (
                    <Text style={panelStyles.menuSubtitle}>
                      DNI: {p.dni}
                    </Text>
                  ) : null}

                  {p.telefono ? (
                    <Text style={panelStyles.menuSubtitle}>
                      Teléfono: {p.telefono}
                    </Text>
                  ) : null}

                  {p.email ? (
                    <Text style={panelStyles.menuSubtitle}>
                      {p.email}
                    </Text>
                  ) : null}

                  <Text style={panelStyles.menuSubtitle}>
                    {countLabel(p.associatedCount)}
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

export default PersonasListScreen;
