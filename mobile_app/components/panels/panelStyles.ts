// components/panels/panelStyles.ts
import { StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

export const panelStyles = StyleSheet.create({
  // Layout base para pantallas tipo panel
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },

  // Header genérico (título + subtítulo)
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    maxWidth: '90%',
  },

  // Secciones
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Tarjetas genéricas
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  cardSubtitleSmall: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginVertical: 4,
  },

  // Filas de texto dentro de tarjeta (tipo label + valor)
  cardRowText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 4,
  },
  cardRowTextLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardRowTextValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  // Botón de acción dentro de tarjeta (ver más, ver todos…)
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  cardButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginRight: 4,
  },

  // Chips “muted” (ej: Deuda, LTV)
  chipMuted: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  chipMutedLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
  },

  // Tarjetas de menú (Día a día, Mes a mes, Patrimonio, Settings…)
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  menuIconCircleSecondary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
