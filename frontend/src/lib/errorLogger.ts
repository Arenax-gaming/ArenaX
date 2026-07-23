import {
  ArenaXError,
  ErrorCategory,
  ErrorSeverity,
  LoggedError,
  determineErrorCategory,
  determineErrorSeverity,
  generateErrorId,
  serializeError,
} from "./errors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ErrorLoggerOptions {
  maxErrors?: number;
  storageKey?: string;
  /** Called after every logged error — use for external sinks (Datadog, Sentry). */
  onError?: (entry: LoggedError) => void;
}

// ─── ErrorLogger class ────────────────────────────────────────────────────────

class ErrorLogger {
  private errors: LoggedError[] = [];
  private readonly maxErrors: number;
  private readonly storageKey: string;
  private onError?: (entry: LoggedError) => void;

  constructor(options: ErrorLoggerOptions = {}) {
    this.maxErrors = options.maxErrors ?? 100;
    this.storageKey = options.storageKey ?? "arenax_errors";
    this.onError = options.onError;

    this.loadFromStorage();
    this.setupGlobalErrorHandlers();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private loadFromStorage(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) this.errors = JSON.parse(raw) as LoggedError[];
    } catch {
      // Storage may be unavailable (private browsing, quota exceeded, etc.)
    }
  }

  private saveToStorage(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.errors));
    } catch {
      // Silently ignore — storage errors must not cascade into more errors
    }
  }

  // ── Global window handlers ───────────────────────────────────────────────────

  private setupGlobalErrorHandlers(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("error", (event) => {
      this.logError(event.error instanceof Error ? event.error : new Error(String(event.error ?? "Unknown error")), {
        source: "uncaught_error",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason ?? "Unhandled promise rejection"));
      this.logError(error, { source: "unhandled_promise_rejection" });
    });
  }

  // ── Core logging ─────────────────────────────────────────────────────────────

  logError(error: Error, metadata?: Record<string, unknown>): LoggedError {
    const category = determineErrorCategory(error);
    const severity = determineErrorSeverity(error);

    const entry: LoggedError = {
      id: generateErrorId(),
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
      category,
      severity,
      metadata: {
        ...(error instanceof ArenaXError ? error.metadata : {}),
        ...metadata,
        serialized: serializeError(error),
      },
      recoveryAttempts: 0,
      recovered: false,
    };

    // Prepend so the most recent error is at index 0
    this.errors.unshift(entry);

    // Cap to maxErrors
    if (this.errors.length > this.maxErrors) {
      this.errors.length = this.maxErrors;
    }

    this.saveToStorage();
    this.emitToConsole(entry, error);
    this.trackAnalytics(entry);
    this.onError?.(entry);

    return entry;
  }

  /**
   * Record that a recovery attempt was made for an existing logged error.
   */
  recordRecoveryAttempt(id: string, succeeded: boolean): void {
    const entry = this.errors.find((e) => e.id === id);
    if (!entry) return;
    entry.recoveryAttempts = (entry.recoveryAttempts ?? 0) + 1;
    if (succeeded) entry.recovered = true;
    this.saveToStorage();
  }

  // ── Console output ───────────────────────────────────────────────────────────

  private emitToConsole(entry: LoggedError, original: Error): void {
    const prefix = `[ArenaX Error] [${entry.category}] [${entry.severity}]`;

    if (entry.severity === ErrorSeverity.CRITICAL || entry.severity === ErrorSeverity.HIGH) {
      console.error(prefix, original, entry.metadata);
    } else if (entry.severity === ErrorSeverity.MEDIUM) {
      console.warn(prefix, original, entry.metadata);
    } else {
      console.info(prefix, original, entry.metadata);
    }
  }

  // ── Analytics integration ────────────────────────────────────────────────────

  private trackAnalytics(entry: LoggedError): void {
    if (typeof window === "undefined") return;

    const isFatal =
      entry.severity === ErrorSeverity.CRITICAL || entry.severity === ErrorSeverity.HIGH;

    // Native gtag (Google Analytics / GA4)
    const w = window as Window & { gtag?: (...args: unknown[]) => void };
    if (typeof w.gtag === "function") {
      w.gtag("event", "exception", {
        description: `[${entry.category}] ${entry.message}`,
        fatal: isFatal,
        error_id: entry.id,
        error_severity: entry.severity,
      });
    }

    // Datadog RUM (if present on window via RumProvider)
    const dd = window as Window & {
      DD_RUM?: {
        addError: (error: unknown, context?: Record<string, unknown>) => void;
      };
    };
    if (dd.DD_RUM?.addError) {
      dd.DD_RUM.addError(new Error(entry.message), {
        errorId: entry.id,
        category: entry.category,
        severity: entry.severity,
        ...entry.metadata,
      });
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  getErrors(): LoggedError[] {
    return [...this.errors];
  }

  getErrorsByCategory(category: ErrorCategory): LoggedError[] {
    return this.errors.filter((e) => e.category === category);
  }

  getErrorsBySeverity(severity: ErrorSeverity): LoggedError[] {
    return this.errors.filter((e) => e.severity === severity);
  }

  /** Errors logged within the last `windowMs` milliseconds. */
  getRecentErrors(windowMs = 60_000): LoggedError[] {
    const cutoff = Date.now() - windowMs;
    return this.errors.filter((e) => e.timestamp >= cutoff);
  }

  /**
   * Basic analytics summary for the monitoring dashboard.
   */
  getSummary(): ErrorSummary {
    const total = this.errors.length;
    const byCategory = Object.values(ErrorCategory).reduce<Record<string, number>>(
      (acc, cat) => {
        acc[cat] = this.errors.filter((e) => e.category === cat).length;
        return acc;
      },
      {},
    );
    const bySeverity = Object.values(ErrorSeverity).reduce<Record<string, number>>(
      (acc, sev) => {
        acc[sev] = this.errors.filter((e) => e.severity === sev).length;
        return acc;
      },
      {},
    );
    const recoveredCount = this.errors.filter((e) => e.recovered).length;
    const recent = this.getRecentErrors(60_000).length;

    return { total, byCategory, bySeverity, recoveredCount, recentCount: recent };
  }

  clearErrors(): void {
    this.errors = [];
    this.saveToStorage();
  }

  /** Replace the external sink callback (e.g. after analytics service initialises). */
  setOnError(cb: (entry: LoggedError) => void): void {
    this.onError = cb;
  }
}

// ─── Export types ─────────────────────────────────────────────────────────────

export interface ErrorSummary {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recoveredCount: number;
  recentCount: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const errorLogger = new ErrorLogger();

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function logError(error: Error, metadata?: Record<string, unknown>): LoggedError {
  return errorLogger.logError(error, metadata);
}

export function getLoggedErrors(): LoggedError[] {
  return errorLogger.getErrors();
}

export function clearLoggedErrors(): void {
  errorLogger.clearErrors();
}

export function getErrorSummary(): ErrorSummary {
  return errorLogger.getSummary();
}
