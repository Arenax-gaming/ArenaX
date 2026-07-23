"use client";

import { getAnalyticsService } from "@/lib/analytics";

export interface FunnelDefinition {
  name: string;
  steps: string[];
}

/**
 * Pre-defined funnels for ArenaX conversion tracking.
 */
export const FUNNELS: Record<string, FunnelDefinition> = {
  registration: {
    name: "registration",
    steps: ["visit", "signup", "first_game", "first_tournament", "first_purchase"],
  },
};

/**
 * Track a funnel step by emitting a funnel_step analytics event.
 *
 * @param funnelName - The funnel identifier (must match a key in FUNNELS)
 * @param stepName   - The step name within the funnel
 * @param stepIndex  - Zero-based index of the step in the funnel
 */
export function trackFunnelStep(
  funnelName: string,
  stepName: string,
  stepIndex: number
): void {
  const service = getAnalyticsService();
  service.track("funnel_step", {
    funnelName,
    stepName,
    stepIndex,
  });
}

/**
 * Convenience helper: given a funnel definition and a step name,
 * look up the step index automatically and track it.
 */
export function trackFunnelStepByName(
  funnelName: string,
  stepName: string
): void {
  const funnel = FUNNELS[funnelName];
  if (!funnel) return;
  const index = funnel.steps.indexOf(stepName);
  if (index === -1) return;
  trackFunnelStep(funnelName, stepName, index);
}
