// navigation/RootNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabs from "./MainTabs";
import { BootScreen } from "../screens/auth/BootScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";

/**
 * RootStackParamList
 * ------------------
 * Este Stack define el flujo global:
 * - Boot: pantalla de carga / wake-up del backend
 * - Login: autenticación
 * - Main: navegación principal (tabs)
 *
 * Ventaja:
 * - El arranque queda explícito y mantenible.
 * - Evitas que la app “arranque en Main” antes de que el backend esté listo.
 */
export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Main: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC = () => {
  return (
    <RootStack.Navigator
      initialRouteName="Boot"
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* 1) Arranque controlado */}
      <RootStack.Screen name="Boot" component={BootScreen} />

      {/* 2) Auth */}
      <RootStack.Screen name="Login" component={LoginScreen} />

      {/* 3) App principal */}
      <RootStack.Screen name="Main" component={MainTabs} />
    </RootStack.Navigator>
  );
};

export default RootNavigator;
