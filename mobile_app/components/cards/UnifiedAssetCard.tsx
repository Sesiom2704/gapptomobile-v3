/**
 * Archivo: mobile_app/components/cards/UnifiedAssetCard.tsx
 *
 * Cambios solicitados:
 * - Tarjeta SIN bordes redondeados (cuadrada).
 * - Encabezado (barra superior) con color más suave:
 *    - Activa: colors.primarySoft (en vez de colors.primary)
 *    - Inactiva: colors.neutralSoft (gris suave)
 *
 * Nota:
 * - Para mantener coherencia visual, ajusto el color del texto en el header:
 *    - En header suave, texto oscuro (textPrimary/textSecondary) en vez de blanco.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, spacing, radius } from '../../theme';

export type CardRow = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export type UnifiedAssetCardLeading =
  | { kind: 'rank'; value: number }
  | { kind: 'icon'; name: any };

type Props = {
  title: string;
  subtitle?: string;

  /** Cifra del filtro (ej: "7,44%") que aparece a la izquierda de los "..." */
  headerValue?: string;

  /** Activa/inactiva: controla estilo y escala de grises */
  active?: boolean;

  /** Filas label/valor ya formateadas por el screen */
  rows: CardRow[];

  /** Tap en tarjeta (navega a detalle) */
  onPress: () => void;

  /** Botón "..." (ActionSheet u opciones contextuales) */
  onOptionsPress?: () => void;

  /** Opcional: rank o icono en el header */
  leading?: UnifiedAssetCardLeading;
};

function Leading({
  active,
  leading,
}: {
  active: boolean;
  leading?: UnifiedAssetCardLeading;
}) {
  if (!leading) return null;

  // Con header suave, el texto/icono debe ser oscuro.
  const tint = active ? colors.textPrimary : colors.textSecondary;

  if (leading.kind === 'rank') {
    return (
      <View
        style={[
          styles.rankPill,
          {
            borderColor: active ? colors.border : colors.neutral200,
          },
        ]}
      >
        <Text style={[styles.rankText, { color: tint }]}>{leading.value}</Text>
      </View>
    );
  }

  return (
    <Ionicons
      name={leading.name}
      size={16}
      color={tint}
      style={{ marginRight: spacing.xs }}
    />
  );
}

const UnifiedAssetCard = memo(function UnifiedAssetCard({
  title,
  subtitle,
  headerValue,
  active = true,
  rows,
  onPress,
  onOptionsPress,
  leading,
}: Props) {
  // ✅ Header más suave
  const barBg = active ? colors.primarySoft : colors.neutralSoft;

  // ✅ Texto en header suave -> oscuro
  const barText = active ? colors.textPrimary : colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, !active && styles.cardInactive]}
      android_ripple={{ color: colors.neutralSoft }}
    >
      {/* Barra superior */}
      <View style={[styles.headerBar, { backgroundColor: barBg }]}>
        <View style={styles.headerLeft}>
          <Leading active={active} leading={leading} />

          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.title, { color: barText }]}>
              {title}
            </Text>

            {!!subtitle && (
              <Text numberOfLines={1} style={[styles.subtitle, { color: barText }]}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          {!!headerValue && (
            <Text numberOfLines={1} style={[styles.headerValue, { color: barText }]}>
              {headerValue}
            </Text>
          )}

          {!!onOptionsPress && (
            <TouchableOpacity
              onPress={(e) => {
                (e as any)?.stopPropagation?.();
                onOptionsPress();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.optionsBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={barText} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Cuerpo */}
      <View style={styles.body}>
        {rows.map((r, idx) => {
          const isLast = idx === rows.length - 1;
          return (
            <View
              key={`${r.label}-${idx}`}
              style={[styles.row, !isLast && styles.rowDivider]}
            >
              <Text style={[styles.label, !active && styles.muted]}>
                {r.label}
              </Text>

              <Text
                style={[
                  styles.value,
                  r.emphasize && styles.valueEmph,
                  !active && styles.muted,
                ]}
                numberOfLines={2}
              >
                {r.value}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,

    // ✅ CUADRADA: sin bordes redondeados
    borderRadius: 0,

    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  cardInactive: {
    opacity: 0.9,
  },

  headerBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,

    // Separador sutil bajo el header para “marcar” sección
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },

  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.9,
  },

  headerValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  optionsBtn: {
    paddingHorizontal: 2,
  },

  body: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 6,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.neutralSoft,
  },

  label: {
    fontSize: 12,
    color: colors.textSecondary,
    flexShrink: 0,
    width: '45%',
  },
  value: {
    fontSize: 12,
    color: colors.textPrimary,
    textAlign: 'right',
    flex: 1,
  },
  valueEmph: {
    fontWeight: '700',
  },
  muted: {
    color: colors.textMuted,
  },

  rankPill: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: radius.pill, // el “pill” del ranking puede quedarse redondeado aunque la card sea cuadrada
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 11,
    fontWeight: '800',
  },
});

export default UnifiedAssetCard;
