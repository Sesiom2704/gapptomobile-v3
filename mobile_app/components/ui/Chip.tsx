/**
 * Archivo: components/ui/Chip.tsx
 *
 * Responsabilidad:
 *   - Chip más “grande” para filtros/segmentación (opcional fullWidth, texto centrado).
 *
 * Reutilización:
 *   - Candidato a externalizar: MEDIO/ALTO (si se usa como chip principal de filtros).
 *
 * Notas:
 *   - Evitar hardcodes '#FFFFFF'.
 *   - Normalizar API de style props a StyleProp para consistencia en todo el proyecto.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { colors, spacing, radius } from '../../theme';

type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  fullWidth?: boolean;
  centerText?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export const Chip: React.FC<ChipProps> = ({
  label,
  selected = false,
  disabled = false,
  onPress,
  fullWidth = false,
  centerText = true,
  style,
  textStyle,
}) => {
  const isDisabled = disabled || !onPress;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        fullWidth && styles.fullWidth,
        selected && styles.chipSelected,
        isDisabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.7}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          centerText && styles.labelCentered,
          selected && styles.labelSelected,
          isDisabled && styles.labelDisabled,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fullWidth: {
    width: '100%',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
    flexShrink: 1, // clave para que no fuerce anchura
  },
  labelCentered: {
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  labelDisabled: {
    color: colors.textMuted,
  },
});

export default Chip;
