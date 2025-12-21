import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { commonFormStyles } from '../forms/formStyles';

type ItemBase = { id: string };

type Props<T extends ItemBase> = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;

  items: T[];
  maxItems?: number;

  getLabel: (item: T) => string;
  onSelect: (item: T) => void;

  emptyText?: string;
  readOnly?: boolean;
};

export function InlineSearchPicker<T extends ItemBase>({
  value,
  onChange,
  placeholder,
  items,
  maxItems = 6,
  getLabel,
  onSelect,
  emptyText = 'No hay resultados que coincidan.',
  readOnly,
}: Props<T>) {
  const visible = (items ?? []).slice(0, maxItems);

  return (
    <>
      <TextInput
        style={[commonFormStyles.input, value.trim() !== '' && commonFormStyles.inputFilled]}
        placeholder={placeholder ?? 'Escribe para buscar'}
        value={value}
        onChangeText={onChange}
        editable={!readOnly}
      />

      <View style={commonFormStyles.proveedoresList}>
        {visible.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={commonFormStyles.proveedorOption}
            onPress={() => {
              if (readOnly) return;
              onSelect(item);
            }}
          >
            <Text style={commonFormStyles.proveedorOptionText}>{getLabel(item)}</Text>
          </TouchableOpacity>
        ))}

        {visible.length === 0 && (
          <Text style={commonFormStyles.helperText}>{emptyText}</Text>
        )}
      </View>
    </>
  );
}
