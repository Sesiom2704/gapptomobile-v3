// mobile_app/screens/mes/MesScreen.tsx
// -----------------------------------------------------------------------------
// MesScreen (Mes a mes) - añadimos una nueva línea:
// "Preview reinicio de mes" -> navega a ReiniciarMesPreviewScreen con año/mes actual.
// -----------------------------------------------------------------------------

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

const MesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  // Año/mes actual para el preview del mes
  const now = new Date();
  const anio = now.getFullYear();
  const mes = now.getMonth() + 1;

  return (
    <>
      <Header
        title="Mes a mes"
        subtitle="Resumen, balance y cierres mensuales."
        showBack
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Panel mensual</Text>

            {/* Resumen */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('MonthResumenScreen')}
            >
              <View style={panelStyles.menuIconCircle}>
                <Ionicons name="analytics-outline" size={22} color="#fff" />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Resumen</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Presupuestos vs consumos y run rate 12 meses.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Balance */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('MonthBalanceScreen')}
            >
              <View style={panelStyles.menuIconCircle}>
                <Ionicons
                  name="swap-horizontal-outline"
                  size={22}
                  color="#fff"
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Balance</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Liquidez, pendientes de cobro/pago y movimientos entre
                  cuentas.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Extraordinarios */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('MonthExtraordinariosScreen')}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="star-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Extraordinarios</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Gastos e ingresos que se salen de lo habitual.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Cierres mensuales */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('CierreListScreen')}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons
                  name="calendar-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Cierres mensuales</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Evolución de cierres y KPIs por mes.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* NUEVO: Preview reinicio (MES) */}
            <TouchableOpacity
              style={panelStyles.menuCard}
              onPress={() => navigation.navigate('ReiniciarMesPreviewScreen', { anio, mes })}
            >
              <View style={panelStyles.menuIconCircleSecondary}>
                <Ionicons name="repeat-outline" size={22} color={colors.primary} />
              </View>

              <View style={panelStyles.menuTextContainer}>
                <Text style={panelStyles.menuTitle}>Preview reinicio de mes</Text>
                <Text style={panelStyles.menuSubtitle}>
                  Validación (1–5), pendientes KPI y presupuesto total.
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

export default MesScreen;
