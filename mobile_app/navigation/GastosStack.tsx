// navigation/GastosStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { GastosListScreen } from '../screens/gastos/GastosListScreen';
import { NuevoGastoScreen } from '../screens/gastos/NuevoGastoScreen';
import { GastoGestionableFormScreen } from '../screens/gastos/GastoGestionableFormScreen';
import { GastoCotidianoFormScreen } from '../screens/gastos/GastoCotidianoFormScreen';

// ✅ NUEVO: screen “Reiniciar cierre”
import ReinciarCierreScreen from '../screens/cierres/ReinciarCierreScreen';

export type GastosStackParamList = {
  GastosList:
    | {
        initialFiltro?: 'pendientes' | 'todos' | 'cotidiano';
        fromDiaADia?: boolean;
      }
    | undefined;

  NuevoGasto: undefined;

  GastoGestionableForm:
    | { id?: string; gasto?: any; readOnly?: boolean }
    | undefined;

  GastoCotidianoForm:
    | { id?: string; gasto?: any; readOnly?: boolean }
    | undefined;

  /**
   * ✅ NUEVO:
   * Pantalla para generar/reiniciar el cierre mensual.
   * (No requiere params por ahora; si luego pasas mes/año, tipa aquí.)
   */
  ReinciarCierreScreen: undefined;
};

const Stack = createNativeStackNavigator<GastosStackParamList>();

const GastosStack: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="GastosList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GastosList" component={GastosListScreen} />
      <Stack.Screen name="NuevoGasto" component={NuevoGastoScreen} />

      <Stack.Screen
        name="GastoGestionableForm"
        component={GastoGestionableFormScreen}
      />
      <Stack.Screen
        name="GastoCotidianoForm"
        component={GastoCotidianoFormScreen}
      />

      {/* ✅ NUEVO: acceso directo a la pantalla de Reiniciar Cierre */}
      <Stack.Screen
        name="ReinciarCierreScreen"
        component={ReinciarCierreScreen}
      />
    </Stack.Navigator>
  );
};

export default GastosStack;
