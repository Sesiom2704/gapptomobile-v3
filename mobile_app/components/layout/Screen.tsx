/**
 * Archivo: components/layout/Screen.tsx
 *
 * Responsabilidad:
 *   - Wrapper de pantalla para aplicar:
 *       - Safe area inferior (bottom)
 *       - Fondo estándar de la app
 *       - Contenedor flex para el contenido
 *
 * Maneja:
 *   - Layout global de pantallas (no incluye cabecera; eso lo gestiona Header)
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (base de todas las pantallas).
 *
 * Notas:
 *   - withHeaderBackground se mantiene por compatibilidad.
 *   - Estilos base centralizados en screenStyles.
 */

import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { screenStyles } from '../../screens/styles/screenStyles';

type ScreenProps = {
  children: React.ReactNode;
  /**
   * La dejamos por compatibilidad con el código que ya pasa
   * withHeaderBackground, pero NO la usamos aquí.
   */
  withHeaderBackground?: boolean;
};

export const Screen: React.FC<ScreenProps> = ({ children }) => {
  return (
    // Solo respetamos el safe area INFERIOR (bottom),
    // el superior ya lo gestiona el Header con edges={['top']}.
    <SafeAreaView style={screenStyles.safeArea} edges={['bottom']}>
      <View style={screenStyles.screen}>{children}</View>
    </SafeAreaView>
  );
};

export default Screen;
