/**
 * ArenaX — Validation Resolver
 *
 * A thin wrapper around `@hookform/resolvers/zod` that instruments every
 * validation call with analytics recording.
 *
 * Drop-in replacement for `zodResolver` — use `createValidationResolver`
 * instead of `zodResolver` to get automatic analytics tracking.
 *
 * Usage:
 *   import { createValidationResolver } from "@/lib/validation/resolver";
 *
 *   const form = useForm<LoginData>({
 *     resolver: createValidationResolver(loginSchema, "login"),
 *   });
 *
 * Or with a `NamedSchema`:
 *   const form = useForm<LoginData>({
 *     resolver: createValidationResolver(namedLoginSchema.schema, namedLoginSchema.meta.name),
 *   });
 */

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver, FieldValues } from "react-hook-form";
import type { ZodSchema, ZodTypeAny, ZodError } from "zod";
import { recordValidationAttempt } from "./analytics";

// ─── Type helpers ─────────────────────────────────────────────────────────────

type ZodSchemaInput = ZodSchema | ZodTypeAny;

// ─── Instrumented resolver ────────────────────────────────────────────────────

/**
 * Creates a React Hook Form resolver that wraps the standard `zodResolver`
 * and records a `ValidationAttemptEvent` to the analytics store on every
 * validation run.
 *
 * @param schema       - Any Zod schema (ZodObject, ZodEffects, etc.)
 * @param schemaName   - Unique identifier for analytics (use `NamedSchema.meta.name`)
 * @param context      - Optional context label ("form-submit", "field-blur", etc.)
 */
export function createValidationResolver<TFieldValues extends FieldValues>(
  schema: ZodSchemaInput,
  schemaName: string,
  context?: string,
): Resolver<TFieldValues> {
  const baseResolver = zodResolver(schema as ZodSchema);

  return async (values, resolverContext, options) => {
    const start = performance.now();
    const result = await baseResolver(values, resolverContext, options);
    const durationMs = Math.round(performance.now() - start);

    const hasErrors = Object.keys(result.errors).length > 0;
    const failedFields = hasErrors ? collectFailedFields(result.errors) : [];

    recordValidationAttempt({
      schemaName,
      success: !hasErrors,
      failedFields,
      durationMs,
      timestamp: new Date().toISOString(),
      context,
    });

    return result;
  };
}

/**
 * Extracts dot-notation field paths from an RHF error object.
 */
function collectFailedFields(
  errors: Record<string, unknown>,
  prefix = "",
): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(errors)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object") {
      const asObj = value as Record<string, unknown>;

      // RHF leaf error: { type, message }
      if (typeof asObj.message === "string" || typeof asObj.type === "string") {
        paths.push(fullPath);
      } else {
        // Nested errors
        paths.push(...collectFailedFields(asObj, fullPath));
      }
    }
  }

  return paths;
}

// ─── Standalone schema validation ─────────────────────────────────────────────

/**
 * Validates data against a Zod schema outside of React Hook Form,
 * recording analytics just like the resolver does.
 *
 * Returns `{ success: true, data }` or `{ success: false, errors }`.
 *
 * @example
 * const result = validateData(loginSchema, "login", rawPayload);
 * if (!result.success) {
 *   console.error(result.errors); // { email: "...", password: "..." }
 * }
 */
export function validateData<T>(
  schema: ZodSchemaInput,
  schemaName: string,
  data: unknown,
  context?: string,
):
  | { success: true; data: T }
  | { success: false; errors: Record<string, string>; rawError: ZodError } {
  const start = performance.now();
  const result = (schema as ZodSchema).safeParse(data);
  const durationMs = Math.round(performance.now() - start);

  if (result.success) {
    recordValidationAttempt({
      schemaName,
      success: true,
      failedFields: [],
      durationMs,
      timestamp: new Date().toISOString(),
      context,
    });
    return { success: true, data: result.data as T };
  }

  const failedFields = result.error.issues.map((i) => i.path.join(".")).filter(Boolean);
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (path && !errors[path]) {
      errors[path] = issue.message;
    }
  }

  recordValidationAttempt({
    schemaName,
    success: false,
    failedFields,
    durationMs,
    timestamp: new Date().toISOString(),
    context,
  });

  return { success: false, errors, rawError: result.error };
}

// ─── Request payload validator ─────────────────────────────────────────────────

/**
 * Validates an API request payload before it is sent.
 * Throws a descriptive `ValidationError` if validation fails.
 *
 * @example
 * await validateRequest(createTournamentSchema, "createTournament", payload);
 * await apiClient.post("/tournaments", payload);
 */
export function validateRequest<T>(
  schema: ZodSchemaInput,
  schemaName: string,
  payload: unknown,
  context = "api-request",
): T {
  const result = validateData<T>(schema, schemaName, payload, context);

  if (!result.success) {
    const messages = Object.entries(result.errors)
      .map(([field, msg]) => `${field}: ${msg}`)
      .join("; ");

    throw new RequestValidationError(
      `Request validation failed for "${schemaName}": ${messages}`,
      result.errors,
      schemaName,
    );
  }

  return result.data;
}

// ─── RequestValidationError ───────────────────────────────────────────────────

/**
 * Thrown by `validateRequest` when a request payload fails validation.
 * Consumers can catch this to surface field errors without an API round-trip.
 */
export class RequestValidationError extends Error {
  /** Field-level error map. */
  public readonly fieldErrors: Record<string, string>;
  /** Schema name that failed. */
  public readonly schemaName: string;

  constructor(
    message: string,
    fieldErrors: Record<string, string>,
    schemaName: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
    this.fieldErrors = fieldErrors;
    this.schemaName = schemaName;
  }
}
