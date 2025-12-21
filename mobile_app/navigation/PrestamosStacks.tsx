/**
 * Archivo: mobile_app/navigation/PrestamosStacks.tsx
 *
 * Responsabilidad:
 *   - Define el stack de navegación de Préstamos (listado, detalle y formulario).
 *   - Centraliza los tipos de params (TypeScript) para evitar “any” en screens.
 *   - Mantiene la convención del proyecto: header nativo oculto (se usa Header propio).
 *
 * Maneja:
 *   - UI: usa NativeStack sin header (Header custom vive en cada Screen).
 *   - Estado: no aplica (solo composición de navegación).
 *   - Datos: no aplica.
 *   - Navegación:
 *       - PrestamosList -> PrestamoDetalle (prestamoId)
 *       - PrestamosList -> PrestamoForm (nuevo)
 *       - PrestamoDetalle -> PrestamoForm (editar)
 *
 * Entradas / Salidas:
 *   - Props: no aplica
 *   - route.params:
 *       - PrestamoDetalle: { prestamoId: string }
 *       - PrestamoForm: { prestamoId?: string | null }
 *
 * Dependencias clave:
 *   - @react-navigation/native-stack
 *   - Screens: screens/prestamos/*
 *
 * Reutilización:
 *   - Candidato a externalizar: BAJO (stack específico de feature).
 *   - Riesgos: nombres de rutas deben coincidir con los navigate() de las pantallas.
 *
 * Notas de estilo:
 *   - Mantener screenOptions={{ headerShown: false }} como en MainTabs.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
// IMPORTANTE: respeta EXACTAMENTE el nombre de archivo real (case-sensitive).
import PrestamosListScreen from '../screens/prestamos/PrestamosListScreen';
import PrestamosDetalleScreen from '../screens/prestamos/PrestamosDetalleScreen';
import PrestamoFormScreen from '../screens/prestamos/PrestamoFormScreen';

export type PrestamosStackParamList = {
  PrestamosList: undefined;

  PrestamoDetalle: {
    prestamoId: string;
  };

  PrestamoForm: {
    prestamoId?: string | null;
  };
};

const Stack = createNativeStackNavigator<PrestamosStackParamList>();

/**
 * NOTA CLAVE (bug corregido):
 *   - En tu versión anterior había un import circular:
 *       `import PrestamosStack from './PrestamosStacks';`
 *     Eso se importa a sí mismo y rompe el bundler/TypeScript.
 *
 * Este componente DEBE exportarse una sola vez, sin auto-import.
 */
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
