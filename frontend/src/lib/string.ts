/**
 * string.ts — comprehensive string utility library
 *
 * Pure functions only — no side effects, no browser dependencies.
 * All functions are tree-shakeable.
 */

// ---------------------------------------------------------------------------
// Case conversion
// ---------------------------------------------------------------------------

/** "hello_world" → "helloWorld" */
export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c) => c.toLowerCase());
}

/** "helloWorld" → "hello_world" */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/** "helloWorld" → "hello-world" */
export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
}

/** "hello world" → "Hello World" */
export function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "hello world" → "Hello world" */
export function toSentenceCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** "helloWorld" → "Hello World" (camel/pascal → human readable) */
export function humanize(str: string): string {
  return toTitleCase(
    str
      .replace(/([A-Z])/g, " $1")
      .replace(/[-_]+/g, " ")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Truncation & padding
// ---------------------------------------------------------------------------

/**
 * Truncate a string to `maxLength` characters, appending `suffix` if cut.
 * Breaks on the nearest word boundary when `breakOnWord` is true.
 */
export function truncate(
  str: string,
  maxLength: number,
  options: { suffix?: string; breakOnWord?: boolean } = {}
): string {
  const { suffix = "…", breakOnWord = false } = options;
  if (str.length <= maxLength) return str;

  const cut = maxLength - suffix.length;
  if (cut <= 0) return suffix;

  if (breakOnWord) {
    const lastSpace = str.lastIndexOf(" ", cut);
    return (lastSpace > 0 ? str.slice(0, lastSpace) : str.slice(0, cut)) + suffix;
  }
  return str.slice(0, cut) + suffix;
}

/** Pad a string on the left to reach `length` using `char` (default " "). */
export function padStart(str: string, length: number, char = " "): string {
  return str.padStart(length, char);
}

/** Pad a string on the right to reach `length` using `char` (default " "). */
export function padEnd(str: string, length: number, char = " "): string {
  return str.padEnd(length, char);
}

// ---------------------------------------------------------------------------
// Search & manipulation
// ---------------------------------------------------------------------------

/**
 * Count occurrences of `needle` in `haystack`.
 * Case-insensitive when `caseInsensitive` is true.
 */
export function countOccurrences(
  haystack: string,
  needle: string,
  caseInsensitive = false
): number {
  if (!needle) return 0;
  const h = caseInsensitive ? haystack.toLowerCase() : haystack;
  const n = caseInsensitive ? needle.toLowerCase() : needle;
  let count = 0;
  let pos = 0;
  while ((pos = h.indexOf(n, pos)) !== -1) {
    count++;
    pos += n.length;
  }
  return count;
}

/**
 * Replace all occurrences of `search` in `str` with `replacement`.
 * Unlike `String.replace(/regex/g)` this is safe with user-supplied strings.
 */
export function replaceAll(str: string, search: string, replacement: string): string {
  if (!search) return str;
  return str.split(search).join(replacement);
}

/** Reverse a string, correctly handling multi-char Unicode codepoints. */
export function reverseString(str: string): string {
  return [...str].reverse().join("");
}

/**
 * Highlight all case-insensitive occurrences of `term` in `text` by
 * wrapping them in `<mark>` tags. Safe for HTML rendering.
 */
export function highlight(text: string, term: string): string {
  if (!term) return escapeHtml(text);
  const escaped = escapeRegex(term);
  const re = new RegExp(`(${escaped})`, "gi");
  return escapeHtml(text).replace(re, "<mark>$1</mark>");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Returns true if the string contains only alphanumeric characters. */
export function isAlphanumeric(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}

/** Returns true if the string is a valid email address. */
export function isEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/** Returns true if the string is a valid URL (http/https). */
export function isUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns true if the string represents a finite number. */
export function isNumericString(str: string): boolean {
  return str.trim() !== "" && isFinite(Number(str));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate a random alphanumeric string of `length` characters.
 * Uses crypto.getRandomValues when available, Math.random otherwise.
 */
export function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    arr.forEach((_, i) => (arr[i] = Math.floor(Math.random() * 256)));
  }

  return Array.from(arr)
    .map((n) => chars[n % chars.length])
    .join("");
}

/**
 * Generate a URL-safe slug from any string.
 * "Hello World! 2025" → "hello-world-2025"
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // remove diacritics
    .replace(/[^a-z0-9\s-]/g, "")      // remove non-alphanumeric
    .trim()
    .replace(/[\s_-]+/g, "-")           // collapse whitespace/dashes
    .replace(/^-+|-+$/g, "");           // trim leading/trailing dashes
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Simple template interpolation: replace `{{key}}` tokens with values.
 *
 * @example
 * interpolate("Hello {{name}}!", { name: "ArenaX" }) // "Hello ArenaX!"
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number | boolean>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{{${key}}}`
  );
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Escape special HTML characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escape special regex metacharacters in a string. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Byte / display helpers
// ---------------------------------------------------------------------------

/**
 * Format a byte count to a human-readable string.
 * 1536 → "1.5 KB"
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Mask sensitive data, showing only the last `visible` characters.
 * "1234567890" → "••••••7890"
 */
export function maskSensitive(str: string, visible = 4, mask = "•"): string {
  if (str.length <= visible) return str;
  return mask.repeat(str.length - visible) + str.slice(-visible);
}

/**
 * Extract initials from a full name (up to `max` initials).
 * "John Michael Doe" → "JMD"
 */
export function getInitials(name: string, max = 2): string {
  return name
    .split(/\s+/)
    .slice(0, max)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
