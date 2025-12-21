/**
 * Archivo: components/ui/FilterRow.tsx
 *
 * Responsabilidad:
 *   - Layout de fila para chips/pills de filtros en 2 o 3 columnas.
 *   - Reparte el ancho de forma estable con flex (sin porcentajes).
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { spacing } from '../../theme';

type FilterRowProps = {
  columns: 2 | 3;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number; // opcional por si algún screen necesita otro espaciado
};

export const FilterRow: React.FC<FilterRowProps> = ({
  columns,
  children,
  style,
  gap = spacing.sm,
}) => {
  const items = React.Children.toArray(children).slice(0, columns);

  return (
    <View style={[style, styles.row]}>
      {items.map((child, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <View
            key={idx}
            style={[styles.item, !isLast && { marginRight: gap }]}
          >
            {child}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    width: '100%',
  },
  item: {
    flex: 1,
    minWidth: 0, // importante para evitar “empujes” raros en Android
  },
});

export default FilterRow;

