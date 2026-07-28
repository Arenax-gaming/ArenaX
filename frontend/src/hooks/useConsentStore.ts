"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANALYTICS_CONSENT_CHANGE_EVENT,
  getAnalyticsConsentCookie,
  setAnalyticsConsentCookie,
  type AnalyticsConsentValue,
} from "@/lib/consentCookie";

/**
 * useConsentStore
 *
 * Cookie-backed consent state usable from anywhere in the tree — no
 * context provider ancestor required. Defaults to "pending" during SSR
 * (cookies aren't readable on the server for this synchronous API) and
 * reconciles with the real cookie value client-side in an effect, the
 * same pattern used by other client-only state hooks in this codebase
 * (see `useNetworkStatus`).
 */
export function useConsentStore() {
  const [consent, setConsentState] = useState<AnalyticsConsentValue>("pending");

  useEffect(() => {
    setConsentState(getAnalyticsConsentCookie());

    function handleConsentChange(event: Event) {
      const detail = (event as CustomEvent<{ analytics: AnalyticsConsentValue }>).detail;
      if (detail?.analytics) {
        setConsentState(detail.analytics);
      } else {
        setConsentState(getAnalyticsConsentCookie());
      }
    }

    window.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, handleConsentChange);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, handleConsentChange);
    };
  }, []);

  const grant = useCallback(() => {
    setAnalyticsConsentCookie("granted");
    setConsentState("granted");
  }, []);

  const revoke = useCallback(() => {
    setAnalyticsConsentCookie("denied");
    setConsentState("denied");
  }, []);

  return {
    consent,
    hasAnalyticsConsent: consent === "granted",
    grant,
    revoke,
  };
}

export default useConsentStore;
