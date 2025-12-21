// components/list/listStyles.ts
import { StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';

export const listStyles = StyleSheet.create({
  // Zona superior: cabecera + chips principales
  topArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.sm,
    marginTop: spacing.sm,
  },

  // Zona media: buscador avanzado
  middleArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  searchToggleText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  searchPanel: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  searchLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  searchIcon: {
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 4,
  },

  // Fila de pills: 3 por fila
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pillWrapper: {
    width: '32%',
    marginBottom: spacing.xs,
  },

  // Versión "wrap libre" (por si hay muchas pills pequeñas)
  pillsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xs,
    rowGap: spacing.xs,
    marginBottom: spacing.sm,
  },

  // Filtros de fecha
  dateFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  dateButtonsContainer: {
    flexDirection: 'row',
    flex: 1,
    columnGap: spacing.sm,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  dateButtonText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  clearDateButton: {
    marginLeft: spacing.sm,
  },

  // Zona inferior: lista
  bottomArea: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },

  // Estados
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },

    // Estilo base opcional para las pills del buscador avanzado
  filterPill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  topFilterRow: {
    marginTop: spacing.sm,
  },
});
