/**
 * consentCookie
 *
 * Single source of truth for analytics consent, backed by a first-party
 * cookie rather than localStorage. A cookie works everywhere in the app —
 * including code that mounts outside the `AnalyticsProvider` React context
 * (e.g. `RumProvider`, which lives in the `[locale]` route tree) — without
 * requiring a shared context provider ancestor.
 *
 * All reads/writes are guarded for SSR since `document`/`window` are not
 * available on the server.
 */

export type AnalyticsConsentValue = "granted" | "denied" | "pending";

export const ANALYTICS_CONSENT_COOKIE_NAME = "arenax_consent_analytics";
export const ANALYTICS_CONSENT_CHANGE_EVENT = "arenax:consent-change";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function getAnalyticsConsentCookie(): AnalyticsConsentValue {
  if (typeof document === "undefined") return "pending";

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`));

  if (!match) return "pending";

  const value = match.slice(ANALYTICS_CONSENT_COOKIE_NAME.length + 1);
  if (value === "granted" || value === "denied") return value;

  return "pending";
}

export function setAnalyticsConsentCookie(value: "granted" | "denied"): void {
  if (typeof document !== "undefined") {
    document.cookie = `${ANALYTICS_CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ANALYTICS_CONSENT_CHANGE_EVENT, {
        detail: { analytics: value },
      })
    );
  }
}

export function hasAnalyticsConsent(): boolean {
  return getAnalyticsConsentCookie() === "granted";
}
