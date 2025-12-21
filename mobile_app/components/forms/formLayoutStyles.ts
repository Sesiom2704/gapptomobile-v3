/**
 * Archivo: mobile_app/components/forms/formLayoutStyles.ts
 *
 * Responsabilidad:
 *   - Centraliza estilos de layout reutilizables para pantallas de formularios.
 *   - Evita duplicación de "row/cols/wrap lists" en screens (Propiedad, Gastos, Ingresos, etc.).
 *
 * Incluye:
 *   - Grillas simples (row + columnas 1/2, 1/3, 2/3)
 *   - Wrappers para listas tipo “pills” (wrap + item)
 *
 * Notas:
 *   - Son estilos de layout (estructura), no de “skin” (colores/bordes), para minimizar acoplamiento.
 */

import { StyleSheet } from 'react-native';

export const formLayoutStyles = StyleSheet.create({
  // Row genérica con separación consistente
  row: {
    flexDirection: 'row',
    gap: 10,
  },

  // Columnas
  col1of2: { flex: 1 },
  col1of3: { flex: 1 },
  col2of3: { flex: 2 },

  // Wrap para listas tipo “pills”
  wrapList: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  // Item dentro de wrap (por defecto, que no se salga)
  wrapItem: {
    maxWidth: '100%',
  },
});

export default formLayoutStyles;
