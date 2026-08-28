/**
 * Tests for custom domain validators.
 */

import { Validators, STELLAR_PUBLIC_KEY_REGEX } from "../validators";

// ─── STELLAR_PUBLIC_KEY_REGEX ─────────────────────────────────────────────────

describe("STELLAR_PUBLIC_KEY_REGEX", () => {
  it("matches a valid Stellar public key", () => {
    // Valid base32: G + 55 chars from A-Z, 2-7
    expect(STELLAR_PUBLIC_KEY_REGEX.test("G" + "A".repeat(55))).toBe(true);
    // G + 55 base32 characters (classic Stellar G-key length)
    expect(STELLAR_PUBLIC_KEY_REGEX.test("GABC2345DEFG67" + "A".repeat(42))).toBe(true);
  });

  it("rejects keys not starting with G", () => {
    expect(STELLAR_PUBLIC_KEY_REGEX.test("S" + "A".repeat(55))).toBe(false);
  });

  it("rejects keys with invalid base32 chars (0, 1, 8, 9)", () => {
    expect(STELLAR_PUBLIC_KEY_REGEX.test("G" + "0".repeat(55))).toBe(false);
    expect(STELLAR_PUBLIC_KEY_REGEX.test("G" + "1".repeat(55))).toBe(false);
  });

  it("rejects keys that are too short or too long", () => {
    expect(STELLAR_PUBLIC_KEY_REGEX.test("G" + "A".repeat(54))).toBe(false);
    expect(STELLAR_PUBLIC_KEY_REGEX.test("G" + "A".repeat(56))).toBe(false);
  });
});

// ─── Validators.stellarAddress ────────────────────────────────────────────────

describe("Validators.stellarAddress()", () => {
  const schema = Validators.stellarAddress();

  it("accepts a valid Stellar address", () => {
    expect(schema.safeParse("G" + "A".repeat(55)).success).toBe(true);
  });

  it("rejects an invalid address", () => {
    expect(schema.safeParse("NOTASTELLAR").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(schema.safeParse("").success).toBe(false);
  });

  it("returns optional schema when optional: true", () => {
    const s = Validators.stellarAddress({ optional: true });
    expect(s.safeParse(undefined).success).toBe(true);
  });

  it("uses custom message", () => {
    const s = Validators.stellarAddress({ message: "Bad address" });
    const result = s.safeParse("INVALID");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Bad address");
  });
});

// ─── Validators.stellarMemo ───────────────────────────────────────────────────

describe("Validators.stellarMemo()", () => {
  const schema = Validators.stellarMemo();

  it("accepts undefined (optional)", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it("accepts memo within 28 bytes", () => {
    expect(schema.safeParse("hello memo").success).toBe(true);
  });

  it("accepts exactly 28 ASCII characters", () => {
    expect(schema.safeParse("a".repeat(28)).success).toBe(true);
  });

  it("rejects memo over 28 bytes", () => {
    expect(schema.safeParse("a".repeat(29)).success).toBe(false);
  });
});

// ─── Validators.entryFee ─────────────────────────────────────────────────────

describe("Validators.entryFee()", () => {
  const schema = Validators.entryFee();

  it("accepts zero (free tournament)", () => {
    expect(schema.safeParse(0).success).toBe(true);
  });

  it("accepts positive fee", () => {
    expect(schema.safeParse(10).success).toBe(true);
  });

  it("rejects negative fee", () => {
    expect(schema.safeParse(-1).success).toBe(false);
  });

  it("rejects fee over default max", () => {
    expect(schema.safeParse(10_001).success).toBe(false);
  });

  it("respects custom maxFee", () => {
    const s = Validators.entryFee({ maxFee: 100 });
    expect(s.safeParse(99).success).toBe(true);
    expect(s.safeParse(101).success).toBe(false);
  });
});

// ─── Validators.maxParticipants ───────────────────────────────────────────────

describe("Validators.maxParticipants()", () => {
  const schema = Validators.maxParticipants();

  it("accepts powers of 2", () => {
    [4, 8, 16, 32, 64, 128, 256].forEach((v) => {
      expect(schema.safeParse(v).success).toBe(true);
    });
  });

  it("rejects non-powers of 2", () => {
    [3, 5, 10, 15, 100].forEach((v) => {
      expect(schema.safeParse(v).success).toBe(false);
    });
  });

  it("accepts any positive integer when allowAny: true", () => {
    const s = Validators.maxParticipants({ allowAny: true, min: 2, max: 1024 });
    expect(s.safeParse(10).success).toBe(true);
    expect(s.safeParse(1025).success).toBe(false);
    expect(s.safeParse(1).success).toBe(false);
  });

  it("rejects floats", () => {
    expect(schema.safeParse(8.5).success).toBe(false);
  });
});

// ─── Validators.eloRating ────────────────────────────────────────────────────

describe("Validators.eloRating()", () => {
  const schema = Validators.eloRating();

  it("accepts valid ELO", () => {
    expect(schema.safeParse(1200).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(true);
  });

  it("rejects negative ELO", () => {
    expect(schema.safeParse(-1).success).toBe(false);
  });

  it("rejects float", () => {
    expect(schema.safeParse(1200.5).success).toBe(false);
  });

  it("rejects over max", () => {
    expect(schema.safeParse(10_000).success).toBe(false);
  });
});

// ─── Validators.discordHandle ────────────────────────────────────────────────

describe("Validators.discordHandle()", () => {
  const schema = Validators.discordHandle({ optional: true });

  it("accepts undefined (optional)", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it("accepts legacy user#1234 format", () => {
    expect(schema.safeParse("User#1234").success).toBe(true);
  });

  it("accepts modern username format", () => {
    expect(schema.safeParse("modernuser").success).toBe(true);
  });

  it("rejects handles that are too long", () => {
    expect(schema.safeParse("a".repeat(101)).success).toBe(false);
  });
});

// ─── Validators.matchScore ───────────────────────────────────────────────────

describe("Validators.matchScore()", () => {
  const schema = Validators.matchScore();

  it("accepts zero", () => {
    expect(schema.safeParse(0).success).toBe(true);
  });

  it("accepts positive integers", () => {
    expect(schema.safeParse(3).success).toBe(true);
  });

  it("rejects negative", () => {
    expect(schema.safeParse(-1).success).toBe(false);
  });

  it("rejects float", () => {
    expect(schema.safeParse(1.5).success).toBe(false);
  });
});

// ─── Validators.uuid ─────────────────────────────────────────────────────────

describe("Validators.uuid()", () => {
  const schema = Validators.uuid();

  it("accepts a valid UUID v4", () => {
    expect(schema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(schema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("accepts undefined when optional: true", () => {
    const s = Validators.uuid({ optional: true });
    expect(s.safeParse(undefined).success).toBe(true);
  });
});

// ─── Validators.page / limit ─────────────────────────────────────────────────

describe("Validators.page()", () => {
  it("accepts undefined (optional)", () => {
    expect(Validators.page().safeParse(undefined).success).toBe(true);
  });

  it("accepts positive page number", () => {
    expect(Validators.page().safeParse(2).success).toBe(true);
  });

  it("rejects page 0", () => {
    expect(Validators.page().safeParse(0).success).toBe(false);
  });
});

describe("Validators.limit()", () => {
  it("accepts valid limit", () => {
    expect(Validators.limit().safeParse(20).success).toBe(true);
  });

  it("rejects 0", () => {
    expect(Validators.limit().safeParse(0).success).toBe(false);
  });

  it("rejects over max", () => {
    expect(Validators.limit({ max: 50 }).safeParse(51).success).toBe(false);
  });
});
