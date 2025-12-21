/**
 * Archivo: mobile_app/components/ui/SelectedInlineValue.tsx
 *
 * Responsabilidad:
 *   - Renderiza un “valor seleccionado” en línea (estilo chip/selector) con opción de limpieza.
 *   - Se usa en formularios cuando un campo ya está seleccionado (p. ej. Localidad/Proveedor/Entidad),
 *     sustituyendo al input de búsqueda y mostrando una acción de “quitar”.
 *
 * FIX:
 *   - Se añade leftIconName al destructuring para evitar el error.
 *
 * Entradas:
 *   - value: texto a mostrar
 *   - onClear: callback al pulsar “quitar”
 *   - disabled: deshabilita la acción de limpiar (típico readOnly)
 *   - containerStyle: estilos extra para el contenedor
 *   - leftIconName: icono Ionicons opcional a la izquierda
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { commonFormStyles, CONTROL_MIN_HEIGHT } from '../forms/formStyles';
import { colors } from '../../theme';

type Props = {
  value: string;
  onClear?: () => void;
  disabled?: boolean; // típico: readOnly
  containerStyle?: StyleProp<ViewStyle>;
  leftIconName?: keyof typeof Ionicons.glyphMap;
};

export function SelectedInlineValue({
  value,
  onClear,
  disabled,
  containerStyle,
  leftIconName,
}: Props) {
  return (
    <View style={[commonFormStyles.selectedProvider, styles.controlContainer, containerStyle]}>
      {!!leftIconName && (
        <Ionicons name={leftIconName} size={16} color={colors.primary} style={{ marginRight: 8 }} />
      )}

      <Text style={[commonFormStyles.selectedProviderText, { flex: 1 }]} numberOfLines={1}>
        {value}
      </Text>

      {!disabled && !!onClear && (
        <TouchableOpacity onPress={onClear} accessibilityRole="button" accessibilityLabel="Quitar">
          <Ionicons name="close-circle" size={18} color={colors.danger} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = {
  controlContainer: {
    minHeight: CONTROL_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  } as ViewStyle,
};
