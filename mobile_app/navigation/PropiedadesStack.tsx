// mobile_app/navigation/PropiedadesStack.tsx

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PropiedadesRankingScreen from '../screens/patrimonio/PropiedadesRankingScreen';
import PropiedadFormScreen from '../screens/patrimonio/PropiedadFormScreen';
import PropiedadDetalleScreen from '../screens/patrimonio/PropiedadDetalleScreen';
import PropiedadKpisScreen from '../screens/patrimonio/PropiedadKpisScreen';
import LocalidadFormScreen from '../screens/ubicaciones/LocalidadFormScreen';

export type PropiedadesStackParamList = {
  PropiedadesRanking: undefined;
  PropiedadForm: { patrimonioId?: string } | undefined; // sin id => alta
  PropiedadDetalle: { patrimonioId: string };
  PropiedadKpis: { patrimonioId: string };
  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;  
};

const Stack = createNativeStackNavigator<PropiedadesStackParamList>();

const PropiedadesStack: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="PropiedadesRanking"
      screenOptions={{
        headerShown: false,
        headerTitleAlign: 'center',
      }}
    >
      <Stack.Screen
        name="PropiedadesRanking"
        component={PropiedadesRankingScreen}
        options={{ title: 'Propiedades' }}
      />
      <Stack.Screen
        name="PropiedadForm"
        component={PropiedadFormScreen}
        options={{ title: 'Alta / Edición' }}
      />
      <Stack.Screen
        name="PropiedadDetalle"
        component={PropiedadDetalleScreen}
        options={{ title: 'Detalle' }}
      />
      <Stack.Screen
        name="PropiedadKpis"
        component={PropiedadKpisScreen}
        options={{ title: 'KPIs' }}
      />

      <Stack.Screen
        name="LocalidadForm" 
        component={LocalidadFormScreen}
        options={{ title: 'Nueva Localidad' }} 
      />
    </Stack.Navigator>
  );
};

export default PropiedadesStack;
