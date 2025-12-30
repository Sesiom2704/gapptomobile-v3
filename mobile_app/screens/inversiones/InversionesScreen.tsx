// mobile_app/screens/inversiones/InversionesScreen.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

type Props = { navigation: any };

const InversionesScreen: React.FC<Props> = ({ navigation }) => {
  const goRanking = () => navigation.navigate('InversionesRanking');
  const goNueva = () => navigation.navigate('InversionForm', { mode: 'create' });

  return (
    <>
      <Header title="Inversiones" subtitle="Join ventures, NPL y operaciones similares." showBack />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Inversiones</Text>

            <TouchableOpacity style={panelStyles.menuCard} onPress={goRanking}>
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="stats-chart-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Ranking</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Ordena por rentabilidad esperada o capital invertido.
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={panelStyles.menuCard} onPress={goNueva}>
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="add-circle-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Nueva inversión</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Alta rápida de operación (sin afectar a caja real).
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

export default InversionesScreen;
