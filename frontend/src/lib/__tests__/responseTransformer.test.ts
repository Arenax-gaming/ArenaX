/**
 * Tests for responseTransformer.ts
 */

import {
  snakeToCamel,
  camelToSnake,
  looksLikeDateString,
  transformValue,
  defaultTransform,
  fullTransform,
} from "../responseTransformer";

// ─── snakeToCamel ─────────────────────────────────────────────────────────────

describe("snakeToCamel", () => {
  it("converts simple snake_case", () => {
    expect(snakeToCamel("created_at")).toBe("createdAt");
  });

  it("converts multi-segment keys", () => {
    expect(snakeToCamel("total_pages_count")).toBe("totalPagesCount");
  });

  it("leaves camelCase untouched", () => {
    expect(snakeToCamel("alreadyCamel")).toBe("alreadyCamel");
  });

  it("handles leading underscore gracefully", () => {
    expect(snakeToCamel("_private")).toBe("_private");
  });

  it("handles consecutive underscores", () => {
    expect(snakeToCamel("foo__bar")).toBe("foo_Bar");
  });
});

// ─── camelToSnake ─────────────────────────────────────────────────────────────

describe("camelToSnake", () => {
  it("converts camelCase to snake_case", () => {
    expect(camelToSnake("createdAt")).toBe("created_at");
  });

  it("leaves lowercase untouched", () => {
    expect(camelToSnake("simple")).toBe("simple");
  });
});

// ─── looksLikeDateString ──────────────────────────────────────────────────────

describe("looksLikeDateString", () => {
  it("recognizes ISO-8601 datetime with key hint", () => {
    expect(looksLikeDateString("2024-01-15T10:30:00Z", "created_at")).toBe(true);
  });

  it("recognizes date-only strings with key hint", () => {
    expect(looksLikeDateString("2024-01-15", "start_date")).toBe(true);
  });

  it("rejects non-date string", () => {
    expect(looksLikeDateString("not-a-date", "created_at")).toBe(false);
  });

  it("rejects date string with wrong key name", () => {
    expect(looksLikeDateString("2024-01-15T10:30:00Z", "username")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(looksLikeDateString(12345, "created_at")).toBe(false);
  });
});

// ─── transformValue ───────────────────────────────────────────────────────────

describe("transformValue", () => {
  it("normalizes snake_case keys in an object", () => {
    const input = { user_id: "abc", total_count: 5 };
    const result = transformValue(input, { normalizeCasing: true }) as Record<string, unknown>;
    expect(result).toEqual({ userId: "abc", totalCount: 5 });
  });

  it("recursively normalizes nested objects", () => {
    const input = { outer_key: { inner_key: "value" } };
    const result = transformValue(input, { normalizeCasing: true }) as Record<string, unknown>;
    expect((result.outerKey as Record<string, unknown>).innerKey).toBe("value");
  });

  it("recursively normalizes arrays of objects", () => {
    const input = [{ user_name: "alice" }, { user_name: "bob" }];
    const result = transformValue(input, { normalizeCasing: true }) as Array<Record<string, unknown>>;
    expect(result[0]?.userName).toBe("alice");
    expect(result[1]?.userName).toBe("bob");
  });

  it("strips null values when stripNulls is true", () => {
    const input = { name: "alice", bio: null, age: 25 };
    const result = transformValue(input, { normalizeCasing: false, stripNulls: true }) as Record<string, unknown>;
    expect(result).not.toHaveProperty("bio");
    expect(result.name).toBe("alice");
    expect(result.age).toBe(25);
  });

  it("keeps null values when stripNulls is false", () => {
    const input = { name: "alice", bio: null };
    const result = transformValue(input, { normalizeCasing: false, stripNulls: false }) as Record<string, unknown>;
    expect(result.bio).toBeNull();
  });

  it("parses ISO date strings when parseDates is true", () => {
    const input = { created_at: "2024-01-15T10:30:00Z" };
    const result = transformValue(input, { normalizeCasing: true, parseDates: true }) as Record<string, unknown>;
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("does not parse dates when parseDates is false", () => {
    const input = { created_at: "2024-01-15T10:30:00Z" };
    const result = transformValue(input, { normalizeCasing: true, parseDates: false }) as Record<string, unknown>;
    expect(typeof result.createdAt).toBe("string");
  });

  it("passes through primitives untouched", () => {
    expect(transformValue(42, {})).toBe(42);
    expect(transformValue("hello", {})).toBe("hello");
    expect(transformValue(true, {})).toBe(true);
  });

  it("handles empty objects", () => {
    expect(transformValue({}, { normalizeCasing: true })).toEqual({});
  });

  it("handles empty arrays", () => {
    expect(transformValue([], { normalizeCasing: true })).toEqual([]);
  });
});

// ─── defaultTransform ─────────────────────────────────────────────────────────

describe("defaultTransform", () => {
  it("applies camelCase normalization only", () => {
    const result = defaultTransform<{ userId: string }>({ user_id: "abc" });
    expect(result.userId).toBe("abc");
  });
});

// ─── fullTransform ────────────────────────────────────────────────────────────

describe("fullTransform", () => {
  it("applies normalization and date parsing", () => {
    const result = fullTransform<{ createdAt: Date; userName: string }>({
      created_at: "2024-01-15T00:00:00Z",
      user_name: "alice",
    });
    expect(result.userName).toBe("alice");
    expect(result.createdAt).toBeInstanceOf(Date);
  });
});
