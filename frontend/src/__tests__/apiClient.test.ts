/**
 * Tests for EnhancedApiClient — Issue #693
 */

import { EnhancedApiClient, getRequestMetrics, getMetricsSummary, clearMetrics } from "@/data/apiClient";
import { ApiError, NetworkError, ValidationError } from "@/lib/errors";

// ─── Fetch mock factory ───────────────────────────────────────────────────────

type MockResponse = { status: number; body: unknown };

/**
 * Installs a mock for global.fetch that serves `responses` in order.
 * Returns a cleanup function that MUST be called after the test.
 */
function useFetch(responses: MockResponse[]): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let idx = 0;
  const orig = global.fetch;

  global.fetch = async (rawUrl: RequestInfo | URL, rawInit?: RequestInit): Promise<Response> => {
    const r = responses[idx] ?? responses[responses.length - 1];
    idx++;
    calls.push({ url: String(rawUrl), init: rawInit ?? {} });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      headers: new Headers(),
      redirected: false,
      statusText: String(r.status),
      type: "basic" as ResponseType,
      url: String(rawUrl),
      clone: () => { throw new Error("clone not implemented"); },
      body: null, bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => "",
    } as Response;
  };

  return { calls, restore: () => { global.fetch = orig; } };
}

/**
 * Installs a dynamic fetch mock driven by `handler(url, init, callIndex)`.
 * Useful when responses depend on the URL/method/headers (e.g. auth refresh).
 */
function useFetchRoute(
  handler: (url: string, init: RequestInit, callIndex: number) => Promise<MockResponse> | MockResponse,
): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const orig = global.fetch;
  let idx = 0;

  global.fetch = async (rawUrl: RequestInfo | URL, rawInit?: RequestInit): Promise<Response> => {
    const i = idx++;
    calls.push({ url: String(rawUrl), init: rawInit ?? {} });
    const r = await handler(String(rawUrl), rawInit ?? {}, i);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      headers: new Headers(),
      redirected: false,
      statusText: String(r.status),
      type: "basic" as ResponseType,
      url: String(rawUrl),
      clone: () => { throw new Error("clone not implemented"); },
      body: null, bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => "",
    } as Response;
  };

  return { calls, restore: () => { global.fetch = orig; } };
}

/**
 * Installs a fetch mock that never resolves but rejects with an AbortError
 * when the request's AbortSignal is aborted (mirrors a real timeout abort).
 * Tracks the number of fetch attempts.
 */
function useFetchHanging(): { attempts: () => number; restore: () => void } {
  const orig = global.fetch;
  let attempts = 0;

  global.fetch = (_url: RequestInfo | URL, rawInit?: RequestInit): Promise<Response> => {
    attempts++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = (rawInit as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  };

  return { attempts: () => attempts, restore: () => { global.fetch = orig; } };
}

function makeClient(cfg: Partial<ConstructorParameters<typeof EnhancedApiClient>[0]> = {}) {
  return new EnhancedApiClient({
    baseURL: "http://test.local/api",
    maxRetries: 0,
    timeoutMs: 5_000,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
    ...cfg,
  });
}

// ─── Global setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  clearMetrics();
  localStorage.clear();
  sessionStorage.clear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EnhancedApiClient — successful requests", () => {
  it("returns parsed JSON on 200", async () => {
    const { restore } = useFetch([{ status: 200, body: { id: "1" } }]);
    try {
      const r = await makeClient().get<{ id: string }>("/test");
      expect(r).toEqual({ id: "1" });
    } finally { restore(); }
  });

  it("getEnveloped() unwraps data field", async () => {
    const { restore } = useFetch([{ status: 200, body: { success: true, data: { name: "X" } } }]);
    try {
      const r = await makeClient().getEnveloped<{ name: string }>("/test");
      expect(r).toEqual({ name: "X" });
    } finally { restore(); }
  });

  it("injects Authorization header when token is stored", async () => {
    localStorage.setItem("auth_token", "my-jwt");
    const { calls, restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().get("/secured");
      expect((calls[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-jwt");
    } finally { restore(); }
  });

  it("appends query params to URL", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().get("/items", { params: { page: 1, limit: 20 } });
      expect(calls[0].url).toContain("page=1");
      expect(calls[0].url).toContain("limit=20");
    } finally { restore(); }
  });

  it("omits null / undefined params", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().get("/items", { params: { page: 1, filter: null, q: undefined } });
      expect(calls[0].url).not.toContain("filter");
      expect(calls[0].url).not.toContain("q=");
    } finally { restore(); }
  });
});

describe("EnhancedApiClient — error mapping", () => {
  it("throws ApiError on 500", async () => {
    const { restore } = useFetch([{ status: 500, body: { message: "Server Error" } }]);
    let caught: unknown;
    try { await makeClient().get("/test"); } catch (e) { caught = e; } finally { restore(); }
    expect(caught).toBeInstanceOf(ApiError);
  });

  it("ApiError carries the status code", async () => {
    const { restore } = useFetch([{ status: 403, body: { message: "Forbidden" } }]);
    let caught: ApiError | null = null;
    try { await makeClient().get("/test"); } catch (e) { caught = e as ApiError; } finally { restore(); }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.statusCode).toBe(403);
  });

  it("throws ValidationError on 422", async () => {
    const { restore } = useFetch([{ status: 422, body: { message: "Bad email", field: "email" } }]);
    let caught: ValidationError | null = null;
    try { await makeClient().post("/reg", {}); } catch (e) { caught = e as ValidationError; } finally { restore(); }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.field).toBe("email");
  });

  it("throws ValidationError on 400", async () => {
    const { restore } = useFetch([{ status: 400, body: { message: "Bad Request" } }]);
    let caught: unknown;
    try { await makeClient().post("/test", {}); } catch (e) { caught = e; } finally { restore(); }
    expect(caught).toBeInstanceOf(ValidationError);
  });
});

describe("EnhancedApiClient — retry logic", () => {
  it("retries on 500 up to maxRetries and succeeds", async () => {
    const { calls, restore } = useFetch([
      { status: 500, body: { message: "err" } },
      { status: 500, body: { message: "err" } },
      { status: 200, body: { data: "ok" } },
    ]);
    try {
      const result = await makeClient({ maxRetries: 2 }).get<{ data: string }>("/flaky");
      expect(result).toEqual({ data: "ok" });
      expect(calls).toHaveLength(3);
    } finally { restore(); }
  });

  it("does not retry on 400", async () => {
    const { calls, restore } = useFetch([{ status: 400, body: { message: "Bad" } }]);
    let caught: unknown;
    try {
      await makeClient({ maxRetries: 3 }).post("/test", {});
    } catch (e) { caught = e; } finally { restore(); }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(1);
  });

  it("noRetry option skips retries even on 500", async () => {
    const { calls, restore } = useFetch([{ status: 500, body: {} }]);
    let caught: unknown;
    try {
      await makeClient({ maxRetries: 3 }).get("/test", { noRetry: true });
    } catch (e) { caught = e; } finally { restore(); }
    expect(caught).toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });
});

describe("EnhancedApiClient — request deduplication", () => {
  it("deduplicates simultaneous GETs to the same URL", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: { id: "1" } }]);
    try {
      const [r1, r2] = await Promise.all([
        makeClient().get("/same"),
        makeClient().get("/same"),
      ]);
      // Each client has its own in-flight map, so 2 calls — but same result
      expect(r1).toEqual(r2);
    } finally { restore(); }
  });

  it("shared client deduplicates concurrent GETs", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: { id: "1" } }]);
    const client = makeClient();
    try {
      const [r1, r2] = await Promise.all([
        client.get("/shared-endpoint"),
        client.get("/shared-endpoint"),
      ]);
      expect(calls).toHaveLength(1);
      expect(r1).toEqual(r2);
    } finally { restore(); }
  });
});

describe("EnhancedApiClient — analytics / metrics", () => {
  it("records a success metric", async () => {
    const { restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().get("/m");
      const m = getRequestMetrics();
      expect(m[0].success).toBe(true);
      expect(m[0].url).toContain("/m");
    } finally { restore(); }
  });

  it("records a failure metric", async () => {
    const { restore } = useFetch([{ status: 500, body: {} }]);
    try { await makeClient().get("/fail"); } catch { /* expected */ } finally { restore(); }
    expect(getRequestMetrics()[0].success).toBe(false);
    expect(getRequestMetrics()[0].status).toBe(500);
  });

  it("getMetricsSummary returns correct rates", async () => {
    clearMetrics();
    const { restore } = useFetch([{ status: 200, body: {} }, { status: 500, body: {} }]);
    try {
      await makeClient().get("/ok");
      try { await makeClient().get("/bad"); } catch { /* expected */ }
    } finally { restore(); }
    const s = getMetricsSummary();
    expect(s.successRate).toBe(0.5);
    expect(s.total).toBe(2);
  });

  it("noAnalytics skips recording", async () => {
    clearMetrics();
    const { restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().get("/silent", { noAnalytics: true });
      expect(getRequestMetrics()).toHaveLength(0);
    } finally { restore(); }
  });
});

describe("EnhancedApiClient — HTTP methods", () => {
  it("post() uses POST and JSON-encodes body", async () => {
    const { calls, restore } = useFetch([{ status: 201, body: {} }]);
    try {
      await makeClient().post("/items", { name: "x" });
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.body).toBe(JSON.stringify({ name: "x" }));
    } finally { restore(); }
  });

  it("patch() uses PATCH", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().patch("/items/1", {});
      expect(calls[0].init.method).toBe("PATCH");
    } finally { restore(); }
  });

  it("delete() uses DELETE", async () => {
    const { calls, restore } = useFetch([{ status: 200, body: {} }]);
    try {
      await makeClient().delete("/items/1");
      expect(calls[0].init.method).toBe("DELETE");
    } finally { restore(); }
  });
});

// ─── Issue #1103 — additional coverage ─────────────────────────────────────────

describe("EnhancedApiClient — 503 retry with exponential backoff", () => {
  it("retries a 503 up to maxRetries (3 failures -> error) and never gives up early", async () => {
    const { calls, restore } = useFetch([
      { status: 503, body: { message: "unavailable" } },
      { status: 503, body: { message: "unavailable" } },
      { status: 503, body: { message: "unavailable" } },
      { status: 503, body: { message: "unavailable" } },
    ]);
    let caught: ApiError | null = null;
    try {
      try {
        await makeClient({ maxRetries: 3, retryBaseDelayMs: 0, retryMaxDelayMs: 0 }).get("/down");
      } catch (e) { caught = e as ApiError; }
      // 1 initial attempt + 3 retries = 4 requests
      expect(calls).toHaveLength(4);
      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.statusCode).toBe(503);
    } finally { restore(); }
  });

  it("throws NetworkError after 3 retries when the network is unreachable", async () => {
    jest.useFakeTimers();
    let fetchCalls = 0;
    const orig = global.fetch;
    global.fetch = async () => { fetchCalls++; throw new TypeError("Failed to fetch"); };

    let caught: unknown;
    try {
      const promise = makeClient({
        maxRetries: 3,
        retryBaseDelayMs: 50,
        retryMaxDelayMs: 400,
      }).get("/net");
      await jest.advanceTimersByTimeAsync(10_000);
      try { await promise; } catch (e) { caught = e; }

      // 1 initial attempt + 3 backoff retries = 4 requests
      expect(fetchCalls).toBe(4);
      expect(caught).toBeInstanceOf(NetworkError);
    } finally {
      global.fetch = orig;
      jest.useRealTimers();
    }
  });
});

describe("EnhancedApiClient — token refresh singleton", () => {
  it("issues a single POST /auth/refresh for two concurrent 401s", async () => {
    localStorage.setItem("auth_token", "expired-jwt");
    localStorage.setItem("refresh_token", "refresh-1");
    let refreshCount = 0;
    let refreshMethod: string | undefined;

    const handler = async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCount++;
        refreshMethod = init.method;
        return { status: 200, body: { accessToken: "new-jwt" } };
      }
      const headers = (init.headers as Record<string, string>) ?? {};
      if (headers.Authorization === "Bearer new-jwt") return { status: 200, body: { ok: true } };
      return { status: 401, body: { message: "expired" } };
    };

    const { restore } = useFetchRoute(handler);
    try {
      const client = makeClient({ maxRetries: 0 });
      // Distinct URLs so in-flight GET dedup doesn't collapse the two calls.
      const [r1, r2] = await Promise.all([client.get("/one"), client.get("/two")]);

      expect(r1).toEqual({ ok: true });
      expect(r2).toEqual({ ok: true });
      expect(refreshCount).toBe(1);
      expect(refreshMethod).toBe("POST");
      expect(localStorage.getItem("auth_token")).toBe("new-jwt");
    } finally { restore(); }
  });

  it("returns null token and throws 401 when refresh fails", async () => {
    localStorage.setItem("auth_token", "expired-jwt");
    localStorage.setItem("refresh_token", "refresh-1");

    const handler = async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return { status: 401, body: { message: "refresh invalid" } };
      }
      if (url.endsWith("/data")) {
        return { status: 401, body: { message: "expired" } };
      }
      return { status: 404, body: {} };
    };

    const { restore } = useFetchRoute(handler);
    let caught: ApiError | null = null;
    try {
      try { await makeClient().get("/data"); } catch (e) { caught = e as ApiError; }
      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.statusCode).toBe(401);
      expect(localStorage.getItem("auth_token")).toBeNull();
    } finally { restore(); }
  });
});

describe("EnhancedApiClient — ValidationError carries field + code", () => {
  it("exposes both field and code on a 422 response", async () => {
    const { restore } = useFetch([
      { status: 422, body: { message: "Bad email", field: "email", code: "EMAIL_INVALID" } },
    ]);
    let caught: ValidationError | null = null;
    try {
      try { await makeClient().post("/reg", { email: "x" }); } catch (e) { caught = e as ValidationError; }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught?.field).toBe("email");
      expect(caught?.code).toBe("EMAIL_INVALID");
    } finally { restore(); }
  });
});

describe("EnhancedApiClient — request timeout", () => {
  it("aborts after timeoutMs and throws NetworkError with a timeout message", async () => {
    jest.useFakeTimers();
    const { attempts, restore } = useFetchHanging();
    let caught: unknown;

    try {
      const promise = makeClient({
        maxRetries: 1,
        timeoutMs: 100,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
      }).get("/slow");
      await jest.advanceTimersByTimeAsync(5_000);
      try { await promise; } catch (e) { caught = e; }

      // First attempt times out, one retry also times out, then NetworkError.
      expect(attempts()).toBe(2);
      expect(caught).toBeInstanceOf(NetworkError);
      expect((caught as NetworkError).message).toContain("timed out");
    } finally {
      restore();
      jest.useRealTimers();
    }
  });

  it("noRetry requests do not retry after a timeout abort", async () => {
    jest.useFakeTimers();
    const { attempts, restore } = useFetchHanging();
    let caught: unknown;

    try {
      const promise = makeClient({
        maxRetries: 3,
        timeoutMs: 100,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
      }).get("/slow", { noRetry: true });
      await jest.advanceTimersByTimeAsync(5_000);
      try { await promise; } catch (e) { caught = e; }

      expect(attempts()).toBe(1);
      expect(caught).toBeInstanceOf(NetworkError);
    } finally {
      restore();
      jest.useRealTimers();
    }
  });
});
