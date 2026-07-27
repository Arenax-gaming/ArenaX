"use client";

/**
 * useHookAnalytics — lightweight analytics instrumentation for custom hooks.
 *
 * Tracks hook usage, performance, and errors across the application.
 * Events are dispatched as custom DOM events so any analytics provider
 * can subscribe without a hard dependency.
 *
 * Features:
 *  - Track hook mount/unmount events
 *  - Time async operations from within hooks
 *  - Record errors with context
 *  - Track feature flag activations
 *  - All events are dispatched as "arenax:hook:event" custom events
 *
 * @example
 * function useTournaments() {
 *   const analytics = useHookAnalytics("useTournaments");
 *   analytics.trackMount();
 *
 *   const load = async () => {
 *     const timer = analytics.startTimer("fetchTournaments");
 *     try {
 *       const data = await api.getTournaments();
 *       timer.end({ count: data.length });
 *     } catch (err) {
 *       analytics.trackError(err, "fetchTournaments");
 *       timer.end({ error: true });
 *     }
 *   };
 * }
 */

import { useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type HookEventType =
  | "mount"
  | "unmount"
  | "operation_start"
  | "operation_end"
  | "error"
  | "feature_activated";

export interface HookAnalyticsEvent {
  hookName: string;
  eventType: HookEventType;
  /** Operation name (for operation_start / operation_end). */
  operation?: string;
  /** Duration in ms (for operation_end). */
  durationMs?: number;
  /** Arbitrary context metadata. */
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Timer helper
// ---------------------------------------------------------------------------

export interface HookTimer {
  /** Finish the timer and emit an operation_end event. */
  end: (metadata?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Dispatch helper (singleton to avoid re-creating on every call)
// ---------------------------------------------------------------------------

function dispatch(event: HookAnalyticsEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("arenax:hook:event", { detail: event })
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseHookAnalyticsResult {
  /** Emit a mount event. Call once on component/hook mount. */
  trackMount: (metadata?: Record<string, unknown>) => void;
  /** Start a timed operation. Returns a timer to end it. */
  startTimer: (operation: string, metadata?: Record<string, unknown>) => HookTimer;
  /** Track an error that occurred inside the hook. */
  trackError: (error: unknown, operation?: string, metadata?: Record<string, unknown>) => void;
  /** Track when a feature flag / variant is activated. */
  trackFeature: (featureName: string, metadata?: Record<string, unknown>) => void;
}

export function useHookAnalytics(hookName: string): UseHookAnalyticsResult {
  const hookNameRef = useRef(hookName);
  hookNameRef.current = hookName;

  // Track mount / unmount automatically
  useEffect(() => {
    dispatch({
      hookName: hookNameRef.current,
      eventType: "mount",
      timestamp: Date.now(),
    });

    return () => {
      dispatch({
        hookName: hookNameRef.current,
        eventType: "unmount",
        timestamp: Date.now(),
      });
    };
  }, []);

  const trackMount = useCallback(
    (metadata?: Record<string, unknown>) => {
      dispatch({
        hookName: hookNameRef.current,
        eventType: "mount",
        metadata,
        timestamp: Date.now(),
      });
    },
    []
  );

  const startTimer = useCallback(
    (operation: string, metadata?: Record<string, unknown>): HookTimer => {
      const startTime = Date.now();

      dispatch({
        hookName: hookNameRef.current,
        eventType: "operation_start",
        operation,
        metadata,
        timestamp: startTime,
      });

      return {
        end: (endMetadata?: Record<string, unknown>) => {
          const durationMs = Date.now() - startTime;
          dispatch({
            hookName: hookNameRef.current,
            eventType: "operation_end",
            operation,
            durationMs,
            metadata: { ...metadata, ...endMetadata },
            timestamp: Date.now(),
          });
        },
      };
    },
    []
  );

  const trackError = useCallback(
    (error: unknown, operation?: string, metadata?: Record<string, unknown>) => {
      const message =
        error instanceof Error ? error.message : String(error);
      dispatch({
        hookName: hookNameRef.current,
        eventType: "error",
        operation,
        metadata: { errorMessage: message, ...metadata },
        timestamp: Date.now(),
      });
    },
    []
  );

  const trackFeature = useCallback(
    (featureName: string, metadata?: Record<string, unknown>) => {
      dispatch({
        hookName: hookNameRef.current,
        eventType: "feature_activated",
        operation: featureName,
        metadata,
        timestamp: Date.now(),
      });
    },
    []
  );

  return { trackMount, startTimer, trackError, trackFeature };
}

/**
 * Subscribe to hook analytics events from outside a component.
 * Useful for analytics providers or debug tooling.
 *
 * @example
 * const unsub = subscribeToHookAnalytics((event) => console.log(event));
 * // later...
 * unsub();
 */
export function subscribeToHookAnalytics(
  handler: (event: HookAnalyticsEvent) => void
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<HookAnalyticsEvent>).detail);
  };
  window.addEventListener("arenax:hook:event", listener);
  return () => window.removeEventListener("arenax:hook:event", listener);
}
