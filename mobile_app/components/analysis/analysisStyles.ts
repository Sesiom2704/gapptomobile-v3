// mobile_app/components/analysis/analysisStyles.ts
import { StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

export const analysisStyles = StyleSheet.create({
  // --------------------
  // Títulos dentro de cards
  // --------------------
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // --------------------
  // KPIs en fila
  // --------------------
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  kpiItem: {
    flex: 1,
    paddingRight: 8,
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  // --------------------
  // Filtros (toggle + contenido)
  // --------------------
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterContent: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  filterHelper: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
  },

  // Fila genérica de filtros con wrap (para subgastos, etc.)
  filterRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },

  // --------------------
  // Barras de progreso
  // --------------------
  progressRow: {
    marginTop: 8,
  },
  progressCaption: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  progressBarFillSoft: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },

  // --------------------
  // Textos vacíos / sin datos
  // --------------------
  emptyText: {
    marginTop: 4,
    fontSize: 12,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
