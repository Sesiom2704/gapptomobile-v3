/**
 * Ruta: mobile_app/navigation/PropiedadesStack.tsx
 * Versión: 4.2.0
 * Descripción:
 * Stack de navegación del módulo de patrimonio / propiedades / contratos / incidencias.
 *
 * Funcionalidades incluidas:
 * - Mantiene navegación existente de propiedades.
 * - Mantiene navegación existente de contratos.
 * - Añade soporte a detalle de incidencias.
 * - Elimina la dependencia provisional de gestorPersonaId en navegación.
 *
 * Notas de diseño:
 * - Se reutiliza el stack actual sin reestructurar navegación global.
 * - La pantalla ContratoList actúa como punto de entrada mixto para contratos e incidencias.
 * - La autenticación y autorización del módulo incidencias se resuelven por usuario logueado en backend.
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
import IncidenciaDetalleScreen from '../screens/Alquiler/IncidenciaDetalleScreen';

export type PropiedadesStackParamList = {
  PropiedadesRanking: undefined;

  PropiedadForm: { patrimonioId?: string } | undefined;

  PropiedadDetalle: {
    patrimonioId: string;
  };

  PropiedadKpis: {
    patrimonioId: string;
  };

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  /**
   * Pantalla mixta de contratos + incidencias.
   * Ya no necesita gestorPersonaId en navegación.
   */
  ContratoList: undefined;

  /**
   * Formulario de contrato.
   * - Se reutiliza para alta y edición.
   * - Puede volver al screen de origen mediante returnToScreen/returnParams.
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

  /**
   * Detalle de incidencia.
   * - incidenciaId es obligatorio.
   * - contratoId y patrimonioId ayudan a contexto y navegación de retorno.
   * - incidencia opcional permite pasar snapshot inicial si ya existe en listado.
   */
  IncidenciaDetalle: {
    incidenciaId: string;
    contratoId?: string;
    patrimonioId?: string;
    incidencia?: any;
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

      <Stack.Screen
        name="ContratoList"
        component={ContratoListScreen}
        options={{ title: 'Contratos e incidencias' }}
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

      <Stack.Screen
        name="IncidenciaDetalle"
        component={IncidenciaDetalleScreen}
        options={{ title: 'Detalle incidencia' }}
      />
    </Stack.Navigator>
  );
};

export default PropiedadesStack;