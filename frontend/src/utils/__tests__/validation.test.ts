/**
 * Unit tests for src/utils/validation.ts
 */
import {
  isValidEmail,
  isValidStellarAddress,
  isValidStellarMemo,
  isValidUsername,
  isValidPhoneNumber,
  isPositiveNumber,
  isValidAmount,
  isNonEmptyString,
  isValidUrl,
} from "../validation";

// ─── isValidEmail ─────────────────────────────────────────────────────────────
describe("isValidEmail", () => {
  it("accepts a standard email", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("accepts email with subdomains", () => {
    expect(isValidEmail("user@mail.example.co.uk")).toBe(true);
  });

  it("accepts email with plus sign", () => {
    expect(isValidEmail("user+tag@example.com")).toBe(true);
  });

  it("accepts email with dots in local part", () => {
    expect(isValidEmail("first.last@domain.org")).toBe(true);
  });

  it("rejects email without @", () => {
    expect(isValidEmail("userexample.com")).toBe(false);
  });

  it("rejects email without TLD", () => {
    expect(isValidEmail("user@example")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(isValidEmail("   ")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidEmail(null as unknown as string)).toBe(false);
    expect(isValidEmail(undefined as unknown as string)).toBe(false);
    expect(isValidEmail(42 as unknown as string)).toBe(false);
  });

  it("rejects email exceeding 254 chars", () => {
    // 250 local-part chars + @b.com = 256 total chars → exceeds 254
    const long = "a".repeat(250) + "@b.com";
    expect(isValidEmail(long)).toBe(false);
  });

  it("rejects email with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });
});

// ─── isValidStellarAddress ────────────────────────────────────────────────────
describe("isValidStellarAddress", () => {
  // Valid Stellar testnet address (56 chars, starts with G, base32)
  const VALID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  it("accepts a valid Stellar public key", () => {
    expect(isValidStellarAddress(VALID)).toBe(true);
  });

  it("rejects an address that is too short", () => {
    expect(isValidStellarAddress(VALID.slice(0, 55))).toBe(false);
  });

  it("rejects an address that is too long", () => {
    expect(isValidStellarAddress(VALID + "A")).toBe(false);
  });

  it("rejects an address not starting with G", () => {
    expect(isValidStellarAddress("A" + VALID.slice(1))).toBe(false);
  });

  it("rejects lowercase letters", () => {
    expect(isValidStellarAddress(VALID.toLowerCase())).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidStellarAddress(null as unknown as string)).toBe(false);
  });
});

// ─── isValidStellarMemo ───────────────────────────────────────────────────────
describe("isValidStellarMemo", () => {
  it("accepts an empty memo", () => {
    expect(isValidStellarMemo("")).toBe(true);
  });

  it("accepts a memo of exactly 28 bytes (ASCII)", () => {
    expect(isValidStellarMemo("a".repeat(28))).toBe(true);
  });

  it("rejects a memo of 29 ASCII bytes", () => {
    expect(isValidStellarMemo("a".repeat(29))).toBe(false);
  });

  it("accepts a short multibyte memo within 28 bytes", () => {
    // 9 × 3-byte characters = 27 bytes
    expect(isValidStellarMemo("あいうえおかきく")).toBe(true); // 8 × 3 = 24 bytes
  });

  it("rejects a multibyte memo exceeding 28 bytes", () => {
    // 10 × 3-byte characters = 30 bytes
    expect(isValidStellarMemo("あ".repeat(10))).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidStellarMemo(null as unknown as string)).toBe(false);
  });
});

// ─── isValidUsername ──────────────────────────────────────────────────────────
describe("isValidUsername", () => {
  it("accepts a simple alphanumeric username", () => {
    expect(isValidUsername("player1")).toBe(true);
  });

  it("accepts a username with underscores in the middle", () => {
    expect(isValidUsername("cool_player")).toBe(true);
  });

  it("accepts minimum length (3 chars)", () => {
    expect(isValidUsername("abc")).toBe(true);
  });

  it("accepts maximum length (20 chars)", () => {
    expect(isValidUsername("a".repeat(20))).toBe(true);
  });

  it("rejects username shorter than 3 chars", () => {
    expect(isValidUsername("ab")).toBe(false);
  });

  it("rejects username longer than 20 chars", () => {
    expect(isValidUsername("a".repeat(21))).toBe(false);
  });

  it("rejects username starting with underscore", () => {
    expect(isValidUsername("_player")).toBe(false);
  });

  it("rejects username ending with underscore", () => {
    expect(isValidUsername("player_")).toBe(false);
  });

  it("rejects username with special characters", () => {
    expect(isValidUsername("play-er")).toBe(false);
    expect(isValidUsername("player!")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUsername("")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidUsername(null as unknown as string)).toBe(false);
  });
});

// ─── isValidPhoneNumber ───────────────────────────────────────────────────────
describe("isValidPhoneNumber", () => {
  it("accepts a Nigerian phone number with +", () => {
    expect(isValidPhoneNumber("+2348012345678")).toBe(true);
  });

  it("accepts a phone number without +", () => {
    expect(isValidPhoneNumber("2348012345678")).toBe(true);
  });

  it("accepts minimum length (7 digits)", () => {
    expect(isValidPhoneNumber("1234567")).toBe(true);
  });

  it("accepts maximum length (15 digits)", () => {
    expect(isValidPhoneNumber("1".repeat(15))).toBe(true);
  });

  it("rejects fewer than 7 digits", () => {
    expect(isValidPhoneNumber("123456")).toBe(false);
  });

  it("rejects more than 15 digits", () => {
    expect(isValidPhoneNumber("1".repeat(16))).toBe(false);
  });

  it("rejects phone with letters", () => {
    expect(isValidPhoneNumber("+1-800-FLOWERS")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPhoneNumber("")).toBe(false);
  });
});

// ─── isPositiveNumber ─────────────────────────────────────────────────────────
describe("isPositiveNumber", () => {
  it("returns true for a positive integer", () => {
    expect(isPositiveNumber(5)).toBe(true);
  });

  it("returns true for a positive float", () => {
    expect(isPositiveNumber(0.001)).toBe(true);
  });

  it("returns true for a numeric string", () => {
    expect(isPositiveNumber("3.14")).toBe(true);
  });

  it("returns false for zero", () => {
    expect(isPositiveNumber(0)).toBe(false);
  });

  it("returns false for a negative number", () => {
    expect(isPositiveNumber(-1)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isPositiveNumber(NaN)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isPositiveNumber(Infinity)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPositiveNumber("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPositiveNumber(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPositiveNumber(undefined)).toBe(false);
  });

  it("returns false for a non-numeric string", () => {
    expect(isPositiveNumber("abc")).toBe(false);
  });
});

// ─── isValidAmount ────────────────────────────────────────────────────────────
describe("isValidAmount", () => {
  it("returns true for a positive number", () => {
    expect(isValidAmount(100)).toBe(true);
  });

  it("returns true for a positive numeric string", () => {
    expect(isValidAmount("50.25")).toBe(true);
  });

  it("returns false for zero", () => {
    expect(isValidAmount(0)).toBe(false);
  });

  it("returns false for negative number", () => {
    expect(isValidAmount(-5)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidAmount("")).toBe(false);
  });

  it("returns false for non-numeric string", () => {
    expect(isValidAmount("abc")).toBe(false);
  });
});

// ─── isNonEmptyString ─────────────────────────────────────────────────────────
describe("isNonEmptyString", () => {
  it("returns true for a non-empty string", () => {
    expect(isNonEmptyString("hello")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  it("returns false for a whitespace-only string", () => {
    expect(isNonEmptyString("   ")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isNonEmptyString(42)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isNonEmptyString([])).toBe(false);
  });
});

// ─── isValidUrl ───────────────────────────────────────────────────────────────
describe("isValidUrl", () => {
  it("accepts an https URL", () => {
    expect(isValidUrl("https://arenax.gg")).toBe(true);
  });

  it("accepts an http URL", () => {
    expect(isValidUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects a javascript: URL", () => {
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a relative path", () => {
    expect(isValidUrl("/dashboard")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUrl("")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(isValidUrl("not a url")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidUrl(null as unknown as string)).toBe(false);
  });

  it("accepts URL with path and query params", () => {
    expect(isValidUrl("https://api.example.com/v1/users?page=1&limit=20")).toBe(true);
  });
});
