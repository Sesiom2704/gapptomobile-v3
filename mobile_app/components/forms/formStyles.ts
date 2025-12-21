/**
 * Archivo: components/forms/formStyles.ts
 *
 * Responsabilidad:
 *   - Estilos base reutilizables para pantallas de formulario: layout, campos, inputs,
 *     grids de selección tipo “pill”, filas de dos columnas y acciones inferiores.
 *
 * Maneja:
 *   - Tokens de tema: colors, spacing, radius (theme/)
 *   - Convención de estilos: StyleSheet (React Native)
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (debe ser el estándar visual para formularios).
 *   - Riesgos: si se introducen estilos específicos de una pantalla aquí, se rompe la coherencia
 *     o se generan efectos colaterales en otras pantallas.
 *
 * Notas:
 *   - Evitar hardcodes de color/espaciado. Si un color se usa más de una vez, debe ser token del theme.
 *   - CONTROL_MIN_HEIGHT define el alto mínimo común para: TextInput, fecha (dateButton),
 *     “selected value” (SelectedInlineValue / selectedProvider) y selectores similares.
 */

// components/forms/formStyles.ts
import { StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';

export const CONTROL_MIN_HEIGHT = 42;
// ✅ Exportado para que controles UI (InlineSearchSelect, FormDateButton, etc.) compartan el mismo “tamaño”
export const CONTROL_PADDING_V = 12;

export const commonFormStyles = StyleSheet.create({
  // Layout general de pantalla de formulario
  topArea: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  formArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.lg,
  },

  // Campos genéricos
  field: {
    marginBottom: spacing.md,
  },
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
    marginBottom: spacing.xs,
  },

  // Input base (alto mínimo común)
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: CONTROL_MIN_HEIGHT,
    paddingVertical: CONTROL_PADDING_V,
    backgroundColor: '#FFFFFF',
    fontSize: 14,
    // ayuda a centrar texto en Android (sin afectar iOS)
    textAlignVertical: 'center',
  },
  inputFilled: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  inputAdvanced: {
    backgroundColor: '#F3F4F6',
  },
  inputDisabled: {
    backgroundColor: colors.surface,
    color: colors.textSecondary,
  },

  // Grids de pills (segmentos, tipos, periodicidad, etc.)
  segmentosRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  segmentoWrapper: {
    width: '48%',
    marginBottom: 8,
  },

  periodicidadRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  periodicidadPillWrapper: {
    width: '48%',
    marginBottom: 8,
  },

  accountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    justifyContent: 'space-between',
  },
  accountPillWrapper: {
    width: '48%',
    marginBottom: 8,
  },

  rangoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  rangoPillWrapper: {
    width: '25%',
    paddingRight: 4,
    marginBottom: 8,
  },

  // Fila dos columnas
  fieldRowTwoCols: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  col: {
    width: '48%',
  },

  // Botón inline "+"
  addInlineButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  addInlineButtonText: {
    fontSize: 20,
    lineHeight: 22,
    color: '#00AA55',
    fontWeight: '700',
  },

  // Selector de fecha (alto mínimo común)
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CONTROL_MIN_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: CONTROL_PADDING_V,
    backgroundColor: '#FFFFFF',
  },
  dateButtonText: {
    fontSize: 14,
    color: colors.textPrimary,
  },

  // Toggle avanzado
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  advancedToggleText: {
    marginLeft: spacing.xs,
    fontSize: 13,
    color: colors.textSecondary,
  },

  // Botón principal inferior
  bottomActions: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },

  // Proveedor seleccionado / SelectedInlineValue (alto mínimo común)
  selectedProvider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: CONTROL_MIN_HEIGHT,

    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: CONTROL_PADDING_V,

    borderWidth: 1,
    borderColor: colors.primary,
    columnGap: 8,
  },
  selectedProviderText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryStrong,
  },

  proveedoresList: {
    marginTop: spacing.xs,
  },
  proveedorOption: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  proveedorOptionText: {
    fontSize: 14,
    color: colors.textPrimary,
  },

  amountInputBig: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'right',
    color: colors.textPrimary,
  },

  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },

  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 15,
    color: colors.textPrimary,
  },
});
