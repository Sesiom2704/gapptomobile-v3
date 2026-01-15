/**
 * Archivo: mobile_app/navigation/PrestamosStacks.tsx
 *
 * Responsabilidad:
 *   - Define el stack de navegación de Préstamos (listado, detalle y formulario).
 *   - Centraliza los tipos de params (TypeScript) para evitar “any” en screens.
 *   - Mantiene la convención del proyecto: header nativo oculto (se usa Header propio).
 *
 * ✅ Mejora (returnTo):
 *   - Permite que PrestamosList reciba un "returnToTab/returnToScreen" para volver
 *     al origen correcto (por ejemplo, si vienes desde Home, volver a Home).
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
import PrestamosListScreen from '../screens/prestamos/PrestamosListScreen';
import PrestamosDetalleScreen from '../screens/prestamos/PrestamosDetalleScreen';
import PrestamoFormScreen from '../screens/prestamos/PrestamoFormScreen';

export type EstadoFiltro = 'ACTIVOS' | 'VENCEN_MES' | 'CANCELADOS' | 'INACTIVOS';

/**
 * Params "returnTo":
 * - returnToTab: nombre del tab raíz (HomeTab, PatrimonyTab, etc.)
 * - returnToScreen: screen raíz dentro de ese tab (HomeScreen, PatrimonyHomeScreen, etc.)
 *
 * Nota: dejamos string para no acoplar este stack a MainTabsParamList y evitar imports cruzados.
 */
export type ReturnToParams = {
  fromHome?: boolean;
  returnToTab?: string;     // e.g. 'HomeTab'
  returnToScreen?: string;  // e.g. 'HomeScreen'
};

export type PrestamosStackParamList = {
  PrestamosList:
    | ({
        /**
         * Filtro inicial al entrar (opcional).
         * Si vienes desde Endeudamiento, lo normal es 'ACTIVOS'.
         */
        initialFiltro?: EstadoFiltro;
      } & ReturnToParams)
    | undefined;

  PrestamoDetalle: {
    prestamoId: string;
  };

  PrestamoForm: {
    prestamoId?: string | null;
  };
};

const Stack = createNativeStackNavigator<PrestamosStackParamList>();

const PrestamosStackNavigator: React.FC = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PrestamosList" component={PrestamosListScreen} />
      <Stack.Screen name="PrestamoDetalle" component={PrestamosDetalleScreen} />
      <Stack.Screen name="PrestamoForm" component={PrestamoFormScreen} />
    </Stack.Navigator>
  );
};

export default PrestamosStackNavigator;
