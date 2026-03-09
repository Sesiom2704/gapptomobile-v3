/**
 * Archivo: mobile_app/navigation/PropiedadesStack.tsx
 * Versión: 4.0.0
 *
 * Responsabilidad:
 * - Stack de navegación del módulo de patrimonio / propiedades / contratos.
 *
 * Cambios:
 * - Añade el nuevo screen global de contratos: ContratoList.
 * - Amplía ContratoCreate con parámetros de retorno al screen de origen.
 * - Mantiene operativas las rutas actuales del módulo de alquileres.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PropiedadesRankingScreen from '../screens/patrimonio/PropiedadesRankingScreen';
import PropiedadFormScreen from '../screens/patrimonio/PropiedadFormScreen';
import PropiedadDetalleScreen from '../screens/patrimonio/PropiedadDetalleScreen';
import PropiedadKpisScreen from '../screens/patrimonio/PropiedadKpisScreen';
import LocalidadFormScreen from '../screens/ubicaciones/LocalidadFormScreen';

import ContratoListScreen from '../screens/Alquiler/ContratoListScreen';
import ContratoCreateScreen from '../screens/Alquiler/ContratoCreateScreen';
import ContratoDetalleScreen from '../screens/Alquiler/ContratoDetalleScreen';
import ContratoParticipantesScreen from '../screens/Alquiler/ContratoParticipantesScreen';

export type PropiedadesStackParamList = {
  PropiedadesRanking: undefined;
  PropiedadForm: { patrimonioId?: string } | undefined;
  PropiedadDetalle: { patrimonioId: string };
  PropiedadKpis: { patrimonioId: string };

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  /**
   * Listado global de contratos.
   */
  ContratoList: undefined;

  /**
   * Formulario de contrato.
   * - Se reutiliza para alta y edición.
   * - Si recibe returnToScreen/returnParams, al guardar vuelve al origen.
   */
  ContratoCreate: {
    patrimonioId: string;
    contrato?: any;
    readOnly?: boolean;
    duplicate?: boolean;

    returnToScreen?: keyof PropiedadesStackParamList;
    returnParams?: Record<string, any>;
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

      {/* =========================================================
          MÓDULO GLOBAL DE CONTRATOS
         ========================================================= */}
      <Stack.Screen
        name="ContratoList"
        component={ContratoListScreen}
        options={{ title: 'Contratos' }}
      />

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