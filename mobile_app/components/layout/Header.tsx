/**
 * Archivo: components/layout/Header.tsx
 *
 * Responsabilidad:
 *   - Cabecera superior estándar con:
 *       - Título principal
 *       - Subtítulo opcional (manual o calculado por mes/año)
 *       - Acción izquierda (back) y acción derecha (icono configurable o legacy "+")
 *   - Gestiona safe area superior (top).
 *
 * Maneja:
 *   - Navegación: back por defecto si no se pasa onBackPress
 *   - Acciones: rightIconName/onRightPress o legacy onAddPress
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (componente estructural).
 *
 * Notas:
 *   - Mantener consistencia de fondo/espaciados con el layout de formularios (evitar duplicación con formStyles).
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '../../theme';

type HeaderProps = {
  title: string;
  subtitle?: string;
  subtitleYear?: number;
  subtitleMonth?: number;
  subtitleMessage?: string;

  showBack?: boolean;
  onBackPress?: () => void;

  // Legacy: si lo pasas y no defines rightIconName, se pinta "+"
  onAddPress?: () => void;

  // Nuevo: icono derecho configurable (ej: "eye-outline")
  rightIconName?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
};

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  subtitleYear,
  subtitleMonth,
  subtitleMessage,
  showBack,
  onBackPress,
  onAddPress,
  rightIconName,
  onRightPress,
}) => {
  const navigation = useNavigation();

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const capitalize = (text: string) =>
    text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;

  let computedSubtitle: string | undefined = subtitle;

  if (!computedSubtitle && subtitleYear && subtitleMonth) {
    const date = new Date(subtitleYear, subtitleMonth - 1, 1);
    const monthLabel = date.toLocaleDateString('es-ES', {
      month: 'long',
      year: 'numeric',
    });
    const cleanLabel = capitalize(monthLabel.replace(' de ', ' '));
    computedSubtitle = subtitleMessage ? `${cleanLabel} - ${subtitleMessage}` : cleanLabel;
  }

  const hasRightAction = Boolean(onRightPress || onAddPress);
  const iconName: keyof typeof Ionicons.glyphMap =
    rightIconName ?? (onAddPress ? 'add' : 'add');

  const handleRight = () => {
    if (onRightPress) return onRightPress();
    if (onAddPress) return onAddPress();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.side}>
          {showBack ? (
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={26} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconPlaceholder} />
          )}
        </View>

        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          {computedSubtitle && <Text style={styles.subtitle}>{computedSubtitle}</Text>}
        </View>

        <View style={[styles.side, { alignItems: 'flex-end' }]}>
          {hasRightAction ? (
            <TouchableOpacity
              onPress={handleRight}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={iconName} size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconPlaceholder} />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.primarySoft,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl, //altura del header
    backgroundColor: colors.primarySoft,
  },

  side: {
    width: 40,
    justifyContent: 'center',
  },
  iconPlaceholder: {
    width: 26,
    height: 26,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});

export default Header;
