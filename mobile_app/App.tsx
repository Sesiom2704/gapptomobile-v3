// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from './context/AuthContext';

import MainTabs from './navigation/MainTabs';
import { LoginScreen } from './screens/auth/LoginScreen';
import { Screen } from './components/layout/Screen';
import { colors, spacing } from './theme';

// ✅ AÑADIR ESTO
import { SafeAreaProvider } from 'react-native-safe-area-context';

const RootNavigator: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Iniciando sesión…</Text>
        </View>
      </Screen>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <MainTabs />;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
  },
});
