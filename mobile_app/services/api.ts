// mobile_app/services/api.ts
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";

export type DBKey = "supabase" | "neon";

// ------------------------------
// Config base (API URL)
// ------------------------------
const extra: any = (Constants.expoConfig as any)?.extra ?? {};

const RAW_API_URL =
  extra.EXPO_PUBLIC_API_URL ||
  extra.API_URL ||
  extra.apiUrl ||
  (extra.eas && (extra.eas.API_URL || extra.eas.apiUrl)) ||
  process.env.EXPO_PUBLIC_API_URL ||
  "";

const API_URL = String(RAW_API_URL).replace(/\/+$/, "");

if (!API_URL) {
  // No rompo la app en runtime por si estás en fase de transición,
  // pero esto debería quedar resuelto por app.json/app.config.js y eas env.
  console.warn(
    "[CONFIG] EXPO_PUBLIC_API_URL no está configurada. Revisa app.json/app.config.js y eas.json (env)."
  );
}

// ------------------------------
// Estado: DB selector (X-DB)
// ------------------------------
let currentDbKey: DBKey = "supabase";

// ------------------------------
// Axios instances
// ------------------------------
export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { Accept: "application/json" },
});

export const apiSlow = axios.create({
  baseURL: API_URL,
  timeout: 60000, // Render free: cold start puede ser alto
  headers: { Accept: "application/json" },
});

// ------------------------------
// Helpers
// ------------------------------
export const setDbKey = (key: DBKey) => {
  currentDbKey = key;
  api.defaults.headers.common["X-DB"] = key;
  apiSlow.defaults.headers.common["X-DB"] = key;
};

export const getDbKey = (): DBKey => currentDbKey;

export const setAuthToken = (token?: string | null) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    apiSlow.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete apiSlow.defaults.headers.common.Authorization;
  }
};

// ------------------------------
// Unauthorized handler (401)
// ------------------------------
let onUnauthorizedHandler: (() => void) | null = null;

export const setOnUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorizedHandler = fn;
};

// ------------------------------
// Logging (diagnóstico de /api, timeouts, etc.)
// ------------------------------
type ReqConfig = InternalAxiosRequestConfig & { __t0?: number; __name?: string; __retried?: boolean };

const logRequest = (name: string) => (config: ReqConfig) => {
  config.__t0 = Date.now();
  config.__name = name;

  const base = String(config.baseURL || "");
  const url = String(config.url || "");
  const method = String(config.method || "GET").toUpperCase();

  // URL final “humana”
  const finalUrl = `${base}${url}`;

  console.log(`[HTTP:${name}] -> ${method} ${finalUrl}`);

  // Pista útil: si tu backend es /api/* y estás llamando sin /api (o viceversa)
  // No es determinista, pero ayuda a detectar el error rápido.
  if (base && url) {
    const baseEndsWithApi = /\/api$/.test(base);
    const urlStartsWithApi = url.startsWith("/api/");
    if (baseEndsWithApi && urlStartsWithApi) {
      console.warn(`[HTTP:${name}] Posible doble '/api': baseURL termina en /api y url empieza por /api/.`);
    }
  }

  return config;
};

const logResponse = (response: AxiosResponse) => {
  const cfg = response.config as ReqConfig;
  const dt = cfg.__t0 ? Date.now() - cfg.__t0 : undefined;
  const base = String(cfg.baseURL || "");
  const url = String(cfg.url || "");
  const method = String(cfg.method || "GET").toUpperCase();
  const finalUrl = `${base}${url}`;

  console.log(
    `[HTTP:${cfg.__name || "?"}] <- ${response.status} ${method} ${finalUrl}${dt != null ? ` (${dt}ms)` : ""}`
  );
  return response;
};

const logError = async (error: AxiosError) => {
  const cfg = (error.config || {}) as ReqConfig;
  const dt = cfg.__t0 ? Date.now() - cfg.__t0 : undefined;
  const base = String(cfg.baseURL || "");
  const url = String(cfg.url || "");
  const method = String(cfg.method || "GET").toUpperCase();
  const finalUrl = `${base}${url}`;

  const status = error.response?.status;
  const data: any = error.response?.data;

  console.log(
    `[HTTP:${cfg.__name || "?"}] !! ${status || "NO_STATUS"} ${method} ${finalUrl}${dt != null ? ` (${dt}ms)` : ""}`
  );
  console.log(`[HTTP:${cfg.__name || "?"}] code=${error.code || "n/a"} message=${error.message}`);

  // Si es 404, suele ser prefijo /api mal.
  if (status === 404) {
    console.warn(
      `[HTTP:${cfg.__name || "?"}] 404: revisa si tus rutas llevan '/api'. Prueba en navegador: /health y /api/health.`
    );
  }

  // Si hay detalle, lo sacamos
  if (data) {
    try {
      console.log(`[HTTP:${cfg.__name || "?"}] response.data=`, data);
    } catch {
      // ignore
    }
  }

  return Promise.reject(error);
};

// Attach logging
api.interceptors.request.use(logRequest("fast"));
api.interceptors.response.use(logResponse, logError);

apiSlow.interceptors.request.use(logRequest("slow"));
apiSlow.interceptors.response.use(logResponse, async (error: AxiosError) => {
  const cfg = (error.config || {}) as ReqConfig;

  const isTimeout =
    error.code === "ECONNABORTED" ||
    (typeof error.message === "string" && error.message.toLowerCase().includes("timeout"));

  // Retry suave por timeout (útil en cold start)
  if (isTimeout && !cfg.__retried) {
    cfg.__retried = true;
    await new Promise((r) => setTimeout(r, 1200));
    return apiSlow.request(cfg);
  }

  return logError(error);
});

// Global 401 handling
api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && onUnauthorizedHandler) onUnauthorizedHandler();
    return Promise.reject(error);
  }
);

export default api;
