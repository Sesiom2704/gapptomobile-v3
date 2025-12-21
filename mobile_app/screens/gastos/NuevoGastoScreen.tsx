// screens/gastos/NuevoGastoScreen.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

export const NuevoGastoScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const irAGastoCotidiano = () => {
    navigation.navigate('GastoCotidianoForm');
  };

  const irAGastoGestionable = () => {
    navigation.navigate('GastoGestionableForm');
  };

  return (
    <Screen withHeaderBackground>
      {/* CABECERA VERDE */}
      <View style={styles.topArea}>
        <Header title="Nuevo gasto" showBack />
      </View>

      {/* CONTENIDO */}
      <View style={styles.content}>
        <Text style={styles.question}>
          ¿Qué tipo de gasto quieres registrar?
        </Text>

        <OptionCard
          iconName="cart-outline"
          title="Gasto Cotidiano"
          description="Compras del día a día (super, comidas, gasolina, restaurantes ...)"
          onPress={irAGastoCotidiano}
        />

        <OptionCard
          iconName="briefcase-outline"
          title="Gasto Gestionable"
          description="Cuotas, suministros, préstamos y otros gastos recurrentes."
          onPress={irAGastoGestionable}
        />

        <OptionCard
          iconName="star-outline"
          title="Gasto Extraordinario"
          description="Gastos puntuales (compras puntuales, ahorros y cualquier gasto no contemplado.)."
          onPress={irAGastoGestionable}
        />   
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  topArea: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  content: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  question: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xl, 
    textAlign: 'center',
  },
});
