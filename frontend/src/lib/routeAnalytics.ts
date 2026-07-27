/**
 * Route-level analytics and monitoring utilities.
 *
 * Tracks:
 *  - Page views with locale, path group, and timing data
 *  - Route guard events (auth redirect, role denied)
 *  - Code-split chunk load failures
 *  - Route performance (time-to-interactive per route group)
 */

export interface RoutePageView {
  path: string;
  locale: string;
  group: string;
  referrer: string;
  timestamp: number;
  /** Navigation timing in ms — set after the route finishes loading. */
  loadDuration?: number;
}

export interface RouteGuardEvent {
  type: "auth_redirect" | "role_denied" | "verification_required";
  path: string;
  locale: string;
  requiredRole?: string;
  timestamp: number;
}

export interface ChunkLoadFailureEvent {
  chunkName: string;
  path: string;
  timestamp: number;
  error: string;
}

/** In-memory buffer for the current session (flushed to analytics provider). */
const pageViewBuffer: RoutePageView[] = [];
const guardEventBuffer: RouteGuardEvent[] = [];
const MAX_BUFFER_SIZE = 50;

function flush() {
  if (typeof window === "undefined") return;

  // Dispatch custom events so the AnalyticsProvider / RumProvider can pick
  // them up without creating a hard dependency here.
  if (pageViewBuffer.length > 0) {
    window.dispatchEvent(
      new CustomEvent("arenax:route:pageview", {
        detail: [...pageViewBuffer],
      })
    );
    pageViewBuffer.length = 0;
  }

  if (guardEventBuffer.length > 0) {
    window.dispatchEvent(
      new CustomEvent("arenax:route:guard", {
        detail: [...guardEventBuffer],
      })
    );
    guardEventBuffer.length = 0;
  }
}

/** Track a route page view. Call from the route-change observer. */
export function trackPageView(event: Omit<RoutePageView, "timestamp">): void {
  if (typeof window === "undefined") return;

  pageViewBuffer.push({ ...event, timestamp: Date.now() });

  if (pageViewBuffer.length >= MAX_BUFFER_SIZE) flush();
}

/** Track a route guard decision (redirect / denial). */
export function trackGuardEvent(
  event: Omit<RouteGuardEvent, "timestamp">
): void {
  if (typeof window === "undefined") return;

  guardEventBuffer.push({ ...event, timestamp: Date.now() });

  if (guardEventBuffer.length >= MAX_BUFFER_SIZE) flush();
}

/** Track a dynamic import (code-split chunk) load failure. */
export function trackChunkLoadFailure(
  event: Omit<ChunkLoadFailureEvent, "timestamp">
): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("arenax:route:chunkfail", {
      detail: { ...event, timestamp: Date.now() },
    })
  );
}

/**
 * Measure route navigation duration using the Navigation Timing API.
 * Returns the duration in ms, or null if the API is unavailable.
 */
export function measureRouteLoad(): number | null {
  if (typeof window === "undefined" || !window.performance) return null;
  const entries = window.performance.getEntriesByType(
    "navigation"
  ) as PerformanceNavigationTiming[];
  if (!entries.length) return null;
  const nav = entries[0];
  return Math.round(nav.loadEventEnd - nav.startTime);
}

/** Flush any buffered events (call on page hide / route change). */
export function flushRouteAnalytics(): void {
  flush();
}
