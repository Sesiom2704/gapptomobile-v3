/**
 * Archivo: components/ui/PillButton.tsx
 *
 * Responsabilidad:
 *   - Botón tipo "pill" reutilizable para selecciones rápidas (segmentos, tipos, periodicidad, estados).
 *
 * Maneja:
 *   - UI: TouchableOpacity + Text
 *   - Estado: ninguno (controlado por props: selected/disabled)
 *
 * Entradas:
 *   - label: texto
 *   - selected: estado seleccionado
 *   - onPress: callback
 *   - disabled: deshabilita interacción y ajusta estilo
 *   - style: estilo adicional para el contenedor
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (pieza base del UI).
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { CONTROL_MIN_HEIGHT } from '../forms/formStyles';

type PillSize = 'sm' | 'md';

type PillButtonProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;

  // extras para reuso real
  size?: PillSize;
  numberOfLines?: number;

  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export const PillButton: React.FC<PillButtonProps> = ({
  label,
  selected = false,
  disabled = false,
  onPress,

  size = 'md',
  numberOfLines = 2,

  style,
  textStyle,
}) => {
  const handlePress = disabled ? undefined : onPress;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      accessibilityLabel={label}
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        selected && styles.selected,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        numberOfLines={numberOfLines}
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : styles.labelMd,
          selected && styles.labelSelected,
          disabled && styles.labelDisabled,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    minHeight: CONTROL_MIN_HEIGHT,
  },

  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  md: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  selected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  disabled: {
    opacity: 0.5,
  },

  label: {
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    // Android: ayuda a centrar cuando hay 2 líneas
    textAlignVertical: 'center',
  },
  labelSm: {
    fontSize: 12,
  },
  labelMd: {
    fontSize: 13,
  },

  labelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  labelDisabled: {
    color: colors.textMuted,
  },
});

export default PillButton;
