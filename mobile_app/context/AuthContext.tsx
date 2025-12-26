// context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import * as SecureStore from "expo-secure-store";

import { setAuthToken, setOnUnauthorizedHandler } from "../services/api";
import { login as loginRequest, LoginResponse } from "../services/authApi";
import { resetToLogin } from "../navigation/navigationRef";

/**
 * Claves de storage.
 */
const STORAGE_TOKEN_KEY = "userToken";

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
   * - borra SecureStore
   * - resetea navegación a Login (si el NavigationContainer ya está listo)
   *
   * Nota:
   * - El reset a Login aquí garantiza que “pierdo token -> vuelvo a Login”
   *   desde cualquier pantalla, sin depender de watchers en la UI.
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
   * - recupera token si existe
   * - lo aplica a axios
   */
  useEffect(() => {
    (async () => {
      setIsHydrating(true);
      try {
        const savedToken = await SecureStore.getItemAsync(STORAGE_TOKEN_KEY);
        if (savedToken) {
          console.log("[Auth] Token recuperado de SecureStore:", maskToken(savedToken));
          applyToken(savedToken);
        } else {
          console.log("[Auth] No hay token guardado en SecureStore.");
        }
      } catch (e) {
        console.log("[Auth] Error leyendo token de SecureStore:", e);
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
