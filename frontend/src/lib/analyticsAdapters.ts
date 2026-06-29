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
