/**
 * ArenaX — Response Data Transformer
 *
 * A composable transformation pipeline that normalizes raw API payloads
 * before they reach application code.
 *
 * Transformations (applied in order):
 *  1. camelCase key normalization  — snake_case → camelCase
 *  2. ISO date detection           — string fields ending in _at / _date / At / Date
 *  3. Null pruning                 — removes explicit null / undefined leaves
 *  4. Type coercions               — numeric strings → numbers where safe
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransformFn<T = unknown> = (value: T) => T;

export interface TransformerOptions {
  /** Convert snake_case keys to camelCase. Default: true */
  normalizeCasing?: boolean;
  /** Parse ISO-8601 date strings into Date objects. Default: false */
  parseDates?: boolean;
  /** Strip null / undefined leaf values. Default: false */
  stripNulls?: boolean;
  /** Coerce numeric strings to numbers. Default: false */
  coerceNumbers?: boolean;
}

// ─── Key normalization ────────────────────────────────────────────────────────

/**
 * Converts a single snake_case string to camelCase.
 * Handles consecutive underscores and leading underscores gracefully.
 */
export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Converts a single camelCase string to snake_case (for reverse transforms).
 */
export function camelToSnake(key: string): string {
  return key.replace(/([A-Z])/g, (_, char: string) => `_${char.toLowerCase()}`);
}

// ─── ISO date detection ───────────────────────────────────────────────────────

/**
 * Regex that matches a subset of ISO-8601 datetime strings.
 * Intentionally strict to avoid false positives on plain strings.
 */
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Key-name patterns that hint a value is a timestamp. */
const DATE_KEY_RE = /(?:_at|_date|At|Date|Time|time)$/;

export function looksLikeDateString(value: unknown, key?: string): value is string {
  if (typeof value !== "string") return false;
  if (key && !DATE_KEY_RE.test(key)) return false;
  return ISO_DATE_RE.test(value);
}

// ─── Core recursive transformer ───────────────────────────────────────────────

/**
 * Recursively walks a JSON-compatible value and applies enabled transformations.
 * Returns a new deep copy — never mutates the input.
 */
export function transformValue(
  value: unknown,
  options: TransformerOptions,
  parentKey?: string,
): unknown {
  // ── null / undefined pruning ─────────────────────────────────────────────
  if (value === null || value === undefined) {
    return options.stripNulls ? undefined : value;
  }

  // ── Date strings ─────────────────────────────────────────────────────────
  if (options.parseDates && looksLikeDateString(value, parentKey)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }

  // ── Numeric coercion ─────────────────────────────────────────────────────
  if (options.coerceNumbers && typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!isNaN(n)) return n;
  }

  // ── Primitives ────────────────────────────────────────────────────────────
  if (typeof value !== "object") return value;

  // ── Arrays ────────────────────────────────────────────────────────────────
  if (Array.isArray(value)) {
    const transformed = value
      .map((item) => transformValue(item, options, parentKey))
      .filter((item) => !(options.stripNulls && item === undefined));
    return transformed;
  }

  // ── Objects ───────────────────────────────────────────────────────────────
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const newKey = options.normalizeCasing !== false ? snakeToCamel(k) : k;
    const transformed = transformValue(v, options, k);

    if (options.stripNulls && transformed === undefined) continue;
    result[newKey] = transformed;
  }
  return result;
}

// ─── Pipeline builder ─────────────────────────────────────────────────────────

/**
 * Builds an ordered list of transformation stage names for the response meta,
 * based on which options are enabled.
 */
export function buildTransformationLog(options: TransformerOptions): string[] {
  const stages: string[] = [];
  if (options.normalizeCasing !== false) stages.push("camelCase normalization");
  if (options.parseDates) stages.push("ISO date parsing");
  if (options.stripNulls) stages.push("null pruning");
  if (options.coerceNumbers) stages.push("numeric coercion");
  return stages;
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/**
 * Applies the default transformation pipeline (camelCase normalization only).
 * This is the fast path used for most API responses.
 */
export function defaultTransform<T>(data: unknown): T {
  return transformValue(data, { normalizeCasing: true }) as T;
}

/**
 * Applies the full transformation pipeline.
 */
export function fullTransform<T>(data: unknown, options?: TransformerOptions): T {
  return transformValue(data, {
    normalizeCasing: true,
    parseDates: true,
    stripNulls: false,
    coerceNumbers: false,
    ...options,
  }) as T;
}
