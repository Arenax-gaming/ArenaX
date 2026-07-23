"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { errorLogger, ErrorSummary } from "@/lib/errorLogger";
import { LoggedError, ErrorCategory, ErrorSeverity } from "@/lib/errors";

// ─── Context shape ────────────────────────────────────────────────────────────

interface ErrorContextType {
  /** All errors captured during this session (most-recent first). */
  errors: LoggedError[];
  /** Log a new error and add it to the session list. */
  addError: (error: Error, metadata?: Record<string, unknown>) => LoggedError;
  /** Remove all errors from the session list (does NOT clear localStorage). */
  clearErrors: () => void;
  /** Retrieve only errors of a given category. */
  getByCategory: (category: ErrorCategory) => LoggedError[];
  /** Retrieve only errors of a given severity. */
  getBySeverity: (severity: ErrorSeverity) => LoggedError[];
  /** Aggregate summary counts useful for the monitoring dashboard. */
  summary: ErrorSummary;
  /** Force a summary refresh (call after bulk operations). */
  refreshSummary: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<LoggedError[]>(() => errorLogger.getErrors());
  const [summary, setSummary] = useState<ErrorSummary>(() => errorLogger.getSummary());

  const refreshSummary = useCallback(() => {
    setSummary(errorLogger.getSummary());
  }, []);

  const addError = useCallback(
    (error: Error, metadata?: Record<string, unknown>): LoggedError => {
      const entry = errorLogger.logError(error, metadata);
      setErrors(errorLogger.getErrors());
      setSummary(errorLogger.getSummary());
      return entry;
    },
    [],
  );

  const clearErrors = useCallback(() => {
    errorLogger.clearErrors();
    setErrors([]);
    setSummary(errorLogger.getSummary());
  }, []);

  const getByCategory = useCallback(
    (category: ErrorCategory): LoggedError[] =>
      errors.filter((e) => e.category === category),
    [errors],
  );

  const getBySeverity = useCallback(
    (severity: ErrorSeverity): LoggedError[] =>
      errors.filter((e) => e.severity === severity),
    [errors],
  );

  return (
    <ErrorContext.Provider
      value={{ errors, addError, clearErrors, getByCategory, getBySeverity, summary, refreshSummary }}
    >
      {children}
    </ErrorContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useError(): ErrorContextType {
  const ctx = useContext(ErrorContext);
  if (!ctx) {
    throw new Error("useError must be used within an ErrorProvider");
  }
  return ctx;
}
