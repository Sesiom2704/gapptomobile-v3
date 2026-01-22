// navigation/types.ts

/**
 * Tipos de navegación global (Root Stack).
 *
 * Separamos los types en un fichero independiente para:
 * - Evitar importaciones circulares (RootNavigator <-> navigationRef <-> AuthContext)
 * - Mantener tipado consistente en toda la app
 */
export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Main: undefined;

  /**
   * Screen global (RootStack) para ejecutar copias automáticas:
   * - Neon -> Supabase
   * - Neon -> Google Sheets
   */
  BackupAuto: undefined;
};
