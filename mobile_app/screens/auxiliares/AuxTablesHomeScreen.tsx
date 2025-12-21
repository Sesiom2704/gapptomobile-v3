// screens/auxiliares/AuxTablesHomeScreen.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

type Props = {
  navigation: any;
};

export const AuxTablesHomeScreen: React.FC<Props> = ({ navigation }) => {
  const goTo = (auxType: string) => {
    navigation.navigate('AuxEntityList', {
      auxType,
      origin: 'config', // venimos desde menú de configuración
    });
  };

  return (
    <>
      <Header
        title="Tablas auxiliares"
        subtitle="Configura tipos, segmentos, ramas y proveedores."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
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
            <Text style={panelStyles.sectionTitle}>Proveedores e ingresos</Text>

            <AuxMenuItem
              label="Ramas de proveedores"
              subtitle="Clasificación de proveedores."
              icon="business-outline"
              onPress={() => goTo('tipo_ramas_proveedores')}
            />

            <AuxMenuItem
              label="Proveedores"
              subtitle="Tiendas, bancos, restaurantes, etc."
              icon="storefront-outline"
              onPress={() => goTo('proveedor')}
            />

            <AuxMenuItem
              label="Tipos de ingreso"
              subtitle="Salario, bonus, otros ingresos."
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
