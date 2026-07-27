/**
 * Middleware tests — #698
 *
 * @jest-environment node
 *
 * Uses the Node environment (not jsdom) so the native Web API globals
 * Response, Request, Headers, and fetch are available without polyfilling.
 *
 * Covers:
 *  requestMiddleware — correlationId, auth injection, retry backoff,
 *                      deduplication, circuit breaker, analytics
 *  RequestMiddlewarePipeline — execute, executeJson, middleware chain order
 *  EnhancedApiClient — request, requestStandard, 401 handling, error wrapping
 */

// ─── Global fetch mock ────────────────────────────────────────────────────────
const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
global.fetch = mockFetch as typeof global.fetch;

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeErrorResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ─── Imports (after global setup) ────────────────────────────────────────────
import {
  correlationIdMiddleware,
  createAuthMiddleware,
  createRetryMiddleware,
  deduplicationMiddleware,
  createCircuitBreakerMiddleware,
  analyticsMiddleware,
  RequestMiddlewarePipeline,
  getRequestAnalyticsEvents,
  clearRequestAnalyticsEvents,
  resetCircuits,
  getCircuitState,
  type RequestContext,
  type RequestMiddlewareFn,
} from "../requestMiddleware";

import { EnhancedApiClient } from "../apiMiddleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    url: "https://api.arenax.gg/tournaments",
    options: { method: "GET", headers: {} },
    startedAt: Date.now(),
    correlationId: "test-corr-1",
    retries: 0,
    cached: false,
    meta: {},
    ...overrides,
  };
}

// Minimal pipeline that just calls fetch at the end
function minimalPipeline(middlewares: RequestMiddlewareFn[]) {
  return new RequestMiddlewarePipeline({
    middlewares: [
      ...middlewares,
    ],
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// correlationIdMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("correlationIdMiddleware", () => {
  test("injects X-Request-Id and X-Correlation-Id headers", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ success: true, data: {} }));
    const ctx = makeCtx();
    let capturedHeaders: Record<string, string> = {};

    await correlationIdMiddleware(ctx, async () => {
      capturedHeaders = { ...ctx.options.headers };
      return makeOkResponse({});
    });

    expect(capturedHeaders["x-request-id"]).toBe("test-corr-1");
    expect(capturedHeaders["x-correlation-id"]).toBe("test-corr-1");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createAuthMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("createAuthMiddleware", () => {
  test("injects Authorization header when token is present", async () => {
    const authMw = createAuthMiddleware(() => "my-token");
    const ctx = makeCtx();
    let captured = "";

    await authMw(ctx, async () => {
      captured = ctx.options.headers["authorization"] ?? "";
      return makeOkResponse({});
    });

    expect(captured).toBe("Bearer my-token");
  });

  test("does not inject header on auth paths", async () => {
    const authMw = createAuthMiddleware(() => "my-token", ["/auth/"]);
    const ctx = makeCtx({ url: "https://api.arenax.gg/auth/login" });
    let captured: string | undefined;

    await authMw(ctx, async () => {
      captured = ctx.options.headers["authorization"];
      return makeOkResponse({});
    });

    expect(captured).toBeUndefined();
  });

  test("does not inject header when no token available", async () => {
    const authMw = createAuthMiddleware(() => null);
    const ctx = makeCtx();
    let captured: string | undefined;

    await authMw(ctx, async () => {
      captured = ctx.options.headers["authorization"];
      return makeOkResponse({});
    });

    expect(captured).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createRetryMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("createRetryMiddleware", () => {
  test("passes through on success without retry", async () => {
    const retryMw = createRetryMiddleware({ maxAttempts: 3, baseDelayMs: 10 });
    const next = jest.fn().mockResolvedValue(makeOkResponse({}));
    const ctx = makeCtx();

    const resp = await retryMw(ctx, next);
    expect(resp.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("retries on 503 then returns success", async () => {
    const retryMw = createRetryMiddleware({
      maxAttempts: 3,
      baseDelayMs: 5,
      retryOn: [503],
    });
    const next = jest.fn()
      .mockResolvedValueOnce(makeErrorResponse(503))
      .mockResolvedValueOnce(makeErrorResponse(503))
      .mockResolvedValueOnce(makeOkResponse({}));
    const ctx = makeCtx();

    const resp = await retryMw(ctx, next);
    expect(resp.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(3);
  });

  test("returns last response after exhausting retries", async () => {
    const retryMw = createRetryMiddleware({
      maxAttempts: 2,
      baseDelayMs: 5,
      retryOn: [502],
    });
    const next = jest.fn().mockResolvedValue(makeErrorResponse(502));
    const ctx = makeCtx();

    const resp = await retryMw(ctx, next);
    expect(resp.status).toBe(502);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("does not retry on 400 client error", async () => {
    const retryMw = createRetryMiddleware({ maxAttempts: 3, baseDelayMs: 5 });
    const next = jest.fn().mockResolvedValue(makeErrorResponse(400));
    const ctx = makeCtx();

    const resp = await retryMw(ctx, next);
    expect(resp.status).toBe(400);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// deduplicationMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("deduplicationMiddleware", () => {
  test("deduplicates identical parallel GET requests", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ ok: true }));
    const pipeline = minimalPipeline([deduplicationMiddleware]);
    const url = `https://api.arenax.gg/dedup-test-${Date.now()}`;

    const [r1, r2, r3] = await Promise.all([
      pipeline.execute(url),
      pipeline.execute(url),
      pipeline.execute(url),
    ]);

    // All should succeed
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    // Fetch should only have been called once
    const callsForUrl = mockFetch.mock.calls.filter(
      (c) => String(c[0]).includes("dedup-test")
    );
    expect(callsForUrl.length).toBe(1);
  });

  test("does not deduplicate POST requests", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({}));
    const pipeline = minimalPipeline([deduplicationMiddleware]);
    const url = `https://api.arenax.gg/post-test-${Date.now()}`;

    mockFetch.mockClear();
    await pipeline.execute(url, { method: "POST" });
    await pipeline.execute(url, { method: "POST" });

    const postCalls = mockFetch.mock.calls.filter(
      (c) => String(c[0]).includes("post-test")
    );
    expect(postCalls.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createCircuitBreakerMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("createCircuitBreakerMiddleware", () => {
  const HOST = "circuit-test.example.com";

  beforeEach(() => resetCircuits());

  test("passes requests through when circuit is closed", async () => {
    const cbMw = createCircuitBreakerMiddleware({ threshold: 3 });
    const next = jest.fn().mockResolvedValue(makeOkResponse({}));
    const ctx = makeCtx({ url: `https://${HOST}/ok` });

    const resp = await cbMw(ctx, next);
    expect(resp.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("opens circuit after threshold consecutive failures", async () => {
    const cbMw = createCircuitBreakerMiddleware({ threshold: 3, openDurationMs: 10_000 });
    const next = jest.fn().mockResolvedValue(makeErrorResponse(500));
    const ctx = () => makeCtx({ url: `https://${HOST}/fail` });

    // 3 failures → circuit opens
    await cbMw(ctx(), next);
    await cbMw(ctx(), next);
    await cbMw(ctx(), next);

    // Next request should be blocked (503 synthetic)
    const blocked = await cbMw(ctx(), next);
    expect(blocked.status).toBe(503);
    // next should NOT have been called on the 4th attempt
    expect(next).toHaveBeenCalledTimes(3);
  });

  test("circuit state reflects failure count", async () => {
    const cbMw = createCircuitBreakerMiddleware({ threshold: 5 });
    const next = jest.fn().mockResolvedValue(makeErrorResponse(500));
    const ctx = makeCtx({ url: `https://${HOST}/track` });

    await cbMw(ctx, next);
    await cbMw(ctx, next);

    const state = getCircuitState(HOST);
    expect(state?.failures).toBe(2);
    expect(state?.openedAt).toBeNull();
  });

  test("resets failure count on success", async () => {
    const cbMw = createCircuitBreakerMiddleware({ threshold: 5 });
    const ctx = makeCtx({ url: `https://${HOST}/reset` });

    // Two failures
    await cbMw(ctx, jest.fn().mockResolvedValue(makeErrorResponse(500)));
    await cbMw(ctx, jest.fn().mockResolvedValue(makeErrorResponse(500)));

    // One success
    await cbMw(ctx, jest.fn().mockResolvedValue(makeOkResponse({})));

    const state = getCircuitState(HOST);
    expect(state?.failures).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// analyticsMiddleware
// ═════════════════════════════════════════════════════════════════════════════
describe("analyticsMiddleware", () => {
  beforeEach(() => clearRequestAnalyticsEvents());

  test("records a successful request event", async () => {
    const ctx = makeCtx({ url: "https://api.arenax.gg/analytics-test" });
    await analyticsMiddleware(ctx, async () => makeOkResponse({}));

    const events = getRequestAnalyticsEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.success).toBe(true);
    expect(events[0]?.url).toBe("https://api.arenax.gg/analytics-test");
    expect(events[0]?.correlationId).toBe("test-corr-1");
  });

  test("records a failed request event (4xx)", async () => {
    const ctx = makeCtx({ url: "https://api.arenax.gg/analytics-fail" });
    await analyticsMiddleware(ctx, async () => makeErrorResponse(404));

    const events = getRequestAnalyticsEvents();
    const event = events.find((e) => e.url.includes("analytics-fail"));
    expect(event?.success).toBe(false);
    expect(event?.statusCode).toBe(404);
  });

  test("records latency for each request", async () => {
    const ctx = makeCtx();
    await analyticsMiddleware(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return makeOkResponse({});
    });

    const events = getRequestAnalyticsEvents();
    expect(events[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("clears events with clearRequestAnalyticsEvents", () => {
    getRequestAnalyticsEvents(); // populate
    clearRequestAnalyticsEvents();
    expect(getRequestAnalyticsEvents().length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RequestMiddlewarePipeline
// ═════════════════════════════════════════════════════════════════════════════
describe("RequestMiddlewarePipeline", () => {
  beforeEach(() => mockFetch.mockClear());

  test("executes middleware in order", async () => {
    const order: number[] = [];
    const m1: RequestMiddlewareFn = async (ctx, next) => { order.push(1); return next(); };
    const m2: RequestMiddlewareFn = async (ctx, next) => { order.push(2); return next(); };
    const m3: RequestMiddlewareFn = async (ctx, next) => { order.push(3); return next(); };

    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    const p = new RequestMiddlewarePipeline({ middlewares: [m1, m2, m3] });
    await p.execute("https://api.arenax.gg/order-test");
    expect(order).toEqual([1, 2, 3]);
  });

  test("execute returns the raw Response", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ hello: "world" }));
    const p = new RequestMiddlewarePipeline({ middlewares: [] });
    const resp = await p.execute("https://api.arenax.gg/raw");
    expect(resp.status).toBe(200);
  });

  test("executeJson returns parsed data and metadata", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ result: "ok" }));
    const p = new RequestMiddlewarePipeline({ middlewares: [] });
    const { data, statusCode } = await p.executeJson("https://api.arenax.gg/json");
    expect(statusCode).toBe(200);
    expect((data as Record<string, unknown>).result).toBe("ok");
  });

  test("executeJson throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(404, { message: "Not found" })
    );
    const p = new RequestMiddlewarePipeline({ middlewares: [] });
    await expect(p.executeJson("https://api.arenax.gg/missing")).rejects.toThrow("Not found");
  });

  test("middleware can mutate headers before fetch", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    let capturedInit: RequestInit | undefined;

    const captureMw: RequestMiddlewareFn = async (ctx, next) => {
      ctx.options.headers["x-custom"] = "test-value";
      const resp = await next();
      capturedInit = ctx.options;
      return resp;
    };

    const p = new RequestMiddlewarePipeline({ middlewares: [captureMw] });
    await p.execute("https://api.arenax.gg/headers");
    expect((capturedInit?.headers as Record<string, string>)["x-custom"]).toBe("test-value");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EnhancedApiClient
// ═════════════════════════════════════════════════════════════════════════════
describe("EnhancedApiClient", () => {
  let client: EnhancedApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new EnhancedApiClient({ retry: { maxAttempts: 1 } });
  });

  test("request() returns unwrapped data", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: { id: "1", user_name: "alice" } })
    );
    const data = await client.request<{ id: string; userName: string }>("/users/1");
    expect(data.id).toBe("1");
    expect(data.userName).toBe("alice"); // camelCase normalized
  });

  test("requestStandard() returns full StandardResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        success: true,
        data: { id: "1" },
        message: "OK",
      })
    );
    const response = await client.requestStandard<{ id: string }>("/users/1");
    expect(response.success).toBe(true);
    expect(response.status).toBe("success");
    expect(response.data.id).toBe("1");
    expect(response.message).toBe("OK");
    expect(typeof response.meta.traceId).toBe("string");
    expect(response.meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(response.meta.requestMethod).toBe("GET");
  });

  test("requestStandard() returns error response on non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(404, { message: "Not found", code: "NOT_FOUND" })
    );
    const response = await client.requestStandard<{ id: string }>("/missing");
    expect(response.success).toBe(false);
    expect(response.status).toBe("error");
    expect(response.message).toBe("Not found");
  });

  test("requestPaginatedStandard() includes pagination meta", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        success: true,
        data: [{ id: "1" }, { id: "2" }],
        total: 50,
        page: 2,
        limit: 2,
        totalPages: 25,
      })
    );
    const resp = await client.requestPaginatedStandard<{ id: string }>("/items");
    expect(resp.pagination.total).toBe(50);
    expect(resp.pagination.page).toBe(2);
    expect(resp.pagination.hasNextPage).toBe(true);
    expect(resp.pagination.hasPrevPage).toBe(true);
    expect(resp.data).toHaveLength(2);
  });

  test("request() throws on error response", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, { message: "Bad request" })
    );
    await expect(client.request("/bad")).rejects.toThrow("Bad request");
  });

  test("request() triggers onAuthFailure on unrecoverable 401", async () => {
    const onAuthFailure = jest.fn();
    client.setOnAuthFailure(onAuthFailure);

    // First call: 401 from the pipeline's fetch
    // Second call: refresh token endpoint also returns 401 (refresh fails)
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeErrorResponse(401, { message: "Refresh failed" }));

    await expect(client.request("/protected")).rejects.toThrow("SESSION_EXPIRED");
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  test("forwards POST body correctly", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: { created: true } })
    );
    await client.request("/tournaments", {
      method: "POST",
      body: JSON.stringify({ name: "Test Tournament" }),
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain("Test Tournament");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Integration — full pipeline
// ═════════════════════════════════════════════════════════════════════════════
describe("Full middleware pipeline integration", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    clearRequestAnalyticsEvents();
    resetCircuits();
  });

  test("correlationId + auth + analytics chain all fire", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ success: true, data: {} }));

    const pipeline = new RequestMiddlewarePipeline({
      middlewares: [
        correlationIdMiddleware,
        createAuthMiddleware(() => "bearer-token"),
        analyticsMiddleware,
      ],
    });

    await pipeline.execute("https://api.arenax.gg/integration");

    // Headers were set by correlationId + auth middlewares
    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-request-id"]).toBeTruthy();
    expect(headers["authorization"]).toBe("Bearer bearer-token");

    // Analytics event was recorded
    const events = getRequestAnalyticsEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.success).toBe(true);
  });
});
