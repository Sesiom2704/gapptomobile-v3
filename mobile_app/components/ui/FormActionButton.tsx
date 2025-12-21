/**
 * Archivo: components/ui/FormActionButton.tsx
 *
 * Responsabilidad:
 *   - Botón de acción principal/secondary para formularios (CTA inferior típico).
 *   - Soporta icono opcional (Ionicons) y variantes visuales.
 *
 * Maneja:
 *   - UI: TouchableOpacity + (opcional) icono + label
 *   - Estado: ninguno (controlado por props)
 *
 * Entradas / Salidas:
 *   - label: texto del botón
 *   - onPress: acción al pulsar
 *   - disabled: deshabilita interacción y aplica estilo
 *   - variant: 'primary' | 'secondary'
 *   - iconName: Ionicons name opcional
 *   - style: estilo adicional del contenedor
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (CTA estándar reutilizable).
 *
 * Notas de estilo:
 *   - Consume tokens del theme (colors/spacing/radius).
 *   - No depende de formStyles para evitar acoplamiento a pantallas.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;

  variant?: 'primary' | 'secondary';
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
};

export function FormActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  iconName,
  style,
}: Props) {
  const isSecondary = variant === 'secondary';

  return (
    <TouchableOpacity
      style={[
        styles.base,
        isSecondary ? styles.secondary : styles.primary,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
    >
      {iconName ? (
        <Ionicons
          name={iconName}
          size={18}
          color={isSecondary ? colors.textPrimary : colors.surface}
          style={styles.icon}
        />
      ) : null}

      <Text style={[styles.label, isSecondary ? styles.labelSecondary : styles.labelPrimary]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  icon: {
    marginRight: spacing.sm,
  },
  label: {
    fontWeight: '600',
    fontSize: 15,
  },
  labelPrimary: {
    color: colors.surface,
  },
  labelSecondary: {
    color: colors.textPrimary,
  },
});
