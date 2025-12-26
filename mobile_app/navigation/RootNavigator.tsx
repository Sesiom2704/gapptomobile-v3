// navigation/RootNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabs from "./MainTabs";
import { BootScreen } from "../screens/auth/BootScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";
import type { RootStackParamList } from "./types";

/**
 * RootStack: flujo global
 * - Boot: wake-up del backend + checks
 * - Login: autenticación
 * - Main: app principal (tabs)
 */
const RootStack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC = () => {
  return (
    <RootStack.Navigator
      initialRouteName="Boot"
      screenOptions={{ headerShown: false }}
    >
      <RootStack.Screen name="Boot" component={BootScreen} />
      <RootStack.Screen name="Login" component={LoginScreen} />
      <RootStack.Screen name="Main" component={MainTabs} />
    </RootStack.Navigator>
  );
};

export default RootNavigator;
