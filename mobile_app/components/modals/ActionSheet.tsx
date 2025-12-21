// components/modals/ActionSheet.tsx
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, radius } from '../../theme';

export type ActionSheetAction = {
  label: string;
  onPress: () => void | Promise<void>;
  destructive?: boolean;
  iconName?: keyof typeof Ionicons.glyphMap; // 👈 icono a la izquierda
  color?: string;                             // 👈 color de texto/icono
};

type ActionSheetProps = {
  visible: boolean;
  title?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
};

export const ActionSheet: React.FC<ActionSheetProps> = ({
  visible,
  title,
  actions,
  onClose,
}) => {
  if (!visible) return null;

  const handleActionPress = async (action: ActionSheetAction) => {
    try {
      await action.onPress();
    } finally {
      onClose();
    }
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              <View style={styles.sheet}>
                {title && <Text style={styles.title}>{title}</Text>}

                {actions.map((action, index) => {
                  const baseColor = action.color
                    ? action.color
                    : action.destructive
                    ? colors.danger
                    : colors.textPrimary;

                  return (
                    <TouchableOpacity
                      key={index.toString()}
                      onPress={() => void handleActionPress(action)}
                      activeOpacity={0.7}
                      style={[
                        styles.actionRow,
                        index === 0 && styles.actionRowFirst,
                        index === actions.length - 1 && styles.actionRowLast,
                      ]}
                    >
                      {action.iconName && (
                        <Ionicons
                          name={action.iconName}
                          size={20}
                          color={baseColor}
                          style={styles.actionIcon}
                        />
                      )}

                      <Text
                        style={[
                          styles.actionLabel,
                          action.destructive && styles.actionLabelDestructive,
                          !!action.color && { color: baseColor },
                        ]}
                      >
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.8}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelLabel}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    padding: spacing.md,
  },
  sheet: {
    borderRadius: radius.xl,
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: '#FFFFFF', // 👈 sin fondos de colores
  },
  actionRowFirst: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  actionRowLast: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderBottomWidth: 0,
  },
  actionIcon: {
    marginRight: spacing.md,
  },
  actionLabel: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  actionLabelDestructive: {
    color: colors.danger,
    fontWeight: '600',
  },
  cancelButton: {
    borderRadius: radius.xl,
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelLabel: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
