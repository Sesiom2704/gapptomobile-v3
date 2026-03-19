/**
 * Ruta: mobile_app/screens/bd/BackupAutoScreen.tsx
 * Versión: 1.0.0
 * Descripción:
 * Pantalla de ejecución automática de copias para GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Ejecuta copia Neon -> Supabase.
 * - Ejecuta copia Neon -> Google Sheets.
 * - Ejecuta ambos procesos de forma secuencial.
 * - Muestra progreso, tabla actual, estado y errores de cada job.
 * - Muestra logs desplegables de ambos procesos.
 * - Guarda en SecureStore el slot diario completado.
 * - Permite volver a la pantalla principal al finalizar.
 *
 * Ajustes de esta versión:
 * - Se evita repetir el backup automático si el slot del día ya fue completado.
 * - Se refuerza el control de montaje/desmontaje del componente.
 * - Se centralizan helpers de espera y textos de estado.
 * - Se mantiene la ejecución secuencial y conservadora.
 *
 * Notas de diseño:
 * - Esta pantalla no ofrece opciones manuales; está pensada como flujo automático controlado.
 * - Se prioriza estabilidad frente a ejecuciones duplicadas.
 * - El guardado del slot completado no bloquea la UI si falla SecureStore.
 * - Se mantiene compatibilidad con el backend actual de jobs.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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

type EndpointDB = "neon" | "supabase" | "sheets";
type JobStatus = "idle" | "queued" | "running" | "done" | "error" | "canceled";

const SS_BACKUP_LAST_COMPLETED_SLOT = "backup_last_completed_slot"; // YYYY-MM-07 | YYYY-MM-14 | YYYY-MM-21 | YYYY-MM-28

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getSlotKeyForToday(d = new Date()): string | null {
  const day = d.getDate();
  if (day !== 7 && day !== 14 && day !== 21 && day !== 28) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(day)}`;
}

function extractAxiosError(e: any) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const detail = data?.detail ?? data;
  const message = e?.message;
  return { status, data, detail, message };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Decisiones por defecto:
 * - Siempre ejecuta (sin dry-run)
 * - No destructivo por seguridad
 * - Ejecución secuencial
 */
const AUTO_EXECUTE = true;
const AUTO_ALLOW_DESTRUCTIVE = false;
const RUN_SEQUENTIALLY = true;
const JOB_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 900;

// ---------------- UI atoms ----------------
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

function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || busy;
  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={isDisabled ? undefined : onPress}
      style={[styles.primaryBtn, isDisabled ? { opacity: 0.6 } : null]}
    >
      {busy ? <ActivityIndicator /> : <Text style={styles.primaryBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function statusTone(st: JobStatus): "info" | "ok" | "warn" | "err" {
  if (st === "done") return "ok";
  if (st === "error") return "err";
  if (st === "canceled") return "warn";
  if (st === "running" || st === "queued") return "info";
  return "info";
}

type JobUiState = {
  jobId: string | null;
  status: JobStatus;
  progress: number;
  currentTable: string | null;
  logTail: string;
  errorText: string | null;
};

function makeInitialJobState(): JobUiState {
  return {
    jobId: null,
    status: "idle",
    progress: 0,
    currentTable: null,
    logTail: "",
    errorText: null,
  };
}

function getCompletionText(finished: boolean, finishedOk: boolean | null) {
  if (!finished) return null;
  if (finishedOk) return "Procesos completados.";
  return "Proceso finalizado con errores. Revisa el estado.";
}

export default function BackupAutoScreen({ navigation }: { navigation: any }) {
  const mountedRef = useRef(true);
  const startedRef = useRef(false);

  const [job1, setJob1] = useState<JobUiState>(makeInitialJobState()); // Neon -> Supabase
  const [job2, setJob2] = useState<JobUiState>(makeInitialJobState()); // Neon -> Sheets

  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [finishedOk, setFinishedOk] = useState<boolean | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const toggleLog = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLogOpen((v) => !v);
  }, []);

  const isAnyBusy = useMemo(() => {
    const busy1 = job1.status === "queued" || job1.status === "running";
    const busy2 = job2.status === "queued" || job2.status === "running";
    return busy1 || busy2 || running;
  }, [job1.status, job2.status, running]);

  const runSingleJob = useCallback(
    async (
      label: "job1" | "job2",
      payload: { source: EndpointDB; dest: EndpointDB; execute: boolean; allow_destructive: boolean }
    ): Promise<"done" | "error" | "canceled"> => {
      const setJob = label === "job1" ? setJob1 : setJob2;

      if (!mountedRef.current) return "canceled";

      setJob((s) => ({
        ...s,
        status: "queued",
        progress: 0,
        currentTable: null,
        logTail: "",
        errorText: null,
        jobId: null,
      }));

      try {
        const r = await startSyncJob(payload);
        const id = (r?.data?.job_id as string) || null;

        if (!id) {
          if (mountedRef.current) {
            setJob((s) => ({
              ...s,
              status: "error",
              errorText: "El backend no devolvió job_id.",
            }));
          }
          return "error";
        }

        if (mountedRef.current) {
          setJob((s) => ({ ...s, jobId: id, status: "queued" }));
        }

        const t0 = Date.now();

        while (mountedRef.current && Date.now() - t0 < JOB_TIMEOUT_MS) {
          await wait(POLL_INTERVAL_MS);

          const rr = await fetchSyncStatus(id);
          const d = rr?.data || {};
          const st = (d.status as JobStatus) || "idle";
          const pr = Number(d.progress || 0);

          if (mountedRef.current) {
            setJob((s) => ({
              ...s,
              status: st,
              progress: pr,
              currentTable: d.current_table || null,
              logTail: d.log_tail || "",
              errorText: d.error ? String(d.error) : s.errorText,
            }));
          }

          if (st === "done" || st === "error" || st === "canceled") {
            return st;
          }
        }

        if (mountedRef.current) {
          setJob((s) => ({
            ...s,
            status: "error",
            errorText: "Timeout esperando el estado del proceso.",
          }));
        }
        return "error";
      } catch (e: any) {
        const x = extractAxiosError(e);
        const msg =
          (typeof x.detail === "string" ? x.detail : x.message) ||
          "No se pudo iniciar o consultar el job.";

        if (mountedRef.current) {
          setJob((s) => ({
            ...s,
            status: "error",
            errorText: msg,
          }));
        }

        return "error";
      }
    },
    []
  );

  const runAll = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    const todaySlot = getSlotKeyForToday(new Date());

    // Si hoy no toca backup por slot, no arrancamos nada.
    if (!todaySlot) {
      if (mountedRef.current) {
        setRunning(false);
        setFinished(true);
        setFinishedOk(true);
      }
      return;
    }

    // Si ya se completó el slot de hoy, evitamos repetir el proceso.
    try {
      const lastCompleted = await SecureStore.getItemAsync(SS_BACKUP_LAST_COMPLETED_SLOT);
      if (lastCompleted === todaySlot) {
        if (mountedRef.current) {
          setRunning(false);
          setFinished(true);
          setFinishedOk(true);
        }
        return;
      }
    } catch {
      // No bloqueamos el proceso si SecureStore falla al leer.
    }

    if (mountedRef.current) {
      setRunning(true);
      setFinished(false);
      setFinishedOk(null);
    }

    const st1 = await runSingleJob("job1", {
      source: "neon",
      dest: "supabase",
      execute: AUTO_EXECUTE,
      allow_destructive: AUTO_ALLOW_DESTRUCTIVE,
    });

    if (!mountedRef.current) return;

    if (st1 !== "done") {
      setRunning(false);
      setFinished(true);
      setFinishedOk(false);
      return;
    }

    if (RUN_SEQUENTIALLY) {
      const st2 = await runSingleJob("job2", {
        source: "neon",
        dest: "sheets",
        execute: AUTO_EXECUTE,
        allow_destructive: AUTO_ALLOW_DESTRUCTIVE,
      });

      if (!mountedRef.current) return;

      const ok = st2 === "done";
      setRunning(false);
      setFinished(true);
      setFinishedOk(ok);

      if (ok) {
        try {
          await SecureStore.setItemAsync(SS_BACKUP_LAST_COMPLETED_SLOT, todaySlot);
        } catch {
          // No bloqueamos por fallo de SecureStore
        }
      }

      return;
    }

    setRunning(false);
    setFinished(true);
    setFinishedOk(false);
  }, [runSingleJob]);

  useEffect(() => {
    mountedRef.current = true;
    void runAll();

    return () => {
      mountedRef.current = false;
    };
  }, [runAll]);

  const completionText = useMemo(() => getCompletionText(finished, finishedOk), [finished, finishedOk]);

  return (
    <>
      <Header
        title="Copia de seguridad"
        subtitle="Neon → Supabase y Neon → Google Sheets"
        showBack={false}
      />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Ejecución automática</Text>
              <Badge
                text={
                  finished
                    ? finishedOk
                      ? "OK"
                      : "ERROR"
                    : isAnyBusy
                      ? "EN CURSO"
                      : "LISTO"
                }
                tone={
                  finished
                    ? finishedOk
                      ? "ok"
                      : "err"
                    : isAnyBusy
                      ? "info"
                      : "info"
                }
              />
            </View>

            <Text style={styles.cardSubtitle}>
              Este screen ejecuta las copias sin opciones. El botón de volver se habilita al terminar.
            </Text>

            {completionText ? (
              <Text style={[styles.completionText, finishedOk ? styles.completionOk : styles.completionErr]}>
                {completionText}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.blockTitle}>1) Neon → Supabase</Text>
              <Badge text={job1.status.toUpperCase()} tone={statusTone(job1.status)} />
            </View>

            <View style={{ marginTop: 10 }}>
              <ProgressBar progress={job1.progress} />
              <View style={styles.progressMetaRow}>
                <Text style={styles.progressMetaLeft}>Progreso</Text>
                <Text style={styles.progressMetaRight}>{job1.progress.toFixed(2)}%</Text>
              </View>

              {!!job1.currentTable && (
                <Text style={styles.tableLine} numberOfLines={1}>
                  Tabla: <Text style={{ fontWeight: "800" }}>{job1.currentTable}</Text>
                </Text>
              )}

              {!!job1.errorText && job1.status === "error" ? (
                <Text style={styles.errorLine}>{job1.errorText}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.blockTitle}>2) Neon → Google Sheets</Text>
              <Badge text={job2.status.toUpperCase()} tone={statusTone(job2.status)} />
            </View>

            <View style={{ marginTop: 10 }}>
              <ProgressBar progress={job2.progress} />
              <View style={styles.progressMetaRow}>
                <Text style={styles.progressMetaLeft}>Progreso</Text>
                <Text style={styles.progressMetaRight}>{job2.progress.toFixed(2)}%</Text>
              </View>

              {!!job2.currentTable && (
                <Text style={styles.tableLine} numberOfLines={1}>
                  Tabla: <Text style={{ fontWeight: "800" }}>{job2.currentTable}</Text>
                </Text>
              )}

              {!!job2.errorText && job2.status === "error" ? (
                <Text style={styles.errorLine}>{job2.errorText}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <TouchableOpacity activeOpacity={0.9} onPress={toggleLog} style={styles.logHeaderRow}>
              <Text style={styles.logTitle}>Status / Logs</Text>
              <Text style={styles.logToggle}>{logOpen ? "Ocultar" : "Mostrar"}</Text>
            </TouchableOpacity>

            {logOpen ? (
              <View style={styles.logBox}>
                <Text style={styles.logSectionTitle}>Neon → Supabase</Text>
                <Text style={styles.logText}>{job1.logTail || "—"}</Text>

                <View style={styles.logDivider} />

                <Text style={styles.logSectionTitle}>Neon → Sheets</Text>
                <Text style={styles.logText}>{job2.logTail || "—"}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ marginTop: 4 }}>
            <PrimaryButton
              label={finished ? "Volver a principal" : "Procesando…"}
              onPress={() => navigation.reset({ index: 0, routes: [{ name: "Main" }] })}
              disabled={!finished}
              busy={!finished && isAnyBusy}
            />
          </View>

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
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  completionText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "800",
  },
  completionOk: { color: colors.success },
  completionErr: { color: colors.danger },
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
  errorLine: {
    marginTop: 8,
    fontSize: 11,
    color: colors.danger,
    fontWeight: "800",
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.2,
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
  logSectionTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 6,
  },
  logDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 10,
  },
  logText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 11,
    color: colors.textPrimary,
    lineHeight: 15,
  },
});