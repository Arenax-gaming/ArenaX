/**
 * State Monitor — Issue #831
 * 
 * Detects and reports state management issues including race conditions,
 * inconsistent updates, and performance problems.
 */

"use client";

export interface StateUpdateEvent {
  hookName: string;
  timestamp: number;
  version: number;
  updateType: "optimistic" | "confirmed" | "rollback";
  duration?: number;
}

export interface StateInconsistencyEvent {
  hookName: string;
  timestamp: number;
  issue: string;
  severity: "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
}

const _stateUpdates: StateUpdateEvent[] = [];
const _inconsistencies: StateInconsistencyEvent[] = [];
const MAX_EVENTS = 500;

export function trackStateUpdate(event: StateUpdateEvent): void {
  _stateUpdates.unshift(event);
  if (_stateUpdates.length > MAX_EVENTS) _stateUpdates.length = MAX_EVENTS;

  // Detect slow updates (>2s indicates potential deadlock or network issue)
  if (event.duration && event.duration > 2000) {
    reportInconsistency({
      hookName: event.hookName,
      timestamp: Date.now(),
      issue: `Slow state update detected: ${event.duration}ms`,
      severity: "medium",
      metadata: { duration: event.duration, type: event.updateType },
    });
  }
}

export function reportInconsistency(event: StateInconsistencyEvent): void {
  _inconsistencies.unshift(event);
  if (_inconsistencies.length > MAX_EVENTS) _inconsistencies.length = MAX_EVENTS;

  if (process.env.NODE_ENV === "development") {
    const level = event.severity === "high" ? "error" : "warn";
    console[level](`[StateMonitor] ${event.issue}`, event.metadata);
  }
}

export function getStateUpdates(): readonly StateUpdateEvent[] {
  return _stateUpdates;
}

export function getInconsistencies(): readonly StateInconsistencyEvent[] {
  return _inconsistencies;
}

export function clearStateMonitor(): void {
  _stateUpdates.length = 0;
  _inconsistencies.length = 0;
}

/**
 * Analyzes state updates for a specific hook and detects race conditions.
 */
export function analyzeHookUpdates(hookName: string): {
  totalUpdates: number;
  concurrentUpdates: number;
  rollbackRate: number;
  averageDuration: number;
  raceConditionsDetected: number;
} {
  const updates = _stateUpdates.filter((u) => u.hookName === hookName);
  
  if (updates.length === 0) {
    return {
      totalUpdates: 0,
      concurrentUpdates: 0,
      rollbackRate: 0,
      averageDuration: 0,
      raceConditionsDetected: 0,
    };
  }

  const rollbacks = updates.filter((u) => u.updateType === "rollback").length;
  const durations = updates.filter((u) => u.duration).map((u) => u.duration!);
  const avgDuration = durations.length > 0 
    ? durations.reduce((a, b) => a + b, 0) / durations.length 
    : 0;

  // Detect concurrent updates (multiple updates within 100ms)
  let concurrent = 0;
  let raceConditions = 0;
  
  for (let i = 0; i < updates.length - 1; i++) {
    const timeDiff = updates[i].timestamp - updates[i + 1].timestamp;
    if (timeDiff < 100) {
      concurrent++;
      // Race condition if versions are not sequential
      if (Math.abs(updates[i].version - updates[i + 1].version) > 1) {
        raceConditions++;
      }
    }
  }

  return {
    totalUpdates: updates.length,
    concurrentUpdates: concurrent,
    rollbackRate: rollbacks / updates.length,
    averageDuration: Math.round(avgDuration),
    raceConditionsDetected: raceConditions,
  };
}

/**
 * Returns a summary of all state management health metrics.
 */
export function getStateHealthSummary(): {
  totalHooks: number;
  totalUpdates: number;
  totalInconsistencies: number;
  highSeverityIssues: number;
  hooksWithRaceConditions: string[];
  slowestHook: { name: string; avgDuration: number } | null;
} {
  const hookNames = Array.from(new Set(_stateUpdates.map((u) => u.hookName)));
  
  const hookAnalyses = hookNames.map((name) => ({
    name,
    analysis: analyzeHookUpdates(name),
  }));

  const hooksWithRaces = hookAnalyses
    .filter((h) => h.analysis.raceConditionsDetected > 0)
    .map((h) => h.name);

  const slowest = hookAnalyses.reduce<{ name: string; avgDuration: number } | null>(
    (max, h) => {
      if (!max || h.analysis.averageDuration > max.avgDuration) {
        return { name: h.name, avgDuration: h.analysis.averageDuration };
      }
      return max;
    },
    null
  );

  return {
    totalHooks: hookNames.length,
    totalUpdates: _stateUpdates.length,
    totalInconsistencies: _inconsistencies.length,
    highSeverityIssues: _inconsistencies.filter((i) => i.severity === "high").length,
    hooksWithRaceConditions: hooksWithRaces,
    slowestHook: slowest,
  };
}
