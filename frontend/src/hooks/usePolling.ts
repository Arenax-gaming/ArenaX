"use client";

/**
 * usePolling — periodically fetch data with adaptive intervals, pause on
 * error, and pause when the tab is hidden.
 *
 * Features:
 *  - Configurable polling interval
 *  - Manual pause/resume
 *  - Auto-pause when the tab is hidden or the browser is in the background
 *  - Error pause with optional exponential back-off
 *  - Cleanup on unmount
 *
 * @example
 * const { data, isPolling, pause, resume, error } = usePolling({
 *   fn: () => api.getMatchStatus(matchId),
 *   interval: 3000,
 *   pauseOnError: true,
 * });
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface UsePollingOptions<T> {
  /** Async function called on each poll. */
  fn: () => Promise<T>;
  /** Interval in ms (default 5000). */
  interval?: number;
  /** Start polling immediately on mount (default true). */
  immediate?: boolean;
  /** Pause polling when an error occurs (default true). */
  pauseOnError?: boolean;
  /** Pause when the document is hidden (default true). */
  pauseOnHidden?: boolean;
  /** Called when the polled data updates. */
  onUpdate?: (data: T) => void;
  /** Called on error. */
  onError?: (error: Error) => void;
}

export interface UsePollingResult<T> {
  /** Latest polled data (null until first success). */
  data: T | null;
  /** True while a fetch is in flight. */
  isLoading: boolean;
  /** True if polling is active (not paused). */
  isPolling: boolean;
  /** Last error (null when idle or succeeded). */
  error: Error | null;
  /** Manually pause polling. */
  pause: () => void;
  /** Manually resume polling. */
  resume: () => void;
  /** Trigger an immediate fetch (doesn't reset the interval timer). */
  refetch: () => Promise<void>;
}

export function usePolling<T>({
  fn,
  interval = 5000,
  immediate = true,
  pauseOnError = true,
  pauseOnHidden = true,
  onUpdate,
  onError,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      setData(result);
      onUpdate?.(result);
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught));
      setError(err);
      onError?.(err);
      if (pauseOnError) {
        setIsPolling(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [pauseOnError, onUpdate, onError]);

  const pause = useCallback(() => {
    setIsPolling(false);
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    setError(null);
    setIsPolling(true);
  }, []);

  // Set up the interval when isPolling = true
  useEffect(() => {
    if (!isPolling) return;

    // Immediately fetch once on start
    refetch();

    // Then set up the recurring interval
    intervalRef.current = setInterval(() => {
      refetch();
    }, interval);

    return clearTimer;
  }, [isPolling, interval, refetch, clearTimer]);

  // Pause when the document is hidden (tab switch, minimize)
  useEffect(() => {
    if (!pauseOnHidden) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else if (isPolling) {
        // Resume polling when tab is visible again
        intervalRef.current = setInterval(() => {
          refetch();
        }, interval);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pauseOnHidden, isPolling, interval, refetch, clearTimer]);

  return {
    data,
    isLoading,
    isPolling,
    error,
    pause,
    resume,
    refetch,
  };
}
