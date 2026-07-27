/**
 * Unit tests for src/utils/formatting.ts
 */
import {
  formatXLM,
  formatToken,
  formatNGN,
  formatLargeNumber,
  truncateStellarAddress,
  formatTimestamp,
  formatDuration,
  formatFileSize,
  formatPercentage,
  formatOrdinal,
} from "../formatting";

// ─── formatXLM ────────────────────────────────────────────────────────────────
describe("formatXLM", () => {
  it("formats a positive number with default 7 decimals", () => {
    expect(formatXLM(100)).toBe("100.0000000 XLM");
  });

  it("formats a float with specified decimals", () => {
    expect(formatXLM(1.5, 2)).toBe("1.50 XLM");
  });

  it("formats zero", () => {
    expect(formatXLM(0)).toBe("0.0000000 XLM");
  });

  it("formats a numeric string", () => {
    expect(formatXLM("250.123456", 6)).toBe("250.123456 XLM");
  });

  it("clamps decimals to max 7", () => {
    expect(formatXLM(1, 10)).toBe("1.0000000 XLM");
  });

  it("returns fallback for NaN", () => {
    expect(formatXLM(NaN)).toBe("0.0000000 XLM");
  });

  it("formats a large number", () => {
    expect(formatXLM(1_000_000, 2)).toBe("1000000.00 XLM");
  });
});

// ─── formatToken ──────────────────────────────────────────────────────────────
describe("formatToken", () => {
  it("formats a token with default 2 decimals", () => {
    expect(formatToken(100, "AX")).toBe("100.00 AX");
  });

  it("formats a token with custom decimals", () => {
    expect(formatToken(3.14159, "USDC", 4)).toBe("3.1416 USDC");
  });

  it("formats zero", () => {
    expect(formatToken(0, "AX")).toBe("0.00 AX");
  });

  it("formats a numeric string", () => {
    expect(formatToken("500", "REP", 0)).toBe("500 REP");
  });

  it("handles NaN gracefully", () => {
    const result = formatToken(NaN, "AX");
    expect(result).toContain("AX");
  });
});

// ─── formatNGN ───────────────────────────────────────────────────────────────
describe("formatNGN", () => {
  it("formats a positive amount as Naira", () => {
    const result = formatNGN(1000);
    expect(result).toContain("1");
    // Should contain the ₦ symbol or NGN equivalent from Intl
    expect(result.replace(/\s/g, "")).toMatch(/[₦N]/);
  });

  it("formats zero", () => {
    const result = formatNGN(0);
    expect(result).toContain("0");
  });

  it("formats a numeric string", () => {
    const result = formatNGN("2500");
    expect(result).toContain("2");
  });

  it("formats a large amount with thousands separator", () => {
    const result = formatNGN(1_000_000);
    expect(result).toContain("1");
    expect(result.length).toBeGreaterThan(7);
  });

  it("returns fallback for NaN", () => {
    const result = formatNGN(NaN);
    expect(result).toContain("0");
  });
});

// ─── formatLargeNumber ───────────────────────────────────────────────────────
describe("formatLargeNumber", () => {
  it("formats numbers below 1000 as-is", () => {
    expect(formatLargeNumber(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatLargeNumber(1500)).toBe("1.5K");
  });

  it("formats exactly 1000", () => {
    expect(formatLargeNumber(1000)).toBe("1K");
  });

  it("formats millions with M suffix", () => {
    expect(formatLargeNumber(2_500_000)).toBe("2.5M");
  });

  it("formats billions with B suffix", () => {
    expect(formatLargeNumber(3_000_000_000)).toBe("3B");
  });

  it("handles zero", () => {
    expect(formatLargeNumber(0)).toBe("0");
  });

  it("handles negative numbers", () => {
    expect(formatLargeNumber(-2000)).toBe("-2K");
  });

  it("handles NaN gracefully", () => {
    expect(formatLargeNumber(NaN)).toBe("0");
  });
});

// ─── truncateStellarAddress ───────────────────────────────────────────────────
describe("truncateStellarAddress", () => {
  const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  it("truncates with default start=6 end=4", () => {
    const result = truncateStellarAddress(ADDR);
    // ADDR ends in 'FLA5' — last 4 chars
    expect(result).toBe("GBBD47...FLA5");
    expect(result).toContain("...");
  });

  it("truncates with custom start and end", () => {
    const result = truncateStellarAddress(ADDR, 4, 4);
    // first 4: GBBD, last 4: FLA5
    expect(result).toBe("GBBD...FLA5");
  });

  it("returns the address as-is if short enough", () => {
    expect(truncateStellarAddress("GABCDE", 6, 4)).toBe("GABCDE");
  });

  it("returns empty string for empty input", () => {
    expect(truncateStellarAddress("")).toBe("");
  });

  it("handles non-string gracefully", () => {
    expect(truncateStellarAddress(null as unknown as string)).toBe("");
  });
});

// ─── formatTimestamp ─────────────────────────────────────────────────────────
describe("formatTimestamp", () => {
  it("formats a Date object", () => {
    const d = new Date(2024, 0, 15, 10, 30); // Jan 15 2024, 10:30
    const result = formatTimestamp(d);
    expect(result).toBe("15 Jan 2024, 10:30");
  });

  it("formats an ISO string", () => {
    const result = formatTimestamp("2024-06-01T14:00:00.000Z");
    expect(result).toMatch(/01 Jun 2024/);
  });

  it("formats a Unix timestamp in ms", () => {
    const ts = new Date(2023, 11, 25, 0, 0).getTime(); // Dec 25 2023
    const result = formatTimestamp(ts);
    expect(result).toContain("25 Dec 2023");
  });

  it("returns 'Invalid Date' for bad input", () => {
    expect(formatTimestamp("not-a-date")).toBe("Invalid Date");
    expect(formatTimestamp(NaN)).toBe("Invalid Date");
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────
describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("formats a minute exactly", () => {
    expect(formatDuration(60_000)).toBe("1m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(9_000_000)).toBe("2h 30m");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
  });

  it("formats zero as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("handles negative input as 0s", () => {
    expect(formatDuration(-1000)).toBe("0s");
  });

  it("handles NaN as 0s", () => {
    expect(formatDuration(NaN)).toBe("0s");
  });
});

// ─── formatFileSize ───────────────────────────────────────────────────────────
describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1536)).toBe("1.50 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1_048_576)).toBe("1.00 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(2_147_483_648)).toBe("2.00 GB");
  });

  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("handles negative input", () => {
    expect(formatFileSize(-100)).toBe("0 B");
  });
});

// ─── formatPercentage ────────────────────────────────────────────────────────
describe("formatPercentage", () => {
  it("formats a basic percentage", () => {
    expect(formatPercentage(45, 100)).toBe("45.0%");
  });

  it("formats with custom decimal places", () => {
    expect(formatPercentage(1, 3, 2)).toBe("33.33%");
  });

  it("handles zero value", () => {
    expect(formatPercentage(0, 100)).toBe("0.0%");
  });

  it("handles zero total", () => {
    expect(formatPercentage(5, 0)).toBe("0%");
  });

  it("handles 100%", () => {
    expect(formatPercentage(100, 100)).toBe("100.0%");
  });

  it("handles over 100%", () => {
    expect(formatPercentage(150, 100)).toBe("150.0%");
  });
});

// ─── formatOrdinal ────────────────────────────────────────────────────────────
describe("formatOrdinal", () => {
  it("formats 1st", () => {
    expect(formatOrdinal(1)).toBe("1st");
  });

  it("formats 2nd", () => {
    expect(formatOrdinal(2)).toBe("2nd");
  });

  it("formats 3rd", () => {
    expect(formatOrdinal(3)).toBe("3rd");
  });

  it("formats 4th", () => {
    expect(formatOrdinal(4)).toBe("4th");
  });

  it("formats 11th (teen exception)", () => {
    expect(formatOrdinal(11)).toBe("11th");
  });

  it("formats 12th (teen exception)", () => {
    expect(formatOrdinal(12)).toBe("12th");
  });

  it("formats 13th (teen exception)", () => {
    expect(formatOrdinal(13)).toBe("13th");
  });

  it("formats 21st", () => {
    expect(formatOrdinal(21)).toBe("21st");
  });

  it("formats 22nd", () => {
    expect(formatOrdinal(22)).toBe("22nd");
  });

  it("formats 100th", () => {
    expect(formatOrdinal(100)).toBe("100th");
  });

  it("formats 101st", () => {
    expect(formatOrdinal(101)).toBe("101st");
  });

  it("formats 111th (teen exception at 111)", () => {
    expect(formatOrdinal(111)).toBe("111th");
  });
});
