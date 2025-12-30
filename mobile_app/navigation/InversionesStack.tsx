// mobile_app/navigation/InversionesStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import InversionesScreen from '../screens/inversiones/InversionesScreen';
import InversionesRankingScreen from '../screens/inversiones/InversionesRankingScreen';
import InversionFormScreen from '../screens/inversiones/InversionFormScreen';

// Si luego añadimos detalle:
// import InversionDetalleScreen from '../screens/inversiones/InversionDetalleScreen';

export type InversionesStackParamList = {
  InversionesHome: undefined;
  InversionesRanking: undefined;
  InversionForm:
    | {
        mode?: 'create' | 'edit';
        inversionId?: string;
        readOnly?: boolean;
      }
    | undefined;

  // InversionDetalle: { inversionId: string } | undefined;
};

const Stack = createNativeStackNavigator<InversionesStackParamList>();

export default function InversionesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="InversionesHome" component={InversionesScreen} />
      <Stack.Screen name="InversionesRanking" component={InversionesRankingScreen} />
      <Stack.Screen name="InversionForm" component={InversionFormScreen} />
      {/* <Stack.Screen name="InversionDetalle" component={InversionDetalleScreen} /> */}
    </Stack.Navigator>
  );
}
