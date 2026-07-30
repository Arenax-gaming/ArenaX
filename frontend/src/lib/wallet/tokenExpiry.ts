/**
 * Token expiry tracking for wallet transaction guards.
 *
 * Because auth tokens live exclusively in httpOnly cookies (invisible to JS),
 * we track the *public* expiry timestamp derived from the `expires_in` field
 * returned by the login and refresh endpoints. Only the timestamp is stored —
 * never the token itself.
 *
 * Storage key lives in sessionStorage so it is cleared on tab close and never
 * persists across browser sessions.
 */

const EXPIRY_KEY = "arenax_token_expiry_at";

/**
 * Threshold in milliseconds. If the token expires within this window we treat
 * it as "about to expire" and proactively refresh before a transaction.
 */
export const EXPIRY_THRESHOLD_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * Persist the token expiry time.
 * Call this after a successful login or token refresh with the `expires_in`
 * value (seconds) returned by the server.
 */
export function setTokenExpiresIn(expiresInSeconds: number): void {
  if (typeof window === "undefined") return;
  const expiresAt = Date.now() + expiresInSeconds * 1_000;
  sessionStorage.setItem(EXPIRY_KEY, String(expiresAt));
}

/**
 * Return the stored expiry timestamp (ms since epoch), or null if unknown.
 */
export function getTokenExpiresAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(EXPIRY_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Remove the stored expiry — call on logout. */
export function clearTokenExpiry(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(EXPIRY_KEY);
}

// ---------------------------------------------------------------------------
// Expiry checks
// ---------------------------------------------------------------------------

/**
 * Returns true when the stored token will expire within `thresholdMs`
 * milliseconds (default: 60 s) OR when no expiry timestamp is recorded
 * (unknown state is treated conservatively as near-expiry).
 */
export function isTokenNearExpiry(thresholdMs = EXPIRY_THRESHOLD_MS): boolean {
  const expiresAt = getTokenExpiresAt();
  if (expiresAt === null) return true; // unknown → assume needs refresh
  return Date.now() >= expiresAt - thresholdMs;
}

/**
 * Returns true when the token has already passed its expiry time.
 */
export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (expiresAt === null) return true;
  return Date.now() >= expiresAt;
}

/**
 * Remaining lifetime in milliseconds. Returns 0 if expired or unknown.
 */
export function tokenRemainingMs(): number {
  const expiresAt = getTokenExpiresAt();
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - Date.now());
}
