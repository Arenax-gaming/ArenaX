"use client";

/**
 * useRouteMonitoring
 *
 * Subscribes to route analytics events dispatched by RouteChangeMonitor
 * and routeAnalytics utilities. Useful for dashboards, admin panels, or
 * debugging tools that need real-time insight into navigation patterns.
 *
 * Events consumed:
 *  - "arenax:route:pageview"   — page view buffer flushed
 *  - "arenax:route:guard"      — guard event buffer flushed
 *  - "arenax:route:chunkfail"  — code-split chunk failed to load
 */

import { useEffect, useCallback, useRef } from "react";
import type {
  RoutePageView,
  RouteGuardEvent,
  ChunkLoadFailureEvent,
} from "@/lib/routeAnalytics";

export interface RouteMonitoringHandlers {
  onPageView?: (events: RoutePageView[]) => void;
  onGuardEvent?: (events: RouteGuardEvent[]) => void;
  onChunkFailure?: (event: ChunkLoadFailureEvent) => void;
}

/**
 * Attach listeners for the custom route events emitted by the analytics layer.
 *
 * @example
 * useRouteMonitoring({
 *   onPageView: (views) => console.log("Page views:", views),
 *   onGuardEvent: (guards) => console.log("Guard events:", guards),
 * });
 */
export function useRouteMonitoring(handlers: RouteMonitoringHandlers): void {
  // Keep handlers in a ref so listeners don't need to be re-attached on re-render
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handlePageView = useCallback((event: Event) => {
    const custom = event as CustomEvent<RoutePageView[]>;
    handlersRef.current.onPageView?.(custom.detail);
  }, []);

  const handleGuard = useCallback((event: Event) => {
    const custom = event as CustomEvent<RouteGuardEvent[]>;
    handlersRef.current.onGuardEvent?.(custom.detail);
  }, []);

  const handleChunkFail = useCallback((event: Event) => {
    const custom = event as CustomEvent<ChunkLoadFailureEvent>;
    handlersRef.current.onChunkFailure?.(custom.detail);
  }, []);

  useEffect(() => {
    window.addEventListener("arenax:route:pageview", handlePageView);
    window.addEventListener("arenax:route:guard", handleGuard);
    window.addEventListener("arenax:route:chunkfail", handleChunkFail);

    return () => {
      window.removeEventListener("arenax:route:pageview", handlePageView);
      window.removeEventListener("arenax:route:guard", handleGuard);
      window.removeEventListener("arenax:route:chunkfail", handleChunkFail);
    };
  }, [handlePageView, handleGuard, handleChunkFail]);
}
