/**
 * Archivo: theme/colors.ts
 *
 * Responsabilidad:
 *   - Paleta de colores (tokens) de la aplicación.
 *   - Debe ser la única fuente de verdad para colores usados en UI.
 *
 * Convenciones:
 *   - Nombres semánticos (ej. textPrimary, border, background) en lugar de nombres “de uso puntual”.
 *   - Evitar duplicados (ej. border vs borderColor) para no fragmentar la UI.
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (base del sistema de diseño).
 */

// theme/colors.ts
// Paleta base de la app. Si mañana cambias el verde, lo haces aquí y ya.

export const colors = {
  primary: '#2A9E9F',
  primarySoft: '#E0F7F7',
  primaryStrong: '#1F6D6E',

  background: '#F5F7FA',
  surface: '#FFFFFF',

  border: '#E1E5EB',
  borderColor: '#D1D5DB', // legacy/alias o “borderStrong”

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  // Estados base
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',

  // ✅ Estados soft (fondos claros para tarjetas/badges)
  // Motivo: evita hardcodes de hex en pantallas y unifica el look & feel.
  successSoft: '#ECFDF5',
  warningSoft: '#FFFBEB',
  dangerSoft: '#FEF2F2',

  // Neutrales
  neutralSoft: '#F3F4F6',
  neutral200: '#E5E7EB',

  // Acciones (para ActionSheet/acciones contextuales)
  actionSuccess: '#16a34a',     // “Marcar como pagado”
  actionDanger: '#b91c1c',      // “Eliminar”
  actionWarning: '#eab308',     // “Editar”
  actionNeutral: '#4b5563',     // “Ver detalle”
  actionInfo: '#2563eb',        // “Duplicar” u otras acciones informativas

  // legacy alias (migrar gradualmente)
  backgroundColor: '#E5E7EB',

    // =========================
  // Tarjetas (fondos suaves)
  // =========================
  // Motivo: reglas de negocio -> tokens semánticos (no hex en pantallas).
  cardBgDefault: '#FFFFFF',      // equivalente a surface
  cardBgOmitted: '#F3F4F6',      // neutralSoft
  cardBgInactive: '#FEF2F2',     // dangerSoft
  cardBgPaid: '#ECFDF5',         // successSoft
  cardBgPendingAlt: '#E0F7F7',   // primarySoft (alternativo suave para pendientes especiales)
  cardBgGuest: '#FFFBEB',        // warningSoft (naranjita suave para “invitado”)
  
} as const;
