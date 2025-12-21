import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, radius } from '../../theme';

type Props = {
  visible: boolean;
  title: string;
  description: string;
  onClose: () => void;
};

const KpiInfoModal: React.FC<Props> = ({ visible, title, description, onClose }) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.sub}>Definición y cálculo</Text>
            </View>

            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.desc}>{description}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  sub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  body: { paddingVertical: spacing.sm },
  desc: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  cta: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '900' },
});

export default KpiInfoModal;
