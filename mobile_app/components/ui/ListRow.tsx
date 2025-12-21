/**
 * Archivo: components/ui/ListRow.tsx
 *
 * Responsabilidad:
 *   - Componente UI base para filas de listados: soporta layout consistente con:
 *       - zona izquierda (icono/avatar),
 *       - bloque central (título + subtítulo + details/footer opcionales),
 *       - zona derecha (importe/acción).
 *
 * Maneja:
 *   - UI: composición por “slots” (left/right/details/footer) para adaptarse a múltiples pantallas.
 *
 * Entradas / Salidas:
 *   - Props:
 *       - left?: ReactNode (icono)
 *       - title: string
 *       - subtitle?: string
 *       - details?: ReactNode (líneas adicionales, p.ej. saldos antes/después)
 *       - footer?: ReactNode (nota/tercera línea)
 *       - right?: ReactNode (importe, badge, botón)
 *       - containerStyle?: estilos adicionales
 *       - showDivider?: boolean (separador inferior)
 *
 * Dependencias clave:
 *   - Tema: colors
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (base estándar para listados en toda la app).
 *   - Riesgos: si cada pantalla mete demasiada lógica dentro de slots, conviene wrappers semánticos (p.ej. MovementRow).
 *
 * Notas de estilo:
 *   - Mantener tipografías y spacing coherentes aquí para que un cambio global afecte a todos los listados.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { colors } from '../../theme/colors';

type Props = {
  left?: React.ReactNode;

  title: string;
  titleStyle?: TextStyle;

  subtitle?: string;
  subtitleStyle?: TextStyle;

  details?: React.ReactNode; // línea extra (saldos, etc.)
  footer?: React.ReactNode;  // nota / tercera línea

  right?: React.ReactNode;   // importe u otro bloque

  containerStyle?: ViewStyle;
  showDivider?: boolean;
};

export const ListRow: React.FC<Props> = ({
  left,
  title,
  titleStyle,
  subtitle,
  subtitleStyle,
  details,
  footer,
  right,
  containerStyle,
  showDivider = true,
}) => {
  return (
    <View style={[styles.row, showDivider && styles.divider, containerStyle]}>
      {left ? <View style={styles.left}>{left}</View> : null}

      <View style={styles.center}>
        <View style={styles.topLine}>
          <Text style={[styles.title, titleStyle]} numberOfLines={1}>
            {title}
          </Text>

          {right ? <View style={styles.right}>{right}</View> : null}
        </View>

        {subtitle ? (
          <Text style={[styles.subtitle, subtitleStyle]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}

        {details ? <View style={styles.details}>{details}</View> : null}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  left: {
    width: 38,
    alignItems: 'flex-start',
    paddingTop: 2,
    marginRight: 8,
  },
  center: {
    flex: 1,
  },
  topLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  right: {
    marginLeft: 8,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  details: {
    marginTop: 2,
  },
  footer: {
    marginTop: 2,
  },
});
