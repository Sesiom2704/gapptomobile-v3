// mobile_app/screens/patrimonio/patrimonioScreen.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

type Props = {
  navigation: any;
};

const PatrimonioScreen: React.FC<Props> = ({ navigation }) => {
  const goPropiedades = () => {
    // Debes registrar "PropiedadesStack" en tu navigator principal
    navigation.navigate('PropiedadesStack');
  };

  const goPrestamos = () => {
      // PrestamosStack debe estar registrado dentro del PatrimonyStackNavigator
  navigation.navigate('PrestamosStack');
  };

  const goInversiones = () => {
    // Navega a la pestaña Patrimony y dentro al stack de Inversiones
    // y dentro al screen "InversionesRanking" (o el nombre que uses en el stack).
    navigation.navigate('PatrimonyTab', {
      screen: 'InversionesStack',
      params: { screen: 'InversionesRanking' },
    });
  };

  return (
    <>
      <Header title="Patrimonio" subtitle="Propiedades y préstamos activos." showBack />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Patrimonio</Text>

            {/* Propiedades */}
            <TouchableOpacity style={panelStyles.menuCard} onPress={goPropiedades}>
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="home-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Propiedades</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Lista, alta, edición e inactivación de viviendas.
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* Préstamos activos */}
            <TouchableOpacity style={panelStyles.menuCard} onPress={goPrestamos}>
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="card-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Préstamos activos</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Estado de tus préstamos y financiación.
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* Inversiones */}
          <TouchableOpacity style={panelStyles.menuCard} onPress={goInversiones}>
            <View style={panelStyles.menuIconCircle}>
              <Ionicons name="trending-up-outline" size={22} color="#fff" />
            </View>

            <View style={panelStyles.menuTextContainer}>
              <Text style={panelStyles.menuTitle}>Inversiones</Text>
              <Text style={panelStyles.menuSubtitle}>
                Operaciones tipo JV/NPL: capital, retorno y rentabilidad esperada.
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          </View>
        </ScrollView>
      </View>
    </>
  );
};

export default PatrimonioScreen;
