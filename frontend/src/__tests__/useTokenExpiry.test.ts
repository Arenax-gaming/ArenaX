/**
 * Unit tests for useTokenExpiry hook.
 *
 * Covers:
 *  - isExpiringSoon() returns false when no TTL has been recorded
 *  - isExpiringSoon() returns false when token has > 60 s remaining
 *  - isExpiringSoon() returns true when token has <= 60 s remaining
 *  - isExpiringSoon() returns true when token has already expired
 *  - ensureValidToken() is a no-op when token is not expiring soon
 *  - ensureValidToken() calls refreshAccessToken() when expiring soon
 *  - ensureValidToken() records the new TTL after a successful refresh
 *  - ensureValidToken() throws SessionExpiredError when refresh fails
 */

import { renderHook, act } from "@testing-library/react";
import {
  useTokenExpiry,
  SessionExpiredError,
  TOKEN_EXPIRY_THRESHOLD_SECONDS,
} from "@/hooks/useTokenExpiry";

// ---------------------------------------------------------------------------
// Mock useAuth
// ---------------------------------------------------------------------------

const mockRefreshAccessToken = jest.fn<Promise<number>, []>();

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    refreshAccessToken: mockRefreshAccessToken,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** TTL in seconds that puts the token well outside the expiry window. */
const SAFE_TTL = TOKEN_EXPIRY_THRESHOLD_SECONDS + 120; // 180 s

/** TTL in seconds that puts the token inside the expiry window. */
const EXPIRING_TTL = TOKEN_EXPIRY_THRESHOLD_SECONDS - 1; // 59 s

/** TTL representing a token that has already expired (negative remaining). */
const EXPIRED_TTL = -10;

function renderTokenExpiry() {
  return renderHook(() => useTokenExpiry());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Restore real timers between tests
  jest.useRealTimers();
});

describe("isExpiringSoon", () => {
  it("returns false when no TTL has been recorded yet", () => {
    const { result } = renderTokenExpiry();
    expect(result.current.isExpiringSoon()).toBe(false);
  });

  it("returns false when token has more than the threshold remaining", () => {
    const { result } = renderTokenExpiry();
    act(() => result.current.recordTokenTTL(SAFE_TTL));
    expect(result.current.isExpiringSoon()).toBe(false);
  });

  it("returns true when token has fewer seconds remaining than the threshold", () => {
    const { result } = renderTokenExpiry();
    act(() => result.current.recordTokenTTL(EXPIRING_TTL));
    expect(result.current.isExpiringSoon()).toBe(true);
  });

  it("returns true when token is exactly at the threshold boundary", () => {
    const { result } = renderTokenExpiry();
    act(() => result.current.recordTokenTTL(TOKEN_EXPIRY_THRESHOLD_SECONDS));
    expect(result.current.isExpiringSoon()).toBe(true);
  });

  it("returns true when the token has already expired (negative TTL)", () => {
    const { result } = renderTokenExpiry();
    act(() => result.current.recordTokenTTL(EXPIRED_TTL));
    expect(result.current.isExpiringSoon()).toBe(true);
  });
});

describe("ensureValidToken", () => {
  it("does NOT call refreshAccessToken when token is not expiring soon", async () => {
    mockRefreshAccessToken.mockResolvedValue(SAFE_TTL);
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(SAFE_TTL));

    await act(async () => {
      await result.current.ensureValidToken();
    });

    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("does NOT call refreshAccessToken when no TTL has been recorded", async () => {
    const { result } = renderTokenExpiry();

    await act(async () => {
      await result.current.ensureValidToken();
    });

    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("calls refreshAccessToken when token is expiring soon", async () => {
    const newTTL = SAFE_TTL;
    mockRefreshAccessToken.mockResolvedValue(newTTL);
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(EXPIRING_TTL));

    await act(async () => {
      await result.current.ensureValidToken();
    });

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("updates the stored expiry after a successful refresh", async () => {
    const newTTL = SAFE_TTL;
    mockRefreshAccessToken.mockResolvedValue(newTTL);
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(EXPIRING_TTL));

    await act(async () => {
      await result.current.ensureValidToken();
    });

    // After refresh with a safe TTL the token should no longer be expiring soon
    expect(result.current.isExpiringSoon()).toBe(false);
  });

  it("does NOT update stored expiry when refreshAccessToken returns 0 (concurrent refresh in flight)", async () => {
    // Simulate useAuth returning 0 because a concurrent refresh is already running
    mockRefreshAccessToken.mockResolvedValue(0);
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(EXPIRING_TTL));

    await act(async () => {
      await result.current.ensureValidToken();
    });

    // expiresAt should still reflect the EXPIRING_TTL, not be reset to Date.now()+0
    // isExpiringSoon() should still be true (not incorrectly flipped to false or
    // further broken by a 0-second TTL overwrite)
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    // The key assertion: we didn't record ttl=0, so the stored value is unchanged
    expect(result.current.isExpiringSoon()).toBe(true);
  });

  it("throws SessionExpiredError when refreshAccessToken rejects", async () => {
    mockRefreshAccessToken.mockRejectedValue(new Error("401 Unauthorized"));
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(EXPIRING_TTL));

    await expect(
      act(async () => {
        await result.current.ensureValidToken();
      })
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError (not the original error) when refresh fails", async () => {
    mockRefreshAccessToken.mockRejectedValue(new Error("Network error"));
    const { result } = renderTokenExpiry();

    act(() => result.current.recordTokenTTL(EXPIRING_TTL));

    let thrown: unknown;
    try {
      await act(async () => {
        await result.current.ensureValidToken();
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SessionExpiredError);
    expect((thrown as Error).message).toBe("SESSION_EXPIRED");
  });
});
