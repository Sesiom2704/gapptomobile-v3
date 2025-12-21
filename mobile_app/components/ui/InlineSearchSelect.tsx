/**
 * Archivo: components/ui/InlineSearchSelect.tsx
 *
 * Responsabilidad:
 *   - Selector inline con búsqueda:
 *       - Cabecera con label y botón de añadir (+)
 *       - Estado seleccionado (pill con opción de limpiar)
 *       - Búsqueda por texto + lista de opciones filtradas
 *
 * Maneja:
 *   - UI: labelRow, input, lista de opciones, estado seleccionado
 *   - Estado: ninguno (controlado por props)
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (control genérico para catálogos: proveedor, tipo, etc.)
 *
 * Notas:
 *   - Consume tokens del theme para consistencia global.
 *   - Para coherencia visual de formularios, comparte CONTROL_MIN_HEIGHT / CONTROL_PADDING_V del estándar.
 */

import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleProp, ViewStyle, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InlineAddButton } from './InlineAddButton';
import { colors, spacing, radius } from '../../theme';
import { CONTROL_MIN_HEIGHT, CONTROL_PADDING_V } from '../forms/formStyles';

type Props<T> = {
  label: string;

  onAddPress: () => void;
  addAccessibilityLabel?: string;

  disabled?: boolean;

  selected: T | null;
  selectedLabel: (item: T) => string;
  onClear: () => void;

  query: string;
  onChangeQuery: (text: string) => void;
  placeholder?: string;

  options: T[];
  optionKey: (item: T) => string;
  optionLabel: (item: T) => string;
  onSelect: (item: T) => void;

  emptyText?: string;
  style?: StyleProp<ViewStyle>;
};

export function InlineSearchSelect<T>({
  label,
  onAddPress,
  addAccessibilityLabel = 'Añadir',
  disabled = false,

  selected,
  selectedLabel,
  onClear,

  query,
  onChangeQuery,
  placeholder,

  options,
  optionKey,
  optionLabel,
  onSelect,

  emptyText,
  style,
}: Props<T>) {
  return (
    <View style={style}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>

        <InlineAddButton
          onPress={onAddPress}
          disabled={disabled}
          accessibilityLabel={addAccessibilityLabel}
        />
      </View>

      {selected ? (
        <View style={[styles.selectedPill, disabled && styles.disabled]}>
          <Text style={styles.selectedText} numberOfLines={1}>{selectedLabel(selected)}</Text>

          {!disabled ? (
            <TouchableOpacity
              onPress={onClear}
              accessibilityRole="button"
              accessibilityLabel="Quitar seleccionado"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.danger} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <>
          <TextInput
            style={[
              styles.input,
              query.trim() !== '' && styles.inputFilled,
              disabled && styles.inputDisabled,
            ]}
            placeholder={placeholder}
            value={query}
            onChangeText={onChangeQuery}
            editable={!disabled}
          />

          <View style={styles.optionsList}>
            {options.map((item) => (
              <TouchableOpacity
                key={optionKey(item)}
                style={styles.option}
                disabled={disabled}
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar ${optionLabel(item)}`}
              >
                <Text style={styles.optionText}>{optionLabel(item)}</Text>
              </TouchableOpacity>
            ))}

            {options.length === 0 && emptyText ? (
              <Text style={styles.helperText}>{emptyText}</Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // ✅ Igual que el estándar (minHeight + padding vertical común)
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: CONTROL_MIN_HEIGHT,
    paddingVertical: CONTROL_PADDING_V,
    backgroundColor: '#FFFFFF',
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: 'center',
  },
  inputFilled: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  inputDisabled: {
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    opacity: 0.7,
  },

  // ✅ Ocupa el ancho del formulario (evita “pill” estrecha) + altura común
  selectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    alignSelf: 'stretch',
    width: '100%',

    minHeight: CONTROL_MIN_HEIGHT,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: CONTROL_PADDING_V,
    borderWidth: 1,
    borderColor: colors.primary,
    columnGap: spacing.sm,
  },
  selectedText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryStrong,
  },

  optionsList: {
    marginTop: spacing.xs,
  },
  option: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  optionText: {
    fontSize: 14,
    color: colors.textPrimary,
  },

  disabled: {
    opacity: 0.7,
  },
});
