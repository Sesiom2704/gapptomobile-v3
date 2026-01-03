// screens/dia/DiaADiaScreen.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

const DiaADiaScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const irAGastosCotidianos = () => {
    navigation.navigate('GastosList', {
      initialFiltro: 'cotidiano',
      fromDiaADia: true,
    });
  };

  const irAGastosGestionables = () => {
    navigation.navigate('GastosList', {
      initialFiltro: 'pendientes',
      fromDiaADia: true,
    });
  };

  const irAIngresosGestionables = () => {
    navigation.navigate('IngresosList', {
      fromDiaADia: true,
    });
  };

  const irAMovimientos = () => {
    navigation.navigate('MovimientosScreen');
  };

  /**
   * NUEVO:
   * Acceso directo al screen de "Reiniciar cierre" (cierre mensual).
   *
   * Importante:
   * - Este screen está en MonthStack (por tu MainTabs.tsx).
   * - Para entrar desde DayToDayTab, hay que navegar a MonthTab indicando screen.
   * - Asegúrate de que en MonthStackNavigator exista:
   *     <MonthStack.Screen name="ReinciarCierreScreen" component={ReinciarCierreScreen} />
   */

  return (
    <>
      <Header
        title="Día a día"
        subtitle="Gestiona tus gastos cotidianos, gestionables e ingresos."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Accesos</Text>

            {/* Gastos cotidianos */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={irAGastosCotidianos}
            >
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="fast-food-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Gastos cotidianos</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Ver y registrar tus gastos del día a día.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Gastos gestionables */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={irAGastosGestionables}
            >
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="file-tray-full-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Gastos gestionables</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Cuotas, préstamos, suscripciones y gastos recurrentes.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Ingresos gestionables */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={irAIngresosGestionables}
            >
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="trending-up-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Ingresos gestionables</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Ingresos recurrentes, alquileres y otros cobros periódicos.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Movimientos del mes */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={irAMovimientos}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="swap-vertical-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Movimientos del mes</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Todos los cobros y pagos ya realizados este mes.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Análisis día a día */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('DayToDayAnalysisScreen')}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="analytics-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Análisis día a día</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Detalle de gastos cotidianos por día, semana y mes.
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

export default DiaADiaScreen;
