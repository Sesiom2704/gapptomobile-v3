/**
 * Archivo: components/ui/IconCircle.tsx
 *
 * Responsabilidad:
 *   - Componente UI atómico: renderiza un icono dentro de un círculo con tamaño y colores configurables.
 *
 * Maneja:
 *   - UI: View circular + Ionicons.
 *
 * Entradas / Salidas:
 *   - Props:
 *       - name: icon name (Ionicons)
 *       - size?: tamaño del icono
 *       - iconColor?: color del icono
 *       - backgroundColor?: color de fondo del círculo
 *       - diameter?: diámetro del círculo
 *       - style?: estilos adicionales del contenedor
 *
 * Dependencias clave:
 *   - Tema: colors
 *   - Iconos: Ionicons
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (utilizable en cualquier listado, tarjeta o botón con icono).
 *
 * Notas de estilo:
 *   - Evitar duplicar “circulitos” con estilos hardcodeados (positivo/negativo/primario). Este componente centraliza el patrón.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

type Props = {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  iconColor?: string;
  backgroundColor?: string;
  diameter?: number;
  style?: ViewStyle;
};

export const IconCircle: React.FC<Props> = ({
  name,
  size = 16,
  iconColor = colors.primary,
  backgroundColor = colors.primarySoft,
  diameter = 30,
  style,
}) => {
  return (
    <View
      style={[
        styles.circle,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor,
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={iconColor} />
    </View>
  );
};

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
