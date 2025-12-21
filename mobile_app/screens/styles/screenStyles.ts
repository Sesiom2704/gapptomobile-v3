/**
 * Archivo: mobile_app/screens/styles/screenStyles.ts
 *
 * Responsabilidad:
 *   - Estilos transversales de layout para screens (no componentes UI).
 *   - Unifica padding, separadores, fondos y estados (loading/error/empty).
 *
 * Maneja:
 *   - Contenedores base: screen, topArea, middleArea, bottomArea.
 *   - Listas: list, listContent.
 *   - Estados: centered, loadingText, errorText, emptyText.
 *   - Textos auxiliares de cabecera: subtitleText / helperText (ej: "Ordenado por ...").
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO
 *
 * Notas:
 *   - Consume tokens del theme (colors/spacing/radius). Evita hardcodes.
 *   - No debe contener estilos de componentes UI (Chip, PillButton, Cards, etc.).
 */

import { StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';

export const screenStyles = StyleSheet.create({
  // Base
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Áreas típicas
  topArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  topAreaWithDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  middleArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },

  bottomArea: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },

  // Listas
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

  // Textos auxiliares (ej: "Ordenado por X")
  helperText: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },
});

export default screenStyles;
