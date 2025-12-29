// mobile_app/components/cards/OptionCard.tsx
// -----------------------------------------------------------------------------
// OptionCard (actualizado)
// - Mantiene el “look & feel” de tarjeta de opción.
// - NUEVO: soporte de estado enabled/disabled sin crear un componente nuevo.
// - Si disabled: fondo gris claro, icono gris oscuro, texto atenuado.
// - Si pulsas estando disabled: dispara onDisabledPress (p.ej. Alert).
// - NUEVO: showChevron (para CTA “dinámicos” donde no aporta la flecha).
// -----------------------------------------------------------------------------
//
// Nota: Si tu OptionCard original tenía estilos ligeramente distintos,
// puedes conservarlos y solo integrar la lógica state/showChevron.
// Este fichero es una implementación completa y coherente con tu UI.
//
// Props compatibles con lo que ya estabas usando:
//  - iconName, title, description, onPress
// + NUEVO:
//  - state, onDisabledPress, showChevron
// -----------------------------------------------------------------------------

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleSheet as RNStyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '../../theme';

type OptionCardState = 'enabled' | 'disabled';

type OptionCardProps = {
  iconName: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;

  onPress?: () => void;

  // NUEVO
  state?: OptionCardState; // default 'enabled'
  onDisabledPress?: () => void;

  // NUEVO
  showChevron?: boolean; // default true
};

export const OptionCard: React.FC<OptionCardProps> = ({
  iconName,
  title,
  description,
  onPress,
  state = 'enabled',
  onDisabledPress,
  showChevron = true,
}) => {
  const disabled = state === 'disabled';

  const handlePress = () => {
    if (disabled) {
      onDisabledPress?.();
      return;
    }
    onPress?.();
  };

  const bg = disabled ? '#F0F1F3' : '#FFFFFF';
  const border = disabled ? '#E1E3E8' : '#E6E6EA';

  const iconColor = disabled ? '#6B7280' : colors.primary; // gris oscuro vs primary
  const titleColor = disabled ? '#6B7280' : colors.textPrimary;
  const descColor = disabled ? '#8B9098' : colors.textSecondary;
  const chevronColor = disabled ? '#9CA3AF' : colors.textSecondary;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.card, { backgroundColor: bg, borderColor: border }]}
    >
      <View style={styles.left}>
        <View style={[styles.iconCircle, { backgroundColor: disabled ? '#E7E9EE' : colors.primarySoft }]}>
          <Ionicons name={iconName} size={20} color={iconColor} />
        </View>
      </View>

      <View style={styles.center}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>

        {!!description && (
          <Text style={[styles.description, { color: descColor }]} numberOfLines={2}>
            {description}
          </Text>
        )}
      </View>

      <View style={styles.right}>
        {showChevron ? (
          <Ionicons name="chevron-forward" size={18} color={chevronColor} />
        ) : (
          <View style={styles.chevronPlaceholder} />
        )}
      </View>
    </TouchableOpacity>
  );
};
const ICON_SIZE = 50

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: RNStyleSheet.hairlineWidth,

    // 🔧 ALTURA
    paddingVertical: spacing.xl, // antes spacing.lg
    paddingHorizontal: spacing.lg,
    minHeight: 84,               // añade esto

    marginBottom: spacing.md,
  },

  left: {
    marginRight: spacing.lg,
  },
  iconCircle: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
  right: {
    marginLeft: spacing.md,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  chevronPlaceholder: {
    width: 18,
    height: 18,
  },
});

export default OptionCard;
