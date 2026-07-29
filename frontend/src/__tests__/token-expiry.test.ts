/**
 * Unit tests for src/lib/wallet/tokenExpiry.ts
 *
 * Covers:
 *   - setTokenExpiresIn / getTokenExpiresAt round-trip
 *   - clearTokenExpiry
 *   - isTokenNearExpiry: true when within threshold, false when far away
 *   - isTokenNearExpiry: true when no timestamp recorded (unknown → conservative)
 *   - isTokenExpired: true past expiry, false before
 *   - tokenRemainingMs: correct duration, 0 when expired or unknown
 *   - Custom threshold override on isTokenNearExpiry
 */

import {
  setTokenExpiresIn,
  getTokenExpiresAt,
  clearTokenExpiry,
  isTokenNearExpiry,
  isTokenExpired,
  tokenRemainingMs,
  EXPIRY_THRESHOLD_MS,
} from "@/lib/wallet/tokenExpiry";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Start each test with a clean sessionStorage so tests are isolated.
  sessionStorage.clear();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// setTokenExpiresIn / getTokenExpiresAt
// ---------------------------------------------------------------------------

describe("setTokenExpiresIn / getTokenExpiresAt", () => {
  it("stores expiresAt as Date.now() + expiresInSeconds * 1000", () => {
    const before = Date.now();
    setTokenExpiresIn(900); // 15 minutes
    const after = Date.now();

    const stored = getTokenExpiresAt();
    expect(stored).not.toBeNull();
    expect(stored!).toBeGreaterThanOrEqual(before + 900_000);
    expect(stored!).toBeLessThanOrEqual(after + 900_000);
  });

  it("returns null when nothing has been stored", () => {
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("overwrites a previous value", () => {
    setTokenExpiresIn(300);
    const first = getTokenExpiresAt();

    setTokenExpiresIn(900);
    const second = getTokenExpiresAt();

    expect(second).toBeGreaterThan(first!);
  });
});

// ---------------------------------------------------------------------------
// clearTokenExpiry
// ---------------------------------------------------------------------------

describe("clearTokenExpiry", () => {
  it("removes the stored timestamp so getTokenExpiresAt returns null", () => {
    setTokenExpiresIn(900);
    expect(getTokenExpiresAt()).not.toBeNull();

    clearTokenExpiry();
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearTokenExpiry()).not.toThrow();
    expect(getTokenExpiresAt()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTokenNearExpiry
// ---------------------------------------------------------------------------

describe("isTokenNearExpiry", () => {
  it("returns true when no expiry has been set (unknown → conservative)", () => {
    expect(isTokenNearExpiry()).toBe(true);
  });

  it("returns false when token expires well beyond the threshold", () => {
    // Token valid for 10 minutes — 600 s > 60 s threshold
    setTokenExpiresIn(600);
    expect(isTokenNearExpiry()).toBe(false);
  });

  it("returns true when remaining lifetime is less than the threshold", () => {
    // Pin Date.now to a fixed value so we control the expiry arithmetic.
    const NOW = 1_000_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(NOW);

    // Token expires in 30 s from NOW — inside the 60 s default threshold.
    setTokenExpiresIn(30);

    expect(isTokenNearExpiry()).toBe(true);
  });

  it("returns false when remaining lifetime is exactly at the threshold boundary", () => {
    const NOW = 1_000_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(NOW);

    // Token expires in exactly EXPIRY_THRESHOLD_MS ms from NOW.
    // Date.now() === expiresAt - threshold → not yet inside the window.
    setTokenExpiresIn(EXPIRY_THRESHOLD_MS / 1_000); // threshold in seconds
    expect(isTokenNearExpiry()).toBe(false);
  });

  it("returns true when the token is already expired", () => {
    setTokenExpiresIn(1); // 1 second
    // Advance time past expiry
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000);
    expect(isTokenNearExpiry()).toBe(true);
  });

  it("respects a custom threshold override", () => {
    setTokenExpiresIn(120); // 2 minutes
    // With default 60 s threshold → not near expiry
    expect(isTokenNearExpiry()).toBe(false);
    // With a 3-minute custom threshold → near expiry
    expect(isTokenNearExpiry(180_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe("isTokenExpired", () => {
  it("returns true when no expiry is stored", () => {
    expect(isTokenExpired()).toBe(true);
  });

  it("returns false before the expiry time", () => {
    setTokenExpiresIn(300); // 5 minutes
    expect(isTokenExpired()).toBe(false);
  });

  it("returns true exactly at the expiry time", () => {
    setTokenExpiresIn(300);
    const expiresAt = getTokenExpiresAt()!;
    jest.spyOn(Date, "now").mockReturnValue(expiresAt);
    expect(isTokenExpired()).toBe(true);
  });

  it("returns true after the expiry time", () => {
    setTokenExpiresIn(1);
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    expect(isTokenExpired()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tokenRemainingMs
// ---------------------------------------------------------------------------

describe("tokenRemainingMs", () => {
  it("returns 0 when no expiry is stored", () => {
    expect(tokenRemainingMs()).toBe(0);
  });

  it("returns the approximate remaining milliseconds for a fresh token", () => {
    setTokenExpiresIn(300); // 300 s = 300 000 ms
    const remaining = tokenRemainingMs();
    // Allow ±500 ms for test execution time
    expect(remaining).toBeGreaterThanOrEqual(299_500);
    expect(remaining).toBeLessThanOrEqual(300_000);
  });

  it("returns 0 when the token has already expired", () => {
    setTokenExpiresIn(1);
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    expect(tokenRemainingMs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EXPIRY_THRESHOLD_MS constant
// ---------------------------------------------------------------------------

describe("EXPIRY_THRESHOLD_MS", () => {
  it("equals 60 000 ms (60 seconds)", () => {
    expect(EXPIRY_THRESHOLD_MS).toBe(60_000);
  });
});
