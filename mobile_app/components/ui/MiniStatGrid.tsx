// mobile_app/components/ui/MiniStatGrid.tsx

import React from 'react';
import { View, StyleSheet } from 'react-native';

export const MiniStatGrid: React.FC<{
  children: React.ReactNode;
  gap?: number;
}> = ({ children, gap = 10 }) => {
  // Asumimos que pasas elementos en pares (2 columnas)
  const items = React.Children.toArray(children);

  const rows: React.ReactNode[] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(
      <View key={`row-${i}`} style={[styles.row, { gap }]}>
        <View style={styles.col}>{items[i]}</View>
        <View style={styles.col}>{items[i + 1] ?? <View />}</View>
      </View>
    );
  }

  return <View style={{ gap }}>{rows}</View>;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
  },
});
