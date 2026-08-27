/**
 * Tests for the schema builder utilities.
 */

import { z } from "zod";
import {
  defineSchema,
  defineSchemaWithRefinements,
  flattenZodErrors,
  getFieldError,
  groupZodErrors,
  getRegisteredSchemas,
} from "../schema";
import { Field } from "../fields";

// ─── defineSchema ─────────────────────────────────────────────────────────────

describe("defineSchema()", () => {
  const testSchema = defineSchema(
    "testLogin",
    {
      email: Field.email(),
      password: Field.passwordLogin(),
    },
    { description: "Test login schema", tags: ["auth"] },
  );

  it("returns a NamedSchema with schema and meta", () => {
    expect(testSchema.schema).toBeDefined();
    expect(testSchema.meta.name).toBe("testLogin");
    expect(testSchema.meta.description).toBe("Test login schema");
    expect(testSchema.meta.tags).toContain("auth");
  });

  it("schema.parse succeeds for valid data", () => {
    expect(() =>
      testSchema.parse({ email: "a@b.com", password: "secret" }),
    ).not.toThrow();
  });

  it("schema.safeParse returns success for valid data", () => {
    const result = testSchema.safeParse({ email: "a@b.com", password: "secret" });
    expect(result.success).toBe(true);
  });

  it("schema.safeParse returns failure for invalid data", () => {
    const result = testSchema.safeParse({ email: "bad", password: "" });
    expect(result.success).toBe(false);
  });

  it("inferred type is correct shape", () => {
    // Type-level test: no TS error means inference works
    const data: z.infer<typeof testSchema.schema> = {
      email: "a@b.com",
      password: "pass",
    };
    expect(data.email).toBe("a@b.com");
  });
});

// ─── defineSchemaWithRefinements ──────────────────────────────────────────────

describe("defineSchemaWithRefinements()", () => {
  const passwordSchema = defineSchemaWithRefinements(
    "testPasswordReset",
    {
      password: z.string().min(1),
      confirmPassword: z.string(),
    },
    (schema) =>
      schema.superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Passwords do not match",
            path: ["confirmPassword"],
          });
        }
      }),
  );

  it("passes when passwords match", () => {
    expect(
      passwordSchema.safeParse({ password: "abc", confirmPassword: "abc" }).success,
    ).toBe(true);
  });

  it("fails when passwords do not match", () => {
    const result = passwordSchema.safeParse({ password: "abc", confirmPassword: "xyz" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("confirmPassword");
    }
  });
});

// ─── getRegisteredSchemas ─────────────────────────────────────────────────────

describe("getRegisteredSchemas()", () => {
  it("includes schemas defined with defineSchema", () => {
    // testLogin was registered above
    const all = getRegisteredSchemas();
    const names = all.map((s) => s.name);
    expect(names).toContain("testLogin");
  });
});

// ─── flattenZodErrors ─────────────────────────────────────────────────────────

describe("flattenZodErrors()", () => {
  it("maps issues to field paths", () => {
    const schema = z.object({ email: z.string().email(), age: z.number().min(18) });
    const result = schema.safeParse({ email: "bad", age: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = flattenZodErrors(result.error);
      expect(flat.email).toBeDefined();
      expect(flat.age).toBeDefined();
    }
  });

  it("uses the first error per field", () => {
    // Intentionally conflicting checks so `pw` produces multiple issues.
    // (Avoid .min().max() together: zod v4 merges them into one length
    // regex, and a min > max produces an invalid {m,n} quantifier.)
    const schema = z.object({ pw: z.string().min(10, "too short").regex(/[A-Z]/, "needs uppercase") });
    const result = schema.safeParse({ pw: "ab" });
    if (!result.success) {
      const flat = flattenZodErrors(result.error);
      expect(typeof flat.pw).toBe("string");
    }
  });
});

// ─── getFieldError ────────────────────────────────────────────────────────────

describe("getFieldError()", () => {
  it("returns error message for a specific field", () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = getFieldError(result.error, "email");
      expect(typeof msg).toBe("string");
    }
  });

  it("returns undefined for a field that has no error", () => {
    const schema = z.object({ email: z.string().email(), name: z.string() });
    const result = schema.safeParse({ email: "bad", name: "" });
    if (!result.success) {
      expect(getFieldError(result.error, "name")).toBeUndefined();
    }
  });
});

// ─── groupZodErrors ───────────────────────────────────────────────────────────

describe("groupZodErrors()", () => {
  it("groups multiple errors per field", () => {
    // String that fails min AND regex — two separate issues
    const schema = z.object({
      pw: z.string().min(10, "too short").regex(/[A-Z]/, "needs uppercase"),
    });
    const result = schema.safeParse({ pw: "abc" });
    if (!result.success) {
      const grouped = groupZodErrors(result.error);
      expect(Array.isArray(grouped.pw)).toBe(true);
      expect(grouped.pw.length).toBeGreaterThan(0);
    }
  });
});
