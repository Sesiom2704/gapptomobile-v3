/**
 * Ruta: screens/auxiliares/AuxTablesHomeScreen.tsx
 * Versión: 1.2.0
 * Descripción:
 * Pantalla de navegación de tablas auxiliares de GapptoMobile v3.
 *
 * Cambios:
 * - Añade sección "Ubicaciones".
 * - Permite gestionar Países, Regiones y Localidades desde tablas auxiliares.
 * - Mantiene intacta la navegación existente.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { AuxEntity } from '../../services/auxiliaresApi';

type Props = {
  navigation: any;
};

export const AuxTablesHomeScreen: React.FC<Props> = ({ navigation }) => {
  const goTo = (auxType: AuxEntity | 'proveedor') => {
    navigation.navigate('AuxEntityList', {
      auxType,
      origin: 'config',
    });
  };

  return (
    <>
      <Header
        title="Tablas auxiliares"
        subtitle="Configura tipos, segmentos, ramas, proveedores y ubicaciones."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Alquiler</Text>

            <AuxMenuItem
              label="Personas"
              subtitle="Inquilinos, avalistas y gestores."
              icon="people-outline"
              onPress={() => navigation.navigate('PersonasList')}
            />
          </View>

          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Cuentas</Text>

            <AuxMenuItem
              label="Cuentas bancarias"
              subtitle="IBAN, alias, banco y configuración."
              icon="card-outline"
              onPress={() => navigation.navigate('CuentasBancariasList')}
            />
          </View>

          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Ubicaciones</Text>

            <AuxMenuItem
              label="Países"
              subtitle="Gestiona países disponibles."
              icon="earth-outline"
              onPress={() => goTo('pais')}
            />

            <AuxMenuItem
              label="Regiones"
              subtitle="Gestiona regiones asociadas a país."
              icon="map-outline"
              onPress={() => goTo('region')}
            />

            <AuxMenuItem
              label="Localidades"
              subtitle="Gestiona localidades asociadas a región."
              icon="location-outline"
              onPress={() => goTo('localidad')}
            />
          </View>

          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Gastos</Text>

            <AuxMenuItem
              label="Tipos de gasto"
              subtitle="Categorización de tus gastos."
              icon="pricetag-outline"
              onPress={() => goTo('tipo_gasto')}
            />

            <AuxMenuItem
              label="Segmentos de gasto"
              subtitle="Cotidianos, gestionables, patrimonio..."
              icon="layers-outline"
              onPress={() => goTo('tipo_segmento_gasto')}
            />

            <AuxMenuItem
              label="Ramas de gasto"
              subtitle="Agrupaciones por rama."
              icon="git-branch-outline"
              onPress={() => goTo('tipo_ramas_gasto')}
            />
          </View>

          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Proveedores</Text>

            <AuxMenuItem
              label="Ramas de proveedores"
              subtitle="Clasificación de proveedores."
              icon="business-outline"
              onPress={() => goTo('tipo_ramas_proveedores')}
            />

            <AuxMenuItem
              label="Subsegmentos de proveedores"
              subtitle="Segundo nivel de clasificación por rama."
              icon="albums-outline"
              onPress={() => goTo('tipo_subsegmento_proveedor')}
            />

            <AuxMenuItem
              label="Proveedores"
              subtitle="Tiendas, bancos, restaurantes, etc."
              icon="storefront-outline"
              onPress={() => goTo('proveedor')}
            />
          </View>

          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Ingresos</Text>

            <AuxMenuItem
              label="Ramas de ingreso"
              subtitle="Agrupa los ingresos por rama."
              icon="git-branch-outline"
              onPress={() => goTo('tipo_ramas_ingreso')}
            />

            <AuxMenuItem
              label="Tipos de ingreso"
              subtitle="Nómina, desempleo, viviendas, bizum..."
              icon="cash-outline"
              onPress={() => goTo('tipo_ingreso')}
            />
          </View>
        </ScrollView>
      </View>
    </>
  );
};

type ItemProps = {
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

const AuxMenuItem: React.FC<ItemProps> = ({
  label,
  subtitle,
  icon,
  onPress,
}) => (
  <TouchableOpacity style={panelStyles.menuCard} onPress={onPress}>
    <View style={panelStyles.menuIconCircleSecondary}>
      <Ionicons name={icon} size={22} color={colors.primary} />
    </View>

    <View style={panelStyles.menuTextContainer}>
      <Text style={panelStyles.menuTitle}>{label}</Text>
      <Text style={panelStyles.menuSubtitle}>{subtitle}</Text>
    </View>

    <Ionicons
      name="chevron-forward"
      size={18}
      color={colors.textSecondary}
    />
  </TouchableOpacity>
);

export default AuxTablesHomeScreen;
