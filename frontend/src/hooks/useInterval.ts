"use client";

/**
 * useInterval — declarative setInterval with play/pause control.
 *
 * A safe wrapper around setInterval that:
 *  - Always calls the latest version of the callback (via ref pattern)
 *  - Pauses when delay is null
 *  - Cleans up on unmount
 *  - Exposes manual pause/resume/reset
 *
 * @example
 * // Count seconds
 * const { pause, resume } = useInterval(() => setCount(c => c + 1), 1000);
 *
 * // Pause by passing null
 * useInterval(callback, isRunning ? 500 : null);
 */

import { useEffect, useCallback, useRef, useState } from "react";

export interface UseIntervalOptions {
  /** Start immediately on mount (default true). */
  immediate?: boolean;
}

export interface UseIntervalResult {
  /** True if the interval is currently running. */
  isRunning: boolean;
  /** Pause the interval. */
  pause: () => void;
  /** Resume the interval. */
  resume: () => void;
  /** Reset: clear and restart the interval. */
  reset: () => void;
}

export function useInterval(
  callback: () => void,
  delay: number | null,
  options: UseIntervalOptions = {}
): UseIntervalResult {
  const { immediate = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const [isRunning, setIsRunning] = useState(immediate && delay !== null);
  const savedDelay = useRef(delay);
  savedDelay.current = delay;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const d = savedDelay.current;
    if (d === null) return;
    clear();
    intervalRef.current = setInterval(() => callbackRef.current(), d);
    setIsRunning(true);
  }, [clear]);

  const pause = useCallback(() => {
    clear();
    setIsRunning(false);
  }, [clear]);

  const resume = useCallback(() => {
    start();
  }, [start]);

  const reset = useCallback(() => {
    pause();
    start();
  }, [pause, start]);

  // Start or stop based on `delay` changes and `isRunning`
  useEffect(() => {
    if (!isRunning || delay === null) {
      clear();
      return;
    }

    intervalRef.current = setInterval(() => callbackRef.current(), delay);
    return clear;
  }, [isRunning, delay, clear]);

  // Clean up on unmount
  useEffect(() => () => clear(), [clear]);

  return { isRunning, pause, resume, reset };
}

/**
 * useTimeout — fire a callback once after a delay with cancel support.
 *
 * @example
 * const { cancel } = useTimeout(() => setToast(null), 3000);
 */
export function useTimeout(
  callback: () => void,
  delay: number | null
): { cancel: () => void; reset: () => void } {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    if (delay !== null) {
      timeoutRef.current = setTimeout(() => callbackRef.current(), delay);
    }
  }, [cancel, delay]);

  useEffect(() => {
    if (delay === null) return;
    timeoutRef.current = setTimeout(() => callbackRef.current(), delay);
    return cancel;
  }, [delay, cancel]);

  return { cancel, reset };
}
