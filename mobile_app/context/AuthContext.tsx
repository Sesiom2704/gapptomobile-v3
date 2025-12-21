// context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { setAuthToken, setOnUnauthorizedHandler } from '../services/api';
import { login as loginRequest, LoginResponse } from '../services/authApi';

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const applyToken = (newToken: string | null) => {
    setTokenState(newToken);
    setAuthToken(newToken);
  };

  const logout = useCallback(async () => {
    applyToken(null);
    setUserState(null);
  }, []);

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      void logout();
    });
    return () => {
      setOnUnauthorizedHandler(null);
    };
  }, [logout]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const data: LoginResponse = await loginRequest(email, password);

      const accessToken = data.access_token;
      if (!accessToken) {
        throw new Error('Respuesta de login sin access_token');
      }

      const userFromApi: AuthUser = {
        id: String(data.user.id),
        email: data.user.email,
        full_name: data.user.full_name ?? null,
        role: data.user.role ?? null,
      };

      applyToken(accessToken);
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
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
};
