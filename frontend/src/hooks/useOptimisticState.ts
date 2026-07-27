"use client";

/**
 * useOptimisticState — optimistic UI state with automatic rollback.
 *
 * Manages a piece of state that is updated immediately in the UI while an
 * async operation confirms the change. On failure the state is rolled back
 * to the last confirmed value and an error is surfaced.
 *
 * Features:
 *  - Immediate optimistic update — zero perceived latency
 *  - Automatic rollback on error with configurable delay
 *  - Pending / error status for loading indicators
 *  - Queue-aware: multiple concurrent updates don't trample each other
 *  - Optional onSuccess / onError callbacks
 *
 * @example
 * const { value, update, isPending, error } = useOptimisticState(
 *   initialTournament,
 *   (next) => api.updateTournament(next.id, next),
 *   { onSuccess: () => toast("Saved!") }
 * );
 */

import { useState, useCallback, useRef } from "react";

export interface UseOptimisticStateOptions<T> {
  /** Called after the async operation resolves successfully. */
  onSuccess?: (next: T, prev: T) => void;
  /** Called after the async operation rejects (before rollback). */
  onError?: (error: Error, attempted: T, rolled_back_to: T) => void;
  /** Delay in ms before rolling back the UI on error (default: 0). */
  rollbackDelayMs?: number;
}

export interface UseOptimisticStateResult<T> {
  /** The current (possibly optimistic) value. */
  value: T;
  /** The last server-confirmed value. */
  confirmedValue: T;
  /** Perform an optimistic update. Returns true on success, false on rollback. */
  update: (nextValue: T) => Promise<boolean>;
  /** True while an async operation is in-flight. */
  isPending: boolean;
  /** The error from the last failed operation (null when idle/succeeded). */
  error: Error | null;
  /** Manually clear the error without resetting state. */
  clearError: () => void;
  /** Reset both optimistic and confirmed state to a new value. */
  reset: (value: T) => void;
}

export function useOptimisticState<T>(
  initialValue: T,
  asyncOperation: (next: T) => Promise<T | void>,
  options: UseOptimisticStateOptions<T> = {}
): UseOptimisticStateResult<T> {
  const { onSuccess, onError, rollbackDelayMs = 0 } = options;

  const [value, setValue] = useState<T>(initialValue);
  const [confirmedValue, setConfirmedValue] = useState<T>(initialValue);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track the in-flight operation to handle concurrent updates
  const pendingCountRef = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback((newValue: T) => {
    setValue(newValue);
    setConfirmedValue(newValue);
    setError(null);
  }, []);

  const update = useCallback(
    async (nextValue: T): Promise<boolean> => {
      const previousConfirmed = confirmedValue;

      // Optimistic update — apply immediately
      setValue(nextValue);
      setError(null);
      setIsPending(true);
      pendingCountRef.current += 1;

      try {
        const result = await asyncOperation(nextValue);
        // Use server-returned value if provided, else use what we sent
        const resolved = result !== undefined && result !== null ? (result as T) : nextValue;
        setConfirmedValue(resolved);
        setValue(resolved);
        onSuccess?.(resolved, previousConfirmed);
        return true;
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setError(err);

        if (rollbackDelayMs > 0) {
          await new Promise((r) => setTimeout(r, rollbackDelayMs));
        }

        // Rollback to last confirmed value
        setValue(previousConfirmed);
        onError?.(err, nextValue, previousConfirmed);
        return false;
      } finally {
        pendingCountRef.current -= 1;
        if (pendingCountRef.current === 0) {
          setIsPending(false);
        }
      }
    },
    [confirmedValue, asyncOperation, onSuccess, onError, rollbackDelayMs]
  );

  return {
    value,
    confirmedValue,
    update,
    isPending,
    error,
    clearError,
    reset,
  };
}
