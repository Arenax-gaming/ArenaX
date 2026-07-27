/**
 * Locale detection utility for ArenaX.
 *
 * Detection priority (highest → lowest):
 *  1. User preference stored in localStorage  (`arenax:locale`)
 *  2. URL search-param                         (`?lang=fr`)
 *  3. Browser / navigator.language            (`navigator.language`)
 *  4. Hard-coded fallback                      (`en`)
 */

import { routing, type Locale } from "./routing";

export const LOCALE_STORAGE_KEY = "arenax:locale";

/** Supported locale set for fast O(1) lookup. */
const SUPPORTED: Set<string> = new Set(routing.locales);

/**
 * Normalise a raw language tag to one of our supported locales.
 * e.g. "fr-CA" → "fr", "YO" → "yo", "zh-Hant-TW" → first match or null
 */
function normalise(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // Exact match (case-insensitive)
  if (SUPPORTED.has(lower)) return lower as Locale;
  // Try the primary language subtag only (e.g. "en-GB" → "en")
  const primary = lower.split("-")[0];
  if (SUPPORTED.has(primary)) return primary as Locale;
  return null;
}

/**
 * 1. Check localStorage for a previously stored preference.
 */
function fromStorage(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalise(stored);
  } catch {
    return null;
  }
}

/**
 * 2. Check the current URL for a `?lang=` query parameter.
 *
 * Priority:
 *  - An explicitly passed `searchParams` argument is always used when present
 *    (covers both SSR and unit-test contexts where passing params is explicit).
 *  - Falls back to `window.location.href` when running in the browser without
 *    an explicit argument.
 */
function fromUrlParam(searchParams?: URLSearchParams | null): Locale | null {
  // Explicit searchParams take priority (SSR / tests)
  if (searchParams) {
    return normalise(searchParams.get("lang"));
  }
  // Browser fallback: read from the live URL
  if (typeof window !== "undefined") {
    try {
      const params = new URL(window.location.href).searchParams;
      return normalise(params.get("lang"));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 3. Check navigator.language (and the full navigator.languages list).
 */
function fromNavigator(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const candidates = [
    navigator.language,
    ...(navigator.languages ?? []),
  ];
  for (const lang of candidates) {
    const matched = normalise(lang);
    if (matched) return matched;
  }
  return null;
}

/**
 * Persist a locale preference in localStorage so it is recalled on
 * subsequent visits.
 */
export function persistLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable (private mode, quota exceeded, etc.)
  }
}

/**
 * Remove any stored locale preference (e.g. when user logs out).
 */
export function clearPersistedLocale(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Primary detection function.
 *
 * Returns the best-matching supported locale by walking the priority chain:
 *   localStorage → URL param → navigator.language → "en"
 *
 * @param searchParams - Optional URLSearchParams to inspect for `?lang=`.
 *   Useful during SSR where `window` is unavailable.
 */
export function detectLocale(
  searchParams?: URLSearchParams | null
): Locale {
  return (
    fromStorage() ??
    fromUrlParam(searchParams) ??
    fromNavigator() ??
    (routing.defaultLocale as Locale)
  );
}

/**
 * Server-side helper: detect locale from an Accept-Language header value.
 * Parses quality values (q=) and returns the best supported match.
 *
 * @example
 *   detectFromAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8")  // → "fr"
 */
export function detectFromAcceptLanguage(
  header: string | null | undefined
): Locale {
  if (!header) return routing.defaultLocale as Locale;

  // Parse "tag;q=value" pairs, sort descending by quality
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const matched = normalise(tag);
    if (matched) return matched;
  }
  return routing.defaultLocale as Locale;
}
