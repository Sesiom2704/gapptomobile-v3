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

/**
 * Claves de storage.
 * Mantener constantes evita typos y te permite migrar fácil en el futuro.
 */
const STORAGE_TOKEN_KEY = "userToken";
// Si en el futuro decides guardar userData:
// const STORAGE_USER_KEY = "userData";

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
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Helper: log seguro del token.
 * Nunca imprimimos JWT completo en consola.
 */
const maskToken = (t: string | null | undefined) => {
  if (!t) return "<none>";
  const head = t.slice(0, 200); // ej: "eyJhbGciOi..."
  return `${head}... (len=${t.length})`;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Aplica token:
   * - actualiza estado react
   * - configura axios para mandar Authorization en siguientes requests
   */
  const applyToken = (newToken: string | null) => {
    setTokenState(newToken);
    setAuthToken(newToken);
  };

  /**
   * Logout:
   * - borra token en memoria y en axios
   * - borra user
   * - borra token persistido (SecureStore)
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
  }, []);

  /**
   * Handler global 401:
   * Si el backend responde 401 en cualquier request (api.ts),
   * ejecutamos logout para forzar vuelta a login.
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
   * Bootstrap de sesión:
   * Al arrancar la app intentamos recuperar token del SecureStore.
   * Si existe:
   * - lo aplicamos a axios
   * - marcamos sesión como autenticada sin pedir login de nuevo
   *
   * Nota:
   * - No reconstruimos el user aquí porque tu backend tiene /api/v1/auth/me.
   * - Lo ideal es que, si hay token, llames a /me y rellenes user.
   *   Pero como ahora estamos depurando “por qué no carga datos”, lo importante
   *   es garantizar que Authorization se envía desde el primer fetch.
   */
  useEffect(() => {
    (async () => {
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
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Login:
   * - llama al backend
   * - valida access_token
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

      // Guardamos token persistente ANTES de navegar/cargar datos
      try {
        await SecureStore.setItemAsync(STORAGE_TOKEN_KEY, accessToken);
      } catch (e) {
        console.log("[Auth] No se pudo guardar token en SecureStore (ojo, pero seguimos):", e);
      }

      const userFromApi: AuthUser = {
        id: String(data.user.id),
        email: data.user.email,
        full_name: data.user.full_name ?? null,
        role: data.user.role ?? null,
      };

      // Aplicamos token a axios y al estado
      applyToken(accessToken);

      // Log seguro: confirma token presente
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
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return ctx;
};
