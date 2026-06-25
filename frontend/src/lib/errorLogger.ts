import {
  ArenaXError,
  ErrorCategory,
  ErrorSeverity,
  LoggedError,
  determineErrorCategory,
  determineErrorSeverity,
  generateErrorId,
} from "./errors";

class ErrorLogger {
  private errors: LoggedError[] = [];
  private readonly maxErrors = 100;
  private readonly storageKey = "arenax_errors";

  constructor() {
    this.loadFromStorage();
    this.setupGlobalErrorHandlers();
  }

  private loadFromStorage() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
          this.errors = JSON.parse(stored);
        }
      } catch (e) {
        console.error("Failed to load errors from storage:", e);
      }
    }
  }

  private saveToStorage() {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.errors));
      } catch (e) {
        console.error("Failed to save errors to storage:", e);
      }
    }
  }

  private setupGlobalErrorHandlers() {
    if (typeof window !== "undefined") {
      // Handle uncaught errors
      window.addEventListener("error", (event) => {
        this.logError(event.error, {
          event: "uncaught_error",
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });

      // Handle unhandled promise rejections
      window.addEventListener("unhandledrejection", (event) => {
        this.logError(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
          { event: "unhandled_promise_rejection" }
        );
      });
    }
  }

  logError(
    error: Error,
    metadata?: Record<string, unknown>
  ): LoggedError {
    const loggedError: LoggedError = {
      id: generateErrorId(),
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
      category: determineErrorCategory(error),
      severity: determineErrorSeverity(error),
      metadata,
    };

    this.errors.unshift(loggedError);

    if (this.errors.length > this.maxErrors) {
      this.errors.pop();
    }

    this.saveToStorage();

    // Log to console for development
    console.error(`[Error] [${loggedError.category}] [${loggedError.severity}]`, error, metadata);

    // Track with analytics
    this.trackError(loggedError);

    return loggedError;
  }

  private trackError(loggedError: LoggedError) {
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "exception", {
        description: `${loggedError.category}: ${loggedError.message}`,
        fatal: loggedError.severity === ErrorSeverity.CRITICAL || loggedError.severity === ErrorSeverity.HIGH,
      });
    }
  }

  getErrors(): LoggedError[] {
    return [...this.errors];
  }

  getErrorsByCategory(category: ErrorCategory): LoggedError[] {
    return this.errors.filter((e) => e.category === category);
  }

  getErrorsBySeverity(severity: ErrorSeverity): LoggedError[] {
    return this.errors.filter((e) => e.severity === severity);
  }

  clearErrors() {
    this.errors = [];
    this.saveToStorage();
  }
}

// Singleton instance
export const errorLogger = new ErrorLogger();

// Convenience functions
export function logError(error: Error, metadata?: Record<string, unknown>) {
  return errorLogger.logError(error, metadata);
}

export function getLoggedErrors() {
  return errorLogger.getErrors();
}

export function clearLoggedErrors() {
  errorLogger.clearErrors();
}
