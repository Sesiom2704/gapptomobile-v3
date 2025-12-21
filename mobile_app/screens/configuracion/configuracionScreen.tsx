// screens/configuracion/configuracionScreen.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

type Props = {
  navigation: any;
};

const ConfiguracionScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <>
      <Header
        title="Configuración"
        subtitle="Ajustes avanzados de tablas y base de datos."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {/* Bloque: Tablas y usuarios */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Tablas y usuarios</Text>

            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('AuxTablesHome')}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Tablas auxiliares</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Usuarios, proveedores, tipos, segmentos y ramas.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Bloque: Herramientas de BD */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Herramientas de BD</Text>

            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('DatabaseTools')}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Importación y copias</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Importación de BD, copias y mantenimiento.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </>
  );
};

export default ConfiguracionScreen;
