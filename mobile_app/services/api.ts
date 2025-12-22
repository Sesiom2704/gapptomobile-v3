// mobile_app/services/api.ts
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";

export type DBKey = "supabase" | "neon";

/**
 * --------------------------------------------
 * Config base (API URL)
 * --------------------------------------------
 * La URL debe venir del runtime config de Expo:
 * - app.json / app.config.js -> expo.extra.EXPO_PUBLIC_API_URL
 * - o variables EAS/CI -> process.env.EXPO_PUBLIC_API_URL
 *
 * Nota: en Expo Go y en builds, Constants.expoConfig.extra es el punto más fiable.
 */
const extra: any = (Constants.expoConfig as any)?.extra ?? {};

// Admitimos múltiples nombres por compatibilidad con V2 / transición
const RAW_API_URL =
  extra.EXPO_PUBLIC_API_URL ||
  extra.API_URL ||
  extra.apiUrl ||
  (extra.eas && (extra.eas.API_URL || extra.eas.apiUrl)) ||
  process.env.EXPO_PUBLIC_API_URL ||
  "";

// Normalizamos: quitamos trailing slashes (evita // en URLs finales)
const API_URL = String(RAW_API_URL).replace(/\/+$/, "");

if (!API_URL) {
  // No rompemos la app en runtime (modo transición),
  // pero esto debería resolverse en app.json/app.config.js y/o EAS env.
  console.warn(
    "[CONFIG] EXPO_PUBLIC_API_URL no está configurada. Revisa app.json/app.config.js y variables de entorno EAS."
  );
}

/**
 * --------------------------------------------
 * Estado: DB selector (X-DB)
 * --------------------------------------------
 * Queremos Neon como predeterminado para V3.
 * Importante:
 * - Si el header X-DB sólo se añade cuando alguien llama a setDbKey(),
 *   las primeras requests pueden salir SIN X-DB.
 *
 * Solución:
 * - Inicializamos el header "X-DB" en el axios.create() para que esté desde el primer request.
 */
let currentDbKey: DBKey = "neon";

/**
 * --------------------------------------------
 * Axios instances
 * --------------------------------------------
 * api: llamadas "rápidas"
 * apiSlow: llamadas con más timeout (cold start Render free, login, primeras cargas)
 */
export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    Accept: "application/json",
    // ✅ X-DB desde el arranque (Neon por defecto)
    "X-DB": currentDbKey,
  },
});

export const apiSlow = axios.create({
  baseURL: API_URL,
  timeout: 60000, // Render free: cold start puede ser alto
  headers: {
    Accept: "application/json",
    // ✅ X-DB desde el arranque (Neon por defecto)
    "X-DB": currentDbKey,
  },
});

/**
 * --------------------------------------------
 * Helpers
 * --------------------------------------------
 */

/** Cambia la BD activa (header X-DB) para siguientes requests. */
export const setDbKey = (key: DBKey) => {
  currentDbKey = key;

  // Mantenemos coherencia entre instancias
  api.defaults.headers.common["X-DB"] = key;
  apiSlow.defaults.headers.common["X-DB"] = key;
};

/** Devuelve la BD activa actual (memoria). */
export const getDbKey = (): DBKey => currentDbKey;

/**
 * Set / unset del token Bearer para ambas instancias.
 * Nota:
 * - Esto modifica el default header de axios para futuras requests.
 * - Si alguna llamada usa axios "directo" en vez de `api`, esa llamada NO llevará token.
 */
export const setAuthToken = (token?: string | null) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    apiSlow.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete apiSlow.defaults.headers.common.Authorization;
  }
};

/**
 * --------------------------------------------
 * Unauthorized handler (401)
 * --------------------------------------------
 * Se usa desde AuthProvider para forzar logout si el backend responde 401.
 */
let onUnauthorizedHandler: (() => void) | null = null;

export const setOnUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorizedHandler = fn;
};

/**
 * --------------------------------------------
 * Logging (diagnóstico de /api, timeouts, etc.)
 * --------------------------------------------
 * - Detecta 404 por prefijos mal montados (/api vs /api/v1)
 * - Mide latencias (cold start)
 * - Muestra si se está enviando Authorization (SIN exponer el token completo)
 */
type ReqConfig = InternalAxiosRequestConfig & {
  __t0?: number;
  __name?: string;
  __retried?: boolean;
};

const maskAuth = (auth: unknown): string => {
  // No imprimimos el token. Solo:
  // - si existe o no
  // - prefijo y longitud (útil para confirmar que es "Bearer <jwt>")
  if (typeof auth !== "string" || !auth) return "<none>";
  const trimmed = auth.trim();
  const head = trimmed.slice(0, 18); // normalmente "Bearer eyJhbGci..."
  return `${head}... (len=${trimmed.length})`;
};

const logRequest = (name: string) => (config: ReqConfig) => {
  config.__t0 = Date.now();
  config.__name = name;

  const base = String(config.baseURL || "");
  const url = String(config.url || "");
  const method = String(config.method || "GET").toUpperCase();
  const finalUrl = `${base}${url}`;

  // DB activa (cabecera X-DB)
  const xdb =
    (config.headers && (config.headers as any)["X-DB"]) ||
    api.defaults.headers.common["X-DB"] ||
    currentDbKey;

  // Authorization: confirmamos si viaja o no (sin mostrar el token)
  const auth =
    (config.headers && ((config.headers as any).Authorization || (config.headers as any).authorization)) ||
    api.defaults.headers.common.Authorization ||
    apiSlow.defaults.headers.common.Authorization;

  console.log(`[HTTP:${name}] -> ${method} ${finalUrl} (X-DB=${String(xdb)}) Authorization=${maskAuth(auth)}`);

  // Heurística: detectar doble '/api' por mala composición baseURL + url
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

  // 404 suele ser prefijo/ruta mal (ej: /api/v1 vs /api)
  if (status === 404) {
    console.warn(
      `[HTTP:${cfg.__name || "?"}] 404: revisa si tus rutas llevan '/api' y/o '/api/v1'. Prueba: /health, /api/health, /openapi.json.`
    );
  }

  // Dump defensivo del body de error
  if (data) {
    try {
      console.log(`[HTTP:${cfg.__name || "?"}] response.data=`, data);
    } catch {
      // ignore
    }
  }

  return Promise.reject(error);
};

// Attach logging interceptors
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

/**
 * --------------------------------------------
 * Global 401 handling
 * --------------------------------------------
 * Si cualquier endpoint devuelve 401, invocamos el handler (AuthProvider suele hacer logout).
 * Nota:
 * - Mantengo esto en api (fast) como tenías.
 * - Si quieres comportamiento idéntico en apiSlow, se puede duplicar.
 */
api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && onUnauthorizedHandler) onUnauthorizedHandler();
    return Promise.reject(error);
  }
);

export default api;
