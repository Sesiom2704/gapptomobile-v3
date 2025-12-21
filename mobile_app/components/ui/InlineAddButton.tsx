/**
 * Archivo: components/ui/InlineAddButton.tsx
 *
 * Responsabilidad:
 *   - Botón pequeño inline para acciones rápidas de “añadir” (por ejemplo crear proveedor/tipo).
 *
 * Maneja:
 *   - UI: TouchableOpacity + Text ("+")
 *   - Estado: ninguno (controlado por props)
 *
 * Entradas / Salidas:
 *   - onPress: acción al pulsar
 *   - disabled: deshabilita interacción y ajusta estilo
 *   - accessibilityLabel: etiqueta accesible
 *   - style: estilo adicional del contenedor
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (botón estándar de formularios).
 *
 * Notas de estilo:
 *   - Usa theme tokens para coherencia y mantenimiento.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, radius } from '../../theme';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function InlineAddButton({ onPress, disabled = false, accessibilityLabel, style }: Props) {
  return (
    <TouchableOpacity
      style={[styles.container, style, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? 'Añadir'}
    >
      <Text style={[styles.text, disabled && styles.textDisabled]}>+</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.success, // sustituye el hardcode '#00AA55'
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  textDisabled: {
    color: colors.textMuted,
  },
});
