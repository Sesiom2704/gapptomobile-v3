/**
 * Archivo: mobile_app/components/ui/PillButton.tsx
 * Versión: 3.1.0
 *
 * Responsabilidad:
 * - Botón tipo "pill" reutilizable para selecciones rápidas.
 *
 * Mejoras incluidas:
 * 1) Soporte de variantes visuales semánticas:
 *    - default
 *    - warning
 *    - neutral
 *    - dangerMuted
 *
 * 2) Soporte de subLabel opcional en segunda línea.
 *
 * 3) Mantiene compatibilidad con usos existentes:
 *    - selected
 *    - disabled
 *    - size
 *    - numberOfLines
 *    - style
 *    - textStyle
 *
 * Uso recomendado:
 * - ramas
 * - tipos
 * - periodicidades
 * - estados
 * - selector de contratos con texto principal + subtítulo
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  View,
} from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { CONTROL_MIN_HEIGHT } from '../forms/formStyles';

type PillSize = 'sm' | 'md';
type PillVariant = 'default' | 'warning' | 'neutral' | 'dangerMuted';

type PillButtonProps = {
  label: string;
  subLabel?: string;

  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;

  size?: PillSize;
  numberOfLines?: number;
  variant?: PillVariant;

  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  subLabelStyle?: StyleProp<TextStyle>;
};

export const PillButton: React.FC<PillButtonProps> = ({
  label,
  subLabel,
  selected = false,
  disabled = false,
  onPress,

  size = 'md',
  numberOfLines = 2,
  variant = 'default',

  style,
  textStyle,
  subLabelStyle,
}) => {
  const handlePress = disabled ? undefined : onPress;

  const variantStyles = getVariantStyles(variant, selected);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      accessibilityLabel={subLabel ? `${label}. ${subLabel}` : label}
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        variantStyles.container,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        <Text
          numberOfLines={numberOfLines}
          style={[
            styles.label,
            size === 'sm' ? styles.labelSm : styles.labelMd,
            variantStyles.label,
            disabled && styles.labelDisabled,
            textStyle,
          ]}
        >
          {label}
        </Text>

        {subLabel ? (
          <Text
            numberOfLines={1}
            style={[
              styles.subLabel,
              size === 'sm' ? styles.subLabelSm : styles.subLabelMd,
              variantStyles.subLabel,
              disabled && styles.subLabelDisabled,
              subLabelStyle,
            ]}
          >
            {subLabel}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

function getVariantStyles(variant: PillVariant, selected: boolean) {
  switch (variant) {
    case 'warning':
      return selected
        ? {
            container: styles.warningSelected,
            label: styles.warningLabelSelected,
            subLabel: styles.warningSubLabelSelected,
          }
        : {
            container: styles.warningBase,
            label: styles.warningLabel,
            subLabel: styles.warningSubLabel,
          };

    case 'neutral':
      return selected
        ? {
            container: styles.neutralSelected,
            label: styles.neutralLabelSelected,
            subLabel: styles.neutralSubLabelSelected,
          }
        : {
            container: styles.neutralBase,
            label: styles.neutralLabel,
            subLabel: styles.neutralSubLabel,
          };

    case 'dangerMuted':
      return selected
        ? {
            container: styles.dangerMutedSelected,
            label: styles.dangerMutedLabelSelected,
            subLabel: styles.dangerMutedSubLabelSelected,
          }
        : {
            container: styles.dangerMutedBase,
            label: styles.dangerMutedLabel,
            subLabel: styles.dangerMutedSubLabel,
          };

    case 'default':
    default:
      return selected
        ? {
            container: styles.selected,
            label: styles.labelSelected,
            subLabel: styles.subLabelSelected,
          }
        : {
            container: styles.defaultBase,
            label: styles.defaultLabel,
            subLabel: styles.defaultSubLabel,
          };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CONTROL_MIN_HEIGHT,
  },

  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  md: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Estado base/default
  defaultBase: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  // Warning (pendiente)
  warningBase: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
  },
  warningSelected: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
  },

  // Neutral (finalizado)
  neutralBase: {
    backgroundColor: colors.neutralSoft,
    borderColor: colors.neutral200,
  },
  neutralSelected: {
    backgroundColor: colors.neutralSoft,
    borderColor: colors.textSecondary,
  },

  // Danger muted (cancelado)
  dangerMutedBase: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.neutral200,
  },
  dangerMutedSelected: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },

  disabled: {
    opacity: 0.5,
  },

  label: {
    fontWeight: '500',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  labelSm: {
    fontSize: 12,
  },
  labelMd: {
    fontSize: 13,
  },

  subLabel: {
    marginTop: 2,
    textAlign: 'center',
  },
  subLabelSm: {
    fontSize: 10,
    lineHeight: 12,
  },
  subLabelMd: {
    fontSize: 11,
    lineHeight: 13,
  },

  // Textos default
  defaultLabel: {
    color: colors.textSecondary,
  },
  defaultSubLabel: {
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  subLabelSelected: {
    color: colors.primaryStrong,
  },

  // Textos warning
  warningLabel: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  warningSubLabel: {
    color: colors.textSecondary,
  },
  warningLabelSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  warningSubLabelSelected: {
    color: colors.textSecondary,
  },

  // Textos neutral
  neutralLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  neutralSubLabel: {
    color: colors.textMuted,
  },
  neutralLabelSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  neutralSubLabelSelected: {
    color: colors.textSecondary,
  },

  // Textos danger muted
  dangerMutedLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  dangerMutedSubLabel: {
    color: colors.textMuted,
  },
  dangerMutedLabelSelected: {
    color: colors.danger,
    fontWeight: '700',
  },
  dangerMutedSubLabelSelected: {
    color: colors.textSecondary,
  },

  labelDisabled: {
    color: colors.textMuted,
  },
  subLabelDisabled: {
    color: colors.textMuted,
  },
});

export default PillButton;