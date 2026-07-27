/**
 * ArenaX — useValidationMonitor hook
 *
 * Exposes real-time validation analytics from the validation pipeline.
 * Useful for admin dashboards and development debugging overlays.
 *
 * Usage:
 *   const { snapshot, violations, refresh } = useValidationMonitor();
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getValidationSnapshot,
  getValidationViolations,
  auditSuccessRates,
  type ValidationAnalyticsSnapshot,
  type ValidationGovernanceViolation,
} from "@/lib/validation/analytics";

export interface ValidationMonitorData {
  snapshot: ValidationAnalyticsSnapshot;
  violations: readonly ValidationGovernanceViolation[];
  /** Success-rate audit violations (schemas with rate < threshold). */
  rateViolations: ValidationGovernanceViolation[];
  refresh: () => void;
  isPolling: boolean;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

export function useValidationMonitor(
  options: { autoStart?: boolean; pollIntervalMs?: number; rateThreshold?: number } = {},
): ValidationMonitorData {
  const { autoStart = false, pollIntervalMs = 5_000, rateThreshold = 0.3 } = options;

  const [snapshot, setSnapshot] = useState<ValidationAnalyticsSnapshot>(() =>
    getValidationSnapshot(),
  );
  const [violations, setViolations] = useState<readonly ValidationGovernanceViolation[]>(
    () => getValidationViolations(),
  );
  const [rateViolations, setRateViolations] = useState<ValidationGovernanceViolation[]>([]);
  const [isPolling, setIsPolling] = useState(autoStart);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    setSnapshot(getValidationSnapshot());
    setViolations(getValidationViolations());
    setRateViolations(auditSuccessRates(rateThreshold));
  }, [rateThreshold]);

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
      intervalRef.current = setInterval(refresh, intervalMs);
    },
    [stopPolling, refresh, pollIntervalMs],
  );

  useEffect(() => {
    if (autoStart) startPolling(pollIntervalMs);
    return () => stopPolling();
  }, [autoStart, pollIntervalMs, startPolling, stopPolling]);

  return { snapshot, violations, rateViolations, refresh, isPolling, startPolling, stopPolling };
}
