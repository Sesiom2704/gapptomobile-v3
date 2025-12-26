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
 * Runtime config (API URL)
 * --------------------------------------------
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

// Preferimos EXPO_PUBLIC_API_URL. NO queremos “API_URL” legacy colándose.
const RAW_API_URL =
  extra.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_API_URL ||
  (extra.eas && (extra.eas.EXPO_PUBLIC_API_URL || extra.eas.apiUrl)) ||
  "";

if (extra.API_URL && extra.API_URL !== extra.EXPO_PUBLIC_API_URL) {
  console.warn(
    "[CONFIG] extra.API_URL está presente pero se ignora por seguridad:",
    extra.API_URL
  );
}

const API_URL = String(RAW_API_URL).replace(/\/+$/, "");

console.log("[CONFIG] RAW_API_URL=", RAW_API_URL);
console.log("[CONFIG] API_URL=", API_URL);
console.log("[CONFIG] Constants.expoConfig.extra=", (Constants.expoConfig as any)?.extra);

if (!API_URL) {
  console.warn(
    "[CONFIG] EXPO_PUBLIC_API_URL no está configurada. Revisa app.json/app.config.js y variables EAS."
  );
}

/**
 * Export explícito para otras capas (BootScreen, diagnósticos, etc.).
 * - Evita re-parsear Constants en múltiples sitios.
 * - Mantiene un único “source of truth”.
 */
export const getApiBaseUrl = (): string => API_URL;

/**
 * --------------------------------------------
 * Estado global: DB selector + Auth token
 * --------------------------------------------
 */
let currentDbKey: DBKey = "neon";

/**
 * Guardamos el token en memoria y lo inyectamos SIEMPRE en cada request
 * mediante interceptor. Esto evita casos raros donde axios/fetch “pierde”
 * defaults.headers o redirecciones cambian headers.
 */
let currentAuthToken: string | null = null;

function buildBearer(token: string): string {
  // Normaliza: “Bearer <jwt>” (B mayúscula, 1 espacio)
  const t = String(token).trim();
  if (!t) return "";
  if (/^bearer\s+/i.test(t)) {
    // Si viene ya con Bearer/bearer, lo normalizamos a "Bearer "
    return "Bearer " + t.replace(/^bearer\s+/i, "").trim();
  }
  return "Bearer " + t;
}

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
 * Helpers públicos
 * --------------------------------------------
 */
export const setDbKey = (key: DBKey) => {
  currentDbKey = key;
  api.defaults.headers.common["X-DB"] = key;
  apiSlow.defaults.headers.common["X-DB"] = key;
};

export const getDbKey = (): DBKey => currentDbKey;

/**
 * Set / unset del token Bearer para ambas instancias.
 * La “fuente de verdad” es currentAuthToken + interceptor.
 */
export const setAuthToken = (token?: string | null) => {
  currentAuthToken = token ? String(token).trim() : null;

  if (currentAuthToken) {
    const v = buildBearer(currentAuthToken);
    // dejamos también defaults por si alguna librería lee de ahí
    api.defaults.headers.common["Authorization"] = v;
    apiSlow.defaults.headers.common["Authorization"] = v;
  } else {
    delete api.defaults.headers.common["Authorization"];
    delete apiSlow.defaults.headers.common["Authorization"];
  }

  // limpieza defensiva
  delete (api.defaults.headers.common as any)["authorization"];
  delete (apiSlow.defaults.headers.common as any)["authorization"];
};

export const getAuthToken = (): string | null => currentAuthToken;

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
 * Logging + inyección de headers por request
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
  const head = trimmed.slice(0, 18);
  return `${head}... (len=${trimmed.length})`;
};

/**
 * Interceptor único:
 * - Garantiza X-DB siempre
 * - Garantiza Authorization siempre (si hay token)
 * - Loggea lo que REALMENTE va en config.headers
 */
const requestInterceptor = (name: string) => (config: ReqConfig) => {
  config.__t0 = Date.now();
  config.__name = name;

  // Normaliza headers (axios en RN puede traer AxiosHeaders u objeto)
  const headersAny: any = (config.headers ?? {});

  // 1) X-DB (siempre)
  headersAny["X-DB"] = headersAny["X-DB"] ?? currentDbKey;

  // 2) Authorization (siempre que haya token)
  if (currentAuthToken) {
    headersAny["Authorization"] = buildBearer(currentAuthToken);
    delete headersAny["authorization"];
  } else {
    // si no hay token, limpiamos
    delete headersAny["Authorization"];
    delete headersAny["authorization"];
  }

  config.headers = headersAny;

  const base = String(config.baseURL || "");
  const url = String(config.url || "");
  const method = String(config.method || "GET").toUpperCase();
  const finalUrl = `${base}${url}`;

  const xdb = headersAny["X-DB"];
  const auth = headersAny["Authorization"] ?? headersAny["authorization"];

  console.log(
    `[HTTP:${name}] -> ${method} ${finalUrl} (X-DB=${String(xdb)}) Authorization=${maskAuth(auth)}`
  );

  // Heurística: detectar doble '/api'
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
  console.log(`[HTTP:${cfg.__name || "?"}] code=${error.code || "n/a"} message=${error.message}`);

  if (status === 404) {
    console.warn(
      `[HTTP:${cfg.__name || "?"}] 404: revisa prefijos '/api' y '/api/v1'. Prueba: /health, /api/health, /openapi.json.`
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

// Attach interceptors
api.interceptors.request.use(requestInterceptor("fast"));
api.interceptors.response.use(logResponse, logError);

apiSlow.interceptors.request.use(requestInterceptor("slow"));
apiSlow.interceptors.response.use(logResponse, async (error: AxiosError) => {
  const cfg = (error.config || {}) as ReqConfig;

  const isTimeout =
    error.code === "ECONNABORTED" ||
    (typeof error.message === "string" && error.message.toLowerCase().includes("timeout"));

  if (isTimeout && !cfg.__retried) {
    cfg.__retried = true;
    await new Promise((r) => setTimeout(r, 1200));
    return apiSlow.request(cfg);
  }

  return logError(error);
});

/**
 * Global 401 handling (api fast)
 */
api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && onUnauthorizedHandler) onUnauthorizedHandler();
    return Promise.reject(error);
  }
);

export default api;
