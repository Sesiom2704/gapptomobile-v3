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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";

import { Screen } from "../../components/layout/Screen";
import { colors, spacing, radius } from "../../theme";
import { useAuth } from "../../context/AuthContext";
import { getApiBaseUrl } from "../../services/api";

/**
 * Keys SecureStore para control de popup y ejecución por slot.
 * - prompt: evita repetir popup el mismo día.
 * - completed_slot: evita sugerir si ya completaste la copia correspondiente a ese slot.
 */
const SS_BACKUP_PROMPT_SEEN_DATE = "backup_prompt_seen_date"; // YYYY-MM-DD
const SS_BACKUP_LAST_COMPLETED_SLOT = "backup_last_completed_slot"; // YYYY-MM-07 | YYYY-MM-14 | YYYY-MM-21 | YYYY-MM-28

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayKeyLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Devuelve slot (1..4) si el día es 7/14/21/28. Si no, null.
 */
function getBackupSlotForDate(d = new Date()): { day: number; slot: 1 | 2 | 3 | 4; slotLabel: string; slotKey: string } | null {
  const day = d.getDate();
  if (day !== 7 && day !== 14 && day !== 21 && day !== 28) return null;
  const slot = (day / 7) as 1 | 2 | 3 | 4;
  const slotLabel = `${slot}/4`;
  const slotKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(day)}`; // YYYY-MM-07
  return { day, slot, slotLabel, slotKey };
}

/**
 * BootScreen
 * ----------
 * Pantalla de arranque con hitos reales:
 * 1) /health -> servidor vivo
 * 2) /ready (o fallback /api/health) -> BD accesible
 * 3) Si hay token -> /api/v1/auth/me -> token válido
 *
 * Extra (Gapptomobile V3):
 * - Si hoy es 7/14/21/28 y estás autenticado -> popup para sugerir copia.
 * - Si aceptas -> abre BackupAuto (dejando Main por debajo).
 */
export const BootScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  console.log("[BOOT] BootScreen mounted");

  const insets = useSafeAreaInsets();
  const { isAuthenticated, isHydrating, token, logout } = useAuth();

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Inicializando…");
  const [failed, setFailed] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const didFinalizeNavRef = useRef(false); // evita dobles navigation.reset

  // Igual que LoginScreen (lo dejo por si más adelante quieres tint suave)
  const primarySoft = useMemo(() => "#F3FBFA", []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Fetch con timeout para no colgar la UI.
   */
  const fetchWithTimeout = async (
    url: string,
    timeoutMs: number,
    extraHeaders?: Record<string, string>
  ) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-cache",
          ...(extraHeaders || {}),
        },
      });
      return res;
    } finally {
      clearTimeout(t);
    }
  };

  /**
   * Polling robusto (Render puede tardar en despertar).
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
        // Normal durante el wake-up o sin conexión
      }

      await sleep(intervalMs);
      intervalMs = Math.min(maxIntervalMs, Math.floor(intervalMs * 1.25));
    }

    return false;
  };

  /**
   * Validación de token:
   * - Si el token es inválido, el backend responderá 401.
   * - En ese caso hacemos logout() y forzamos Login.
   */
  const validateSessionIfToken = async (base: string): Promise<"valid" | "invalid" | "unknown"> => {
    if (!token) return "unknown";

    const meUrl = `${base}/api/v1/auth/me`;
    const authHeader = { Authorization: `Bearer ${token}` };

    try {
      const res = await fetchWithTimeout(meUrl, 6_000, authHeader);

      if (res.status === 401) return "invalid";
      if (res.ok) return "valid";

      if (res.status === 404) {
        console.warn("[BOOT] /api/v1/auth/me no existe. Se omite validación de sesión.");
        return "unknown";
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  };

  /**
   * Decide si toca mostrar popup de copia y lo muestra.
   * Devuelve true si el flujo de navegación queda “gestionado” por el popup (aceptar/rechazar),
   * y por tanto runBoot debe hacer return para no ejecutar navigation.reset adicional.
   */
  const maybeShowBackupPrompt = useCallback(async (): Promise<boolean> => {
    // Solo tiene sentido si vamos a entrar a Main (sesión activa).
    if (!isAuthenticated) return false;

    const slot = getBackupSlotForDate(new Date());
    if (!slot) return false;

    try {
      const today = todayKeyLocal(new Date());

      const [seenDate, completedSlot] = await Promise.all([
        SecureStore.getItemAsync(SS_BACKUP_PROMPT_SEEN_DATE),
        SecureStore.getItemAsync(SS_BACKUP_LAST_COMPLETED_SLOT),
      ]);

      // Si ya se completó este slot, no molestamos.
      if (completedSlot && completedSlot === slot.slotKey) {
        console.log("[BOOT] Backup slot ya completado, no se muestra popup:", completedSlot);
        return false;
      }

      // Si ya se mostró el popup hoy, no insistimos.
      if (seenDate && seenDate === today) {
        console.log("[BOOT] Popup de backup ya mostrado hoy:", seenDate);
        return false;
      }

      // Marcamos como “mostrado hoy” en cuanto decidimos mostrarlo (acepte o rechace, no insistimos).
      await SecureStore.setItemAsync(SS_BACKUP_PROMPT_SEEN_DATE, today);

      // Importante: el popup gestiona la navegación final.
      Alert.alert(
        "Copia de seguridad",
        `Toca copia de seguridad (${slot.slotLabel}).\n\nSi la haces ahora, se copiará:\n- Neon → Supabase\n- Neon → Google Sheets`,
        [
          {
            text: "Ahora no",
            style: "cancel",
            onPress: () => {
              if (didFinalizeNavRef.current) return;
              didFinalizeNavRef.current = true;
              navigation.reset({ index: 0, routes: [{ name: "Main" }] });
            },
          },
          {
            text: "Hacer copia",
            style: "default",
            onPress: () => {
              if (didFinalizeNavRef.current) return;
              didFinalizeNavRef.current = true;
              // Dejamos Main por debajo, y abrimos BackupAuto encima.
              navigation.reset({
                index: 1,
                routes: [{ name: "Main" }, { name: "BackupAuto" }],
              });
            },
          },
        ],
        { cancelable: true }
      );

      return true;
    } catch (e) {
      // Si SecureStore falla, no bloqueamos el arranque.
      console.warn("[BOOT] maybeShowBackupPrompt error:", e);
      return false;
    }
  }, [isAuthenticated, navigation]);

  const runBoot = useCallback(async () => {
    didFinalizeNavRef.current = false;

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

    const urlHealth = `${base}/health`;
    const urlReadyPrimary = `${base}/ready`;
    const urlReadyFallback = `${base}/api/health`;

    try {
      setStatus("Preparando…");
      setProgress(5);

      // 1) Servidor vivo
      setStatus("Despertando backend…");
      setProgress(15);

      const okHealth = await pollOk(urlHealth, { totalMs: 60_000 });
      if (!okHealth) {
        throw new Error(`No responde /health.\nURL: ${urlHealth}`);
      }
      if (!mountedRef.current) return;
      setProgress(45);

      // 2) DB accesible
      setStatus("Validando base de datos…");
      setProgress(55);

      let okReady = await pollOk(urlReadyPrimary, { totalMs: 30_000 });
      if (!okReady) okReady = await pollOk(urlReadyFallback, { totalMs: 30_000 });

      if (!okReady) {
        throw new Error(
          `No responde /ready (ni /api/health).\nURLs:\n- ${urlReadyPrimary}\n- ${urlReadyFallback}`
        );
      }
      if (!mountedRef.current) return;
      setProgress(80);

      // 3) Esperar a que SecureStore termine (AuthContext)
      setStatus("Preparando sesión…");
      const t0 = Date.now();
      while (mountedRef.current && isHydrating && Date.now() - t0 < 6_000) {
        await sleep(120);
      }
      if (!mountedRef.current) return;
      setProgress(88);

      // 4) Si hay token, validarlo
      if (token) {
        setStatus("Validando credenciales…");
        setProgress(92);

        const session = await validateSessionIfToken(base);

        if (session === "invalid") {
          await logout();
          if (!mountedRef.current) return;
          setProgress(100);
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }
      }

      // 5) Final: navegar según estado
      setStatus("Listo");
      setProgress(100);

      if (isAuthenticated) {
        // Intentamos popup de backup antes de entrar a Main (pero la navegación final la hace el popup).
        const handledByPopup = await maybeShowBackupPrompt();
        if (handledByPopup) return;

        if (didFinalizeNavRef.current) return;
        didFinalizeNavRef.current = true;
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } else {
        if (didFinalizeNavRef.current) return;
        didFinalizeNavRef.current = true;
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setFailed(true);
      setStatus("No se pudo iniciar la app.");
      setErrorDetail(typeof e?.message === "string" ? e.message : "Error desconocido");
    }
  }, [isAuthenticated, isHydrating, token, logout, navigation, maybeShowBackupPrompt]);

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
        <View style={[styles.headerSoft, { backgroundColor: "#FFFFFF" }]} />

        <View style={styles.logoWrap}>
          <Image
            source={require("../../assets/brand/logotipo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.familyWrap}>
          <Image
            source={require("../../assets/brand/family.png")}
            style={styles.family}
            resizeMode="contain"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Iniciando aplicación</Text>
          <Text style={styles.subtitle}>{status}</Text>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{progress}%</Text>
            {!failed ? <ActivityIndicator /> : null}
          </View>

          {failed ? (
            <>
              <Text style={styles.errorText}>
                No se ha podido conectar. Si Render estaba dormido, el primer arranque puede tardar.
              </Text>

              {errorDetail ? (
                <Text style={styles.errorDetailText} numberOfLines={8}>
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
