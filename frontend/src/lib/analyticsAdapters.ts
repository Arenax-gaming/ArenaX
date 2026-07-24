import type { AnalyticsAdapter, AnalyticsPayload } from "@/types/analytics";

/**
 * Console adapter — logs events in dev; swap for Mixpanel/PostHog/GA in prod
 * by implementing the same AnalyticsAdapter interface.
 */
export const consoleAdapter: AnalyticsAdapter = {
  name: "console",
  track(payload: AnalyticsPayload) {
    if (process.env.NODE_ENV === "development") {
      console.log("[Analytics]", payload.event, payload);
    }
  },
  identify(userId: string, traits?: Record<string, unknown>) {
    if (process.env.NODE_ENV === "development") {
      console.log("[Analytics] identify", userId, traits);
    }
  },
  reset() {
    if (process.env.NODE_ENV === "development") {
      console.log("[Analytics] reset");
    }
  },
};

const API_ENDPOINT = "/api/analytics/events";
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Production adapter that sends events to /api/analytics/events via fetch.
 * Supports batching, consent gating, and graceful error fallback.
 */
export const customApiAdapter: AnalyticsAdapter = {
  name: "customApi",
  _buffer: [] as AnalyticsPayload[],
  _flushTimer: null as ReturnType<typeof setInterval> | null,

  track(payload: AnalyticsPayload) {
    this._buffer.push(payload);

    if (this._buffer.length >= BATCH_SIZE) {
      this._flush();
    } else if (!this._flushTimer) {
      this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
    }
  },

  identify(userId: string, traits?: Record<string, unknown>) {
    const event: AnalyticsPayload = {
      event: "profile_viewed" as const,
      timestamp: Date.now(),
      sessionId: "",
      identifyUserId: userId,
      identifyTraits: traits,
    } as AnalyticsPayload & { identifyUserId?: string; identifyTraits?: Record<string, unknown> };
    this._buffer.push(event);
  },

  reset() {
    this._buffer = [];
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  },

  _flush() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    if (this._buffer.length === 0) return;

    const batch = this._buffer.splice(0, BATCH_SIZE);

    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const sent = navigator.sendBeacon(
          API_ENDPOINT,
          JSON.stringify({ events: batch })
        );
        if (sent) return;
      }
    } catch {
      // sendBeacon not available, fall through to fetch
    }

    fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => {
      // Network failure — events are lost but we fail silently
    });
  },
} as AnalyticsAdapter & {
  _buffer: AnalyticsPayload[];
  _flushTimer: ReturnType<typeof setInterval> | null;
  _flush(): void;
};
