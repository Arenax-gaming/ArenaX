/**
 * ArenaX — Validation System Public API
 *
 * Single import point for all validation utilities.
 *
 * @example
 * import {
 *   Field,
 *   Validators,
 *   defineSchema,
 *   createValidationResolver,
 *   validateRequest,
 *   loginRequestSchema,
 * } from "@/lib/validation";
 */

// ── Core building blocks ─────────────────────────────────────────────────────
export { Field, mustMatch, requiredWhen } from "./fields";
export type { MinMaxOptions, RequiredOptions } from "./fields";

export { Validators, STELLAR_PUBLIC_KEY_REGEX } from "./validators";

export {
  defineSchema,
  defineSchemaWithRefinements,
  flattenZodErrors,
  getFieldError,
  groupZodErrors,
  getRegisteredSchemas,
  getSchemaMetadata,
} from "./schema";
export type { NamedSchema, SchemaMetadata } from "./schema";

// ── Resolver & validation pipeline ──────────────────────────────────────────
export {
  createValidationResolver,
  validateData,
  validateRequest,
  RequestValidationError,
} from "./resolver";

// ── Analytics & governance ───────────────────────────────────────────────────
export {
  recordValidationAttempt,
  getValidationEvents,
  getValidationViolations,
  getSchemaStats,
  getValidationSnapshot,
  auditSuccessRates,
  clearValidationAnalytics,
  registerGovernancePolicy,
} from "./analytics";
export type {
  ValidationAttemptEvent,
  ValidationFieldStats,
  ValidationSchemaStats,
  ValidationAnalyticsSnapshot,
  ValidationGovernancePolicy,
  ValidationGovernanceViolation,
} from "./analytics";

// ── Domain schemas ───────────────────────────────────────────────────────────
export * from "./schemas";
