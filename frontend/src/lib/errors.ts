// ─── Error Severity & Category ───────────────────────────────────────────────

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ErrorCategory {
  NETWORK = "network",
  AUTHENTICATION = "authentication",
  VALIDATION = "validation",
  RUNTIME = "runtime",
  API = "api",
  UNKNOWN = "unknown",
}

// ─── Logged Error Shape ───────────────────────────────────────────────────────

export interface LoggedError {
  id: string;
  timestamp: number;
  message: string;
  stack?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata?: Record<string, unknown>;
  /** How many times an automatic recovery was attempted */
  recoveryAttempts?: number;
  /** Whether an automatic recovery succeeded */
  recovered?: boolean;
}

// ─── Custom Error Classes ─────────────────────────────────────────────────────

/**
 * Base application error.  All ArenaX-specific errors should extend this class
 * so that error boundaries and the logger can extract structured metadata.
 */
export class ArenaXError extends Error {
  public category: ErrorCategory;
  public severity: ErrorSeverity;
  public metadata?: Record<string, unknown>;

  constructor(
    message: string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ArenaXError";
    this.category = category;
    this.severity = severity;
    this.metadata = metadata;

    if ((Error as { captureStackTrace?: (t: unknown, c: unknown) => void }).captureStackTrace) {
      (Error as { captureStackTrace: (t: unknown, c: unknown) => void }).captureStackTrace(this, ArenaXError);
    }
  }
}

/** Thrown when a network request fails or times out. */
export class NetworkError extends ArenaXError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.HIGH, metadata);
    this.name = "NetworkError";
  }
}

/** Thrown when the user is not authenticated or a token has expired. */
export class AuthenticationError extends ArenaXError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCategory.AUTHENTICATION, ErrorSeverity.HIGH, metadata);
    this.name = "AuthenticationError";
  }
}

/** Thrown when user-supplied data fails validation. */
export class ValidationError extends ArenaXError {
  public field?: string;

  constructor(
    message: string,
    field?: string,
    metadata?: Record<string, unknown>,
  ) {
    super(message, ErrorCategory.VALIDATION, ErrorSeverity.LOW, metadata);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** Thrown when an API endpoint returns an error response. */
export class ApiError extends ArenaXError {
  public statusCode?: number;

  constructor(
    message: string,
    statusCode?: number,
    metadata?: Record<string, unknown>,
  ) {
    const severity =
      statusCode && statusCode >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
    super(message, ErrorCategory.API, severity, metadata);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

// ─── Recovery strategies ──────────────────────────────────────────────────────

/**
 * Describes how the error recovery system should react to a given error.
 */
export interface RecoveryStrategy {
  /** Maximum number of automatic retry attempts (default: 3). */
  maxAttempts: number;
  /** Base delay in milliseconds between retries (default: 1 000 ms). */
  baseDelayMs: number;
  /** Whether to apply exponential back-off between retries (default: true). */
  exponentialBackoff: boolean;
  /** Maximum delay cap in milliseconds (default: 30 000 ms). */
  maxDelayMs: number;
}

export const DEFAULT_RECOVERY_STRATEGY: RecoveryStrategy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  exponentialBackoff: true,
  maxDelayMs: 30_000,
};

/**
 * Returns the recommended recovery strategy for a given error category.
 * Network and API errors are retryable; auth/validation errors are not.
 */
export function getRecoveryStrategy(category: ErrorCategory): RecoveryStrategy | null {
  switch (category) {
    case ErrorCategory.NETWORK:
      return { maxAttempts: 3, baseDelayMs: 1_000, exponentialBackoff: true, maxDelayMs: 15_000 };
    case ErrorCategory.API:
      return { maxAttempts: 2, baseDelayMs: 2_000, exponentialBackoff: true, maxDelayMs: 10_000 };
    case ErrorCategory.RUNTIME:
      return { maxAttempts: 1, baseDelayMs: 500, exponentialBackoff: false, maxDelayMs: 500 };
    // Authentication and Validation errors should not be auto-retried
    case ErrorCategory.AUTHENTICATION:
    case ErrorCategory.VALIDATION:
    case ErrorCategory.UNKNOWN:
    default:
      return null;
  }
}

// ─── Utility Functions ────────────────────────────────────────────────────────

export function determineErrorCategory(error: Error): ErrorCategory {
  if (error instanceof ArenaXError) return error.category;

  const msg = error.message.toLowerCase();

  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
    return ErrorCategory.NETWORK;
  }
  if (
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("authentication") ||
    msg.includes("401") ||
    msg.includes("403")
  ) {
    return ErrorCategory.AUTHENTICATION;
  }
  if (msg.includes("validation") || msg.includes("invalid")) {
    return ErrorCategory.VALIDATION;
  }
  if (msg.includes("api") || msg.includes("server") || msg.includes("500")) {
    return ErrorCategory.API;
  }

  return ErrorCategory.UNKNOWN;
}

export function determineErrorSeverity(error: Error): ErrorSeverity {
  if (error instanceof ArenaXError) return error.severity;

  const msg = error.message.toLowerCase();

  if (msg.includes("critical") || msg.includes("fatal")) return ErrorSeverity.CRITICAL;
  if (msg.includes("network") || msg.includes("timeout")) return ErrorSeverity.HIGH;

  return ErrorSeverity.MEDIUM;
}

/**
 * Returns whether an error should be considered retryable based on its category.
 */
export function isRetryableError(error: Error): boolean {
  const category = determineErrorCategory(error);
  return getRecoveryStrategy(category) !== null;
}

export function generateErrorId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Serialises an error into a plain object safe for JSON / logging.
 */
export function serializeError(error: Error): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if (error instanceof ArenaXError) {
    base.category = error.category;
    base.severity = error.severity;
    base.metadata = error.metadata;
  }

  return base;
}
