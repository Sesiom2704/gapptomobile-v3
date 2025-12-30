// screens/auth/LoginScreen.tsx
import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Text,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native'; // ✅ FIX: poder resetear navegación tras login

import { Screen } from '../../components/layout/Screen';
import { colors, spacing, radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();

  // ✅ FIX: navegación para resetear el stack después del login
  // Usamos `any` para no romper tipado si no tienes el RootStackParamList tipado.
  const navigation = useNavigation<any>();

  // ✅ Credenciales por defecto SOLO en desarrollo
  // Sustituye por tus valores
  const DEFAULT_EMAIL = __DEV__ ? 'moises.gomariz@gmail.com' : '';
  const DEFAULT_PASSWORD = __DEV__ ? '589140' : '';

  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primarySoft = useMemo(() => {
    // Si más adelante quieres un tint suave del primary, cambia aquí.
    return '#F3FBFA';
  }, []);

  /**
   * handleSubmit
   * ------------
   * 1) Valida inputs
   * 2) Ejecuta login() (AuthContext):
   *    - llama backend
   *    - guarda token en SecureStore
   *    - aplica token en axios
   *    - setea user en memoria
   * 3) ✅ FIX: al terminar login OK, resetea navegación a Boot
   *    BootScreen ya hace el "arranque robusto":
   *    - /health
   *    - /ready o /api/health
   *    - si token: /api/v1/auth/me (si existe)
   *    - finalmente decide Main vs Login
   *
   * Esto evita el bug de "me logeo y no entra al Main hasta que reinicio la app".
   */
  const handleSubmit = async () => {
    setError(null);

    // ✅ Si están vacíos (por ejemplo si los borras), en dev vuelve a rellenar automáticamente
    const finalEmail = email || DEFAULT_EMAIL;
    const finalPassword = password || DEFAULT_PASSWORD;

    if (!finalEmail || !finalPassword) {
      setError('Introduce email y contraseña');
      return;
    }

    try {
      setSubmitting(true);

      // 1) Login (guarda token + aplica token + set user)
      await login(finalEmail, finalPassword);

      // ✅ FIX CLAVE:
      // Tras login OK, forzamos pasar por BootScreen para que:
      // - despierte backend (Render/lo que sea)
      // - valide BD
      // - valide token (si aplica)
      // - redirija con navigation.reset() a Main o Login
      //
      // Nota: el nombre "Boot" debe coincidir EXACTAMENTE con tu ruta en el Navigator.
      navigation.reset({ index: 0, routes: [{ name: 'Boot' }] });
    } catch (err) {
      console.error(err);
      setError('No se ha podido iniciar sesión. Revisa tus datos.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.container,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header suave */}
          <View style={[styles.headerSoft, { backgroundColor: '#FFFFFF' }]} />

          {/* Logo */}
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/brand/logotipo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Family */}
          <View style={styles.familyWrap}>
            <Image
              source={require('../../assets/brand/family.png')}
              style={styles.family}
              resizeMode="contain"
            />
          </View>

          {/* Card login */}
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              placeholder="Usuario (email)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!submitting}
              returnKeyType="next"
            />

            <TextInput
              style={[styles.input, { marginTop: spacing.md }]}
              placeholder="Contraseña"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
  },

  headerSoft: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },

  logoWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  // Grande pero sin romper el layout
  logo: {
    width: '100%',
    maxWidth: 420,
    height: 120,
  },

  familyWrap: {
    alignItems: 'center',
    marginTop: -6,
    marginBottom: spacing.md,
  },

  family: {
    width: '100%',
    maxWidth: 420,
    height: 240,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 20,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },

  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },

  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
});
