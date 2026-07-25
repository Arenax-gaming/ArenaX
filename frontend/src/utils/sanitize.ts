/**
 * Input sanitization utilities (#706 – XSS Protections)
 *
 * Pure-TypeScript helpers with no runtime dependencies.
 * Use these on any user-supplied data before rendering or persisting it.
 */

// ─── HTML entity map ──────────────────────────────────────────────────────────
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

// Patterns for stripping dangerous HTML constructs
const SCRIPT_TAG_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_HANDLER_PATTERN = /\s+on\w+\s*=\s*["'][^"']*["']/gi;
const EVENT_HANDLER_UNQUOTED_PATTERN = /\s+on\w+\s*=\s*[^\s>]*/gi;
const JAVASCRIPT_URI_PATTERN = /javascript\s*:/gi;
const DATA_URI_SCRIPT_PATTERN = /data\s*:\s*text\/html/gi;
const IFRAME_PATTERN = /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi;
const EMBED_OBJECT_PATTERN = /<(?:embed|object|applet)\b[^>]*>/gi;

/**
 * Strips script tags, event handler attributes, javascript: URIs,
 * and other XSS vectors from an HTML string.
 *
 * NOTE: For rich-HTML use cases prefer a battle-tested library like DOMPurify
 * on the client side. This function is a lightweight server/SSR-safe fallback.
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string") return "";
  return input
    .replace(SCRIPT_TAG_PATTERN, "")
    .replace(IFRAME_PATTERN, "")
    .replace(EMBED_OBJECT_PATTERN, "")
    .replace(EVENT_HANDLER_PATTERN, "")
    .replace(EVENT_HANDLER_UNQUOTED_PATTERN, "")
    .replace(JAVASCRIPT_URI_PATTERN, "javascript_blocked:")
    .replace(DATA_URI_SCRIPT_PATTERN, "data_blocked:text/html")
    .trim();
}

/**
 * Returns '#' for dangerous URLs (javascript:, data:text/html, vbscript:).
 * Allows http://, https://, relative paths, and anchor-only URLs.
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== "string" || url.trim() === "") return "#";
  const trimmed = url.trim().toLowerCase();
  // Block dangerous schemes
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    trimmed.startsWith("data:text/html") ||
    trimmed.startsWith("data:application/")
  ) {
    return "#";
  }
  // Allow explicitly safe schemes and relative URLs
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(".")
  ) {
    return url.trim();
  }
  // Block anything else with an explicit scheme that isn't safe
  if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) {
    return "#";
  }
  // Relative URLs without explicit scheme are fine
  return url.trim();
}

/**
 * HTML entity-encodes a string to prevent injection into HTML attributes
 * and text nodes.
 */
export function escapeHtml(input: string): string {
  if (typeof input !== "string") return "";
  return input.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * General-purpose input sanitizer for user-supplied strings:
 * trims whitespace, enforces a maximum length, then HTML-escapes the result.
 *
 * @param input     - raw user input
 * @param maxLength - maximum allowed length (default: 1000)
 */
export function sanitizeInput(input: string, maxLength = 1000): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  const clamped = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  return escapeHtml(clamped);
}
