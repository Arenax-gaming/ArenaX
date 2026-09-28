"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONSENT_CHANGE_EVENT,
  ConsentChoices,
  acceptAllConsent,
  declineAllConsent,
  getConsentPreferences,
  saveConsentPreferences,
} from "@/lib/consentPreferences";

/**
 * useConsentStore
 *
 * Reactive view over the granular, localStorage-backed consent preferences
 * (#1093, `lib/consentPreferences.ts`) — usable from anywhere in the tree,
 * no context provider ancestor required. Defaults to "not decided yet"
 * during SSR/first paint and reconciles with the real stored value
 * client-side in an effect, the same pattern used by other client-only
 * state hooks in this codebase (see `useNetworkStatus`).
 */
export function useConsentStore() {
  const [preferences, setPreferences] = useState(() => getConsentPreferences());

  useEffect(() => {
    setPreferences(getConsentPreferences());

    function handleConsentChange() {
      setPreferences(getConsentPreferences());
    }

    window.addEventListener(CONSENT_CHANGE_EVENT, handleConsentChange);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, handleConsentChange);
    };
  }, []);

  const grant = useCallback(() => {
    setPreferences(acceptAllConsent());
  }, []);

  const revoke = useCallback(() => {
    setPreferences(declineAllConsent());
  }, []);

  /** Saves specific category choices, e.g. from the "manage cookies" modal. */
  const save = useCallback((choices: Partial<ConsentChoices>) => {
    setPreferences(saveConsentPreferences(choices));
  }, []);

  const consent: "granted" | "denied" | "pending" = !preferences.hasDecided
    ? "pending"
    : preferences.choices.analytics
      ? "granted"
      : "denied";

  return {
    /** @deprecated coarse view kept for RumProvider's existing gate; prefer the per-category flags below. */
    consent,
    hasDecided: preferences.hasDecided,
    choices: preferences.choices,
    hasAnalyticsConsent: preferences.hasDecided && preferences.choices.analytics,
    hasPerformanceConsent: preferences.hasDecided && preferences.choices.performance,
    hasPersonalisationConsent: preferences.hasDecided && preferences.choices.personalisation,
    grant,
    revoke,
    save,
  };
}

export default useConsentStore;
