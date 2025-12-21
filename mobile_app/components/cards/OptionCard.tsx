// components/cards/OptionCard.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, radius } from '../../theme';

type OptionCardProps = {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  onPress?: () => void;
};

export const OptionCard: React.FC<OptionCardProps> = ({
  iconName,
  title,
  description,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={onPress}
    >
      {/* ICONO IZQUIERDA */}
      <View style={styles.iconWrapper}>
        <Ionicons name={iconName} size={76} color={colors.primary} />
      </View>

      {/* TEXTO DERECHA */}
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',              // contenido centrado vertical
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,       // más alto
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    marginBottom: spacing.md,
  },
  iconWrapper: {
    marginRight: spacing.md,           // más espacio al texto
  },
  texts: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: spacing.md,
    marginRight: spacing.xl,
  },
  title: {
    fontSize: 28,                      // grande
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
    marginRight: spacing.xxl,
  },
  description: {
    fontSize: 16,
    color: colors.textSecondary,
  },
});
