// mobile_app/services/api.ts
import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
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

console.log("[CONFIG] runtimeVersion=", (Constants.expoConfig as any)?.runtimeVersion);
console.log("[CONFIG] updates.url=", (Constants.expoConfig as any)?.updates?.url);
console.log(
  "[CONFIG] releaseChannel/channel=",
  (Constants.expoConfig as any)?.releaseChannel ||
    (Constants.expoConfig as any)?.updates?.requestHeaders
);
console.log("[CONFIG] BUILD_TAG=2025-12-22T-GPT-FIX-01");

// Admitimos múltiples nombres por compatibilidad / transición
const RAW_API_URL =
  extra.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_API_URL ||
  (extra.eas && (extra.eas.API_URL || extra.eas.apiUrl)) ||
  "";

if (extra.API_URL && extra.API_URL !== extra.EXPO_PUBLIC_API_URL) {
  console.warn(
    "[CONFIG] extra.API_URL está presente pero se ignora por seguridad:",
    extra.API_URL
  );
}

// Normalizamos: quitamos trailing slashes (evita // en URLs finales)
const API_URL = String(RAW_API_URL).replace(/\/+$/, "");

console.log("[CONFIG] RAW_API_URL=", RAW_API_URL);
console.log("[CONFIG] API_URL=", API_URL);
console.log("[CONFIG] Constants.expoConfig.extra=", (Constants.expoConfig as any)?.extra);

if (!API_URL) {
  console.warn(
    "[CONFIG] EXPO_PUBLIC_API_URL no está configurada. Revisa app.json/app.config.js y variables de entorno EAS."
  );
}

/**
 * --------------------------------------------
 * Estado: DB selector (X-DB)
 * --------------------------------------------
 */
let currentDbKey: DBKey = "neon";

/**
 * --------------------------------------------
 * Axios instances
 * --------------------------------------------
 */
export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    Accept: "application/json",
    "X-DB": currentDbKey,
  },
});

export const apiSlow = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: {
    Accept: "application/json",
    "X-DB": currentDbKey,
  },
});

/**
 * --------------------------------------------
 * Helpers
 * --------------------------------------------
 */
export const setDbKey = (key: DBKey) => {
  currentDbKey = key;
  api.defaults.headers.common["X-DB"] = key;
  apiSlow.defaults.headers.common["X-DB"] = key;
};

export const getDbKey = (): DBKey => currentDbKey;

/**
 * Normaliza tokens:
 * - quita prefijos "bearer " o "Bearer " si te lo pasan ya prefijado
 * - evita casos tipo "Bearer Bearer <jwt>"
 */
const normalizeJwt = (token: string): string => {
  return token
    .trim()
    .replace(/^bearer\s+/i, "")     // quita "bearer " (case-insensitive)
    .replace(/^Bearer\s+/i, "");    // por si viene "Bearer " (doble prefijo)
};

/**
 * Set / unset del token Bearer para ambas instancias.
 */
export const setAuthToken = (token?: string | null) => {
  if (token) {
    const jwt = normalizeJwt(token);
    const v = `Bearer ${jwt}`; // B mayúscula SIEMPRE
    api.defaults.headers.common["Authorization"] = v;
    apiSlow.defaults.headers.common["Authorization"] = v;

    // limpieza defensiva
    delete (api.defaults.headers.common as any)["authorization"];
    delete (apiSlow.defaults.headers.common as any)["authorization"];
  } else {
    delete api.defaults.headers.common["Authorization"];
    delete apiSlow.defaults.headers.common["Authorization"];
    delete (api.defaults.headers.common as any)["authorization"];
    delete (apiSlow.defaults.headers.common as any)["authorization"];
  }
};

/**
 * --------------------------------------------
 * Unauthorized handler (401)
 * --------------------------------------------
 */
let onUnauthorizedHandler: (() => void) | null = null;

export const setOnUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorizedHandler = fn;
};

/**
 * --------------------------------------------
 * Logging (diagnóstico)
 * --------------------------------------------
 */
type ReqConfig = InternalAxiosRequestConfig & {
  __t0?: number;
  __name?: string;
  __retried?: boolean;
};

const maskAuth = (auth: unknown): string => {
  if (typeof auth !== "string" || !auth) return "<none>";
  const trimmed = auth.trim();
  const head = trimmed.slice(0, 18); // "Bearer eyJhbGci..."
  return `${head}... (len=${trimmed.length})`;
};

/**
 * Fuerza en cada request:
 * - Authorization -> "Bearer <jwt>" (corrige "bearer <jwt>")
 * - elimina "authorization" en minúscula si aparece
 */
const normalizeAuthorizationHeader = (config: ReqConfig, defaultsAuth?: any) => {
  const headersAny = (config.headers || {}) as any;

  const raw =
    headersAny.Authorization ??
    headersAny.authorization ??
    defaultsAuth ??
    "";

  if (typeof raw === "string" && raw.trim()) {
    const fixed = raw.trim().replace(/^bearer\s+/i, "Bearer ");
    headersAny.Authorization = fixed;
    delete headersAny.authorization;
    config.headers = headersAny;
  }

  return config;
};

const logRequest = (name: string) => (config: ReqConfig) => {
  config.__t0 = Date.now();
  config.__name = name;

  const base = String(config.baseURL || "");
  const url = String(config.url || "");
  const method = String(config.method || "GET").toUpperCase();
  const finalUrl = `${base}${url}`;

  const xdb =
    ((config.headers as any)?.["X-DB"]) ||
    api.defaults.headers.common["X-DB"] ||
    currentDbKey;

  const headersAny = (config.headers || {}) as any;
  const auth = headersAny.Authorization ?? headersAny.authorization ?? "<missing>";

  console.log(
    `[HTTP:${name}] -> ${method} ${finalUrl} (X-DB=${String(
      xdb
    )}) Authorization=${maskAuth(auth)}`
  );

  if (base && url) {
    const baseEndsWithApi = /\/api$/.test(base);
    const urlStartsWithApi = url.startsWith("/api/");
    if (baseEndsWithApi && urlStartsWithApi) {
      console.warn(
        `[HTTP:${name}] Posible doble '/api': baseURL termina en /api y url empieza por /api/.`
      );
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
    `[HTTP:${cfg.__name || "?"}] <- ${response.status} ${method} ${finalUrl}${
      dt != null ? ` (${dt}ms)` : ""
    }`
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
    `[HTTP:${cfg.__name || "?"}] !! ${status || "NO_STATUS"} ${method} ${finalUrl}${
      dt != null ? ` (${dt}ms)` : ""
    }`
  );
  console.log(
    `[HTTP:${cfg.__name || "?"}] code=${error.code || "n/a"} message=${error.message}`
  );

  if (status === 404) {
    console.warn(
      `[HTTP:${cfg.__name || "?"}] 404: revisa si tus rutas llevan '/api' y/o '/api/v1'. Prueba: /health, /api/health, /openapi.json.`
    );
  }

  if (data) {
    try {
      console.log(`[HTTP:${cfg.__name || "?"}] response.data=`, data);
    } catch {
      // ignore
    }
  }

  return Promise.reject(error);
};

/**
 * --------------------------------------------
 * Interceptors
 * --------------------------------------------
 * Importante: primero normalizamos Authorization; luego logRequest.
 */

// FAST
api.interceptors.request.use((config: ReqConfig) =>
  normalizeAuthorizationHeader(config, api.defaults.headers.common["Authorization"])
);
api.interceptors.request.use(logRequest("fast"));
api.interceptors.response.use(logResponse, logError);

// SLOW
apiSlow.interceptors.request.use((config: ReqConfig) =>
  normalizeAuthorizationHeader(config, apiSlow.defaults.headers.common["Authorization"])
);
apiSlow.interceptors.request.use(logRequest("slow"));
apiSlow.interceptors.response.use(
  logResponse,
  async (error: AxiosError) => {
    const cfg = (error.config || {}) as ReqConfig;

    const isTimeout =
      error.code === "ECONNABORTED" ||
      (typeof error.message === "string" &&
        error.message.toLowerCase().includes("timeout"));

    if (isTimeout && !cfg.__retried) {
      cfg.__retried = true;
      await new Promise((r) => setTimeout(r, 1200));
      return apiSlow.request(cfg);
    }

    return logError(error);
  }
);

/**
 * --------------------------------------------
 * Global 401 handling
 * --------------------------------------------
 */
api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && onUnauthorizedHandler) {
      onUnauthorizedHandler();
    }
    return Promise.reject(error);
  }
);

export default api;
