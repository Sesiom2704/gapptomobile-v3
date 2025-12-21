/**
 * Archivo: components/ui/FormDateButton.tsx
 *
 * Responsabilidad:
 *   - Botón de selección/visualización de fecha con icono (calendar por defecto).
 *   - Se usa en formularios para abrir un DateTimePicker u otra UI de selección de fecha.
 *
 * Maneja:
 *   - UI: TouchableOpacity + Ionicons + Text
 *   - Estado: ninguno (controlado por props)
 *
 * Entradas / Salidas:
 *   - valueText: texto a mostrar (fecha formateada)
 *   - onPress: acción al pulsar
 *   - disabled: deshabilita interacción y aplica estilo de deshabilitado
 *   - iconName: icono Ionicons
 *   - style: estilo adicional para el contenedor
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (control estándar para formularios).
 *
 * Notas de estilo:
 *   - Consume tokens del theme (colors/spacing/radius) para consistencia global.
 *   - Comparte CONTROL_MIN_HEIGHT / CONTROL_PADDING_V del estándar de formularios.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';
import { CONTROL_MIN_HEIGHT, CONTROL_PADDING_V } from '../forms/formStyles';

type Props = {
  valueText: string;
  onPress: () => void;
  disabled?: boolean;
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
};

export function FormDateButton({
  valueText,
  onPress,
  disabled = false,
  iconName = 'calendar-outline',
  style,
}: Props) {
  return (
    <TouchableOpacity
      style={[styles.container, style, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`Seleccionar fecha. Valor actual: ${valueText}`}
    >
      <Ionicons name={iconName} size={16} color={colors.textSecondary} style={styles.icon} />
      <Text style={[styles.text, disabled && styles.textDisabled]} numberOfLines={1}>
        {valueText}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',

    // ✅ ancho consistente con TextInput en layouts de formulario
    alignSelf: 'stretch',
    width: '100%',

    minHeight: CONTROL_MIN_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: CONTROL_PADDING_V,
    backgroundColor: '#FFFFFF',
  },
  icon: {
    marginRight: spacing.xs + 2,
  },
  text: {
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  disabled: {
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  textDisabled: {
    color: colors.textSecondary,
  },
});
