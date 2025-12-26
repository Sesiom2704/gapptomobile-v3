// navigation/navigationRef.ts
import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

/**
 * navigationRef
 * -------------
 * Permite navegar/RESET desde fuera de componentes React (por ejemplo desde AuthContext).
 *
 * Caso de uso principal:
 * - Si el backend devuelve 401 -> logout() -> reset a Login desde cualquier pantalla.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function resetToLogin() {
  if (!navigationRef.isReady()) return;

  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: "Login" }],
    })
  );
}

export function resetToBoot() {
  if (!navigationRef.isReady()) return;

  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: "Boot" }],
    })
  );
}

export function resetToMain() {
  if (!navigationRef.isReady()) return;

  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: "Main" }],
    })
  );
}
