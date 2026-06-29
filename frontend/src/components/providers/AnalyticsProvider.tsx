"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { getAnalyticsService } from "@/lib/analytics";
import { getABTestingService } from "@/lib/abTesting";
import { consoleAdapter } from "@/lib/analyticsAdapters";
import type { ABExperiment, ABVariant, ConsentState } from "@/types/analytics";
import type { AnalyticsEventName } from "@/types/analytics";

interface AnalyticsContextValue {
  track: (event: AnalyticsEventName, props?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  setConsent: (status: "granted" | "denied") => void;
  getConsent: () => ConsentState;
  getVariant: (experiment: ABExperiment, userId: string) => ABVariant;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const service = useMemo(() => {
    const svc = getAnalyticsService();
    svc.registerAdapter(consoleAdapter);
    return svc;
  }, []);

  const abService = useMemo(() => getABTestingService(), []);

  // Auto-track page views on route changes (pathname changes)
  useEffect(() => {
    const consent = service.getConsent();
    if (consent.analytics !== "granted") return;
    service.track("page_view", {
      path: window.location.pathname,
      referrer: document.referrer || undefined,
    });
  }, [service]);

  const track = useCallback(
    (event: AnalyticsEventName, props?: Record<string, unknown>) => {
      service.track(event, props);
    },
    [service]
  );

  const identify = useCallback(
    (userId: string, traits?: Record<string, unknown>) => {
      service.identify(userId, traits);
    },
    [service]
  );

  const reset = useCallback(() => {
    service.reset();
    abService.clearAssignments();
  }, [service, abService]);

  const setConsent = useCallback(
    (status: "granted" | "denied") => {
      service.setConsent(status);
    },
    [service]
  );

  const getConsent = useCallback(() => service.getConsent(), [service]);

  const getVariant = useCallback(
    (experiment: ABExperiment, userId: string) => abService.getVariant(experiment, userId),
    [abService]
  );

  const value = useMemo(
    () => ({ track, identify, reset, setConsent, getConsent, getVariant }),
    [track, identify, reset, setConsent, getConsent, getVariant]
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error("useAnalytics must be used within <AnalyticsProvider>");
  return ctx;
}
