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
import { trackStateUpdate } from "@/lib/stateMonitor";

export interface UseOptimisticStateOptions<T> {
  /** Called after the async operation resolves successfully. */
  onSuccess?: (next: T, prev: T) => void;
  /** Called after the async operation rejects (before rollback). */
  onError?: (error: Error, attempted: T, rolled_back_to: T) => void;
  /** Delay in ms before rolling back the UI on error (default: 0). */
  rollbackDelayMs?: number;
  /** Hook name for monitoring (default: "useOptimisticState"). */
  monitorName?: string;
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
  const { onSuccess, onError, rollbackDelayMs = 0, monitorName = "useOptimisticState" } = options;

  const [value, setValue] = useState<T>(initialValue);
  const [confirmedValue, setConfirmedValue] = useState<T>(initialValue);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track the in-flight operation to handle concurrent updates
  const pendingCountRef = useRef(0);
  // State version to detect stale updates
  const versionRef = useRef(0);
  // Queue of pending operations to ensure ordering
  const updateQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // Lock to prevent concurrent state modifications
  const lockRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback((newValue: T) => {
    // Clear queue and reset versions
    versionRef.current += 1;
    lockRef.current = false;
    updateQueueRef.current = Promise.resolve(true);
    pendingCountRef.current = 0;
    
    setValue(newValue);
    setConfirmedValue(newValue);
    setError(null);
    setIsPending(false);
  }, []);

  const update = useCallback(
    async (nextValue: T): Promise<boolean> => {
      // Capture current version for this update
      const updateVersion = ++versionRef.current;
      
      // Chain this update to the queue to prevent race conditions
      const previousUpdate = updateQueueRef.current;
      
      const updatePromise = (async (): Promise<boolean> => {
        // Wait for previous update to complete
        await previousUpdate;
        
        // Check if this update is still valid (not superseded)
        if (versionRef.current !== updateVersion) {
          return false; // Stale update, skip
        }
        
        const previousConfirmed = confirmedValue;
        const startTime = Date.now();
        
        // Acquire lock
        while (lockRef.current) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        lockRef.current = true;

        try {
          // Optimistic update — apply immediately
          setValue(nextValue);
          setError(null);
          
          trackStateUpdate({
            hookName: monitorName,
            timestamp: Date.now(),
            version: updateVersion,
            updateType: "optimistic",
          });
          
          if (pendingCountRef.current === 0) {
            setIsPending(true);
          }
          pendingCountRef.current += 1;

          const result = await asyncOperation(nextValue);
          
          // Double-check version hasn't changed during async operation
          if (versionRef.current !== updateVersion) {
            return false; // Superseded by newer update
          }
          
          // Use server-returned value if provided, else use what we sent
          const resolved = result !== undefined && result !== null ? (result as T) : nextValue;
          setConfirmedValue(resolved);
          setValue(resolved);
          
          const duration = Date.now() - startTime;
          trackStateUpdate({
            hookName: monitorName,
            timestamp: Date.now(),
            version: updateVersion,
            updateType: "confirmed",
            duration,
          });
          
          onSuccess?.(resolved, previousConfirmed);
          return true;
        } catch (caught) {
          const err = caught instanceof Error ? caught : new Error(String(caught));
          setError(err);

          if (rollbackDelayMs > 0) {
            await new Promise((r) => setTimeout(r, rollbackDelayMs));
          }

          // Only rollback if this is still the current version
          if (versionRef.current === updateVersion) {
            setValue(previousConfirmed);
            
            const duration = Date.now() - startTime;
            trackStateUpdate({
              hookName: monitorName,
              timestamp: Date.now(),
              version: updateVersion,
              updateType: "rollback",
              duration,
            });
          }
          onError?.(err, nextValue, previousConfirmed);
          return false;
        } finally {
          pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
          if (pendingCountRef.current === 0) {
            setIsPending(false);
          }
          lockRef.current = false;
        }
      })();
      
      updateQueueRef.current = updatePromise;
      return updatePromise;
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
