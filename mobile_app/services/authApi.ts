// services/authApi.ts
import { api } from './api';

export interface LoginResponseUser {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: LoginResponseUser;
}

// Rutas “de toda la vida” por si el openapi no está disponible
const FALLBACK_LOGIN_CANDIDATES = [
  '/api/v1/auth/login',
  '/api/v1/login',
  '/auth/login',
  '/login',
] as const;

// Para recordar la ruta buena una vez encontrada
let cachedLoginPath: string | null = null;

/**
 * Intenta descubrir el endpoint de login leyendo /openapi.json
 * y buscando un POST que parezca login.
 */
async function discoverLoginPathFromOpenApi(): Promise<string | null> {
  try {
    console.log('[authApi] Intentando descubrir login vía /openapi.json');
    const res = await api.get<any>('/openapi.json');
    const paths = res.data?.paths;
    if (!paths) {
      console.warn('[authApi] /openapi.json sin campo paths');
      return null;
    }

    const candidates: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      const postOp = (methods as any)?.post;
      if (!postOp) continue;

      const pathLower = path.toLowerCase();
      const summary = String(postOp.summary ?? '').toLowerCase();
      const description = String(postOp.description ?? '').toLowerCase();

      const looksLikeLogin =
        pathLower.includes('login') ||
        summary.includes('login') ||
        description.includes('login');

      if (looksLikeLogin) {
        candidates.push(path);
      }
    }

    if (candidates.length === 0) {
      console.warn(
        '[authApi] No se ha encontrado ningún POST que parezca login en /openapi.json'
      );
      return null;
    }

    // De momento usamos el primero
    console.log('[authApi] Candidato(s) de login detectado(s):', candidates);
    return candidates[0];
  } catch (err) {
    console.warn('[authApi] Error leyendo /openapi.json', err);
    return null;
  }
}

/**
 * Login que:
 * 1) Intenta descubrir la ruta correcta vía /openapi.json.
 * 2) Si no lo consigue, prueba varias rutas típicas.
 * 3) Una vez encuentra una ruta válida, la guarda en caché.
 */
export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  let lastError: any = null;

  // 1) Si no tenemos ruta cacheada, intentamos descubrirla
  if (!cachedLoginPath) {
    const discovered = await discoverLoginPathFromOpenApi();
    if (discovered) {
      cachedLoginPath = discovered;
    }
  }

  // 2) Construimos la lista de rutas a probar:
  const candidates: string[] = [];

  if (cachedLoginPath) {
    candidates.push(cachedLoginPath);
  }

  // Añadimos los fallbacks que sean diferentes de la caché
  for (const fb of FALLBACK_LOGIN_CANDIDATES) {
    if (!candidates.includes(fb)) {
      candidates.push(fb);
    }
  }

  // 3) Probamos en orden
  for (const path of candidates) {
    try {
      console.log('[authApi] Probando login en:', path);

      const response = await api.post<LoginResponse>(path, {
        email,
        password,
      });

      console.log('[authApi] Login OK usando endpoint:', path);
      cachedLoginPath = path; // guardamos la buena
      return response.data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        console.warn(
          `[authApi] Endpoint ${path} devuelve 404, probando siguiente...`
        );
        lastError = err;
        continue;
      }

      // Otros errores (401, 422, 500...) -> ya no seguimos probando
      throw err;
    }
  }

  console.error('[authApi] Ninguna ruta ha funcionado como login');
  throw lastError ?? new Error('No se ha podido encontrar un endpoint de login');
}
