"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthUser, LoginRequest, RegisterRequest } from "@/types";
import { api } from "@/lib/api";
import { AuthApiError, REGISTER_ERROR_MAP } from "@/lib/authErrors";
import {
  setTokenExpiresIn,
  clearTokenExpiry,
} from "@/lib/wallet/tokenExpiry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextType {
  user: AuthUser | null;
  login: (credentials: LoginRequest & { rememberMe?: boolean }) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: (email: string) => Promise<void>;
  /** Trigger a silent token refresh. Returns the new TTL in seconds. */
  refreshAccessToken: () => Promise<number>;
  /** True while a token refresh is in flight. */
  isRefreshing: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Non-sensitive storage keys
//
// Tokens are NEVER stored in localStorage / sessionStorage.
// Only the public user profile (no secrets) is cached here so the UI can
// render immediately on page reload without a network round-trip.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "arenax_auth_user";
const PENDING_VERIFICATION_EMAIL_KEY = "arenax_pending_email";

export const AUTH_PROFILE_QUERY_KEY = ["auth", "profile"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapBackendUser(
  backendUser: {
    id: string;
    email?: string;
    username: string;
    isVerified?: boolean;
    is_verified?: boolean;
    [key: string]: unknown;
  },
): AuthUser {
  return {
    id: backendUser.id,
    username: backendUser.username,
    email: (backendUser.email as string | undefined) ?? "",
    isVerified:
      (backendUser.isVerified as boolean | undefined) ??
      (backendUser.is_verified as boolean | undefined) ??
      false,
    elo:
      typeof backendUser.elo === "number" ? (backendUser.elo as number) : 0,
    createdAt:
      typeof backendUser.createdAt === "string"
        ? (backendUser.createdAt as string)
        : typeof backendUser.created_at === "string"
          ? (backendUser.created_at as string)
          : new Date().toISOString(),
    // token / refreshToken fields are intentionally omitted — tokens live
    // exclusively in httpOnly cookies and are invisible to JavaScript.
    token: "",
    refreshToken: "",
  };
}

/** Read the cached public profile from sessionStorage (no secrets). */
function readCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    return null;
  }
}

/** Persist the public profile to sessionStorage for hydration speed. */
function cacheUser(user: AuthUser | null): void {
  if (typeof window === "undefined") return;
  if (user) {
    // Strip any accidental token fields before caching.
    const safe = { ...user, token: "", refreshToken: "" };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const AuthProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  // ── Session probe ──────────────────────────────────────────────────────────
  // We determine whether the user is logged in by fetching their profile.
  // The httpOnly cookie is sent automatically; a 401 means no active session.
  // `placeholderData` hydrates the UI instantly from the sessionStorage cache.

  const profileQuery = useQuery({
    queryKey: AUTH_PROFILE_QUERY_KEY,
    queryFn: async (): Promise<AuthUser | null> => {
      try {
        const profile = await api.getProfile();
        const user = mapBackendUser({
          id: profile.id,
          username: profile.username,
          email: profile.email ?? undefined,
          is_verified: profile.is_verified,
          elo: profile.elo,
          created_at: profile.created_at,
        });
        cacheUser(user);
        return user;
      } catch {
        // 401 or network error → not authenticated
        cacheUser(null);
        return null;
      }
    },
    staleTime: 60_000,
    gcTime: 300_000,
    placeholderData: readCachedUser,
    // Always attempt the probe — the cookie (not a localStorage flag) is the
    // source of truth.
    enabled: true,
    retry: false,
  });

  const user = profileQuery.data ?? null;

  // ── Login ──────────────────────────────────────────────────────────────────

  const login = async (
    credentials: LoginRequest & { rememberMe?: boolean },
  ) => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.login({
        email: credentials.email,
        password: credentials.password,
      });

      // The server has now set the httpOnly cookies.  Pull the user object
      // from the response body — it carries no token values.
      const authUser = mapBackendUser(
        response.user as Parameters<typeof mapBackendUser>[0],
      );

      // Track the public expiry time so wallet guards can check it.
      if (typeof response.expires_in === "number") {
        setTokenExpiresIn(response.expires_in);
      }

      cacheUser(authUser);
      queryClient.setQueryData(AUTH_PROFILE_QUERY_KEY, authUser);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid email or password";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ── Register ───────────────────────────────────────────────────────────────

  const register = async (userData: RegisterRequest) => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.register({
        username: userData.username,
        email: userData.email,
        password: userData.password,
      });

      // Cookies are set by the server; store only the public profile locally.
      const authUser = mapBackendUser(
        response.user as Parameters<typeof mapBackendUser>[0],
      );

      queryClient.setQueryData(AUTH_PROFILE_QUERY_KEY, authUser);

      if (typeof window !== "undefined") {
        localStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, userData.email);
      }
      // Do not cache the full profile until email is verified.
    } catch (err) {
      if (err instanceof AuthApiError && REGISTER_ERROR_MAP[err.code]) {
        throw err;
      }
      const message =
        err instanceof Error ? err.message : "Registration failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ── Verify email ───────────────────────────────────────────────────────────

  const verifyEmail = async (token: string) => {
    try {
      setLoading(true);
      setError(null);
      await api.verifyEmail(token);
      if (user) {
        const updated = { ...user, isVerified: true };
        cacheUser(updated);
        queryClient.setQueryData(AUTH_PROFILE_QUERY_KEY, updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ── Resend verification ────────────────────────────────────────────────────

  const resendVerificationEmail = async (email: string) => {
    try {
      setLoading(true);
      setError(null);
      await api.resendVerificationEmail(email);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to resend verification email";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ── Logout ─────────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    // Tell the server to blacklist the current token and clear cookies.
    // Fire-and-forget — clear local state immediately regardless of outcome.
    api.logout().catch(() => {});

    cacheUser(null);
    clearTokenExpiry();
    if (typeof window !== "undefined") {
      localStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY);
    }
    setError(null);
    queryClient.removeQueries({ queryKey: AUTH_PROFILE_QUERY_KEY });
  }, [queryClient]);

  // ── Token refresh ──────────────────────────────────────────────────────────

  const refreshAccessToken = useCallback(async (): Promise<number> => {
    if (isRefreshingRef.current) return 0;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const expiresIn = await api.refreshAccessToken();
      // Keep the public expiry timestamp in sync after a successful refresh.
      setTokenExpiresIn(expiresIn);
      return expiresIn;
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  // ── Wire auth-failure handler ──────────────────────────────────────────────
  // When ApiClient can't refresh (session truly expired), it calls this so
  // we log the user out and redirect to the login page.

  useEffect(() => {
    api.setOnAuthFailure(() => {
      logout();
      router.push("/login?reason=session_expired");
    });
  }, [logout, router]);

  // ── Context value ──────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        loading,
        error,
        clearError,
        verifyEmail,
        resendVerificationEmail,
        refreshAccessToken,
        isRefreshing,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
