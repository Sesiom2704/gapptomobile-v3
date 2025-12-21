/**
 * Archivo: components/forms/FormSection.tsx
 *
 * Responsabilidad:
 *   - Contenedor tipo “card” para agrupar campos de formulario por secciones.
 *   - Opcionalmente muestra un título (ej. “Datos básicos”, “Importe y condiciones”).
 *
 * Maneja:
 *   - UI: View + Text
 *   - Estilos: tokens de theme (colors/spacing/radius)
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (patrón estándar de formularios).
 *
 * Notas:
 *   - Evitar estilos específicos de un formulario concreto; debe servir para cualquier pantalla.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';

type FormSectionProps = {
  title?: string;
  children: React.ReactNode;
};

/**
 * Tarjeta blanca reutilizable para agrupar campos de formulario.
 * Ejemplo: "Datos básicos", "Importe y condiciones", etc.
 */
export const FormSection: React.FC<FormSectionProps> = ({ title, children }) => {
  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}
      <View style={styles.body}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  body: {
    gap: spacing.sm,
  },
});
