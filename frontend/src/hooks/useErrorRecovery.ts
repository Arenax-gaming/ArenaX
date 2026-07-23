"use client";

import { useState, useCallback, useRef } from "react";
import {
  ErrorCategory,
  ErrorSeverity,
  determineErrorCategory,
  getRecoveryStrategy,
  isRetryableError,
  RecoveryStrategy,
} from "@/lib/errors";
import { errorLogger } from "@/lib/errorLogger";
import { LoggedError } from "@/lib/errors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecoveryStatus = "idle" | "retrying" | "succeeded" | "failed";

export interface UseErrorRecoveryOptions {
  /** Override the default recovery strategy derived from the error category. */
  strategy?: Partial<RecoveryStrategy>;
  /** Called when all retry attempts are exhausted without success. */
  onExhausted?: (error: Error, attempts: number) => void;
  /** Called when a retry attempt succeeds. */
  onRecovered?: (attempts: number) => void;
}

export interface UseErrorRecoveryResult<T> {
  /** Execute the async action with automatic retry / back-off on failure. */
  execute: (action: () => Promise<T>) => Promise<T | undefined>;
  /** The current recovery state. */
  status: RecoveryStatus;
  /** How many retry attempts have been made in the current run. */
  attempts: number;
  /** The last error that was caught (null when idle or succeeded). */
  error: Error | null;
  /** The logged-error entry created by the logger (null until first failure). */
  loggedError: LoggedError | null;
  /** Manually reset state back to idle. */
  reset: () => void;
  /** Whether the last error is considered retryable. */
  isRetryable: boolean;
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes the delay for attempt `n` (0-based) given a strategy.
 */
function computeDelay(strategy: RecoveryStrategy, attempt: number): number {
  if (!strategy.exponentialBackoff) return strategy.baseDelayMs;
  const delay = strategy.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, strategy.maxDelayMs);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useErrorRecovery` wraps an async action with automatic retry logic and
 * exponential back-off.  It integrates with the global `errorLogger` so every
 * failure and recovery attempt is tracked.
 *
 * @example
 * ```tsx
 * const { execute, status, error } = useErrorRecovery<Tournament[]>();
 *
 * const loadTournaments = () =>
 *   execute(() => api.getTournaments());
 * ```
 */
export function useErrorRecovery<T = unknown>(
  options: UseErrorRecoveryOptions = {},
): UseErrorRecoveryResult<T> {
  const [status, setStatus] = useState<RecoveryStatus>("idle");
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [loggedError, setLoggedError] = useState<LoggedError | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);

  // Use a ref so the abort signal survives re-renders
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = false;
    setStatus("idle");
    setAttempts(0);
    setError(null);
    setLoggedError(null);
    setIsRetryable(false);
  }, []);

  const execute = useCallback(
    async (action: () => Promise<T>): Promise<T | undefined> => {
      abortRef.current = false;
      setStatus("idle");
      setAttempts(0);
      setError(null);
      setLoggedError(null);

      let attempt = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const result = await action();

          // Succeeded — record recovery if this was a retry
          if (attempt > 0 && loggedError) {
            errorLogger.recordRecoveryAttempt(loggedError.id, true);
            options.onRecovered?.(attempt);
          }

          setStatus("succeeded");
          setAttempts(attempt);
          return result;
        } catch (caught) {
          if (abortRef.current) return undefined;

          const err = caught instanceof Error ? caught : new Error(String(caught));
          const category = determineErrorCategory(err);
          const retryable = isRetryableError(err);

          // Log on first failure
          let logged = loggedError;
          if (attempt === 0) {
            logged = errorLogger.logError(err, {
              source: "useErrorRecovery",
              category,
              attempt,
            });
            setLoggedError(logged);
            setIsRetryable(retryable);
          } else if (logged) {
            errorLogger.recordRecoveryAttempt(logged.id, false);
          }

          setError(err);

          // Determine strategy (explicit override > category-derived > give up)
          const baseStrategy = getRecoveryStrategy(category);
          if (!retryable || !baseStrategy) {
            setStatus("failed");
            setAttempts(attempt);
            options.onExhausted?.(err, attempt);
            return undefined;
          }

          const strategy: RecoveryStrategy = {
            ...baseStrategy,
            ...options.strategy,
          };

          attempt += 1;
          setAttempts(attempt);

          if (attempt > strategy.maxAttempts) {
            setStatus("failed");
            options.onExhausted?.(err, attempt - 1);
            return undefined;
          }

          setStatus("retrying");

          const delay = computeDelay(strategy, attempt - 1);
          await sleep(delay);

          if (abortRef.current) return undefined;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.onExhausted, options.onRecovered, options.strategy],
  );

  return { execute, status, attempts, error, loggedError, reset, isRetryable };
}
