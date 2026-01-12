// mobile_app/components/ui/PeriodNavigator.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../theme/colors';

type Props = {
  label: string;
  hint?: string;

  onPrev: () => void;
  onNext: () => void;

  disablePrev?: boolean;
  disableNext?: boolean;

  style?: StyleProp<ViewStyle>;
};

export const PeriodNavigator: React.FC<Props> = ({
  label,
  hint,
  onPrev,
  onNext,
  disablePrev = false,
  disableNext = false,
  style,
}) => {
  return (
    <View style={[styles.row, style]}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.iconBtn, disablePrev && styles.btnDisabled]}
        disabled={disablePrev}
        onPress={onPrev}
      >
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        {!!hint && (
          <Text style={styles.hint} numberOfLines={2}>
            {hint}
          </Text>
        )}
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.iconBtn, disableNext && styles.btnDisabled]}
        disabled={disableNext}
        onPress={onNext}
      >
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: (colors as any).neutralSoft ?? colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: (colors as any).border ?? colors.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textPrimary,
    //textTransform: 'uppercase',
  },
  hint: {
    marginTop: 2,
    fontSize: 11,
    color: (colors as any).textMuted ?? colors.textSecondary,
    textAlign: 'center',
    fontWeight: '700',
  },
});

export default PeriodNavigator;
