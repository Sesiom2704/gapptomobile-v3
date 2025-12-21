// screens/ingresos/NuevoIngresoScreen.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../../components/layout/Screen';
import { Header } from '../../components/layout/Header';
import { OptionCard } from '../../components/cards/OptionCard';
import { colors, spacing } from '../../theme';

export const NuevoIngresoScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const irAIngresoGestionable = () => {
    navigation.navigate('IngresoForm', {
      mode: 'gestionable',
    });
  };

  const irAIngresoExtraordinario = () => {
    navigation.navigate('IngresoForm', {
      mode: 'extraordinario',
    });
  };

  return (
    <Screen withHeaderBackground>
      {/* CABECERA VERDE */}
      <View style={styles.topArea}>
        <Header title="Nuevo ingreso" showBack />
      </View>

      {/* CONTENIDO */}
      <View style={styles.content}>
        <Text style={styles.question}>
          ¿Qué tipo de ingreso quieres registrar?
        </Text>

        <OptionCard
          iconName="trending-up"
          title="Ingreso Gestionable"
          description="Ingresos recurrentes (nóminas, alquileres, rentas periódicas...)."
          onPress={irAIngresoGestionable}
        />

        <OptionCard
          iconName="star-outline"
          title="Ingreso Extraordinario"
          description="Ingresos puntuales (ventas, devoluciones, premios...)."
          onPress={irAIngresoExtraordinario}
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

export default NuevoIngresoScreen;
