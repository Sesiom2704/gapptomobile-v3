/**
 * Archivo: mobile_app/components/ui/InfoModal.tsx
 *
 * Responsabilidad:
 *   - Proveer un patrón reutilizable para mostrar información contextual (“i”)
 *     mediante un modal estándar (cerrar con X o pulsando fuera).
 *
 * Motivo:
 *   - Evita duplicación de lógica/estado en múltiples pantallas.
 *   - Unifica comportamiento y estilos del sistema de ayuda contextual.
 *
 * Uso típico:
 *   const info = useInfoModal();
 *   <InfoButton onPress={() => info.open("Título", "Texto")} />
 *   <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
 */

import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';

export function InfoButton({
  onPress,
  size = 18,
  align = 'title',
  style,
}: {
  onPress: () => void;
  size?: number;
  /**
   * Alineación visual respecto al texto cercano:
   * - title: para títulos (suele necesitar subir 1–2px)
   * - body: para texto normal (normalmente 0 a -1px)
   * - none: sin ajuste
   */
  align?: 'title' | 'body' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const offsetTop = align === 'title' ? -4 : align === 'body' ? -1 : 0;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.infoBtn, { top: offsetTop }, style]}
    >
      <Ionicons
        name="information-circle-outline"
        size={size}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

export function InfoModal({
  visible,
  title,
  text,
  onClose,
}: {
  visible: boolean;
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => null}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.text}>{text}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function useInfoModal() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  const open = useCallback((t: string, msg: string) => {
    setTitle(t);
    setText(msg || '—');
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  return { visible, title, text, open, close };
}

const styles = StyleSheet.create({
  infoBtn: {
    alignSelf: 'center',
  },

  backdrop: {
    flex: 1,
    backgroundColor: '#0007',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '900', color: colors.textPrimary },
  text: { fontSize: 13, color: colors.textPrimary },
});
