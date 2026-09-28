/**
 * ArenaX — Schema Builder
 *
 * Assembles Zod schemas from Field / Validators declarations and attaches
 * metadata (name, description, version) used by analytics and governance.
 *
 * Usage:
 *   import { defineSchema } from "@/lib/validation/schema";
 *   import { Field } from "@/lib/validation/fields";
 *
 *   export const loginSchema = defineSchema(
 *     "login",
 *     {
 *       email:    Field.email(),
 *       password: Field.passwordLogin(),
 *       rememberMe: Field.boolean().optional().default(false),
 *     },
 *     { description: "User login form", version: 1 }
 *   );
 *
 *   // Type inference still works:
 *   type LoginData = z.infer<typeof loginSchema.schema>;
 */

import { z } from "zod";

// ─── Schema metadata ──────────────────────────────────────────────────────────

export interface SchemaMetadata {
  /** Unique name for this schema (used in analytics and governance). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Schema version — increment when shape changes. */
  version?: number;
  /**
   * Governance tags — e.g. "auth", "payment", "admin".
   * Used to apply domain-specific governance policies.
   */
  tags?: string[];
}

// ─── Named schema wrapper ─────────────────────────────────────────────────────

/**
 * A Zod object schema with attached metadata.
 * The `schema` property is the standard Zod schema; use it as you would
 * any `z.ZodObject`.
 */
export interface NamedSchema<
  TShape extends z.ZodRawShape,
  TSchema extends z.ZodObject<TShape> = z.ZodObject<TShape>,
> {
  schema: TSchema;
  meta: SchemaMetadata;
  /** Convenience: validate and return typed data or throw ZodError. */
  parse(data: unknown): z.infer<TSchema>;
  /** Convenience: validate and return { success, data } without throwing. */
  safeParse(data: unknown): z.ZodSafeParseResult<z.infer<TSchema>>;
}

// ─── defineSchema ─────────────────────────────────────────────────────────────

/**
 * Creates a named, versioned Zod schema from a field shape map.
 *
 * @param name   - Unique identifier (used in analytics / governance).
 * @param shape  - Zod field shape — the same object you'd pass to `z.object({})`.
 * @param meta   - Optional metadata (description, version, tags).
 *
 * @returns A `NamedSchema` containing the compiled Zod schema and metadata.
 *
 * @example
 * const loginSchema = defineSchema("login", {
 *   email:    Field.email(),
 *   password: Field.passwordLogin(),
 * });
 * type LoginData = z.infer<typeof loginSchema.schema>;
 */
export function defineSchema<TShape extends z.ZodRawShape>(
  name: string,
  shape: TShape,
  meta: Omit<SchemaMetadata, "name"> = {},
): NamedSchema<TShape> {
  const schema = z.object(shape);
  const fullMeta: SchemaMetadata = { name, version: 1, ...meta };

  // Register in the global registry so governance / analytics can discover it
  _registerSchema(fullMeta);

  return {
    schema,
    meta: fullMeta,
    parse: (data: unknown) => schema.parse(data),
    safeParse: (data: unknown) => schema.safeParse(data),
  };
}

/**
 * Creates a named schema with cross-field refinements.
 * Use when `superRefine` or `refine` must apply after the base shape is built.
 *
 * @example
 * const registerSchema = defineSchemaWithRefinements(
 *   "register",
 *   { password: Field.password(), confirmPassword: z.string() },
 *   (schema) =>
 *     schema.superRefine(mustMatch("password", "confirmPassword", "Passwords do not match")),
 * );
 */
export function defineSchemaWithRefinements<
  TShape extends z.ZodRawShape,
  TRefined extends z.ZodTypeAny,
>(
  name: string,
  shape: TShape,
  refine: (schema: z.ZodObject<TShape>) => TRefined,
  meta: Omit<SchemaMetadata, "name"> = {},
): { schema: TRefined; meta: SchemaMetadata; parse: (data: unknown) => z.infer<TRefined>; safeParse: (data: unknown) => z.ZodSafeParseResult<z.infer<TRefined>> } {
  const base = z.object(shape);
  const refined = refine(base);
  const fullMeta: SchemaMetadata = { name, version: 1, ...meta };

  _registerSchema(fullMeta);

  return {
    schema: refined,
    meta: fullMeta,
    parse: (data: unknown) => refined.parse(data),
    safeParse: (data: unknown) => refined.safeParse(data),
  };
}

// ─── Schema registry ──────────────────────────────────────────────────────────

const _registry = new Map<string, SchemaMetadata>();

function _registerSchema(meta: SchemaMetadata): void {
  if (_registry.has(meta.name)) {
    // Version conflict — warn in dev
    if (process.env.NODE_ENV === "development") {
      const existing = _registry.get(meta.name)!;
      if (existing.version !== meta.version) {
        console.warn(
          `[ArenaX Validation] Schema "${meta.name}" registered with conflicting versions: ` +
            `${existing.version} vs ${meta.version}. ` +
            "Ensure each schema name is unique across the codebase.",
        );
      }
    }
  }
  _registry.set(meta.name, meta);
}

/** Returns all registered schema metadata (for governance / documentation). */
export function getRegisteredSchemas(): SchemaMetadata[] {
  return Array.from(_registry.values());
}

/** Returns metadata for a specific schema by name. */
export function getSchemaMetadata(name: string): SchemaMetadata | undefined {
  return _registry.get(name);
}

// ─── Validation error utilities ───────────────────────────────────────────────

/**
 * Converts a `ZodError` into a flat `Record<string, string>` mapping
 * field paths to their first error message.
 *
 * @example
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   const errors = flattenZodErrors(result.error);
 *   // { "email": "Enter a valid email address", "password": "..." }
 * }
 */
export function flattenZodErrors(error: z.ZodError): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!flat[path]) {
      flat[path] = issue.message;
    }
  }
  return flat;
}

/**
 * Returns the first error message for a specific field path in a ZodError.
 */
export function getFieldError(error: z.ZodError, field: string): string | undefined {
  return error.issues.find((i) => i.path.join(".") === field)?.message;
}

/**
 * Returns all error messages grouped by field path.
 */
export function groupZodErrors(error: z.ZodError): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!grouped[path]) grouped[path] = [];
    grouped[path].push(issue.message);
  }
  return grouped;
}
