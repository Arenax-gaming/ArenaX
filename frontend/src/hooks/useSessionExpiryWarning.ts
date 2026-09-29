"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Show the countdown warning this many seconds before the token expires (#1090). */
export const SESSION_EXPIRY_WARNING_SECONDS = 120;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSessionExpiryWarningReturn {
  /** True when the token expires within `SESSION_EXPIRY_WARNING_SECONDS`. */
  isOpen: boolean;
  /** Seconds until the token expires, floored at 0. */
  secondsRemaining: number;
  /** "Stay signed in": refreshes the token and (via `isOpen` going false) dismisses the modal. */
  extend: () => Promise<void>;
  /** "Sign out": logs out immediately and redirects to /login. */
  signOut: () => void;
}

/**
 * Drives `SessionTimeoutModal` from the real token expiry (`expiresAt` on
 * `useAuth()`, itself derived from the `expires_in` the backend returns on
 * login/refresh — the access token is an httpOnly cookie and cannot be
 * decoded from JS) rather than from client-side inactivity (#1090).
 *
 * Renders as a no-op (never opens) when there is no signed-in user, so it is
 * safe to mount on public/unauthenticated pages.
 */
export function useSessionExpiryWarning(): UseSessionExpiryWarningReturn {
  const { user, expiresAt, refreshAccessToken, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const hasHandledExpiryRef = useRef(false);

  // A fresh expiry (new login or successful refresh) means any prior
  // expiry-redirect no longer applies.
  useEffect(() => {
    hasHandledExpiryRef.current = false;
  }, [expiresAt]);

  useEffect(() => {
    if (!user || expiresAt === null) {
      setSecondsRemaining(null);
      return;
    }

    const tick = () => {
      const remaining = Math.round((expiresAt - Date.now()) / 1_000);
      setSecondsRemaining(remaining);

      if (remaining <= 0 && !hasHandledExpiryRef.current) {
        hasHandledExpiryRef.current = true;
        logout();
        const query = searchParams?.toString();
        const returnTo = query ? `${pathname}?${query}` : pathname || "/";
        router.push(
          `/login?reason=session_expired&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }
    };

    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [user, expiresAt, logout, router, pathname, searchParams]);

  const extend = useCallback(async () => {
    await refreshAccessToken();
  }, [refreshAccessToken]);

  const signOut = useCallback(() => {
    hasHandledExpiryRef.current = true;
    logout();
    router.push("/login?reason=user_logout");
  }, [logout, router]);

  const isOpen =
    !!user &&
    secondsRemaining !== null &&
    secondsRemaining > 0 &&
    secondsRemaining <= SESSION_EXPIRY_WARNING_SECONDS;

  return {
    isOpen,
    secondsRemaining: secondsRemaining !== null ? Math.max(secondsRemaining, 0) : 0,
    extend,
    signOut,
  };
}
