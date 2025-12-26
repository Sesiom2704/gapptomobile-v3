// App.tsx
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "./context/AuthContext";
import RootNavigator from "./navigation/RootNavigator";
import { navigationRef } from "./navigation/navigationRef";

/**
 * App (entrypoint)
 * ----------------
 * - Aquí NO decidimos Main/Login.
 * - El flujo vive en RootNavigator (Boot -> Login/Main).
 * - Conectamos navigationRef para poder resetear a Login desde AuthContext (logout/401).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
