import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../theme/colors';

type Tone = 'success' | 'danger' | 'warning' | 'neutral';

type Props = {
  icon: any; // nombre de Ionicons, p.ej. "wallet-outline"
  title: string;
  value: string;
  caption?: string;
  tone?: Tone;
};

function toneColor(tone: Tone | undefined) {
  if (tone === 'success') return colors.success;
  if (tone === 'danger') return colors.danger;
  if (tone === 'warning') return colors.warning ?? colors.primary;
  return colors.primary;
}

export const MiniStatCard: React.FC<Props> = ({ icon, title, value, caption, tone = 'neutral' }) => {
  const c = toneColor(tone);

  return (
    <View style={styles.card}>
      <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={c} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.value}>{value}</Text>
        {!!caption && <Text style={styles.caption}>{caption}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '48%',
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  title: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  value: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  caption: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
});
