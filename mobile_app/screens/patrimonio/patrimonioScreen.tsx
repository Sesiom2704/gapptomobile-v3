/**
 * Archivo: mobile_app/screens/patrimonio/patrimonioScreen.tsx
 * Versión: 4.0.0
 *
 * Responsabilidad:
 * - Pantalla principal del módulo Patrimonio.
 * - Reorganiza el acceso en bloques funcionales.
 * - Añade acceso global al gestor de contratos.
 *
 * Funcionalidades:
 * - Sección "Patrimonio y contratos"
 *   - Propiedades
 *   - Contratos
 * - Sección "Financiación"
 *   - Préstamos activos
 * - Sección "Inversiones"
 *   - Inversiones
 *
 * Notas:
 * - No elimina ninguna funcionalidad existente.
 * - Mantiene la navegación actual a propiedades, préstamos e inversiones.
 * - Añade navegación al nuevo screen "ContratoList" dentro de PropiedadesStack.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

type Props = {
  navigation: any;
};

const PatrimonioScreen: React.FC<Props> = ({ navigation }) => {
  const goPropiedades = () => {
    navigation.navigate('PropiedadesStack', {
      screen: 'PropiedadesRanking',
    });
  };

  const goContratos = () => {
    navigation.navigate('PropiedadesStack', {
      screen: 'ContratoList',
    });
  };

  const goPrestamos = () => {
    navigation.navigate('PrestamosStack');
  };

  const goInversiones = () => {
    navigation.navigate('PatrimonyTab', {
      screen: 'InversionesStack',
      params: { screen: 'InversionesRanking' },
    });
  };

  return (
    <>
      <Header
        title="Patrimonio y contratos"
        subtitle="Propiedades, contratos, préstamos e inversiones."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          {/* =========================================================
              BLOQUE 1: PATRIMONIO Y CONTRATOS
             ========================================================= */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Patrimonio y contratos</Text>

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

            <TouchableOpacity style={panelStyles.menuCard} onPress={goContratos}>
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="document-text-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Contratos</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Listado global, búsqueda, filtros y edición de contratos.
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* =========================================================
              BLOQUE 2: FINANCIACIÓN
             ========================================================= */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Financiación</Text>

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
          </View>

          {/* =========================================================
              BLOQUE 3: INVERSIONES
             ========================================================= */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Inversiones</Text>

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