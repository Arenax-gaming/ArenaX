/**
 * performance.ts — client-side performance utilities
 *
 * Measurement, rate limiting, and lightweight benchmarking tools.
 * SSR-safe: all browser API access is guarded with `typeof window` checks.
 */

// ---------------------------------------------------------------------------
// Timing / measurement
// ---------------------------------------------------------------------------

/**
 * Measure the execution time of a synchronous function.
 * Returns `{ result, durationMs }`.
 */
export function measureSync<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  return { result, durationMs: performance.now() - start };
}

/**
 * Measure the execution time of an async function.
 * Returns `{ result, durationMs }`.
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, durationMs: performance.now() - start };
}

/**
 * Mark a named performance entry (wraps `performance.mark`).
 * No-op in non-browser environments.
 */
export function mark(name: string): void {
  if (typeof performance !== "undefined") {
    performance.mark(name);
  }
}

/**
 * Measure between two marks and return the duration in ms.
 * Returns null if either mark does not exist.
 */
export function measureBetween(startMark: string, endMark: string): number | null {
  if (typeof performance === "undefined") return null;
  try {
    const label = `${startMark}→${endMark}`;
    performance.measure(label, startMark, endMark);
    const entries = performance.getEntriesByName(label, "measure");
    performance.clearMeasures(label);
    return entries[0]?.duration ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Maximum number of calls allowed within `windowMs`. */
  maxCalls: number;
  /** Time window in ms (default 1000). */
  windowMs?: number;
}

export interface RateLimiterResult {
  /** True if the call is allowed. */
  allowed: boolean;
  /** Number of calls remaining in the current window. */
  remaining: number;
  /** Ms until the window resets. */
  resetsInMs: number;
}

/**
 * Create a token-bucket style rate limiter.
 *
 * @example
 * const limiter = createRateLimiter({ maxCalls: 5, windowMs: 1000 });
 * if (limiter.check().allowed) { ... }
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { maxCalls, windowMs = 1000 } = options;
  let calls: number[] = [];

  return {
    check(): RateLimiterResult {
      const now = Date.now();
      // Evict calls outside the window
      calls = calls.filter((t) => now - t < windowMs);

      const allowed = calls.length < maxCalls;
      if (allowed) calls.push(now);

      const oldest = calls[0] ?? now;
      const resetsInMs = Math.max(0, windowMs - (now - oldest));

      return {
        allowed,
        remaining: Math.max(0, maxCalls - calls.length),
        resetsInMs,
      };
    },

    reset(): void {
      calls = [];
    },

    get count(): number {
      const now = Date.now();
      calls = calls.filter((t) => now - t < windowMs);
      return calls.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Idle-time scheduling
// ---------------------------------------------------------------------------

type IdleCallback = (deadline: { timeRemaining: () => number }) => void;

/**
 * Schedule work during browser idle time.
 * Falls back to `setTimeout` when `requestIdleCallback` is unavailable (SSR, older Safari).
 *
 * @example
 * scheduleIdle(() => preloadHeavyModule());
 */
export function scheduleIdle(
  callback: IdleCallback,
  timeout = 2000
): () => void {
  if (typeof window === "undefined") {
    const id = setTimeout(() => callback({ timeRemaining: () => 50 }), 0);
    return () => clearTimeout(id);
  }

  if ("requestIdleCallback" in window) {
    const id = (window as Window & { requestIdleCallback: (cb: IdleCallback, opts?: { timeout: number }) => number }).requestIdleCallback(
      callback,
      { timeout }
    );
    return () =>
      (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
  }

  // Fallback for Safari
  const id = setTimeout(() => callback({ timeRemaining: () => 50 }), 1);
  return () => clearTimeout(id);
}

// ---------------------------------------------------------------------------
// Frame scheduling
// ---------------------------------------------------------------------------

/**
 * Schedule `callback` to run in the next animation frame.
 * Returns a cancel function.
 */
export function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "undefined") {
    const id = setTimeout(callback, 16);
    return () => clearTimeout(id);
  }
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
}

// ---------------------------------------------------------------------------
// Memory usage
// ---------------------------------------------------------------------------

export interface MemoryInfo {
  usedJSHeapSizeMB: number | null;
  totalJSHeapSizeMB: number | null;
  heapUsagePercent: number | null;
}

/**
 * Return JS heap memory usage (Chrome only — returns nulls elsewhere).
 */
export function getMemoryInfo(): MemoryInfo {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  };

  if (!perf.memory) {
    return {
      usedJSHeapSizeMB: null,
      totalJSHeapSizeMB: null,
      heapUsagePercent: null,
    };
  }

  const used = perf.memory.usedJSHeapSize / (1024 * 1024);
  const total = perf.memory.totalJSHeapSize / (1024 * 1024);

  return {
    usedJSHeapSizeMB: Math.round(used * 10) / 10,
    totalJSHeapSizeMB: Math.round(total * 10) / 10,
    heapUsagePercent: total > 0 ? Math.round((used / total) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Lib analytics integration
// ---------------------------------------------------------------------------

export interface LibAnalyticsEvent {
  utility: string;
  operation: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Emit a lib-level analytics event.
 * Consumed by the same `arenax:lib:event` custom event stream.
 */
export function emitLibEvent(event: Omit<LibAnalyticsEvent, "timestamp">): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("arenax:lib:event", {
      detail: { ...event, timestamp: Date.now() },
    })
  );
}

/**
 * Subscribe to lib analytics events.
 */
export function subscribeToLibEvents(
  handler: (event: LibAnalyticsEvent) => void
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<LibAnalyticsEvent>).detail);
  };
  window.addEventListener("arenax:lib:event", listener);
  return () => window.removeEventListener("arenax:lib:event", listener);
}
