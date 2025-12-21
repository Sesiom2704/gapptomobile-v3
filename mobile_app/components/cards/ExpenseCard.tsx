/**
 * Archivo: screens/ingresos/IngresoListScreen.tsx
 *
 * Responsabilidad:
 *   - Listado de ingresos gestionables (pendientes / todos) con navegación a alta/edición/detalle.
 *   - Integración de “Buscador avanzado” con filtros plegables (periodicidad, tipo, estado, pagado, KPI).
 *   - Acciones contextuales por ingreso mediante ActionSheet (cobrar, editar, duplicar, ver detalle, eliminar).
 *
 * Maneja:
 *   - Data fetching: API de ingresos (pendientes / todos) + catálogo de tipos.
 *   - Estado UI: loading/refreshing/error, buscador abierto/cerrado, filtros locales, selección de item.
 *   - UX: confirmaciones (Alert) para cobrar/eliminar y pull-to-refresh.
 *
 * Dependencias clave:
 *   - components/ui: Chip, FilterPill, FilterRow
 *   - components/cards: ExpenseCard
 *   - components/modals: ActionSheet
 *   - services: api, fetchTiposIngreso
 *   - constants: PERIODICIDAD_OPTIONS
 *   - theme: colors + listStyles
 *
 * Reutilización:
 *   - Candidato a externalizar: MEDIO
 *     (patrón “ListScreen + filtros plegables + ActionSheet” repetible, pero con lógica de dominio específica).
 *
 * Notas:
 *   - Evitar hardcodes: usar tokens del theme (spacing/radius/colors) y estilos compartidos (listStyles).
 *   - Los filtros “fijos” en modo pendientes (estado/pagado/KPI) deben bloquear opciones no seleccionadas
 *     sin replicar “disabled visual” en screens (la UI lo resuelve el componente base).
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';

type ExpenseCardProps = {
  title: string;
  category?: string;
  dateLabel?: string;
  amountLabel: string;
  segmentoId?: string | null;
  inactive?: boolean;
  onPress?: () => void;
  onOptionsPress?: () => void;
  iconNameOverride?: string;

  /** Versión usada en GastosListScreen */
  actionIconName?: string;
  onActionPress?: () => void;

  /** Versión usada en IngresoListScreen */
  quickActionIconName?: string;
  onQuickActionPress?: () => void;
};

const getIconForSegmento = (segmentoId?: string | null) => {
  switch (segmentoId) {
    case 'AHO-12345':
      return { name: 'wallet-outline' as const, bg: colors.primarySoft };
    case 'FIN-12345':
      return { name: 'card-outline' as const, bg: colors.primarySoft };
    case 'FOR-12345':
      return { name: 'school-outline' as const, bg: colors.primarySoft };
    case 'OCI-12345':
      return { name: 'game-controller-outline' as const, bg: colors.primarySoft };
    case 'VIVI-12345':
      return { name: 'home-outline' as const, bg: colors.primarySoft };
    case 'GEST-RESTO':
      return { name: 'briefcase-outline' as const, bg: colors.primarySoft };
    case 'COT-12345':
      return { name: 'cart-outline' as const, bg: colors.primarySoft };
    case 'INGRESO':
      return { name: 'trending-up-outline' as const, bg: colors.primarySoft };
    default:
      return { name: 'pricetag-outline' as const, bg: colors.primarySoft };
  }
};

// Columnas fijas para alinear todo el listado
const ACTION_COL_WIDTH = 10; // botón pagar/cobrar
const RIGHT_COL_WIDTH = 91; // importe + ...

export const ExpenseCard: React.FC<ExpenseCardProps> = ({
  title,
  category,
  dateLabel,
  amountLabel,
  segmentoId,
  inactive,
  onPress,
  onOptionsPress,
  iconNameOverride,
  actionIconName,
  onActionPress,
  quickActionIconName,
  onQuickActionPress,
}) => {
  const baseIcon = getIconForSegmento(segmentoId);
  const iconName = (iconNameOverride ?? baseIcon.name) as any;

  // Acción rápida unificada (gastos/ingresos)
  const finalQuickActionHandler = onQuickActionPress ?? onActionPress;
  const finalQuickActionIcon =
    quickActionIconName ?? actionIconName ?? 'cash-outline';
  const showQuickAction = Boolean(finalQuickActionHandler);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      {/* Columna izquierda (flex): icono + textos */}
      <View style={styles.left}>
        <View style={[styles.iconCircle, { backgroundColor: baseIcon.bg }]}>
          <Ionicons name={iconName} size={22} color={colors.primary} />
        </View>

        <View style={styles.texts}>
          <Text style={[styles.title, inactive && styles.titleInactive]} numberOfLines={1}>
            {title}
          </Text>

          {!!category && (
            <Text style={styles.category} numberOfLines={1}>
              {category}
            </Text>
          )}

          {!!dateLabel && (
            <Text style={styles.date} numberOfLines={1}>
              {dateLabel}
            </Text>
          )}
        </View>
      </View>

      {/* Columna central fija: botón pagar/cobrar (alineado en vertical en toda la lista) */}
      <View style={styles.actionCol}>
        {showQuickAction ? (
          <TouchableOpacity
            style={styles.quickAction}
            activeOpacity={0.85}
            onPress={finalQuickActionHandler}
            accessibilityRole="button"
            accessibilityLabel="Acción rápida"
          >
            <Ionicons name={finalQuickActionIcon as any} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          // Placeholder fijo para que NO baile la alineación
          <View style={styles.quickActionPlaceholder} />
        )}
      </View>

      {/* Columna derecha fija: importe + ... */}
      <View style={styles.right}>
        <Text style={styles.amount} numberOfLines={1}>
          {amountLabel}
        </Text>

        {onOptionsPress ? (
          <TouchableOpacity
            onPress={onOptionsPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.moreBtn}
            accessibilityRole="button"
            accessibilityLabel="Más opciones"
          >
            <Text style={styles.more}>•••</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.morePlaceholder} />
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },

  // IZQUIERDA
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0, // clave para que no empuje columnas fijas
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleInactive: {
    color: colors.danger,
  },
  category: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  date: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // COLUMNA ACCIÓN (FIJA)
  actionCol: {
    width: ACTION_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center', // centrado vertical real
    marginLeft: spacing.sm,
  },
  quickAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionPlaceholder: {
    width: 44,
    height: 44,
  },

  // DERECHA (FIJA)
  right: {
    width: RIGHT_COL_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginLeft: spacing.sm,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'right',
  },
  moreBtn: {
    paddingTop: spacing.xs,
  },
  more: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  morePlaceholder: {
    height: 18 + spacing.xs,
  },
});
