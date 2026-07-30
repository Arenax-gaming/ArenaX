"use client";

import { useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Refresh proactively when the token has less than this many seconds left. */
export const TOKEN_EXPIRY_THRESHOLD_SECONDS = 60;

// ---------------------------------------------------------------------------
// Error sentinel
// ---------------------------------------------------------------------------

/** Thrown by ensureValidToken when a refresh attempt fails. */
export class SessionExpiredError extends Error {
  constructor() {
    super("SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTokenExpiryReturn {
  /**
   * Record the TTL returned by a successful token refresh.
   * Call this after every refreshAccessToken() succeeds.
   */
  recordTokenTTL: (expiresInSeconds: number) => void;

  /**
   * Returns true when the stored expiry timestamp is within
   * TOKEN_EXPIRY_THRESHOLD_SECONDS of now (or has already passed).
   * Returns false if no expiry has been recorded yet — the token was
   * freshly set at login and the server TTL is unknown on the client.
   */
  isExpiringSoon: () => boolean;

  /**
   * Proactively ensures the access token is valid before a wallet
   * transaction that requires backend confirmation:
   *
   *  1. If expiry is known and within threshold → refresh immediately.
   *  2. If the refresh throws → throw SessionExpiredError.
   *  3. If no expiry is recorded (post-login state) → pass through.
   *
   * Always awaited before submitting a transaction.
   */
  ensureValidToken: () => Promise<void>;
}

export function useTokenExpiry(): UseTokenExpiryReturn {
  const { refreshAccessToken } = useAuth();

  /**
   * Epoch ms at which the current access token expires.
   * null = we have not yet recorded a TTL (e.g. fresh login or SSR).
   */
  const expiresAtRef = useRef<number | null>(null);

  const recordTokenTTL = useCallback((expiresInSeconds: number) => {
    expiresAtRef.current = Date.now() + expiresInSeconds * 1_000;
  }, []);

  const isExpiringSoon = useCallback((): boolean => {
    if (expiresAtRef.current === null) return false;
    const secondsRemaining = (expiresAtRef.current - Date.now()) / 1_000;
    return secondsRemaining <= TOKEN_EXPIRY_THRESHOLD_SECONDS;
  }, []);

  const ensureValidToken = useCallback(async (): Promise<void> => {
    if (!isExpiringSoon()) return;

    try {
      const ttl = await refreshAccessToken();
      // refreshAccessToken returns 0 when a concurrent refresh is already
      // in flight — skip updating the stored expiry in that case so we
      // don't accidentally set it to Date.now() + 0 (immediately expired).
      if (ttl > 0) {
        recordTokenTTL(ttl);
      }
    } catch {
      // refreshAccessToken itself threw — session is unrecoverable.
      throw new SessionExpiredError();
    }
  }, [isExpiringSoon, refreshAccessToken, recordTokenTTL]);

  return { recordTokenTTL, isExpiringSoon, ensureValidToken };
}
