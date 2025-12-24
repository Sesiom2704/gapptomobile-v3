/**
 * Archivo: mobile_app/components/cards/PropertyRankingCard.tsx
 *
 * Responsabilidad:
 *   - Tarjeta reutilizable para listar propiedades en modo “ranking”.
 *   - Layout tabulado: etiquetas y valores alineados en columnas consistentes.
 *   - Muestra la posición del ranking encima del icono.
 *
 * Mejoras:
 *   - Soporta subtítulo opcional (subtitle) bajo el título principal.
 *     Útil para estados como "(INACTIVADA)" con tipografía más pequeña,
 *     sin tener que convertir title en ReactNode.
 *
 * Diseño:
 *   - Fila 1: Título (izq) + KPI (der) + opciones (...)
 *   - Fila 1b (opcional): Subtítulo (debajo del título, a la izquierda)
 *   - Fila 2: Participación (izq) | Sup. const. (der)
 *   - Fila 3: Adquisición (izq)   | Sup. útil (der)
 *   - Fila 4: Valor mercado (izq etiqueta) | valor (der, alineado)
 *   - Fila 5: Dirección a ancho completo (debajo del icono también)
 *
 * Notas:
 *   - Consume tokens del theme; evita hardcodes.
 *   - El tabulado se logra con ancho fijo de etiqueta por columna (izq/der) + alineaciones por celda.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';

type Props = {
  /** Título principal (referencia o id) */
  title: string;

  /**
   * Subtítulo opcional (ej: "(INACTIVADA)").
   * Se renderiza debajo del título, con tipografía más pequeña.
   */
  subtitle?: string;

  /**
   * Si true, aplica un estilo "desactivado" a la tarjeta:
   * - Opacidad reducida
   * - Borde/colores más suaves
   *
   * Nota: no bloquea onPress (eso se decide desde la screen).
   */
  disabledStyle?: boolean;

  /** KPI principal (ej: 8,75%) */
  kpiValue: string;

  /** Posición ranking (ej: 1, 2, 3...) */
  rankPosition: number;

  participacionValue: string; // "100%"
  supConstValue: string; // "41,85 m²"

  adquisicionValue: string; // "30/08/2024"
  supUtilValue: string; // "50,15 m²"

  /**
   * Valor mercado (ej: "95.000 €").
   * (La fecha "a fecha:" la puedes incorporar al string o ampliar la card más adelante)
   */
  valorMercadoValue: string;

  direccion: string;

  onPress?: () => void;
  onOptionsPress?: () => void;

  iconName?: React.ComponentProps<typeof Ionicons>['name'];

  /**
   * Permite inyectar estilos extra desde fuera si hiciera falta
   * sin tocar el layout interno.
   */
  cardStyle?: ViewStyle;
};

export const PropertyRankingCard: React.FC<Props> = ({
  title,
  subtitle,
  disabledStyle = false,
  kpiValue,
  rankPosition,
  participacionValue,
  supConstValue,
  adquisicionValue,
  supUtilValue,
  valorMercadoValue,
  direccion,
  onPress,
  onOptionsPress,
  iconName = 'home-outline',
  cardStyle,
}) => {
  return (
    <TouchableOpacity
      style={[styles.card, disabledStyle ? styles.cardDisabled : null, cardStyle]}
      activeOpacity={0.86}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.topRow}>
        {/* Columna icono: Posición + Icono */}
        <View style={styles.iconCol}>
          <Text style={styles.rankPosText}>{rankPosition}</Text>
          <View style={[styles.iconCircle, disabledStyle ? styles.iconCircleDisabled : null]}>
            <Ionicons name={iconName} size={26} color={colors.primary} />
          </View>
        </View>

        {/* Columna contenido */}
        <View style={styles.body}>
          {/* Fila 1: Título | KPI | ... */}
          <View style={styles.headerRow}>
            <View style={styles.titleCol}>
              <Text style={[styles.title, disabledStyle ? styles.titleDisabled : null]} numberOfLines={1}>
                {title}
              </Text>

              {/* Subtítulo opcional: para "(INACTIVADA)" o similar */}
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <View style={styles.headerRight}>
              <Text style={styles.kpiValue} numberOfLines={1}>
                {kpiValue}
              </Text>

              {onOptionsPress ? (
                <TouchableOpacity
                  onPress={onOptionsPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.optionsBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Opciones"
                >
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Fila 2: Participación | Sup. const. */}
          <View style={styles.twoColRow}>
            <View style={styles.cellLeft}>
              <Text style={styles.labelLeft} numberOfLines={1}>
                Participación:
              </Text>
              <Text style={styles.valueLeft} numberOfLines={1}>
                {participacionValue}
              </Text>
            </View>

            <View style={styles.cellRight}>
              <Text style={styles.labelRight} numberOfLines={1}>
                Sup. const.:
              </Text>
              <Text style={styles.valueRight} numberOfLines={1}>
                {supConstValue}
              </Text>
            </View>
          </View>

          {/* Fila 3: Adquisición | Sup. útil */}
          <View style={styles.twoColRow}>
            <View style={styles.cellLeft}>
              <Text style={styles.labelLeft} numberOfLines={1}>
                Adquisición:
              </Text>
              <Text style={styles.valueLeft} numberOfLines={1}>
                {adquisicionValue}
              </Text>
            </View>

            <View style={styles.cellRight}>
              <Text style={styles.labelRight} numberOfLines={1}>
                Sup. útil:
              </Text>
              <Text style={styles.valueRight} numberOfLines={1}>
                {supUtilValue}
              </Text>
            </View>
          </View>

          {/* Fila 4: Valor mercado (tabulado) */}
          <View style={styles.oneRow}>
            <View style={styles.cellLeft}>
              <Text style={styles.labelLeft} numberOfLines={1}>
                Valor mercado:
              </Text>
            </View>

            <View style={styles.cellRight}>
              <Text style={styles.valueRightStrong} numberOfLines={1}>
                {valorMercadoValue}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Dirección full-width (debajo del icono también) */}
      <Text style={styles.addressFull} numberOfLines={2}>
        {direccion || '—'}
      </Text>
    </TouchableOpacity>
  );
};

const ICON_COL_W = 55;

// Etiqueta izq más ancha; etiqueta der más estrecha para “pegar” superficies al valor
const LABEL_W_LEFT = 65; // Participación / Adquisición / Valor mercado
const LABEL_W_RIGHT = 65; // Sup. const. / Sup. útil

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },

  // Estilo visual para tarjeta “inactiva” (sin deshabilitar interacciones)
  cardDisabled: {
    opacity: 0.7,
    borderColor: colors.borderColor,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  iconCol: {
    width: ICON_COL_W,
    alignItems: 'center',
    paddingRight: spacing.sm,
  },
  rankPosText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleDisabled: {
    borderColor: colors.borderColor,
  },

  body: {
    flex: 1,
    gap: spacing.xs,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  // Columna para título + subtítulo
  titleCol: {
    flex: 1,
    minWidth: 0,
  },

  title: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  titleDisabled: {
    color: colors.textSecondary,
  },

  // Subtítulo más pequeño (ej. "(INACTIVADA)")
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  headerRight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.primary,
  },
  optionsBtn: {
    paddingTop: 0,
  },

  twoColRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 2,
  },

  oneRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },

  // Celdas
  cellLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 0,
    gap: spacing.xs,
  },
  cellRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 0,
    justifyContent: 'flex-end',
    gap: 2, // más pegado a los valores (especialmente superficies)
  },

  // Labels
  labelLeft: {
    width: LABEL_W_LEFT,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  labelRight: {
    width: LABEL_W_RIGHT,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },

  // Values
  valueLeft: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  valueRight: {
    minWidth: 0,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '800',
    textAlign: 'right',
  },
  valueRightStrong: {
    minWidth: 0,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '900',
    textAlign: 'right',
  },

  addressFull: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    textAlign: 'center',
  },
});

export default PropertyRankingCard;
