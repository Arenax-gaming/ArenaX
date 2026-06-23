/**
 * Tests for offline-first architecture:
 *   - SyncQueue (enqueue, LWW dedup, flush, ordering)
 *   - useNetworkStatus hook
 *   - AnalyticsQueue
 */

// ─── Mock IndexedDB via offlineStorage ──────────────────────────────────────
const store: Record<string, unknown> = {};

jest.mock("@/lib/offlineStorage", () => ({
  idbGet: jest.fn(async (key: string) => store[key]),
  idbSet: jest.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  idbDelete: jest.fn(async (key: string) => {
    delete store[key];
  }),
  idbClear: jest.fn(async () => {
    Object.keys(store).forEach((k) => delete store[k]);
  }),
}));

// ─── Imports ────────────────────────────────────────────────────────────────
import {
  enqueueSync,
  flushSyncQueue,
  getSyncQueueLength,
} from "@/lib/syncQueue";
import { enqueueAnalytics, flushAnalyticsQueue } from "@/lib/analyticsQueue";
import { renderHook, act } from "@testing-library/react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

// ─── Helpers ────────────────────────────────────────────────────────────────
beforeEach(() => {
  // Reset in-memory store between tests
  Object.keys(store).forEach((k) => delete store[k]);
  jest.restoreAllMocks();
  // Restore navigator.onLine
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

// ── SyncQueue ────────────────────────────────────────────────────────────────
describe("syncQueue", () => {
  it("enqueues an item and reports pending count", async () => {
    await enqueueSync({ url: "/api/matches/1/report", method: "POST", body: '{"score":10}' });
    expect(await getSyncQueueLength()).toBe(1);
  });

  it("applies Last-Write-Wins for same url+method", async () => {
    await enqueueSync({ url: "/api/matches/1/report", method: "POST", body: '{"score":10}' });
    await enqueueSync({ url: "/api/matches/1/report", method: "POST", body: '{"score":20}' });

    expect(await getSyncQueueLength()).toBe(1);
    // The queue in the store should hold the second (newer) body
    const { idbGet } = jest.requireMock("@/lib/offlineStorage");
    const queue = await idbGet("offline:sync-queue");
    expect(queue[0].body).toBe('{"score":20}');
  });

  it("flushes items in chronological order and clears on 2xx", async () => {
    const fetchOrder: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      fetchOrder.push(url as string);
      return { ok: true, status: 200 } as Response;
    }) as jest.Mock;

    // Add two items with different timestamps
    await enqueueSync({ url: "/api/a", method: "POST" });
    await new Promise((r) => setTimeout(r, 5)); // ensure ts difference
    await enqueueSync({ url: "/api/b", method: "POST" });

    await flushSyncQueue();

    expect(fetchOrder).toEqual(["/api/a", "/api/b"]);
    expect(await getSyncQueueLength()).toBe(0);
  });

  it("stops flushing if network is unavailable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Network error")) as jest.Mock;

    await enqueueSync({ url: "/api/c", method: "POST" });
    await flushSyncQueue();

    // Item should remain queued
    expect(await getSyncQueueLength()).toBe(1);
  });

  it("removes 409 conflict responses (server resolved it)", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 409 } as Response)) as jest.Mock;

    await enqueueSync({ url: "/api/d", method: "POST" });
    await flushSyncQueue();

    expect(await getSyncQueueLength()).toBe(0);
  });
});

// ── useNetworkStatus ─────────────────────────────────────────────────────────
describe("useNetworkStatus", () => {
  it("returns true when navigator.onLine is true", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it("updates to false when offline event fires", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it("updates back to true when online event fires", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
  });
});

// ── AnalyticsQueue ───────────────────────────────────────────────────────────
describe("analyticsQueue", () => {
  it("enqueues analytics events", async () => {
    await enqueueAnalytics({ name: "page_view", timestamp: Date.now() });
    const { idbGet } = jest.requireMock("@/lib/offlineStorage");
    const queue = await idbGet("offline:analytics-queue");
    expect(queue).toHaveLength(1);
    expect(queue[0].name).toBe("page_view");
  });

  it("flushes via sendBeacon when available and clears queue", async () => {
    await enqueueAnalytics({ name: "match_start", timestamp: Date.now() });

    const mockSendBeacon = jest.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: mockSendBeacon,
      configurable: true,
    });

    await flushAnalyticsQueue();

    expect(mockSendBeacon).toHaveBeenCalledWith(
      "/api/analytics/events",
      expect.stringContaining("match_start")
    );

    const { idbGet } = jest.requireMock("@/lib/offlineStorage");
    expect(await idbGet("offline:analytics-queue")).toHaveLength(0);
  });

  it("falls back to fetch when sendBeacon fails", async () => {
    await enqueueAnalytics({ name: "tournament_join", timestamp: Date.now() });

    Object.defineProperty(navigator, "sendBeacon", {
      value: jest.fn(() => false),
      configurable: true,
    });

    global.fetch = jest.fn(async () => ({ ok: true } as Response)) as jest.Mock;

    await flushAnalyticsQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/analytics/events",
      expect.objectContaining({ method: "POST" })
    );
  });
});
