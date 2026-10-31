/**
 * Ruta: mobile_app/context/AuthContext.tsx
 * Versión: 1.1.0
 * Descripción:
 * Contexto global de autenticación para GAPPTO Mobile.
 *
 * Funcionalidades incluidas:
 * - Recupera token guardado en SecureStore al arrancar.
 * - Aplica token Bearer al cliente HTTP global.
 * - Gestiona login y logout.
 * - Gestiona usuario autenticado.
 * - Gestiona estado de carga de login.
 * - Gestiona estado de hidratación inicial.
 * - Maneja logout automático ante respuestas 401.
 * - Inicializa siempre Neon y actualiza la base guardada en SecureStore.
 *
 * Ajustes de esta versión:
 * - Se añade lectura inicial de dbKey desde SecureStore.
 * - Se aplica setDbKey antes de finalizar la hidratación.
 * - Neon es la base principal y la seleccionamos en cada arranque.
 * - Se asegura que la app arranca con el X-DB correcto antes de entrar a Main.
 *
 * Reglas funcionales:
 * - dbKey válido solo puede ser "supabase" o "neon".
 * - Si no hay dbKey guardado, se crea con valor "supabase".
 * - AuthContext no decide Main/Login; solo prepara estado y cliente HTTP.
 * - RootNavigator y BootScreen siguen gestionando el flujo visual.
 *
 * Notas de diseño:
 * - La base activa se mantiene aunque el usuario haga logout.
 * - Logout borra el token, pero no borra dbKey.
 * - Esto permite que soporte o administración conserve la base elegida.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import * as SecureStore from "expo-secure-store";

import {
  setAuthToken,
  setOnUnauthorizedHandler,
  setDbKey,
  DEFAULT_DB_KEY,
  type DBKey,
} from "../services/api";
import { login as loginRequest, LoginResponse } from "../services/authApi";
import { resetToLogin } from "../navigation/navigationRef";

/**
 * Claves de storage.
 */
const STORAGE_TOKEN_KEY = "userToken";
const STORAGE_DB_KEY = "dbKey";

/**
 * La base principal se define en services/api.ts para que toda la app
 * comparta el mismo valor (Neon).
 */

type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
};

type AuthContextType = {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;

  /**
   * isLoading:
   * - true mientras se ejecuta el login (para deshabilitar botón/spinner)
   */
  isLoading: boolean;

  /**
   * isHydrating:
   * - true mientras leemos SecureStore al arrancar
   * - BootScreen lo usa para no decidir Main/Login antes de tiempo
   */
  isHydrating: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isValidDbKey = (value: string | null): value is DBKey => {
  return value === "supabase" || value === "neon";
};

const maskToken = (t: string | null | undefined) => {
  if (!t) return "<none>";
  const head = t.slice(0, 200);
  return `${head}... (len=${t.length})`;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);

  /**
   * Aplica token a:
   * - estado React
   * - axios (Authorization)
   */
  const applyToken = (newToken: string | null) => {
    setTokenState(newToken);
    setAuthToken(newToken);
  };

  /**
   * Logout:
   * - limpia token (memoria + axios)
   * - limpia user
   * - borra SecureStore solo del token
   * - resetea navegación a Login (si el NavigationContainer ya está listo)
   *
   * Nota:
   * - No borramos dbKey. La base activa es una preferencia operativa
   *   independiente de la sesión.
   */
  const logout = useCallback(async () => {
    console.log("[Auth] logout()");

    applyToken(null);
    setUserState(null);

    try {
      await SecureStore.deleteItemAsync(STORAGE_TOKEN_KEY);
    } catch (e) {
      console.log("[Auth] No se pudo borrar token de SecureStore (ignorable):", e);
    }

    // Navegación global a Login
    resetToLogin();
  }, []);

  /**
   * Handler global de 401:
   * - Si cualquier request devuelve 401, forzamos logout.
   */
  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      console.log("[Auth] 401 detectado -> logout()");
      void logout();
    });

    return () => {
      setOnUnauthorizedHandler(null);
    };
  }, [logout]);

  /**
   * Bootstrap de sesión al arrancar:
   * - establece Neon como base inicial aunque hubiera Supabase guardada
   * - aplica base activa a axios
   * - recupera token si existe
   * - aplica token a axios
   *
   * Importante:
   * - setDbKey se ejecuta antes de terminar isHydrating.
   * - Así BootScreen y las primeras pantallas ya usan X-DB correcto.
   */
  useEffect(() => {
    (async () => {
      setIsHydrating(true);

      try {
        const savedDbKeyRaw = await SecureStore.getItemAsync(STORAGE_DB_KEY);

        // Neon es la base principal: arrancamos siempre con ella.
        // Esto corrige también instalaciones que ya guardaron Supabase.
        const effectiveDbKey: DBKey = DEFAULT_DB_KEY;
        setDbKey(effectiveDbKey);

        if (savedDbKeyRaw !== effectiveDbKey) {
          await SecureStore.setItemAsync(STORAGE_DB_KEY, effectiveDbKey);
        }

        console.log(
          "[Auth] Base de arranque:", effectiveDbKey,
          "| anterior:", isValidDbKey(savedDbKeyRaw) ? savedDbKeyRaw : "sin selección válida"
        );

        const savedToken = await SecureStore.getItemAsync(STORAGE_TOKEN_KEY);

        if (savedToken) {
          console.log("[Auth] Token recuperado de SecureStore:", maskToken(savedToken));
          applyToken(savedToken);
        } else {
          console.log("[Auth] No hay token guardado en SecureStore.");
        }
      } catch (e) {
        console.log("[Auth] Error leyendo SecureStore en bootstrap:", e);

        // Fallback seguro si SecureStore falla.
        setDbKey(DEFAULT_DB_KEY);
      } finally {
        setIsHydrating(false);
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Login:
   * - llama al backend
   * - guarda token en SecureStore
   * - aplica token a axios
   * - setea user
   */
  const login = async (email: string, password: string) => {
    setIsLoading(true);

    try {
      console.log("[Auth] login() intentando con email:", email);

      const data: LoginResponse = await loginRequest(email, password);

      const accessToken = data.access_token;
      if (!accessToken) {
        throw new Error("Respuesta de login sin access_token");
      }

      try {
        await SecureStore.setItemAsync(STORAGE_TOKEN_KEY, accessToken);
      } catch (e) {
        console.log("[Auth] No se pudo guardar token en SecureStore (seguimos):", e);
      }

      const userFromApi: AuthUser = {
        id: String(data.user.id),
        email: data.user.email,
        full_name: data.user.full_name ?? null,
        role: data.user.role ?? null,
      };

      applyToken(accessToken);
      console.log("[Auth] login OK. Token:", maskToken(accessToken));
      setUserState(userFromApi);
    } finally {
      setIsLoading(false);
    }
  };

  const value: AuthContextType = {
    token,
    user,
    isAuthenticated: !!token,
    isLoading,
    isHydrating,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
};