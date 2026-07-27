/**
 * ArenaX — Declarative Field Builder API
 *
 * Provides a class-validator-style declarative API for defining Zod field
 * schemas.  Each `Field.*` builder returns a Zod schema that can be composed
 * directly into a `z.object({})` or used standalone.
 *
 * Design goals:
 *  - No class decorators, no reflect-metadata — works with plain Babel + Next.js
 *  - All constraints carry automatic, human-readable error messages
 *  - Fully type-safe — the returned type is always `ZodTypeAny`
 *  - Composable — chain `.optional()`, `.nullable()`, `.refine()` after any field
 *
 * Usage:
 *   import { Field } from "@/lib/validation/fields";
 *
 *   const schema = z.object({
 *     email:    Field.email(),
 *     username: Field.username({ min: 3, max: 20 }),
 *     age:      Field.integer({ min: 18, message: "Must be 18 or older" }),
 *   });
 */

import { z } from "zod";

// ─── Shared constraint options ────────────────────────────────────────────────

export interface MinMaxOptions {
  min?: number;
  max?: number;
  /** Override the default error message for the min constraint. */
  minMessage?: string;
  /** Override the default error message for the max constraint. */
  maxMessage?: string;
  /** Override ALL constraint error messages with a single message. */
  message?: string;
}

export interface RequiredOptions {
  /** Whether the field is optional. Default: false (required). */
  optional?: boolean;
  /** Message shown when the field is missing / empty. */
  requiredMessage?: string;
}

// ─── Field namespace ──────────────────────────────────────────────────────────

export const Field = {
  // ── String primitives ───────────────────────────────────────────────────────

  /**
   * A required non-empty string.
   * @example Field.text({ min: 1, max: 200 })
   */
  text(
    options: MinMaxOptions & RequiredOptions & { trim?: boolean } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    let schema = z.string();

    if (options.trim !== false) {
      schema = schema.trim();
    }

    const required = options.requiredMessage ?? "This field is required";

    schema = schema.min(1, required);

    if (options.min !== undefined && options.min > 1) {
      schema = schema.min(
        options.min,
        options.minMessage ?? options.message ?? `Must be at least ${options.min} characters`,
      );
    }

    if (options.max !== undefined) {
      schema = schema.max(
        options.max,
        options.maxMessage ?? options.message ?? `Must be ${options.max} characters or fewer`,
      );
    }

    if (options.optional) {
      return schema.optional();
    }

    return schema;
  },

  /**
   * An optional string (empty string is treated as absent).
   * @example Field.optionalText({ max: 280 })
   */
  optionalText(
    options: Omit<MinMaxOptions, "min"> & { trim?: boolean } = {},
  ): z.ZodOptional<z.ZodString> {
    let schema = z.string();

    if (options.trim !== false) {
      schema = schema.trim();
    }

    if (options.max !== undefined) {
      schema = schema.max(
        options.max,
        options.maxMessage ?? options.message ?? `Must be ${options.max} characters or fewer`,
      );
    }

    return schema.optional();
  },

  // ── Identity / auth fields ──────────────────────────────────────────────────

  /**
   * Email address field.
   * Validates format and enforces max 254 characters (RFC 5321).
   * @example Field.email()
   * @example Field.email({ message: "Work email only" })
   */
  email(options: { message?: string; requiredMessage?: string } = {}): z.ZodString {
    return z
      .string()
      .min(1, options.requiredMessage ?? "Email is required")
      .max(254, "Email must be 254 characters or fewer")
      .email(options.message ?? "Enter a valid email address");
  },

  /**
   * Username field — alphanumeric, 3–20 chars by default.
   * @example Field.username()
   * @example Field.username({ min: 2, max: 30, allowUnderscore: true })
   */
  username(
    options: {
      min?: number;
      max?: number;
      allowUnderscore?: boolean;
      message?: string;
      requiredMessage?: string;
    } = {},
  ): z.ZodString {
    const min = options.min ?? 3;
    const max = options.max ?? 20;
    const pattern = options.allowUnderscore
      ? /^[a-zA-Z0-9_]+$/
      : /^[a-zA-Z0-9]+$/;
    const patternMsg = options.allowUnderscore
      ? "Username can only contain letters, numbers, and underscores"
      : "Username can only contain letters and numbers";

    return z
      .string()
      .min(1, options.requiredMessage ?? "Username is required")
      .min(min, options.message ?? `Username must be at least ${min} characters`)
      .max(max, options.message ?? `Username must be ${max} characters or fewer`)
      .regex(pattern, options.message ?? patternMsg);
  },

  /**
   * Password field with configurable strength requirements.
   * @example Field.password()                          // default strong requirements
   * @example Field.password({ requireSpecial: false }) // relax special char requirement
   */
  password(
    options: {
      min?: number;
      max?: number;
      requireUppercase?: boolean;
      requireNumber?: boolean;
      requireSpecial?: boolean;
      message?: string;
    } = {},
  ): z.ZodString {
    const min = options.min ?? 8;
    const max = options.max ?? 128;
    const requireUpper = options.requireUppercase !== false;
    const requireNum = options.requireNumber !== false;
    const requireSpecial = options.requireSpecial !== false;

    let schema = z
      .string()
      .min(1, "Password is required")
      .min(min, options.message ?? `Password must be at least ${min} characters`)
      .max(max, `Password must be ${max} characters or fewer`);

    if (requireUpper) {
      schema = schema.regex(
        /[A-Z]/,
        options.message ?? "Password must contain at least one uppercase letter",
      );
    }
    if (requireNum) {
      schema = schema.regex(
        /[0-9]/,
        options.message ?? "Password must contain at least one number",
      );
    }
    if (requireSpecial) {
      schema = schema.regex(
        /[^a-zA-Z0-9]/,
        options.message ?? "Password must contain at least one special character",
      );
    }

    return schema;
  },

  /**
   * A simple non-empty required password field (for login — no strength checks).
   */
  passwordLogin(): z.ZodString {
    return z.string().min(1, "Password is required");
  },

  // ── Numeric fields ──────────────────────────────────────────────────────────

  /**
   * A finite number.
   * @example Field.number({ min: 0, max: 1000 })
   */
  number(
    options: MinMaxOptions & RequiredOptions & { finite?: boolean } = {},
  ): z.ZodNumber | z.ZodOptional<z.ZodNumber> {
    let schema = (options.finite !== false ? z.number().finite() : z.number())
      .refine(
        (v) => !isNaN(v),
        options.message ?? "Enter a valid number",
      );

    if (options.min !== undefined) {
      schema = schema.min(
        options.min,
        options.minMessage ?? options.message ?? `Must be at least ${options.min}`,
      );
    }
    if (options.max !== undefined) {
      schema = schema.max(
        options.max,
        options.maxMessage ?? options.message ?? `Must be ${options.max} or fewer`,
      );
    }

    if (options.optional) return schema.optional();
    return schema;
  },

  /**
   * A non-negative integer.
   * @example Field.integer({ min: 1, max: 256, message: "Participants must be 1–256" })
   */
  integer(
    options: MinMaxOptions & RequiredOptions = {},
  ): z.ZodNumber | z.ZodOptional<z.ZodNumber> {
    let schema = z
      .number()
      .int(options.message ?? "Must be a whole number")
      .finite();

    if (options.min !== undefined) {
      schema = schema.min(
        options.min,
        options.minMessage ?? options.message ?? `Must be at least ${options.min}`,
      );
    }
    if (options.max !== undefined) {
      schema = schema.max(
        options.max,
        options.maxMessage ?? options.message ?? `Must be ${options.max} or fewer`,
      );
    }

    if (options.optional) return schema.optional();
    return schema;
  },

  /**
   * A positive (> 0) number, expressed as a string (common for form inputs).
   * @example Field.positiveAmountString()  // "0.001" → valid, "0" → invalid
   */
  positiveAmountString(
    options: { message?: string } = {},
  ): z.ZodString {
    return z
      .string()
      .min(1, "Amount is required")
      .refine(
        (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0;
        },
        options.message ?? "Enter a valid amount greater than 0",
      );
  },

  /**
   * A non-negative amount string (allows 0 and empty for optional inputs).
   */
  nonNegativeAmountString(
    options: { message?: string } = {},
  ): z.ZodString {
    return z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v || v === "") return true;
          const n = Number(v);
          return Number.isFinite(n) && n >= 0;
        },
        options.message ?? "Enter a valid amount",
      ) as unknown as z.ZodString;
  },

  // ── Enum / union fields ─────────────────────────────────────────────────────

  /**
   * A required enum field.
   * @example Field.enum(["xlm", "usdc"] as const)
   */
  enum<T extends string>(
    values: readonly [T, ...T[]],
    options: { message?: string } = {},
  ): z.ZodEnum<[T, ...T[]]> {
    return z.enum(values, {
      errorMap: () => ({
        message: options.message ?? `Must be one of: ${values.join(", ")}`,
      }),
    });
  },

  // ── Boolean fields ──────────────────────────────────────────────────────────

  /**
   * A boolean that must be `true` (e.g. terms acceptance).
   * @example Field.mustBeTrue("You must agree to the terms")
   */
  mustBeTrue(message = "This field is required"): z.ZodBoolean {
    return z.boolean().refine((v) => v === true, { message });
  },

  /**
   * A plain boolean (no constraint — for toggle switches).
   */
  boolean(): z.ZodBoolean {
    return z.boolean();
  },

  // ── Date / time fields ──────────────────────────────────────────────────────

  /**
   * An ISO-8601 datetime string that must be a valid date.
   * @example Field.isoDate()
   * @example Field.isoDate({ futureOnly: true })
   */
  isoDate(
    options: {
      message?: string;
      futureOnly?: boolean;
      futureMessage?: string;
      optional?: boolean;
    } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    let schema = z
      .string()
      .min(1, "Date is required")
      .refine(
        (v) => !isNaN(Date.parse(v)),
        options.message ?? "Enter a valid date",
      );

    if (options.futureOnly) {
      schema = schema.refine(
        (v) => new Date(v) > new Date(),
        options.futureMessage ?? "Date must be in the future",
      );
    }

    if (options.optional) return schema.optional();
    return schema;
  },

  // ── URL / link fields ───────────────────────────────────────────────────────

  /**
   * An optional URL that must start with http:// or https:// when present.
   * @example Field.url()
   */
  url(
    options: { message?: string; optional?: boolean } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    const schema = z
      .string()
      .url(options.message ?? "Enter a valid URL (must start with http:// or https://)");

    if (options.optional !== false) return schema.optional();
    return schema;
  },

  /**
   * An optional text field that, when filled, must be a valid http/https URL.
   */
  optionalUrl(options: { message?: string } = {}): z.ZodOptional<z.ZodString> {
    return z
      .string()
      .optional()
      .refine(
        (v) => !v || v.startsWith("https://") || v.startsWith("http://"),
        options.message ?? "Must be a valid URL starting with http:// or https://",
      ) as z.ZodOptional<z.ZodString>;
  },

  // ── Regex / pattern fields ──────────────────────────────────────────────────

  /**
   * A string that must match the given regex pattern.
   * @example Field.pattern(/^\d{4}-\d{2}-\d{2}$/, "Enter a date like 2024-01-15")
   */
  pattern(
    regex: RegExp,
    message: string,
    options: RequiredOptions & { min?: number; max?: number } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    let schema = z.string().min(1, options.requiredMessage ?? "This field is required").regex(regex, message);

    if (options.min) schema = schema.min(options.min);
    if (options.max) schema = schema.max(options.max);
    if (options.optional) return schema.optional();
    return schema;
  },
} as const;

// ─── Cross-field constraint helpers ───────────────────────────────────────────

/**
 * Creates a `.refine` that checks two fields match (e.g. password confirmation).
 *
 * Usage:
 *   z.object({ password: Field.password(), confirmPassword: z.string() })
 *     .superRefine(mustMatch("password", "confirmPassword", "Passwords do not match"))
 */
export function mustMatch<T extends Record<string, unknown>>(
  sourceField: keyof T,
  targetField: keyof T,
  message = "Fields do not match",
): (data: T, ctx: z.RefinementCtx) => void {
  return (data, ctx) => {
    if (data[sourceField] !== data[targetField]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: [targetField as string],
      });
    }
  };
}

/**
 * Creates a `.superRefine` that marks a field as required when a condition is true.
 *
 * Usage:
 *   schema.superRefine(requiredWhen(
 *     (d) => !!d.newPassword,
 *     "currentPassword",
 *     "Current password is required to change your password"
 *   ))
 */
export function requiredWhen<T extends Record<string, unknown>>(
  condition: (data: T) => boolean,
  field: keyof T,
  message: string,
): (data: T, ctx: z.RefinementCtx) => void {
  return (data, ctx) => {
    if (condition(data) && !data[field]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: [field as string],
      });
    }
  };
}
