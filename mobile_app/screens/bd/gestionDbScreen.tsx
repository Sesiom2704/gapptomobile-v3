/**
 * Ruta: mobile_app/screens/bd/gestionDbScreen.tsx
 * Versión: 1.0.0
 * Descripción:
 * Pantalla de gestión manual de base de datos y sincronizaciones para GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Permite seleccionar la base activa de la app entre Supabase y Neon.
 * - Guarda la base activa en SecureStore.
 * - Permite lanzar sincronizaciones manuales entre Neon, Supabase y Sheets.
 * - Soporta dry-run y ejecución real.
 * - Soporta modo destructivo controlado.
 * - Consulta el estado del job por polling.
 * - Permite cancelar un job en curso.
 * - Muestra progreso, tabla actual y log desplegable.
 * - Incluye ping de backend para depuración.
 *
 * Ajustes de esta versión:
 * - Se refuerzan validaciones antes de lanzar sincronización.
 * - Se mejora la limpieza del polling para evitar estados colgados.
 * - Se evita relanzar un job manual si ya hay uno en curso.
 * - Se mantienen logs de depuración y comportamiento funcional existente.
 *
 * Notas de diseño:
 * - La pantalla sigue siendo manual y operativa, útil para pruebas y soporte.
 * - Se prioriza la claridad del estado del job y la prevención de acciones conflictivas.
 * - El polling sigue siendo simple para no añadir complejidad innecesaria.
 * - Se mantiene compatibilidad con el backend actual de sincronización.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import Header from "../../components/layout/Header";
import { panelStyles } from "../../components/panels/panelStyles";
import { colors } from "../../theme/colors";
import { api } from "../../services/api";

// Habilitar animaciones en Android (para desplegables)
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type DBKey = "supabase" | "neon";
type EndpointDB = "neon" | "supabase" | "sheets";
type JobStatus = "idle" | "queued" | "running" | "done" | "error" | "canceled";

const DEBUG_DB = true;
const POLL_INTERVAL_MS = 900;

function debug(...args: any[]) {
  if (!DEBUG_DB) return;
  console.log("[GestionDb]", ...args);
}

function safeJson(x: any) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function extractAxiosError(e: any) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const detail = data?.detail ?? data;
  const message = e?.message;
  return { status, data, detail, message };
}

async function startSyncJob(payload: {
  source: EndpointDB;
  dest: EndpointDB;
  execute: boolean;
  allow_destructive: boolean;
  tables?: string[] | null;
  exclude?: string[] | null;
}) {
  return api.post("/api/db/sync/start", payload);
}

async function fetchSyncStatus(jobId: string) {
  return api.get(`/api/db/sync/${jobId}`);
}

async function cancelSyncJob(jobId: string) {
  return api.post(`/api/db/sync/${jobId}/cancel`);
}

function Pill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.pill,
        active ? styles.pillActive : styles.pillInactive,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ToggleRow({
  title,
  description,
  value,
  onToggle,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={disabled ? undefined : onToggle}
      style={[styles.toggleRow, disabled ? { opacity: 0.6 } : null]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {!!description && <Text style={styles.toggleDesc}>{description}</Text>}
      </View>

      <View style={[styles.toggleTrack, value ? styles.toggleTrackOn : styles.toggleTrackOff]}>
        <View style={[styles.toggleThumb, value ? styles.toggleThumbOn : styles.toggleThumbOff]} />
      </View>
    </TouchableOpacity>
  );
}

function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
  tone = "primary",
}: {
  label: string;
  onPress?: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "danger";
}) {
  const isDisabled = disabled || busy;

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={isDisabled ? undefined : onPress}
      style={[
        styles.primaryBtn,
        tone === "danger" ? styles.primaryBtnDanger : styles.primaryBtnPrimary,
        isDisabled ? { opacity: 0.6 } : null,
      ]}
    >
      {busy ? <ActivityIndicator /> : <Text style={styles.primaryBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function Badge({ text, tone }: { text: string; tone: "info" | "ok" | "warn" | "err" }) {
  const bg =
    tone === "ok"
      ? colors.success
      : tone === "err"
        ? colors.danger
        : tone === "warn"
          ? "#f59e0b"
          : colors.primary;

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, progress || 0));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

export default function GestionDbScreen() {
  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reqIdRef = useRef<string>("");

  const [currentDb, setCurrentDb] = useState<DBKey>("supabase");

  const [syncSrc, setSyncSrc] = useState<EndpointDB>("neon");
  const [syncDst, setSyncDst] = useState<EndpointDB>("supabase");
  const [syncExecute, setSyncExecute] = useState(false);
  const [syncDestructive, setSyncDestructive] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [currentTable, setCurrentTable] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const dbOptions = useMemo(
    () => [
      { key: "supabase" as DBKey, label: "Supabase", hint: "pooler" },
      { key: "neon" as DBKey, label: "Neon", hint: "serverless" },
    ],
    []
  );

  const syncOptions: { key: EndpointDB; label: string; subtitle: string }[] = [
    { key: "neon", label: "Neon", subtitle: "Postgres" },
    { key: "supabase", label: "Supabase", subtitle: "Postgres" },
    { key: "sheets", label: "Sheets", subtitle: "Google" },
  ];

  const isJobBusy = jobStatus === "queued" || jobStatus === "running";
  const canLaunch = !launching && !isJobBusy;

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      debug("poll: clear");
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyDb = useCallback(async (key: DBKey) => {
    debug("applyDb ->", key);
    setCurrentDb(key);

    try {
      await SecureStore.setItemAsync("dbKey", key);
      Alert.alert("Base de datos", `Ahora usas: ${key.toUpperCase()}`);
    } catch (e) {
      debug("applyDb error:", e);
      Alert.alert("Base de datos", "No se pudo guardar la selección.");
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      debug("poll: start", { jobId: id, reqId: reqIdRef.current });
      clearPoll();

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetchSyncStatus(id);
          const d = r.data || {};
          const st = (d.status as JobStatus) || "idle";
          const pr = Number(d.progress || 0);

          debug("poll: tick", {
            reqId: reqIdRef.current,
            jobId: id,
            status: st,
            progress: pr,
            current_table: d.current_table,
          });

          if (!mountedRef.current) {
            clearPoll();
            return;
          }

          setJobStatus(st);
          setProgress(pr);
          setCurrentTable(d.current_table || null);
          setLogTail(d.log_tail || "");

          if (st === "done" || st === "error" || st === "canceled") {
            debug("poll: stop terminal status", st, "error=", d.error);
            clearPoll();
          }
        } catch (e: any) {
          const x = extractAxiosError(e);
          debug("poll: ERROR -> stop", safeJson(x));
          clearPoll();

          if (mountedRef.current) {
            setJobStatus("error");
          }
        }
      }, POLL_INTERVAL_MS);
    },
    [clearPoll]
  );

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const stored = (await SecureStore.getItemAsync("dbKey")) as DBKey | null;
        const effective = stored || "supabase";
        debug("boot: stored dbKey =", stored, "-> effective =", effective);

        if (mountedRef.current) {
          setCurrentDb(effective);
        }
      } catch (e) {
        debug("boot: SecureStore read failed:", e);
        if (mountedRef.current) {
          setCurrentDb("supabase");
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [clearPoll]);

  useEffect(() => {
    (async () => {
      try {
        debug("api.baseURL =", (api.defaults as any)?.baseURL);
        const r = await api.get("/api/db/ping");
        debug("PING OK:", r?.status, r?.data);
      } catch (e: any) {
        const x = extractAxiosError(e);
        debug("PING FAIL:", safeJson(x));
      }
    })();
  }, []);

  const statusTone: "info" | "ok" | "warn" | "err" = useMemo(() => {
    if (jobStatus === "done") return "ok";
    if (jobStatus === "error") return "err";
    if (jobStatus === "canceled") return "warn";
    if (jobStatus === "running" || jobStatus === "queued") return "info";
    return "info";
  }, [jobStatus]);

  const executionHint = useMemo(() => {
    if (!syncExecute) return "Modo simulación: no escribe datos (dry-run).";
    if (syncExecute && !syncDestructive) return "Ejecutará escritura sin cambios destructivos.";
    return "Ejecutará y podrá eliminar estructuras sobrantes en el destino.";
  }, [syncExecute, syncDestructive]);

  const launchSync = useCallback(async () => {
    reqIdRef.current = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    debug("launchSync begin", {
      reqId: reqIdRef.current,
      source: syncSrc,
      dest: syncDst,
      execute: syncExecute,
      allow_destructive: syncDestructive,
    });

    if (!canLaunch) {
      Alert.alert("Sincronización", "Ya hay un proceso en curso.");
      return;
    }

    if (syncSrc === syncDst) {
      Alert.alert("Sincronización", "Origen y destino no pueden ser iguales.");
      return;
    }

    if (!syncExecute && syncDestructive) {
      Alert.alert("Sincronización", "“Destructivo” solo aplica cuando “Ejecutar” está activado.");
      return;
    }

    setLaunching(true);

    try {
      const payload = {
        source: syncSrc,
        dest: syncDst,
        execute: syncExecute,
        allow_destructive: syncDestructive,
      };

      debug("launchSync POST /api/db/sync/start payload=", safeJson(payload));

      const r = await startSyncJob(payload);

      debug("launchSync response", { status: r?.status, data: r?.data });

      const id = (r?.data?.job_id as string) || null;
      if (!id) {
        debug("launchSync: missing job_id. raw=", safeJson(r?.data));
        Alert.alert("Sincronización", "El backend no devolvió job_id. Revisa logs del servidor.");
        return;
      }

      setJobId(id);
      setJobStatus("queued");
      setProgress(0);
      setCurrentTable(null);
      setLogTail("");
      setLogOpen(false);

      startPolling(id);
    } catch (e: any) {
      const x = extractAxiosError(e);
      debug("launchSync ERROR", { reqId: reqIdRef.current, ...x });

      const msg =
        (typeof x.detail === "string" ? x.detail : safeJson(x.detail)) ||
        x.message ||
        "No se pudo iniciar el job";

      Alert.alert("Sincronización", msg);
    } finally {
      setLaunching(false);
      debug("launchSync end", { reqId: reqIdRef.current });
    }
  }, [canLaunch, startPolling, syncDestructive, syncDst, syncExecute, syncSrc]);

  const cancelJob = useCallback(async () => {
    if (!jobId) return;

    debug("cancelJob begin", { reqId: reqIdRef.current, jobId });

    try {
      const r = await cancelSyncJob(jobId);
      debug("cancelJob response", { status: r?.status, data: r?.data });
      Alert.alert("Sincronización", "Cancelación solicitada.");
    } catch (e: any) {
      const x = extractAxiosError(e);
      debug("cancelJob ERROR", safeJson(x));
      Alert.alert("Sincronización", "No se pudo cancelar el job.");
    }
  }, [jobId]);

  const toggleLog = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLogOpen((v) => !v);
  }, []);

  return (
    <>
      <Header title="Importación y copias" subtitle="Sincroniza Neon, Supabase y Google Sheets." showBack />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Base activa (peticiones normales)</Text>
              <Badge text={currentDb.toUpperCase()} tone="info" />
            </View>
            <Text style={styles.cardSubtitle}>
              Selecciona la base de datos principal para las peticiones estándar de la app.
            </Text>

            <View style={styles.pillRow}>
              {dbOptions.map((o) => (
                <Pill
                  key={o.key}
                  label={`${o.label} · ${o.hint}`}
                  active={currentDb === o.key}
                  onPress={() => applyDb(o.key)}
                />
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Sincronización / Copia</Text>
              <Badge
                text={syncExecute ? (syncDestructive ? "EXEC + DESTR" : "EXEC") : "DRY-RUN"}
                tone={syncExecute ? (syncDestructive ? "warn" : "ok") : "info"}
              />
            </View>
            <Text style={styles.cardSubtitle}>
              Define origen y destino. Recomendación: empieza siempre con dry-run.
            </Text>

            <View style={styles.selectorBlock}>
              <Text style={styles.blockLabel}>Origen</Text>
              <View style={styles.pillRow}>
                {syncOptions.map((o) => (
                  <Pill
                    key={`src-${o.key}`}
                    label={`${o.label} · ${o.subtitle}`}
                    active={syncSrc === o.key}
                    onPress={() => setSyncSrc(o.key)}
                    disabled={isJobBusy}
                  />
                ))}
              </View>
            </View>

            <View style={styles.selectorBlock}>
              <Text style={styles.blockLabel}>Destino</Text>
              <View style={styles.pillRow}>
                {syncOptions.map((o) => (
                  <Pill
                    key={`dst-${o.key}`}
                    label={`${o.label} · ${o.subtitle}`}
                    active={syncDst === o.key}
                    onPress={() => setSyncDst(o.key)}
                    disabled={isJobBusy}
                  />
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            <ToggleRow
              title="Ejecutar (escribe datos)"
              description="Si está desactivado, solo simula el plan (dry-run)."
              value={syncExecute}
              onToggle={() => setSyncExecute((v) => !v)}
              disabled={isJobBusy}
            />

            <ToggleRow
              title="Destructivo (permitir limpieza)"
              description="Permite eliminar estructuras sobrantes en el destino."
              value={syncDestructive}
              onToggle={() => setSyncDestructive((v) => !v)}
              disabled={!syncExecute || isJobBusy}
            />

            <Text style={styles.hintText}>{executionHint}</Text>

            <View style={{ height: 10 }} />

            <PrimaryButton
              label={syncExecute ? "Iniciar sincronización" : "Ver plan (dry-run)"}
              onPress={launchSync}
              busy={launching || isJobBusy}
              disabled={!canLaunch}
            />
          </View>

          {jobId && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Estado del proceso</Text>
                <Badge text={jobStatus.toUpperCase()} tone={statusTone} />
              </View>

              <Text style={styles.cardSubtitle}>Job ID: {jobId}</Text>

              <View style={{ marginTop: 8 }}>
                <ProgressBar progress={progress} />
                <View style={styles.progressMetaRow}>
                  <Text style={styles.progressMetaLeft}>Progreso</Text>
                  <Text style={styles.progressMetaRight}>{progress.toFixed(2)}%</Text>
                </View>

                {!!currentTable && (
                  <Text style={styles.tableLine} numberOfLines={1}>
                    Tabla en proceso: <Text style={{ fontWeight: "700" }}>{currentTable}</Text>
                  </Text>
                )}
              </View>

              <View style={{ height: 12 }} />

              <View style={styles.actionsRow}>
                <PrimaryButton
                  label="Cancelar"
                  tone="danger"
                  onPress={cancelJob}
                  disabled={!isJobBusy}
                />
              </View>

              <View style={styles.divider} />

              <TouchableOpacity activeOpacity={0.9} onPress={toggleLog} style={styles.logHeaderRow}>
                <Text style={styles.logTitle}>Log (últimas líneas)</Text>
                <Text style={styles.logToggle}>{logOpen ? "Ocultar" : "Mostrar"}</Text>
              </TouchableOpacity>

              {logOpen && (
                <View style={styles.logBox}>
                  <Text style={styles.logText}>{logTail || "—"}</Text>
                </View>
              )}
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  cardSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  selectorBlock: {
    marginTop: 12,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  pillInactive: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 9.5,
    fontWeight: "700",
  },
  pillTextActive: {
    color: colors.primary,
  },
  pillTextInactive: {
    color: colors.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  toggleDesc: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 999,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: colors.primary,
  },
  toggleTrackOff: {
    backgroundColor: colors.border,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
  },
  toggleThumbOn: {
    backgroundColor: "#fff",
    alignSelf: "flex-end",
  },
  toggleThumbOff: {
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  hintText: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnPrimary: {
    backgroundColor: colors.primary,
  },
  primaryBtnDanger: {
    backgroundColor: colors.danger,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  progressMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  progressMetaLeft: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  progressMetaRight: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "900",
  },
  tableLine: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textSecondary,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  logHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  logToggle: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
  },
  logBox: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 10,
  },
  logText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 11,
    color: colors.textPrimary,
    lineHeight: 15,
  },
});