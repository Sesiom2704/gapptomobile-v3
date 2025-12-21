// navigation/IngresosStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import IngresoListScreen from "../screens/ingresos/IngresoListScreen";
import NuevoIngresoScreen from "../screens/ingresos/NuevoIngresoScreen";
import IngresoFormScreen from "../screens/ingresos/IngresoFormScreen";

export type IngresosStackParamList = {
  IngresosList: undefined;
  NuevoIngreso: undefined;
  IngresoForm: {
    ingreso?: Record<string, any>;
    mode?: "gestionable" | "extraordinario";
    readOnly?: boolean;
  };
};

const Stack = createNativeStackNavigator<IngresosStackParamList>();

const IngresosStack: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="IngresosList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="IngresosList" component={IngresoListScreen} />
      <Stack.Screen name="NuevoIngreso" component={NuevoIngresoScreen} />
      <Stack.Screen name="IngresoForm" component={IngresoFormScreen} />
    </Stack.Navigator>
  );
};

export default IngresosStack;
