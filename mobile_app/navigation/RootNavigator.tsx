// navigation/RootNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MainTabs from './MainTabs';

export type RootStackParamList = {
  Main: undefined;
  // Aquí en el futuro podríamos añadir Login, Onboarding, etc.
};

const RootStack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC = () => {
  return (
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <RootStack.Screen name="Main" component={MainTabs} />
    </RootStack.Navigator>
  );
};

export default RootNavigator;
