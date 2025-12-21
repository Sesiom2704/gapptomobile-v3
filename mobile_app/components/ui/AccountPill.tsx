/**
 * Archivo: components/ui/AccountPill.tsx
 *
 * Responsabilidad:
 *   - Píldora seleccionable para representar una cuenta (label + subLabel opcional).
 *   - Soporta tamaños (standard/small) y estado seleccionado.
 *
 * Requisito UX:
 *   - El anagrama (label) debe soportar hasta 2 líneas sin truncar en exceso.
 *   - El pill mantiene altura estable por tamaño.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';

export type AccountPillSize = 'standard' | 'small';

export type AccountPillProps = {
  label: string;
  subLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;

  /**
   * standard: tamaño por defecto en forms grandes
   * small: para forms más compactos
   */
  size?: AccountPillSize;

  style?: StyleProp<ViewStyle>;
};

export const AccountPill: React.FC<AccountPillProps> = ({
  label,
  subLabel,
  selected = false,
  disabled = false,
  onPress,
  size = 'standard',
  style,
}) => {
  const isSmall = size === 'small';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      accessibilityLabel={subLabel ? `${label}. ${subLabel}` : label}
      style={[
        styles.containerBase,
        isSmall ? styles.containerSmall : styles.containerStandard,
        selected && styles.containerSelected,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.textBlock}>
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={[
            styles.label,
            isSmall && styles.labelSmall,
            selected && styles.labelSelected,
          ]}
        >
          {label}
        </Text>

        {subLabel ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.subLabel,
              isSmall && styles.subLabelSmall,
              selected && styles.subLabelSelected,
            ]}
          >
            {subLabel}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

// Alturas fijas preparadas para 2 líneas de label
const HEIGHT_STANDARD = 72; // antes 56
const HEIGHT_SMALL = 44; // antes 44

const styles = StyleSheet.create({
  containerBase: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },

  containerStandard: {
    minHeight: HEIGHT_STANDARD,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  containerSmall: {
    minHeight: HEIGHT_SMALL,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },

  containerSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },

  disabled: {
    opacity: 0.6,
  },

  textBlock: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  labelSmall: {
    fontSize: 12,
    lineHeight: 14,
  },
  labelSelected: {
    color: colors.primaryStrong,
  },

  subLabel: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  subLabelSmall: {
    fontSize: 10,
    lineHeight: 12,
    marginTop: 1,
  },
  subLabelSelected: {
    color: colors.textPrimary,
  },
});

export default AccountPill;
