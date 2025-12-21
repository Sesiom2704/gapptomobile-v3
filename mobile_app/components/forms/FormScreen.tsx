/**
 * Archivo: components/forms/FormScreen.tsx
 *
 * Responsabilidad:
 *   - Contenedor estándar de pantallas de formulario:
 *       - Header con back
 *       - Scroll + pull-to-refresh opcional
 *       - Loader opcional
 *       - Footer dentro del scroll (acciones)
 *
 * Maneja:
 *   - UI: Screen, Header, ScrollView, ActivityIndicator
 *   - Estado: ninguno (controlado por props)
 *
 * Notas:
 *   - Expone subtitle para que el Header muestre el modo: alta/edición/consulta, etc.
 */

// mobile_app/components/forms/FormScreen.tsx
import React from 'react';
import { View, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Screen } from '../layout/Screen';
import { Header } from '../layout/Header';
import { formScreenStyles } from './formScreenStyles';
import { colors } from '../../theme';

type Props = {
  title: string;
  subtitle?: string;
  onBackPress: () => void;

  loading?: boolean;

  refreshing?: boolean;
  onRefresh?: () => void;

  children: React.ReactNode;

  footer?: React.ReactNode;
};

export const FormScreen: React.FC<Props> = ({
  title,
  subtitle,
  onBackPress,
  loading = false,
  refreshing = false,
  onRefresh,
  children,
  footer,
}) => {
  return (
    <Screen>
      <Header title={title} subtitle={subtitle} showBack onBackPress={onBackPress} />

      {loading ? (
        <View style={formScreenStyles.loader}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={formScreenStyles.formArea}
          contentContainerStyle={formScreenStyles.formContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
          }
        >
          {children}

          {/* ✅ Footer dentro del scroll */}
          {footer ? <View style={formScreenStyles.footerInScroll}>{footer}</View> : null}
        </ScrollView>
      )}
    </Screen>
  );
};

export default FormScreen;
