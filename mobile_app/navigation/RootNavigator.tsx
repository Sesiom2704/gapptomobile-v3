/**
 * Ruta: mobile_app/navigation/RootNavigator.tsx
 * Versión: 2.3.3
 * Descripción:
 * Navegador raíz global de la aplicación.
 *
 * Ajustes:
 * - Se registra la screen global "BackupAuto" dentro del RootStack.
 * - Se mantiene el flujo existente Boot -> Login -> Main.
 * - Se corrige la incoherencia entre el tipado de navegación y las rutas realmente registradas.
 * - Esto permite que BootScreen pueda navegar correctamente a BackupAuto
 *   cuando el usuario acepta realizar la copia automática.
 */

import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabs from "./MainTabs";
import { BootScreen } from "../screens/auth/BootScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";
import BackupAutoScreen from "../screens/bd/BackupAutoScreen";
import type { RootStackParamList } from "./types";

/**
 * RootStack: flujo global
 * - Boot: wake-up del backend + checks
 * - Login: autenticación
 * - Main: app principal (tabs)
 * - BackupAuto: ejecución automática de copias de seguridad
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
      <RootStack.Screen name="BackupAuto" component={BackupAutoScreen} />
    </RootStack.Navigator>
  );
};

export default RootNavigator;