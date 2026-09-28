/**
 * PII redaction helpers for error monitoring — Issue #1100.
 *
 * Error reports sent to external monitoring services (Datadog RUM, Google
 * Analytics) must never include personally identifiable information. These
 * helpers strip emails, phone numbers and bearer/JWT tokens from error
 * messages and context payloads before anything leaves the browser.
 */

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_PATTERN = /\+?\d[\d\s\-().]{7,}\d/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

export function redactPii(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(PHONE_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}

export function redactContext<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "string") {
    return redactPii(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactContext(item, seen)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return value;
    seen.add(obj);

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = redactContext(obj[key], seen);
    }
    return result as unknown as T;
  }

  return value;
}

/**
 * Returns a clone of `error` whose message has been stripped of PII, so the
 * original error object (and its UI-facing message) is left untouched while
 * the monitored copy is safe to forward.
 */
export function redactErrorForMonitoring(error: Error): Error {
  const cleaned = new Error(redactPii(error.message));
  cleaned.name = error.name;
  cleaned.stack = error.stack;
  return cleaned;
}