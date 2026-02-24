"use client";

import { useState, createContext, useContext, useCallback } from "react";
import { AuthUser, LoginRequest, RegisterRequest } from "@/types";
import { api } from "@/lib/api";

interface AuthContextType {
  user: AuthUser | null;
  login: (credentials: LoginRequest & { rememberMe?: boolean }) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";
const STORAGE_KEY = "arenax_auth_user";
const REMEMBER_KEY = "arenax_remember_me";

function getStorage(remember: boolean): Storage {
  return remember ? localStorage : sessionStorage;
}

function mapBackendUserToAuthUser(
  backendUser: {
    id: string;
    email: string;
    username: string;
    [key: string]: unknown;
  },
  accessToken: string,
  refreshToken: string
): AuthUser {
  return {
    id: backendUser.id,
    username: backendUser.username,
    email: backendUser.email,
    isVerified: true,
    elo: typeof (backendUser as Record<string, unknown>).elo === "number"
      ? ((backendUser as Record<string, unknown>).elo as number)
      : 0,
    createdAt:
      typeof (backendUser as Record<string, unknown>).createdAt === "string"
        ? ((backendUser as Record<string, unknown>).createdAt as string)
        : new Date().toISOString(),
    token: accessToken,
    refreshToken,
  };
}

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const remember = localStorage.getItem(REMEMBER_KEY) === "true";
  const storage = getStorage(remember);
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    return null;
  }
}

function getStoredToken(): { token: string; refreshToken: string } | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY) ?? sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (token && refresh) return { token, refreshToken: refresh };
  return null;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const persistSession = useCallback(
    (authUser: AuthUser, rememberMe: boolean) => {
      localStorage.setItem(REMEMBER_KEY, String(rememberMe));
      const storage = getStorage(rememberMe);
      storage.setItem(STORAGE_KEY, JSON.stringify(authUser));
      storage.setItem(TOKEN_KEY, authUser.token);
      storage.setItem(REFRESH_TOKEN_KEY, authUser.refreshToken);
    },
    []
  );

  const login = async (
    credentials: LoginRequest & { rememberMe?: boolean }
  ) => {
    try {
      setLoading(true);
      setError(null);
      const { rememberMe = false } = credentials;
      const response = await api.login({
        email: credentials.email,
        password: credentials.password,
      });
      const authUser = mapBackendUserToAuthUser(
        response.user as Parameters<typeof mapBackendUserToAuthUser>[0],
        response.tokens.accessToken,
        response.tokens.refreshToken
      );
      setUser(authUser);
      persistSession(authUser, rememberMe);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid email or password";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: RegisterRequest) => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.register({
        username: userData.username,
        email: userData.email,
        password: userData.password,
      });
      const authUser = mapBackendUserToAuthUser(
        response.user as Parameters<typeof mapBackendUserToAuthUser>[0],
        response.tokens.accessToken,
        response.tokens.refreshToken
      );
      setUser(authUser);
      persistSession(authUser, true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const logout = useCallback(() => {
    [localStorage, sessionStorage].forEach((storage) => {
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(TOKEN_KEY);
      storage.removeItem(REFRESH_TOKEN_KEY);
    });
    localStorage.removeItem(REMEMBER_KEY);
    setUser(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, login, register, logout, loading, error, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
};
