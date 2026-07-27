/**
 * i18n Monitoring & Analytics Utility
 *
 * Responsibilities:
 *  - Capture missing translation key events (dev/staging only)
 *  - Track language-change events and forward them to the analytics bus
 *  - Provide a lightweight in-memory store so the dev overlay can surface gaps
 */

import { getAnalyticsService } from "@/lib/analytics";
import type { Locale } from "./routing";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MissingKeyRecord {
  locale: string;
  namespace: string;
  key: string;
  timestamp: number;
  count: number;
}

export interface LocaleChangeRecord {
  from: Locale | null;
  to: Locale;
  timestamp: number;
  source: "user" | "auto-detect" | "url-param" | "storage";
}

// ─── In-memory store (dev/staging) ───────────────────────────────────────────

const missingKeys = new Map<string, MissingKeyRecord>();
let localeHistory: LocaleChangeRecord[] = [];

const ENABLED =
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "production";

// ─── Missing-key tracking ─────────────────────────────────────────────────────

/**
 * Called by the next-intl `onError` / `getMessageFallback` callbacks.
 * Batches duplicate reports so the console isn't flooded.
 */
export function reportMissingKey(
  locale: string,
  namespace: string,
  key: string
): void {
  if (!ENABLED) return;

  const mapKey = `${locale}:${namespace}:${key}`;
  const existing = missingKeys.get(mapKey);

  if (existing) {
    existing.count += 1;
    existing.timestamp = Date.now();
  } else {
    missingKeys.set(mapKey, {
      locale,
      namespace,
      key,
      timestamp: Date.now(),
      count: 1,
    });
    // Only log the first occurrence to avoid noise
    console.warn(
      `[i18n] Missing key — locale: "${locale}", namespace: "${namespace}", key: "${key}"`
    );
  }
}

/**
 * Returns all recorded missing keys (sorted by most-recent first).
 */
export function getMissingKeys(): MissingKeyRecord[] {
  return [...missingKeys.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clears the missing-key store (useful in tests).
 */
export function clearMissingKeys(): void {
  missingKeys.clear();
}

// ─── Locale-change analytics ──────────────────────────────────────────────────

/**
 * Track a locale change event.
 * Forwards to the AnalyticsService (if consent granted) and keeps a local log.
 *
 * @param from   - Previous locale (`null` on first load)
 * @param to     - New locale being activated
 * @param source - How the change was triggered
 */
export function trackLocaleChange(
  from: Locale | null,
  to: Locale,
  source: LocaleChangeRecord["source"] = "user"
): void {
  const record: LocaleChangeRecord = {
    from,
    to,
    timestamp: Date.now(),
    source,
  };

  localeHistory = [record, ...localeHistory].slice(0, 50); // keep last 50

  // Forward to analytics bus (respects consent internally)
  try {
    const svc = getAnalyticsService();
    // Cast to `any` because "locale_changed" is a domain-specific event not yet
    // in the shared AnalyticsEventName union — add it there when ready.
    (svc as any).track("locale_changed", {
      from,
      to,
      source,
    });
  } catch {
    // Analytics is best-effort; never throw from here
  }

  if (ENABLED) {
    console.info(
      `[i18n] Locale changed: ${from ?? "none"} → ${to} (source: ${source})`
    );
  }
}

/**
 * Returns the locale-change history (most-recent first).
 */
export function getLocaleHistory(): LocaleChangeRecord[] {
  return [...localeHistory];
}

/**
 * Clears the locale history (useful in tests).
 */
export function clearLocaleHistory(): void {
  localeHistory = [];
}

// ─── Summary report ───────────────────────────────────────────────────────────

/**
 * Prints a formatted dev-only summary to the console.
 * Handy to call from a dev tools panel or `useEffect` in development.
 */
export function printI18nDiagnostics(): void {
  if (!ENABLED) return;

  const missing = getMissingKeys();
  const history = getLocaleHistory();

  console.group("[i18n] Diagnostics");

  if (missing.length === 0) {
    console.log("✅ No missing translation keys detected.");
  } else {
    console.group(`⚠️  Missing keys (${missing.length})`);
    missing.forEach(({ locale, namespace, key, count }) => {
      console.warn(`  ${locale} / ${namespace}.${key}  (×${count})`);
    });
    console.groupEnd();
  }

  if (history.length > 0) {
    console.group(`🌐 Locale change history (${history.length})`);
    history.forEach(({ from, to, source, timestamp }) => {
      console.info(
        `  ${new Date(timestamp).toISOString()}  ${from ?? "—"} → ${to}  [${source}]`
      );
    });
    console.groupEnd();
  }

  console.groupEnd();
}
