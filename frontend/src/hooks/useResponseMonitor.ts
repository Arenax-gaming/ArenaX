/**
 * ArenaX — useResponseMonitor hook
 *
 * Exposes real-time response performance metrics from the interceptor pipeline.
 * Useful for admin dashboards, debug overlays, and monitoring panels.
 *
 * Usage:
 *   const { snapshot, events, governance, refresh } = useResponseMonitor();
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMonitorSnapshot,
  getAnalyticsEvents,
} from "@/lib/responseInterceptor";
import {
  getGovernanceSummary,
  getGovernanceViolations,
} from "@/lib/responseGovernance";
import type {
  ResponseMonitorSnapshot,
  ResponseAnalyticsEvent,
} from "@/types/response";
import type { GovernanceSummary, GovernanceViolation } from "@/lib/responseGovernance";

export interface ResponseMonitorData {
  /** Aggregate performance snapshot (latency percentiles, error rates, etc.). */
  snapshot: ResponseMonitorSnapshot;
  /** The 500 most recent response analytics events (newest first). */
  events: readonly ResponseAnalyticsEvent[];
  /** Governance violation summary. */
  governance: {
    summary: GovernanceSummary;
    violations: readonly GovernanceViolation[];
    recentViolations: GovernanceViolation[];
  };
  /** Force an immediate refresh of the displayed data. */
  refresh: () => void;
  /** Whether the monitor is actively polling. */
  isPolling: boolean;
  /** Start automatic polling at the given interval (ms). Default: 5000. */
  startPolling: (intervalMs?: number) => void;
  /** Stop automatic polling. */
  stopPolling: () => void;
}

/**
 * Number of recent violations to surface in `governance.recentViolations`.
 */
const RECENT_VIOLATIONS_LIMIT = 10;

export function useResponseMonitor(
  options: {
    /** Auto-start polling on mount. Default: false. */
    autoStart?: boolean;
    /** Polling interval in ms. Default: 5000. */
    pollIntervalMs?: number;
  } = {},
): ResponseMonitorData {
  const { autoStart = false, pollIntervalMs = 5_000 } = options;

  const [snapshot, setSnapshot] = useState<ResponseMonitorSnapshot>(() =>
    getMonitorSnapshot(),
  );
  const [events, setEvents] = useState<readonly ResponseAnalyticsEvent[]>(() =>
    getAnalyticsEvents(),
  );
  const [govSummary, setGovSummary] = useState<GovernanceSummary>(() =>
    getGovernanceSummary(),
  );
  const [violations, setViolations] = useState<readonly GovernanceViolation[]>(
    () => getGovernanceViolations(),
  );
  const [isPolling, setIsPolling] = useState(autoStart);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    setSnapshot(getMonitorSnapshot());
    setEvents(getAnalyticsEvents());
    setGovSummary(getGovernanceSummary());
    setViolations(getGovernanceViolations());
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(
    (intervalMs = pollIntervalMs) => {
      stopPolling();
      setIsPolling(true);
      intervalRef.current = setInterval(() => {
        refresh();
      }, intervalMs);
    },
    [stopPolling, refresh, pollIntervalMs],
  );

  // Auto-start on mount if requested
  useEffect(() => {
    if (autoStart) {
      startPolling(pollIntervalMs);
    }
    return () => stopPolling();
  }, [autoStart, pollIntervalMs, startPolling, stopPolling]);

  const recentViolations = [...violations].slice(0, RECENT_VIOLATIONS_LIMIT);

  return {
    snapshot,
    events,
    governance: {
      summary: govSummary,
      violations,
      recentViolations,
    },
    refresh,
    isPolling,
    startPolling,
    stopPolling,
  };
}

// ─── Convenience selector hooks ───────────────────────────────────────────────

/**
 * Returns only the performance snapshot, refreshed at the given interval.
 * Lighter than `useResponseMonitor` when you only need aggregate metrics.
 */
export function useResponseSnapshot(pollIntervalMs = 5_000): ResponseMonitorSnapshot {
  const [snapshot, setSnapshot] = useState<ResponseMonitorSnapshot>(() =>
    getMonitorSnapshot(),
  );

  useEffect(() => {
    const id = setInterval(() => setSnapshot(getMonitorSnapshot()), pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs]);

  return snapshot;
}

/**
 * Returns the latest N analytics events, refreshed at the given interval.
 */
export function useRecentResponseEvents(
  limit = 20,
  pollIntervalMs = 3_000,
): ResponseAnalyticsEvent[] {
  const [events, setEvents] = useState<ResponseAnalyticsEvent[]>(() =>
    [...getAnalyticsEvents()].slice(0, limit),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setEvents([...getAnalyticsEvents()].slice(0, limit));
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [limit, pollIntervalMs]);

  return events;
}
