// mobile_app/navigation/PropiedadesStack.tsx
//
// Stack de navegación de Propiedades / Patrimonio (v3)
//
// Cambios incluidos:
// - Se mantiene la navegación actual sin alterar funcionalidades existentes.
// - Se activan las pantallas del módulo de alquileres/contratos.
// - Se mantienen las rutas dentro del mismo stack de patrimonio para respetar
//   el flujo natural: Propiedad -> Contrato -> Participantes.
// - Se corrigen imports según la ruta real elegida:
//     - screens/Alquiler/ContratoCreateScreen
//     - screens/Alquiler/ContratoDetalleScreen
//     - screens/Alquiler/ContratoParticipantesScreen
//
// Pantallas activadas:
//   1) ContratoCreate
//   2) ContratoDetalle
//   3) ContratoParticipantes
//
// Nota:
// - En esta fase la navegación ya queda operativa.
// - La conexión con backend y datos reales se hará en el siguiente paso.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PropiedadesRankingScreen from '../screens/patrimonio/PropiedadesRankingScreen';
import PropiedadFormScreen from '../screens/patrimonio/PropiedadFormScreen';
import PropiedadDetalleScreen from '../screens/patrimonio/PropiedadDetalleScreen';
import PropiedadKpisScreen from '../screens/patrimonio/PropiedadKpisScreen';
import LocalidadFormScreen from '../screens/ubicaciones/LocalidadFormScreen';

import ContratoCreateScreen from '../screens/Alquiler/ContratoCreateScreen';
import ContratoDetalleScreen from '../screens/Alquiler/ContratoDetalleScreen';
import ContratoParticipantesScreen from '../screens/Alquiler/ContratoParticipantesScreen';

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

  // -----------------------------------------
  // Rutas del módulo de alquileres
  // -----------------------------------------

  ContratoCreate: {
    patrimonioId: string;
    contrato?: any;
    readOnly?: boolean;
    duplicate?: boolean;
  };

  ContratoDetalle: {
    patrimonioId: string;
    contratoId: string;
    contrato?: any;
  };

  ContratoParticipantes: {
    patrimonioId: string;
    contratoId: string;
    participantes?: any[];
  };
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

      {/* ==========================================================
          PANTALLAS DEL MÓDULO DE ALQUILER / CONTRATOS
         ========================================================== */}

      <Stack.Screen
        name="ContratoCreate"
        component={ContratoCreateScreen}
        options={{ title: 'Nuevo contrato' }}
      />

      <Stack.Screen
        name="ContratoDetalle"
        component={ContratoDetalleScreen}
        options={{ title: 'Detalle contrato' }}
      />

      <Stack.Screen
        name="ContratoParticipantes"
        component={ContratoParticipantesScreen}
        options={{ title: 'Participantes' }}
      />
    </Stack.Navigator>
  );
};

export default PropiedadesStack;