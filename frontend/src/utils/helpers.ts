/**
 * Core functional helpers (#704 – Enhanced Utilities Library)
 *
 * debounce, throttle, deep clone, array/object utilities, async helpers.
 * No runtime dependencies.
 */

// ─── Function Utilities ───────────────────────────────────────────────────────

/**
 * Returns a debounced version of `fn` that delays invocation by `delay` ms.
 * The timer resets on every new call within the delay window.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<T>): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
}

/**
 * Returns a throttled version of `fn` that can only fire once per `limit` ms.
 * Subsequent calls within the limit window are dropped.
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (...args: Parameters<T>): void {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

// ─── Object Utilities ─────────────────────────────────────────────────────────

/**
 * Creates a deep clone of a JSON-serialisable value.
 * Non-serialisable properties (functions, undefined, symbols) are silently dropped.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Groups an array of objects by the value of a key.
 * @returns Record mapping each unique key-value to an array of matching items.
 */
export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = String(item[key]);
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

/**
 * Splits an array into sub-arrays of at most `size` elements.
 * @example chunk([1,2,3,4,5], 2) → [[1,2],[3,4],[5]]
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Returns a new array with duplicate primitive values removed (preserves order).
 */
export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Returns a new array with duplicates removed based on a specific object key.
 * First occurrence wins.
 */
export function uniqueBy<T>(arr: T[], key: keyof T): T[] {
  const seen = new Set<unknown>();
  return arr.filter((item) => {
    const k = item[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Maps each element to an array and flattens the results by one level.
 * @example flatMap([1,2], n => [n, n * 2]) → [1, 2, 2, 4]
 */
export function flatMap<T, U>(arr: T[], fn: (item: T) => U[]): U[] {
  return arr.reduce<U[]>((acc, item) => acc.concat(fn(item)), []);
}

/**
 * Returns a shallow copy of `obj` containing only the listed keys.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

/**
 * Returns a shallow copy of `obj` with the listed keys removed.
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj } as Omit<T, K>;
  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string];
  }
  return result;
}

// ─── Async Utilities ──────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async function up to `attempts` times with an optional delay
 * between retries. Throws the last error if all attempts fail.
 * @param fn       - async factory function to call
 * @param attempts - maximum number of attempts (≥ 1)
 * @param delay    - milliseconds to wait between attempts (default 0)
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number,
  delay = 0
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1 && delay > 0) {
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ─── Miscellaneous ────────────────────────────────────────────────────────────

/**
 * Returns true if the object has no own enumerable properties.
 */
export function isObjectEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

/**
 * Safely parses a JSON string, returning `fallback` on any error.
 * @param str      - raw JSON string
 * @param fallback - value to return if parsing fails
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
