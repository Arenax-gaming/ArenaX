/**
 * Granular, category-based consent preferences (#1093).
 *
 * Persisted to `localStorage` (per the acceptance criteria) under
 * `arenax_consent_v1` — distinct from the older single-category
 * `arenax_consent_analytics` cookie in `consentCookie.ts`, which
 * `useConsentStore`/`RumProvider` now derive from this store instead.
 *
 * GDPR / NDPR: every category except `essential` (which has no toggle —
 * the app cannot function without it) defaults to `false` until the user
 * makes an explicit choice.
 */

export type ConsentCategory = "essential" | "performance" | "analytics" | "personalisation";

export type ConsentChoices = Record<Exclude<ConsentCategory, "essential">, boolean>;

export interface ConsentPreferences {
  /** Whether the user has ever submitted a choice (vs. the banner still being pending). */
  hasDecided: boolean;
  choices: ConsentChoices;
  updatedAt: string;
}

export const CONSENT_STORAGE_KEY = "arenax_consent_v1";
export const CONSENT_CHANGE_EVENT = "arenax:consent-v1-change";

const DEFAULT_CHOICES: ConsentChoices = {
  performance: false,
  analytics: false,
  personalisation: false,
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getConsentPreferences(): ConsentPreferences {
  if (!isBrowser()) {
    return { hasDecided: false, choices: { ...DEFAULT_CHOICES }, updatedAt: "" };
  }

  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) {
      return { hasDecided: false, choices: { ...DEFAULT_CHOICES }, updatedAt: "" };
    }
    const parsed = JSON.parse(raw) as Partial<ConsentPreferences>;
    return {
      hasDecided: Boolean(parsed.hasDecided),
      choices: { ...DEFAULT_CHOICES, ...parsed.choices },
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return { hasDecided: false, choices: { ...DEFAULT_CHOICES }, updatedAt: "" };
  }
}

/** Persists a full or partial set of category choices and marks the banner as decided. */
export function saveConsentPreferences(choices: Partial<ConsentChoices>): ConsentPreferences {
  const current = getConsentPreferences();
  const next: ConsentPreferences = {
    hasDecided: true,
    choices: { ...current.choices, ...choices },
    updatedAt: new Date().toISOString(),
  };

  if (isBrowser()) {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode, quota) — consent still
      // applies for the rest of this session via the dispatched event.
    }
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: next }));
  }

  return next;
}

/** `essential` is always granted; every other category reads from stored choices. */
export function hasConsentedTo(category: ConsentCategory): boolean {
  if (category === "essential") return true;
  return getConsentPreferences().choices[category] === true;
}

export function acceptAllConsent(): ConsentPreferences {
  return saveConsentPreferences({ performance: true, analytics: true, personalisation: true });
}

export function declineAllConsent(): ConsentPreferences {
  return saveConsentPreferences({ performance: false, analytics: false, personalisation: false });
}
