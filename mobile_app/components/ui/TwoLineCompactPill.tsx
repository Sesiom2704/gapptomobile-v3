// components/ui/TwoLineCompactPill.tsx
/**
 * TwoLineCompactPill
 * - Pill compacto para casos puntuales donde el label debe caber en 2 líneas
 *   sin aumentar el tamaño del botón.
 * - NO sustituye a FilterPill (compatibilidad). Solo usar donde se necesite.
 *
 * Nota:
 * - Mantenemos el estándar visual delegando en PillButton.
 * - Forzamos altura fija y texto compacto para permitir 2 líneas sin crecer.
 */

import React from 'react';
import { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { PillButton } from './PillButton';

type TwoLineCompactPillProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export const TwoLineCompactPill: React.FC<TwoLineCompactPillProps> = ({
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
      numberOfLines={2}
      size="sm"
      /**
       * Objetivo: 2 líneas sin crecer.
       * - Altura fija para evitar que el pill “expanda” el layout.
       * - Centramos contenido vertical/horizontal.
       */
      style={[
        {
          height: 34,
          paddingHorizontal: 10,
          paddingVertical: 0,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
      /**
       * Texto compacto:
       * - Reducimos fontSize/lineHeight para que entren 2 líneas dentro de la altura fija.
       * - Centramos para mejorar legibilidad en pills estrechos.
       */
      textStyle={[
        {
          fontSize: 11,
          lineHeight: 12,
          textAlign: 'center',
        },
        textStyle,
      ]}
    />
  );
};

export default TwoLineCompactPill;
