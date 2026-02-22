"use client";

import { useState, createContext, useContext } from "react";
import { AuthUser, LoginRequest, RegisterRequest } from "@/types";

interface AuthContextType {
  user: AuthUser | null;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "arenax_mock_auth";

const buildMockUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "mock-user",
  username: "ArenaPlayer",
  email: "player@arenax.gg",
  isVerified: true,
  createdAt: new Date().toISOString(),
  elo: 1200,
  token: "mock-token",
  refreshToken: "mock-refresh",
  ...overrides,
});

const readStoredUser = (): AuthUser | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    return null;
  }
};

const writeStoredUser = (user: AuthUser | null) => {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
};

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

  const login = async (credentials: LoginRequest) => {
    try {
      setLoading(true);
      setError(null);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const nextUser = buildMockUser({
        email: credentials.email,
        username: credentials.email.split("@")[0] || "ArenaPlayer",
      });

      setUser(nextUser);
      writeStoredUser(nextUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: RegisterRequest) => {
    try {
      setLoading(true);
      setError(null);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const nextUser = buildMockUser({
        email: userData.email,
        username: userData.username || "ArenaPlayer",
      });

      setUser(nextUser);
      writeStoredUser(nextUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    writeStoredUser(null);
    setUser(null);
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, login, register, logout, loading, error }}
    >
      {children}
    </AuthContext.Provider>
  );
};
