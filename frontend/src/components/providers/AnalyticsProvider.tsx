"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { getAnalyticsService } from "@/lib/analytics";
import { getABTestingService } from "@/lib/abTesting";
import { consoleAdapter, customApiAdapter } from "@/lib/analyticsAdapters";
import { enqueueAnalytics } from "@/lib/analyticsQueue";
import { shouldSample, validatePayload } from "@/lib/analyticsGovernance";
import type { ABExperiment, ABVariant, ConsentState } from "@/types/analytics";
import type { AnalyticsEventName } from "@/types/analytics";

const ANON_ID_KEY = "arenax:analytics:anonymous_id";

function generateAnonymousId(): string {
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function loadOrCreateAnonymousId(): string {
  if (typeof window === "undefined") return generateAnonymousId();
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
  } catch {
    // ignore
  }
  const id = generateAnonymousId();
  try {
    localStorage.setItem(ANON_ID_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

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
    svc.registerAdapter(customApiAdapter);
    return svc;
  }, []);

  const abService = useMemo(() => getABTestingService(), []);

  // Generate/load anonymous ID on mount
  const anonymousIdRef = useRef<string>("");
  useEffect(() => {
    anonymousIdRef.current = loadOrCreateAnonymousId();
  }, []);

  // Flush queue on mount and periodically
  useEffect(() => {
    const flush = async () => {
      try {
        const { flushAnalyticsQueue } = await import("@/lib/analyticsQueue");
        await flushAnalyticsQueue();
      } catch {
        // ignore offline queue errors
      }
    };
    flush();
    const interval = setInterval(flush, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-track page views on route changes (pathname changes)
  useEffect(() => {
    const consent = service.getConsent();
    if (consent.analytics !== "granted") return;
    service.track("page_view", {
      path: window.location.pathname,
      referrer: document.referrer || undefined,
      anonymousId: anonymousIdRef.current,
    });
  }, [service]);

  const track = useCallback(
    (event: AnalyticsEventName, props?: Record<string, unknown>) => {
      // Governance: validate event name
      const validation = validatePayload({
        event,
        timestamp: Date.now(),
        sessionId: service.getSession().sessionId,
      });
      if (!validation.isValid) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[Analytics] Validation failed:", validation.error);
        }
        return;
      }

      // Governance: sampling
      if (!shouldSample(event)) return;

      service.track(event, {
        ...props,
        anonymousId: anonymousIdRef.current,
      });

      // Enqueue to offline queue
      enqueueAnalytics({
        name: event,
        props,
        timestamp: Date.now(),
      }).catch(() => {
        // ignore queue errors
      });
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
