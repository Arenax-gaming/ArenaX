/**
 * Tests for responseInterceptor.ts
 */

import {
  ResponseInterceptor,
  buildErrorResponse,
  getMonitorSnapshot,
  clearMonitor,
  getAnalyticsEvents,
  clearAnalyticsEvents,
} from "../responseInterceptor";
import type { InterceptedRequest } from "../responseInterceptor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<InterceptedRequest> = {}): InterceptedRequest {
  return {
    url: "https://api.arenax.gg/tournaments",
    method: "GET",
    statusCode: 200,
    latencyMs: 120,
    retries: 0,
    cached: false,
    ...overrides,
  };
}

const interceptor = new ResponseInterceptor({
  config: { normalizeCasing: true, parseDates: false, stripNulls: false },
});

// ─── intercept ────────────────────────────────────────────────────────────────

describe("ResponseInterceptor.intercept", () => {
  beforeEach(() => {
    clearMonitor();
    clearAnalyticsEvents();
  });

  it("unwraps a standard { success, data } envelope", () => {
    const raw = { success: true, data: { user_name: "alice" }, message: "OK" };
    const result = interceptor.intercept(raw, makeRequest());

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.message).toBe("OK");
    expect((result.data as Record<string, unknown>).userName).toBe("alice");
  });

  it("normalizes snake_case keys in the payload", () => {
    const raw = { success: true, data: { total_count: 42, page_size: 10 } };
    const result = interceptor.intercept<Record<string, unknown>>(raw, makeRequest());

    expect(result.data.totalCount).toBe(42);
    expect(result.data.pageSize).toBe(10);
  });

  it("handles raw responses without envelope (auth endpoints)", () => {
    const raw = { user: { id: "1" }, tokens: { accessToken: "tok" } };
    const result = interceptor.intercept(raw, makeRequest());

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).user).toBeDefined();
  });

  it("injects response meta with correct fields", () => {
    const raw = { success: true, data: {} };
    const req = makeRequest({ latencyMs: 250, retries: 1, statusCode: 200 });
    const result = interceptor.intercept(raw, req);

    expect(result.meta.latencyMs).toBe(250);
    expect(result.meta.retries).toBe(1);
    expect(result.meta.statusCode).toBe(200);
    expect(result.meta.requestMethod).toBe("GET");
    expect(result.meta.requestPath).toBe("/tournaments");
    expect(typeof result.meta.traceId).toBe("string");
    expect(typeof result.meta.receivedAt).toBe("string");
  });

  it("uses server-provided traceId when available", () => {
    const raw = { success: true, data: {} };
    const req = makeRequest({ traceId: "server-trace-123" });
    const result = interceptor.intercept(raw, req);
    expect(result.meta.traceId).toBe("server-trace-123");
  });

  it("generates a client traceId when none is provided", () => {
    const raw = { success: true, data: {} };
    const result = interceptor.intercept(raw, makeRequest({ traceId: undefined }));
    expect(result.meta.traceId).toMatch(/^tx-/);
  });

  it("records analytics events", () => {
    const raw = { success: true, data: {} };
    interceptor.intercept(raw, makeRequest());
    const events = getAnalyticsEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.endpoint).toBe("/tournaments");
  });

  it("updates the monitor snapshot", () => {
    const raw = { success: true, data: {} };
    interceptor.intercept(raw, makeRequest());
    const snap = getMonitorSnapshot();
    expect(snap.totalRequests).toBeGreaterThan(0);
    expect(snap.successCount).toBeGreaterThan(0);
  });

  it("marks a response as slow when latency exceeds threshold", () => {
    const slowInterceptor = new ResponseInterceptor({
      config: { slowResponseThresholdMs: 100, analyticsEnabled: true },
    });
    slowInterceptor.intercept({ success: true, data: {} }, makeRequest({ latencyMs: 3000 }));
    const events = getAnalyticsEvents();
    const slowEvent = events.find((e) => e.latencyMs === 3000);
    expect(slowEvent?.slow).toBe(true);
  });
});

// ─── interceptPaginated ───────────────────────────────────────────────────────

describe("ResponseInterceptor.interceptPaginated", () => {
  it("extracts pagination metadata from envelope", () => {
    const raw = {
      success: true,
      data: [{ id: "1" }, { id: "2" }],
      total: 100,
      page: 2,
      limit: 20,
      totalPages: 5,
    };
    const result = interceptor.interceptPaginated(raw, makeRequest());

    expect(result.pagination.total).toBe(100);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.totalPages).toBe(5);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  it("sets hasNextPage false on last page", () => {
    const raw = {
      success: true,
      data: [{ id: "1" }],
      total: 10,
      page: 5,
      limit: 5,
      totalPages: 5,
    };
    const result = interceptor.interceptPaginated(raw, makeRequest());
    expect(result.pagination.hasNextPage).toBe(false);
  });

  it("falls back gracefully for non-paginated arrays", () => {
    const raw = [{ id: "1" }, { id: "2" }];
    const result = interceptor.interceptPaginated(raw, makeRequest());
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.total).toBe(2);
  });
});

// ─── buildErrorResponse ───────────────────────────────────────────────────────

describe("buildErrorResponse", () => {
  it("builds a StandardErrorResponse with correct shape", () => {
    const err = buildErrorResponse(
      { message: "Not found", statusCode: 404, code: "NOT_FOUND" },
      { url: "/tournaments/999", method: "GET", latencyMs: 50, retries: 0 },
    );

    expect(err.success).toBe(false);
    expect(err.status).toBe("error");
    expect(err.error.code).toBe("NOT_FOUND");
    expect(err.error.message).toBe("Not found");
    expect(err.error.statusCode).toBe(404);
    expect(err.meta.requestPath).toBe("/tournaments/999");
  });

  it("defaults code to UNKNOWN_ERROR when not provided", () => {
    const err = buildErrorResponse(
      { message: "Oops" },
      { url: "/test", method: "POST", latencyMs: 10, retries: 0 },
    );
    expect(err.error.code).toBe("UNKNOWN_ERROR");
  });
});

// ─── Monitor snapshot ─────────────────────────────────────────────────────────

describe("getMonitorSnapshot", () => {
  beforeEach(() => clearMonitor());

  it("returns zeroed snapshot when no requests have been made", () => {
    const snap = getMonitorSnapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.successRate).toBe(1);
  });

  it("tracks error counts correctly", () => {
    const errInterceptor = new ResponseInterceptor({ config: { analyticsEnabled: true } });
    errInterceptor.intercept(
      { success: false, data: null },
      makeRequest({ statusCode: 500 }),
    );
    const snap = getMonitorSnapshot();
    expect(snap.errorCount).toBeGreaterThan(0);
    expect(snap.successRate).toBeLessThan(1);
  });
});
