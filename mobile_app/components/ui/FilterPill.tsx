/**
 * Archivo: components/ui/FilterPill.tsx
 *
 * Responsabilidad:
 *   - Wrapper de compatibilidad para filtros avanzados.
 *   - Internamente delega en PillButton para mantener un único estándar visual.
 *
 * Nota:
 *   - Mantener mientras se migra el proyecto. En pantallas nuevas, usar PillButton directamente.
 */

import React from 'react';
import { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { PillButton } from './PillButton';

type FilterPillProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export const FilterPill: React.FC<FilterPillProps> = ({
  label,
  selected = false,
  onPress,
  disabled = false,
  style,
  textStyle,
}) => {
  return (
    <PillButton
      label={label}
      selected={selected}
      onPress={onPress}
      disabled={disabled}
      numberOfLines={1}
      size="sm"
      style={style}
      textStyle={textStyle}
    />
  );
};
