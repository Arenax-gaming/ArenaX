/**
 * async.ts — async utilities: retry, debounce, throttle, memoize, sleep, race
 *
 * All utilities are environment-agnostic (work in browser and Node.js).
 */

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

/** Return a Promise that resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts (default 3). */
  attempts?: number;
  /** Base delay in ms between retries (default 300). */
  delayMs?: number;
  /** Whether to use exponential back-off (default true). */
  exponential?: boolean;
  /** Max delay cap in ms (default 30_000). */
  maxDelayMs?: number;
  /** Jitter fraction 0–1 added to delay to prevent thundering herd (default 0.1). */
  jitter?: number;
  /** Predicate — if provided, only retry when it returns true. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry attempt. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Execute `fn` with automatic retry on failure.
 *
 * @example
 * const data = await retry(() => api.getTournaments(), { attempts: 3, delayMs: 500 });
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    attempts = 3,
    delayMs = 300,
    exponential = true,
    maxDelayMs = 30_000,
    jitter = 0.1,
    shouldRetry,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === attempts) break;
      if (shouldRetry && !shouldRetry(err, attempt)) break;

      const base = exponential
        ? Math.min(delayMs * Math.pow(2, attempt - 1), maxDelayMs)
        : delayMs;
      const jitterMs = base * jitter * Math.random();
      const wait = Math.min(base + jitterMs, maxDelayMs);

      onRetry?.(err, attempt, wait);
      await sleep(wait);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

export interface DebouncedFn<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): void;
  /** Cancel any pending invocation. */
  cancel: () => void;
  /** Immediately invoke the pending call (if any) and cancel the timer. */
  flush: (...args: Parameters<T>) => void;
}

/**
 * Returns a debounced version of `fn` that delays invocation until `waitMs`
 * ms after the last call.
 *
 * @example
 * const debouncedSearch = debounce((query: string) => search(query), 300);
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  waitMs: number,
  options: { leading?: boolean } = {}
): DebouncedFn<T> {
  const { leading = false } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;

    if (timer === null && leading) {
      fn(...args);
    }

    if (timer !== null) clearTimeout(timer);

    timer = setTimeout(() => {
      timer = null;
      if (!leading && lastArgs !== null) fn(...lastArgs);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    fn(...(args.length ? args : (lastArgs ?? [])));
    lastArgs = null;
  };

  return debounced as DebouncedFn<T>;
}

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

export interface ThrottledFn<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): void;
  cancel: () => void;
}

/**
 * Returns a throttled version of `fn` — invoked at most once per `limitMs`.
 * Trailing edge by default: fires with the most recent args after the window closes.
 *
 * @example
 * const throttledScroll = throttle(onScroll, 100);
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limitMs: number
): ThrottledFn<T> {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailingArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed >= limitMs) {
      lastCall = now;
      fn(...args);
    } else {
      trailingArgs = args;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          lastCall = Date.now();
          if (trailingArgs !== null) {
            fn(...trailingArgs);
            trailingArgs = null;
          }
        }, limitMs - elapsed);
      }
    }
  };

  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    trailingArgs = null;
  };

  return throttled as ThrottledFn<T>;
}

// ---------------------------------------------------------------------------
// memoize
// ---------------------------------------------------------------------------

export interface MemoizeOptions {
  /** Key resolver — defaults to JSON.stringify of all args. */
  keyFn?: (...args: unknown[]) => string;
  /**
   * Time-to-live in ms for cached results.
   * Expired entries are evicted lazily on next access.
   */
  ttlMs?: number;
  /** Max number of cached entries (LRU eviction). */
  maxSize?: number;
}

export interface MemoizedFn<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): ReturnType<T>;
  /** Clear all cached entries. */
  clear: () => void;
  /** Return the current cache size. */
  size: () => number;
}

/**
 * Memoize a (possibly async) function with optional TTL and LRU eviction.
 *
 * @example
 * const cachedFetch = memoize(fetchUserById, { ttlMs: 60_000, maxSize: 100 });
 */
export function memoize<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: MemoizeOptions = {}
): MemoizedFn<T> {
  const {
    keyFn = (...args) => JSON.stringify(args),
    ttlMs,
    maxSize,
  } = options;

  const cache = new Map<string, { value: ReturnType<T>; expiry: number | null }>();

  const memoized = (...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn(...args);
    const now = Date.now();

    const entry = cache.get(key);
    if (entry !== undefined) {
      if (entry.expiry === null || entry.expiry > now) {
        // LRU: move to end on access
        cache.delete(key);
        cache.set(key, entry);
        return entry.value;
      }
      // Expired — evict
      cache.delete(key);
    }

    const result = fn(...args) as ReturnType<T>;

    // LRU eviction when over maxSize
    if (maxSize !== undefined && cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }

    cache.set(key, {
      value: result,
      expiry: ttlMs !== undefined ? now + ttlMs : null,
    });

    return result;
  };

  memoized.clear = () => cache.clear();
  memoized.size = () => cache.size;

  return memoized as MemoizedFn<T>;
}

// ---------------------------------------------------------------------------
// race with timeout
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.
 * Throws `TimeoutError` if `promise` does not resolve within `ms`.
 *
 * @example
 * const result = await withTimeout(fetch(url), 5000);
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Create a manually resolvable Promise.
 *
 * @example
 * const deferred = createDeferred<string>();
 * deferred.resolve("done");
 * await deferred.promise; // "done"
 */
export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Batch / queue
// ---------------------------------------------------------------------------

/**
 * Batch multiple calls to `fn` into a single invocation per `windowMs`.
 * All callers within the window receive the same resolved value.
 *
 * Useful for deduplicating parallel fetches of the same data.
 *
 * @example
 * const batchedFetch = batchCalls(() => api.getLeaderboard(), 50);
 * // Ten simultaneous calls → one actual fetch
 */
export function batchCalls<T>(
  fn: () => Promise<T>,
  windowMs = 50
): () => Promise<T> {
  let pending: Deferred<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    if (!pending) {
      pending = createDeferred<T>();

      timer = setTimeout(async () => {
        const current = pending!;
        pending = null;
        timer = null;
        try {
          current.resolve(await fn());
        } catch (err) {
          current.reject(err);
        }
      }, windowMs);
    }

    return pending.promise;
  };
}
