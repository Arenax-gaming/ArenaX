"use client";

import { idbGet, idbSet } from "./offlineStorage";

const ANALYTICS_KEY = "offline:analytics-queue";

export interface AnalyticsEvent {
  name: string;
  props?: Record<string, unknown>;
  timestamp: number;
}

async function readQueue(): Promise<AnalyticsEvent[]> {
  return (await idbGet<AnalyticsEvent[]>(ANALYTICS_KEY)) ?? [];
}

async function writeQueue(queue: AnalyticsEvent[]): Promise<void> {
  await idbSet(ANALYTICS_KEY, queue);
}

export async function enqueueAnalytics(event: AnalyticsEvent): Promise<void> {
  const queue = await readQueue();
  queue.push(event);
  await writeQueue(queue);
}

/**
 * Flush queued analytics events.
 * Replace the `sendBeacon` target with your actual analytics endpoint.
 */
export async function flushAnalyticsQueue(): Promise<void> {
  const queue = await readQueue();
  if (queue.length === 0) return;

  const endpoint = "/api/analytics/events";

  try {
    const sent = navigator.sendBeacon(
      endpoint,
      JSON.stringify({ events: queue })
    );
    if (sent) {
      await writeQueue([]);
      return;
    }
  } catch {
    // sendBeacon not available or failed, fall through to fetch
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue }),
      keepalive: true,
    });
    if (res.ok) await writeQueue([]);
  } catch {
    // Network still down – will retry on next flush
  }
}
