/**
 * Tests for the declarative Field builder API.
 */

import { Field, mustMatch, requiredWhen } from "../fields";
import { z } from "zod";

// ─── Field.email ──────────────────────────────────────────────────────────────

describe("Field.email()", () => {
  const schema = Field.email();

  it("accepts a valid email", () => {
    expect(schema.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = schema.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].message).toContain("required");
  });

  it("rejects invalid format", () => {
    expect(schema.safeParse("not-an-email").success).toBe(false);
  });

  it("rejects email over 254 chars", () => {
    expect(schema.safeParse("a".repeat(250) + "@b.com").success).toBe(false);
  });

  it("uses custom requiredMessage", () => {
    const s = Field.email({ requiredMessage: "Email needed" });
    const result = s.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Email needed");
  });

  it("uses custom message for format error", () => {
    const s = Field.email({ message: "Bad email" });
    const result = s.safeParse("notvalid");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Bad email");
  });
});

// ─── Field.username ───────────────────────────────────────────────────────────

describe("Field.username()", () => {
  const schema = Field.username();

  it("accepts valid usernames", () => {
    expect(schema.safeParse("Alice123").success).toBe(true);
    expect(schema.safeParse("abc").success).toBe(true);
  });

  it("rejects too short", () => {
    expect(schema.safeParse("ab").success).toBe(false);
  });

  it("rejects too long", () => {
    expect(schema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it("rejects special characters", () => {
    expect(schema.safeParse("user@name").success).toBe(false);
  });

  it("allows underscores when allowUnderscore is true", () => {
    const s = Field.username({ allowUnderscore: true });
    expect(s.safeParse("user_name").success).toBe(true);
    expect(s.safeParse("user@name").success).toBe(false);
  });

  it("accepts custom min/max", () => {
    const s = Field.username({ min: 2, max: 30 });
    expect(s.safeParse("ab").success).toBe(true);
    expect(s.safeParse("a".repeat(31)).success).toBe(false);
  });
});

// ─── Field.password ───────────────────────────────────────────────────────────

describe("Field.password()", () => {
  const schema = Field.password();

  it("accepts a strong password", () => {
    expect(schema.safeParse("Password1!").success).toBe(true);
  });

  it("rejects too short", () => {
    expect(schema.safeParse("Pass1!").success).toBe(false);
  });

  it("rejects missing uppercase", () => {
    expect(schema.safeParse("password1!").success).toBe(false);
  });

  it("rejects missing number", () => {
    expect(schema.safeParse("Password!!").success).toBe(false);
  });

  it("rejects missing special character", () => {
    expect(schema.safeParse("Password1").success).toBe(false);
  });

  it("allows relaxed requirements", () => {
    const s = Field.password({
      requireUppercase: false,
      requireNumber: false,
      requireSpecial: false,
      min: 6,
    });
    expect(s.safeParse("simple").success).toBe(true);
  });
});

// ─── Field.passwordLogin ──────────────────────────────────────────────────────

describe("Field.passwordLogin()", () => {
  const schema = Field.passwordLogin();

  it("accepts any non-empty string", () => {
    expect(schema.safeParse("anypassword").success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(schema.safeParse("").success).toBe(false);
  });
});

// ─── Field.text ───────────────────────────────────────────────────────────────

describe("Field.text()", () => {
  it("rejects empty string by default", () => {
    expect(Field.text().safeParse("").success).toBe(false);
  });

  it("enforces min and max", () => {
    const s = Field.text({ min: 3, max: 10 });
    expect(s.safeParse("ab").success).toBe(false);
    expect(s.safeParse("abc").success).toBe(true);
    expect(s.safeParse("a".repeat(11)).success).toBe(false);
    expect(s.safeParse("a".repeat(10)).success).toBe(true);
  });

  it("returns optional schema when optional: true", () => {
    const s = Field.text({ optional: true });
    expect(s.safeParse(undefined).success).toBe(true);
  });

  it("uses custom minMessage and maxMessage", () => {
    const s = Field.text({ min: 5, minMessage: "Too short!", max: 10, maxMessage: "Too long!" });
    let result = s.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Too short!");
    result = s.safeParse("a".repeat(11));
    if (!result.success) expect(result.error.issues[0].message).toBe("Too long!");
  });
});

// ─── Field.optionalText ───────────────────────────────────────────────────────

describe("Field.optionalText()", () => {
  it("accepts undefined", () => {
    expect(Field.optionalText().safeParse(undefined).success).toBe(true);
  });

  it("accepts empty string", () => {
    expect(Field.optionalText().safeParse("").success).toBe(true);
  });

  it("enforces max when provided", () => {
    const s = Field.optionalText({ max: 10 });
    expect(s.safeParse("a".repeat(11)).success).toBe(false);
  });
});

// ─── Field.integer ────────────────────────────────────────────────────────────

describe("Field.integer()", () => {
  it("accepts a valid integer", () => {
    expect(Field.integer({ min: 1, max: 100 }).safeParse(50).success).toBe(true);
  });

  it("rejects a float", () => {
    expect(Field.integer().safeParse(1.5).success).toBe(false);
  });

  it("rejects below min", () => {
    expect(Field.integer({ min: 5 }).safeParse(3).success).toBe(false);
  });

  it("rejects above max", () => {
    expect(Field.integer({ max: 10 }).safeParse(11).success).toBe(false);
  });

  it("returns optional schema when optional: true", () => {
    expect(Field.integer({ optional: true }).safeParse(undefined).success).toBe(true);
  });
});

// ─── Field.positiveAmountString ───────────────────────────────────────────────

describe("Field.positiveAmountString()", () => {
  const schema = Field.positiveAmountString();

  it("accepts positive numeric strings", () => {
    expect(schema.safeParse("10").success).toBe(true);
    expect(schema.safeParse("0.001").success).toBe(true);
  });

  it("rejects zero", () => {
    expect(schema.safeParse("0").success).toBe(false);
  });

  it("rejects negative", () => {
    expect(schema.safeParse("-5").success).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    expect(schema.safeParse("abc").success).toBe(false);
  });
});

// ─── Field.enum ──────────────────────────────────────────────────────────────

describe("Field.enum()", () => {
  const schema = Field.enum(["a", "b", "c"] as const);

  it("accepts valid values", () => {
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("c").success).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(schema.safeParse("d").success).toBe(false);
  });
});

// ─── Field.mustBeTrue ────────────────────────────────────────────────────────

describe("Field.mustBeTrue()", () => {
  it("accepts true", () => {
    expect(Field.mustBeTrue().safeParse(true).success).toBe(true);
  });

  it("rejects false", () => {
    expect(Field.mustBeTrue().safeParse(false).success).toBe(false);
  });

  it("uses custom message", () => {
    const s = Field.mustBeTrue("Must accept");
    const result = s.safeParse(false);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Must accept");
  });
});

// ─── Field.isoDate ───────────────────────────────────────────────────────────

describe("Field.isoDate()", () => {
  it("accepts valid ISO date", () => {
    expect(Field.isoDate().safeParse("2025-01-01T00:00:00Z").success).toBe(true);
  });

  it("rejects invalid date", () => {
    expect(Field.isoDate().safeParse("not-a-date").success).toBe(false);
  });

  it("rejects past dates when futureOnly is true", () => {
    expect(Field.isoDate({ futureOnly: true }).safeParse("2020-01-01").success).toBe(false);
  });

  it("accepts future dates when futureOnly is true", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(Field.isoDate({ futureOnly: true }).safeParse(future).success).toBe(true);
  });
});

// ─── Field.optionalUrl ───────────────────────────────────────────────────────

describe("Field.optionalUrl()", () => {
  it("accepts undefined", () => {
    expect(Field.optionalUrl().safeParse(undefined).success).toBe(true);
  });

  it("accepts valid https URL", () => {
    expect(Field.optionalUrl().safeParse("https://example.com").success).toBe(true);
  });

  it("rejects invalid URL", () => {
    expect(Field.optionalUrl().safeParse("not-a-url").success).toBe(false);
  });
});

// ─── mustMatch ───────────────────────────────────────────────────────────────

describe("mustMatch()", () => {
  const schema = z
    .object({ password: z.string(), confirmPassword: z.string() })
    .superRefine(mustMatch("password", "confirmPassword", "Passwords do not match"));

  it("accepts matching fields", () => {
    expect(
      schema.safeParse({ password: "abc", confirmPassword: "abc" }).success,
    ).toBe(true);
  });

  it("rejects mismatched fields and sets correct path", () => {
    const result = schema.safeParse({ password: "abc", confirmPassword: "xyz" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("confirmPassword");
      expect(result.error.issues[0].message).toBe("Passwords do not match");
    }
  });
});

// ─── requiredWhen ─────────────────────────────────────────────────────────────

describe("requiredWhen()", () => {
  const schema = z
    .object({ newPassword: z.string().optional(), currentPassword: z.string().optional() })
    .superRefine(
      requiredWhen(
        (d) => !!(d.newPassword),
        "currentPassword",
        "Current password required",
      ),
    );

  it("does not require field when condition is false", () => {
    expect(schema.safeParse({ newPassword: undefined }).success).toBe(true);
  });

  it("requires field when condition is true", () => {
    const result = schema.safeParse({ newPassword: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("currentPassword");
    }
  });

  it("passes when condition is true and field is provided", () => {
    expect(
      schema.safeParse({ newPassword: "abc", currentPassword: "old" }).success,
    ).toBe(true);
  });
});
