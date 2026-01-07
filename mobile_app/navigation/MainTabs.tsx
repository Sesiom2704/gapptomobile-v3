// mobile_app/navigation/MainTabs.tsx
// -----------------------------------------------------------------------------
// Navegación principal (Tabs + Stacks)
// - HomeScreen se ha movido a: mobile_app/screens/home/HomeScreen.tsx
// - Este archivo se centra solo en navegación.
// - No se elimina ninguna funcionalidad; solo se separa UI vs navegación.
// -----------------------------------------------------------------------------

import React from 'react';
import { StyleSheet } from 'react-native';
import { NavigatorScreenParams } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';

// Screens (Home ahora externo)
import HomeScreen from '../screens/home/HomeScreen';

import ConfiguracionScreen from '../screens/configuracion/configuracionScreen';
import DiaADiaScreen from '../screens/dia/DiaADiaScreen';
import MesScreen from '../screens/mes/MesScreen';
import ResumenScreen from '../screens/mes/resumenScreen';
import BalanceScreen from '../screens/mes/balanceScreen';
import PatrimonioScreen from '../screens/patrimonio/patrimonioScreen';

import { GastosListScreen } from '../screens/gastos/GastosListScreen';
import { NuevoGastoScreen } from '../screens/gastos/NuevoGastoScreen';
import { GastoCotidianoFormScreen } from '../screens/gastos/GastoCotidianoFormScreen';
import { GastoGestionableFormScreen } from '../screens/gastos/GastoGestionableFormScreen';

import IngresoListScreen from '../screens/ingresos/IngresoListScreen';
import { NuevoIngresoScreen } from '../screens/ingresos/NuevoIngresoScreen';
import IngresoFormScreen from '../screens/ingresos/IngresoFormScreen';

import DayToDayAnalysisScreen from '../screens/dia/DayToDayAnalysisScreen';
import MovimientosScreen from '../screens/dia/MovimientosScreen';
import MovimientosCuentasScreen from '../screens/mes/MovimientosCuentasScreen';
import ExtraordinariosScreen from '../screens/mes/extraordinarios';

import { AuxTablesHomeScreen } from '../screens/auxiliares/AuxTablesHomeScreen';
import { AuxEntityListScreen } from '../screens/auxiliares/AuxEntityListScreen';
import { AuxEntityFormScreen } from '../screens/auxiliares/AuxEntityFormScreen';

import PropiedadesStack from './PropiedadesStack';
import LocalidadFormScreen from '../screens/ubicaciones/LocalidadFormScreen';
import PrestamosStack from './PrestamosStacks';

import CierreListScreen from '../screens/cierres/CierreListScreen';
import CierreDetalleScreen from '../screens/cierres/CierreDetalleScreen';
import CierreKpiScreen from '../screens/cierres/CierreKpiScreen';
import CierreEditScreen from '../screens/cierres/CierreEditScreen';

import { CuentasBancariasListScreen } from '../screens/cuentas/CuentasBancariasListScreen';
import { CuentaBancariaFormScreen } from '../screens/cuentas/CuentaBancariaFormScreen';
import GestionDbScreen from '../screens/bd/gestionDbScreen';
import ReinciarCierreScreen from '../screens/cierres/ReinciarCierreScreen';
import ReiniciarMesScreen from '../screens/cierres/ReiniciarMesScreen';
import ReiniciarMesPreviewScreen from '../screens/cierres/ReiniciarMesPreviewScreen';
import InversionesStack from './InversionesStack';
import DayToDayKpisScreen from '../screens/dia/DayToDayKpisScreen';

// --------------------
// Tipos de navegación
// --------------------

export type MainTabsParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  DayToDayTab: NavigatorScreenParams<DayToDayStackParamList>;
  MonthTab: NavigatorScreenParams<MonthStackParamList>;
  PatrimonyTab: NavigatorScreenParams<PatrimonyStackParamList>;
};

export type HomeStackParamList = {
  HomeScreen: undefined;
  SettingsHomeScreen: undefined;

  AuxTablesHome: undefined;
  AuxEntityList:
    | {
        auxType: string;
        origin?: 'config';
      }
    | undefined;
  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;

        returnTo?: string;
        returnKey?: string;

        auxResult?: {
          type: string;
          item: any;
          key?: string | null;
          mode?: 'created' | 'updated';
        };
      }
    | undefined;

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  CuentasBancariasList: undefined;
  CuentaBancariaForm: undefined;
  DatabaseTools: undefined;
};

export type DayToDayStackParamList = {
  DayToDayHomeScreen: undefined;

  GastosList:
    | {
        initialFiltro?: 'pendientes' | 'todos' | 'cotidiano';
        fromDiaADia?: boolean;
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  IngresosList:
    | {
        fromDiaADia?: boolean;
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  DayToDayAnalysisScreen:
    | {
        fromHome?: boolean;
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MovimientosScreen: undefined;

  NuevoGasto: undefined;

  GastoGestionableForm:
    | {
        id?: string;
        gasto?: any;
        readOnly?: boolean;
        preset?: 'extra';
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  GastoCotidianoForm:
    | {
        id?: string;
        gasto?: any;
        readOnly?: boolean;
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;
        onCreated?: (item: any) => void;
      }
    | undefined;

  NuevoIngreso:
    | {
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  IngresoForm:
    | {
        ingreso?: Record<string, any>;
        mode?: 'gestionable' | 'extraordinario';
        readOnly?: boolean;
        fromHome?: boolean;
        fromDiaADia?: boolean;
      }
    | undefined;

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  DayToDayKpisScreen:
    | {
        fromHome?: boolean;

        pago?: 'TODOS' | 'YO' | 'OTRO';
        view?: 'GENERAL' | 'CATEGORIA';
        categoria?: string | null;
        tipoId?: string | null;

        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;
};

export type MonthStackParamList = {
  MonthHomeScreen: undefined;
  MonthResumenScreen: undefined;

  MonthBalanceScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MonthExtraordinariosScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  MovimientosScreen: {
    year: number;
    month: number;
    cuentaId: string | null;
  };
  MovimientosCuentasScreen: {
    year: number;
    month: number;
    cuentaId: string | null;
  };

  MesHome: undefined;

  // Cierres
  CierreListScreen: undefined;
  CierreKpiScreen: undefined;
  CierreEditScreen: { cierreId: string } | undefined;

  // IMPORTANTE: tu listado navega pasando { cierreId, cierre }
  CierreDetalleScreen: { cierreId: string; cierre?: any };

  ReinciarCierreScreen:
    | {
        returnToTab?: keyof MainTabsParamList;
        returnToScreen?: string;
      }
    | undefined;

  ReiniciarMesScreen: { anio: number; mes: number; cierreId: string | null };
  ReiniciarMesPreviewScreen: { anio: number; mes: number };
};

export type PatrimonyStackParamList = {
  PatrimonyHomeScreen: undefined;
  PropiedadesStack: undefined;

  AuxEntityForm:
    | {
        auxType: string;
        origin?: 'cotidianos' | 'gestionables' | 'ingresos' | 'patrimonio';
        defaultRamaId?: string | null;

        returnTo?: string;
        returnKey?: string;
        returnRouteKey?: string;

        auxResult?: {
          type: string;
          item: any;
          key?: string | null;
          mode?: 'created' | 'updated';
        };
      }
    | undefined;

  LocalidadForm:
    | {
        returnRouteKey?: string;
        returnTo?: string;
        initialSearch?: string;
      }
    | undefined;

  PrestamosStack: undefined;
  InversionesStack: undefined;
};

// --------------------
// Creación de navegadores
// --------------------

const Tab = createBottomTabNavigator<MainTabsParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const DayToDayStack = createNativeStackNavigator<DayToDayStackParamList>();
const MonthStack = createNativeStackNavigator<MonthStackParamList>();
const PatrimonyStack = createNativeStackNavigator<PatrimonyStackParamList>();

// --------------------
// Stacks por pestaña
// --------------------

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeScreen" component={HomeScreen} />
      <HomeStack.Screen name="SettingsHomeScreen" component={ConfiguracionScreen} />
      <HomeStack.Screen name="AuxTablesHome" component={AuxTablesHomeScreen} />
      <HomeStack.Screen name="AuxEntityList" component={AuxEntityListScreen} />
      <HomeStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <HomeStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />
      <HomeStack.Screen name="CuentasBancariasList" component={CuentasBancariasListScreen} />
      <HomeStack.Screen name="CuentaBancariaForm" component={CuentaBancariaFormScreen} />
      <HomeStack.Screen name="DatabaseTools" component={GestionDbScreen} />
    </HomeStack.Navigator>
  );
}

function DayToDayStackNavigator() {
  return (
    <DayToDayStack.Navigator screenOptions={{ headerShown: false }}>
      <DayToDayStack.Screen name="DayToDayHomeScreen" component={DiaADiaScreen} />
      <DayToDayStack.Screen name="MovimientosScreen" component={MovimientosScreen} />

      <DayToDayStack.Screen name="GastosList" component={GastosListScreen} />
      <DayToDayStack.Screen name="IngresosList" component={IngresoListScreen} />

      <DayToDayStack.Screen name="NuevoGasto" component={NuevoGastoScreen} />
      <DayToDayStack.Screen name="GastoGestionableForm" component={GastoGestionableFormScreen} />
      <DayToDayStack.Screen name="GastoCotidianoForm" component={GastoCotidianoFormScreen} />

      <DayToDayStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <DayToDayStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />

      <DayToDayStack.Screen name="NuevoIngreso" component={NuevoIngresoScreen} />
      <DayToDayStack.Screen name="IngresoForm" component={IngresoFormScreen} />

      <DayToDayStack.Screen name="DayToDayAnalysisScreen" component={DayToDayAnalysisScreen} />
      <DayToDayStack.Screen name="DayToDayKpisScreen" component={DayToDayKpisScreen} />
    </DayToDayStack.Navigator>
  );
}

function MonthStackNavigator() {
  return (
    <MonthStack.Navigator screenOptions={{ headerShown: false }}>
      <MonthStack.Screen name="MonthHomeScreen" component={MesScreen} />
      <MonthStack.Screen name="MonthResumenScreen" component={ResumenScreen} />
      <MonthStack.Screen name="MonthBalanceScreen" component={BalanceScreen} />
      <MonthStack.Screen name="MonthExtraordinariosScreen" component={ExtraordinariosScreen} />
      <MonthStack.Screen name="MovimientosScreen" component={MovimientosScreen} />
      <MonthStack.Screen name="MovimientosCuentasScreen" component={MovimientosCuentasScreen} />

      <MonthStack.Screen name="CierreListScreen" component={CierreListScreen} />
      <MonthStack.Screen name="CierreDetalleScreen" component={CierreDetalleScreen} />
      <MonthStack.Screen name="CierreKpiScreen" component={CierreKpiScreen} />
      <MonthStack.Screen name="CierreEditScreen" component={CierreEditScreen} />
      <MonthStack.Screen name="ReinciarCierreScreen" component={ReinciarCierreScreen} />
      <MonthStack.Screen name="ReiniciarMesScreen" component={ReiniciarMesScreen} />
      <MonthStack.Screen name="ReiniciarMesPreviewScreen" component={ReiniciarMesPreviewScreen} />
    </MonthStack.Navigator>
  );
}

function PatrimonyStackNavigator() {
  return (
    <PatrimonyStack.Navigator screenOptions={{ headerShown: false }}>
      <PatrimonyStack.Screen name="PatrimonyHomeScreen" component={PatrimonioScreen} />
      <PatrimonyStack.Screen name="PropiedadesStack" component={PropiedadesStack} />
      <PatrimonyStack.Screen name="AuxEntityForm" component={AuxEntityFormScreen} />
      <PatrimonyStack.Screen name="LocalidadForm" component={LocalidadFormScreen} />
      <PatrimonyStack.Screen name="PrestamosStack" component={PrestamosStack} />
      <PatrimonyStack.Screen name="InversionesStack" component={InversionesStack} />
    </PatrimonyStack.Navigator>
  );
}

// --------------------
// Bottom Tabs principal
// --------------------

const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: string;

          if (route.name === 'HomeTab') iconName = 'home-outline';
          else if (route.name === 'DayToDayTab') iconName = 'pulse-outline';
          else if (route.name === 'MonthTab') iconName = 'calendar-number-outline';
          else iconName = 'business-outline';

          return <Ionicons name={iconName as any} size={size + 4} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStackNavigator} options={{ title: 'Inicio' }} />

      <Tab.Screen
        name="DayToDayTab"
        component={DayToDayStackNavigator}
        options={{ title: 'Día a día' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('DayToDayTab', { screen: 'DayToDayHomeScreen' });
          },
        })}
      />

      <Tab.Screen name="MonthTab" component={MonthStackNavigator} options={{ title: 'Mes a mes' }} />

      <Tab.Screen
        name="PatrimonyTab"
        component={PatrimonyStackNavigator}
        options={{ title: 'Patrimonio' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabs;
