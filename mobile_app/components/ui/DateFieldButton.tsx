import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { commonFormStyles } from '../forms/formStyles';
import { colors } from '../../theme';

type Props = {
  text: string;
  onPress: () => void;
  disabled?: boolean;
  showIcon?: boolean;
};

export function DateFieldButton({ text, onPress, disabled, showIcon = true }: Props) {
  return (
    <TouchableOpacity style={commonFormStyles.dateButton} onPress={onPress} disabled={disabled}>
      {showIcon ? (
        <Ionicons
          name="calendar-outline"
          size={16}
          color={colors.textSecondary}
          style={{ marginRight: 6 }}
        />
      ) : null}
      <Text style={commonFormStyles.dateButtonText}>{text}</Text>
    </TouchableOpacity>
  );
}
