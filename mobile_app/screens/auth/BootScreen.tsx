// screens/auth/BootScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Text,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "../../components/layout/Screen";
import { colors, spacing, radius } from "../../theme";
import { useAuth } from "../../context/AuthContext";
import { getApiBaseUrl } from "../../services/api";

/**
 * BootScreen
 * ----------
 * Pantalla de arranque “profesional”:
 * - Mismo diseño que LoginScreen (logo, family, card)
 * - En lugar de inputs, muestra progreso + estado del backend
 *
 * Objetivo:
 * - Evitar que el usuario llegue al Login/Main con el backend dormido (Render free).
 * - Mostrar una experiencia guiada: “despertando backend”, “validando BD”, etc.
 *
 * Funcionamiento:
 * 1) Fase A: /health OK  -> el servidor está vivo
 * 2) Fase B: /ready OK   -> servidor + DB OK (alias de /api/health)
 * 3) Fase C: sesión lista (SecureStore leído) para decidir Login/Main
 */
export const BootScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isHydrating } = useAuth();

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Inicializando…");
  const [failed, setFailed] = useState(false);

  // Para mostrar un motivo de fallo legible
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Evita setState si desmontan la pantalla durante un reset de navegación
  const mountedRef = useRef(true);

  // “Fondo suave” como en Login (lo dejé listo por si lo vuelves a usar)
  const primarySoft = useMemo(() => {
    return "#F3FBFA";
  }, []);

  /**
   * Helpers: sleep + fetch con timeout
   */
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const fetchWithTimeout = async (url: string, timeoutMs: number) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache" },
      });
      return res;
    } finally {
      clearTimeout(t);
    }
  };

  /**
   * Polling robusto:
   * - Reintenta hasta totalMs
   * - Incrementa el intervalo gradualmente (backoff)
   */
  const pollOk = async (
    url: string,
    opts?: {
      totalMs?: number;
      initialIntervalMs?: number;
      maxIntervalMs?: number;
      requestTimeoutMs?: number;
    }
  ): Promise<boolean> => {
    const totalMs = opts?.totalMs ?? 60_000;
    let intervalMs = opts?.initialIntervalMs ?? 900;
    const maxIntervalMs = opts?.maxIntervalMs ?? 4_000;
    const requestTimeoutMs = opts?.requestTimeoutMs ?? 4_000;

    const start = Date.now();

    while (Date.now() - start < totalMs) {
      try {
        const res = await fetchWithTimeout(url, requestTimeoutMs);
        if (res.ok) return true;
      } catch {
        // Normal durante wake-up o sin conexión
      }

      await sleep(intervalMs);
      intervalMs = Math.min(maxIntervalMs, Math.floor(intervalMs * 1.25));
    }

    return false;
  };

  /**
   * Progreso por hitos (recomendado):
   * - No existe “% real” de Render, pero sí hay estados medibles.
   * - Asignamos porcentajes a cada estado, y avanzamos al cumplirlos.
   *
   * Nota UX:
   * - No hacemos animación “suavizada” aquí para mantenerlo simple y fiable.
   *   Si quieres, luego añadimos un “smoother” para que la barra no salte.
   */
  const runBoot = useCallback(async () => {
    setFailed(false);
    setErrorDetail(null);
    setProgress(0);

    const base = String(getApiBaseUrl() || "").replace(/\/+$/, "");
    if (!base) {
      setFailed(true);
      setStatus("Falta configuración de API.");
      setErrorDetail("EXPO_PUBLIC_API_URL no está configurada.");
      return;
    }

    // URLs objetivo: preferimos /health y /ready (nuevos/claros)
    // Aun así, mantenemos compatibilidad con tu /api/health (existente).
    const urlHealth = `${base}/health`;
    const urlReadyPrimary = `${base}/ready`;
    const urlReadyFallback = `${base}/api/health`;

    try {
      setStatus("Preparando…");
      setProgress(5);

      // Fase 1: servidor vivo
      setStatus("Despertando backend…");
      setProgress(15);

      const okHealth = await pollOk(urlHealth, { totalMs: 60_000 });
      if (!okHealth) {
        throw new Error(
          `No responde /health. Puede estar dormido en Render o no hay conexión.\nURL: ${urlHealth}`
        );
      }
      if (!mountedRef.current) return;
      setProgress(45);

      // Fase 2: servidor + DB OK (ready)
      setStatus("Validando base de datos…");
      setProgress(55);

      // Intentamos /ready (nuevo). Si no existe (404), probamos /api/health.
      let okReady = await pollOk(urlReadyPrimary, { totalMs: 30_000 });
      if (!okReady) {
        okReady = await pollOk(urlReadyFallback, { totalMs: 30_000 });
      }

      if (!okReady) {
        throw new Error(
          `No responde /ready (ni /api/health). El backend puede estar arriba, pero la BD no está accesible.\nURLs:\n- ${urlReadyPrimary}\n- ${urlReadyFallback}`
        );
      }
      if (!mountedRef.current) return;
      setProgress(85);

      // Fase 3: esperar a que AuthContext termine de leer SecureStore
      setStatus("Preparando sesión…");
      const t0 = Date.now();
      while (mountedRef.current && isHydrating && Date.now() - t0 < 6_000) {
        await sleep(120);
      }
      if (!mountedRef.current) return;
      setProgress(100);

      // Decisión final:
      // - Si hay token (isAuthenticated), vamos a Main
      // - Si no, vamos a Login
      if (isAuthenticated) {
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } else {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setFailed(true);
      setStatus("No se pudo iniciar la app.");
      setErrorDetail(typeof e?.message === "string" ? e.message : "Error desconocido");
      // Si fallamos, dejamos progreso donde esté (para diagnóstico visual)
    }
  }, [isAuthenticated, isHydrating, navigation]);

  useEffect(() => {
    mountedRef.current = true;
    void runBoot();
    return () => {
      mountedRef.current = false;
    };
  }, [runBoot]);

  return (
    <Screen>
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
        {/* Header suave (igual que Login) */}
        <View style={[styles.headerSoft, { backgroundColor: "#FFFFFF" }]} />

        {/* Logo (igual que Login) */}
        <View style={styles.logoWrap}>
          <Image
            source={require("../../assets/brand/logotipo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* Family (igual que Login) */}
        <View style={styles.familyWrap}>
          <Image
            source={require("../../assets/brand/family.png")}
            style={styles.family}
            resizeMode="contain"
          />
        </View>

        {/* Card de carga (misma card, distinto contenido) */}
        <View style={styles.card}>
          <Text style={styles.title}>Iniciando aplicación</Text>
          <Text style={styles.subtitle}>{status}</Text>

          {/* Barra */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{progress}%</Text>
            {!failed ? <ActivityIndicator /> : null}
          </View>

          {/* Error detail (solo si falla) */}
          {failed ? (
            <>
              <Text style={styles.errorText}>
                No se ha podido conectar. Si Render estaba dormido, el primer arranque puede tardar.
              </Text>

              {errorDetail ? (
                <Text style={styles.errorDetailText} numberOfLines={6}>
                  {errorDetail}
                </Text>
              ) : null}

              <TouchableOpacity
                style={styles.button}
                onPress={() => void runBoot()}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonText}>Reintentar</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flexGrow: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.lg,
  },

  headerSoft: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },

  logoWrap: {
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  logo: {
    width: "100%",
    maxWidth: 420,
    height: 120,
  },

  familyWrap: {
    alignItems: "center",
    marginTop: -6,
    marginBottom: spacing.md,
  },

  family: {
    width: "100%",
    maxWidth: 420,
    height: 240,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },

  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },

  progressTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#EEF2F4",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },

  progressFill: {
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  progressRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  progressText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  errorText: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
  },

  errorDetailText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },

  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: "center",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
});
