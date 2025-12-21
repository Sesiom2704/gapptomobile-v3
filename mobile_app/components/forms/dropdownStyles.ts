import { StyleSheet } from 'react-native';
import { commonFormStyles } from './formStyles';

export const dropdownStyles = StyleSheet.create({
  // Contenedor del dropdown
  box: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: commonFormStyles.input.borderColor,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: commonFormStyles.input.backgroundColor,
  },

  // Loader centrado (cuando hay ActivityIndicator)
  loader: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Fila horizontal (input + botón)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // Botón toggle ▲/▼
  toggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: commonFormStyles.input.borderColor,
    backgroundColor: commonFormStyles.input.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '800',
    color: commonFormStyles.label.color,
  },

  // Header de búsqueda dentro del dropdown
  searchRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: commonFormStyles.input.borderColor,
  },
  searchInput: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: commonFormStyles.input.borderColor,
    backgroundColor: commonFormStyles.input.backgroundColor,
    color: commonFormStyles.label.color,
  },

  // Item del dropdown
  item: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: commonFormStyles.input.borderColor,
  },
  itemText: {
    fontSize: 12,
    fontWeight: '700',
    color: commonFormStyles.label.color,
  },

  // Estado vacío
  empty: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 12,
    color: commonFormStyles.helperText.color,
  },

  // Pill pequeña para alternar LISTA / NUEVA
  smallPill: {
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: commonFormStyles.input.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: commonFormStyles.input.backgroundColor,
  },
  smallPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: commonFormStyles.label.color,
  },
});
