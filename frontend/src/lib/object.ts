/**
 * object.ts — deep object utilities
 *
 * Pure functions — no side effects, no browser dependencies.
 */

// ---------------------------------------------------------------------------
// Deep clone
// ---------------------------------------------------------------------------

/**
 * Deep clone a value.
 * Uses `structuredClone` when available (modern browsers/Node 17+),
 * falls back to JSON round-trip for plain data objects.
 * Cannot clone Functions, Symbols, DOM nodes, or Dates accurately via JSON.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  // JSON fallback — converts Date to string, loses undefined values
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Recursively merge `source` into `target`.
 * Arrays are replaced (not concatenated).
 * Returns a new object — does not mutate either argument.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: DeepPartial<T>
): T {
  const output: Record<string, unknown> = { ...target };

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const srcVal = source[key];
    const tgtVal = output[key];

    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      output[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      output[key] = srcVal;
    }
  }

  return output as T;
}

// ---------------------------------------------------------------------------
// Deep equality
// ---------------------------------------------------------------------------

/**
 * Structural deep equality check.
 * Handles primitives, objects, arrays, Date, null, undefined.
 * Does not handle circular references.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

// ---------------------------------------------------------------------------
// Deep diff
// ---------------------------------------------------------------------------

export type DeepDiffResult = {
  /** Keys present in `next` but not `prev` (or changed values). */
  added: Record<string, unknown>;
  /** Keys present in `prev` but not `next`. */
  removed: Record<string, unknown>;
  /** Keys present in both with different values. */
  changed: Record<string, { from: unknown; to: unknown }>;
};

/**
 * Compute a shallow diff between two plain objects.
 * For a full deep diff use with `deepEqual` per key.
 */
export function shallowDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): DeepDiffResult {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const key of allKeys) {
    const inPrev = Object.prototype.hasOwnProperty.call(prev, key);
    const inNext = Object.prototype.hasOwnProperty.call(next, key);

    if (!inPrev) {
      added[key] = next[key];
    } else if (!inNext) {
      removed[key] = prev[key];
    } else if (!deepEqual(prev[key], next[key])) {
      changed[key] = { from: prev[key], to: next[key] };
    }
  }

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Pick / omit
// ---------------------------------------------------------------------------

/**
 * Pick specified keys from an object.
 * @example
 * pick({ a: 1, b: 2, c: 3 }, ["a", "c"]) // { a: 1, c: 3 }
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach((key) => {
    if (key in obj) result[key] = obj[key];
  });
  return result;
}

/**
 * Omit specified keys from an object.
 * @example
 * omit({ a: 1, b: 2, c: 3 }, ["b"]) // { a: 1, c: 3 }
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result as Omit<T, K>;
}

// ---------------------------------------------------------------------------
// Path access
// ---------------------------------------------------------------------------

/**
 * Get a deeply nested value using a dot-separated path.
 * Returns `defaultValue` (undefined) if any segment is missing.
 * @example
 * getIn({ a: { b: { c: 42 } } }, "a.b.c") // 42
 */
export function getIn(
  obj: Record<string, unknown>,
  path: string,
  defaultValue?: unknown
): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current !== undefined ? current : defaultValue;
}

/**
 * Set a deeply nested value using a dot-separated path.
 * Returns a new object — does not mutate the original.
 * @example
 * setIn({ a: { b: 1 } }, "a.b", 99) // { a: { b: 99 } }
 */
export function setIn(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const segments = path.split(".");
  const clone = deepClone(obj);
  let current = clone as Record<string, unknown>;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof current[seg] !== "object" || current[seg] === null) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
  return clone;
}

// ---------------------------------------------------------------------------
// Inversion & transformation
// ---------------------------------------------------------------------------

/**
 * Invert keys and values of an object.
 * @example
 * invertObject({ a: "1", b: "2" }) // { "1": "a", "2": "b" }
 */
export function invertObject(
  obj: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
}

/**
 * Map the values of an object, returning a new object with the same keys.
 */
export function mapValues<T, U>(
  obj: Record<string, T>,
  fn: (value: T, key: string) => U
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = fn(value, key);
  }
  return result;
}

/**
 * Filter an object's entries by a predicate on [key, value].
 */
export function filterObject<T>(
  obj: Record<string, T>,
  predicate: (value: T, key: string) => boolean
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => predicate(value, key))
  );
}

/**
 * Remove all keys whose value is null or undefined.
 */
export function compactObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return filterObject(obj as Record<string, unknown>, (v) => v !== null && v !== undefined) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/**
 * Check whether two objects are shallowly equal.
 */
export function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

/**
 * Return true if `obj` has no own enumerable keys.
 */
export function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

/**
 * Return true if `value` is a plain (non-null, non-array) object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
