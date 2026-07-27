/**
 * requestMiddleware.ts — outgoing request interception pipeline
 *
 * Provides a composable middleware chain for every API request before it
 * leaves the browser. Each middleware is a function that receives a
 * `RequestContext` and can:
 *   - Mutate headers / URL / body
 *   - Short-circuit by returning a Response directly
 *   - Record analytics / tracing data
 *   - Enforce circuit-breaker state
 *
 * The pipeline runs in registration order. After all middlewares transform
 * the request, `execute()` issues the actual fetch call and wires the
 * result into `InterceptedRequest` for the response pipeline.
 *
 * Architecture:
 *   RequestMiddlewarePipeline
 *     ├── correlationId  — attaches X-Request-Id to every request
 *     ├── auth           — injects Bearer token + handles 401 refresh
 *     ├── retryBackoff   — exponential back-off with jitter
 *     ├── deduplication  — collapses identical in-flight GET requests
 *     ├── circuitBreaker — opens circuit after N consecutive failures
 *     └── analytics      — emits request analytics events
 */

"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestContext {
  /** Full URL (may be mutated by middleware). */
  url: string;
  /** Fetch init options (may be mutated by middleware). */
  options: RequestInit & { headers: Record<string, string> };
  /** Monotonic start time (set by the pipeline runner). */
  startedAt: number;
  /** Auto-generated correlation / trace ID for this request. */
  correlationId: string;
  /** Number of retry attempts already made. */
  retries: number;
  /** Whether the response was served from the dedup cache. */
  cached: boolean;
  /** Arbitrary bag for middleware to pass state down the chain. */
  meta: Record<string, unknown>;
}

export type RequestMiddlewareFn = (
  ctx: RequestContext,
  next: () => Promise<Response>
) => Promise<Response>;

export interface RequestAnalyticsEvent {
  correlationId: string;
  url: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  retries: number;
  cached: boolean;
  success: boolean;
  blocked: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Analytics store
// ---------------------------------------------------------------------------

const MAX_REQUEST_EVENTS = 300;
const _requestEvents: RequestAnalyticsEvent[] = [];

export function getRequestAnalyticsEvents(): readonly RequestAnalyticsEvent[] {
  return _requestEvents;
}

export function clearRequestAnalyticsEvents(): void {
  _requestEvents.length = 0;
}

function recordRequestEvent(event: RequestAnalyticsEvent): void {
  _requestEvents.unshift(event);
  if (_requestEvents.length > MAX_REQUEST_EVENTS) {
    _requestEvents.length = MAX_REQUEST_EVENTS;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("arenax:request:event", { detail: event })
    );
  }
}

// ---------------------------------------------------------------------------
// Correlation ID generation
// ---------------------------------------------------------------------------

let _correlationCounter = 0;

function generateCorrelationId(): string {
  _correlationCounter = (_correlationCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `req-${Date.now().toString(36)}-${_correlationCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Built-in middlewares
// ---------------------------------------------------------------------------

/**
 * Attaches a unique X-Request-Id header to every outgoing request so
 * distributed traces can be correlated across client → API gateway → backend.
 */
export const correlationIdMiddleware: RequestMiddlewareFn = async (ctx, next) => {
  ctx.options.headers["x-request-id"] = ctx.correlationId;
  ctx.options.headers["x-correlation-id"] = ctx.correlationId;
  return next();
};

/**
 * Injects the Bearer token from storage into every request.
 * Skips auth routes to avoid circular refresh loops.
 */
export function createAuthMiddleware(
  getToken: () => string | null,
  authPaths: string[] = ["/auth/"]
): RequestMiddlewareFn {
  return async (ctx, next) => {
    const isAuthPath = authPaths.some((p) => ctx.url.includes(p));
    if (!isAuthPath) {
      const token = getToken();
      if (token) {
        ctx.options.headers["authorization"] = `Bearer ${token}`;
      }
    }
    return next();
  };
}

/**
 * Retry middleware with exponential back-off and jitter.
 * Only retries on network failures and 5xx / 429 status codes.
 */
export interface RetryMiddlewareOptions {
  /** Maximum attempts (default 3, counting the initial request). */
  maxAttempts?: number;
  /** Base delay in ms (default 300). */
  baseDelayMs?: number;
  /** Cap on back-off delay ms (default 15 000). */
  maxDelayMs?: number;
  /** Jitter fraction 0–1 (default 0.15). */
  jitter?: number;
  /** Status codes that should trigger a retry (default: 429, 502, 503, 504). */
  retryOn?: number[];
}

export function createRetryMiddleware(
  opts: RetryMiddlewareOptions = {}
): RequestMiddlewareFn {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 15_000,
    jitter = 0.15,
    retryOn = [429, 502, 503, 504],
  } = opts;

  return async (ctx, next) => {
    let lastResponse: Response | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      ctx.retries = attempt - 1;

      try {
        const resp = await next();
        if (!retryOn.includes(resp.status) || attempt === maxAttempts) {
          return resp;
        }
        lastResponse = resp;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        // Network error — wait and retry
      }

      // Compute delay
      const base = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const wait = base + base * jitter * Math.random();
      await new Promise((r) => setTimeout(r, wait));
    }

    return lastResponse ?? new Response(null, { status: 0 });
  };
}

/**
 * Request deduplication middleware.
 * Multiple simultaneous GET requests to the same URL resolve against a single
 * in-flight fetch.  Non-GET requests always pass through.
 */
const _inFlight = new Map<string, Promise<Response>>();

export const deduplicationMiddleware: RequestMiddlewareFn = async (ctx, next) => {
  const method = (ctx.options.method ?? "GET").toUpperCase();
  if (method !== "GET") return next();

  const key = `${method}:${ctx.url}`;
  const existing = _inFlight.get(key);

  if (existing) {
    ctx.cached = true;
    // Clone the response so each caller gets its own readable body
    const shared = await existing;
    return shared.clone();
  }

  const promise = next().then((resp) => {
    _inFlight.delete(key);
    return resp;
  }).catch((err) => {
    _inFlight.delete(key);
    throw err;
  });

  _inFlight.set(key, promise);
  return promise.then((r) => r.clone());
};

/**
 * Circuit breaker middleware.
 * Tracks consecutive failures per host. When failures exceed `threshold` the
 * circuit opens for `openDurationMs` ms and all requests immediately fail with
 * a synthetic 503.
 */
export interface CircuitBreakerOptions {
  /** Consecutive failure threshold to open the circuit (default 5). */
  threshold?: number;
  /** Duration to stay open in ms before half-opening (default 30 000). */
  openDurationMs?: number;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const _circuits = new Map<string, CircuitState>();

function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function createCircuitBreakerMiddleware(
  opts: CircuitBreakerOptions = {}
): RequestMiddlewareFn {
  const { threshold = 5, openDurationMs = 30_000 } = opts;

  return async (ctx, next) => {
    const host = getHost(ctx.url);
    const state = _circuits.get(host) ?? { failures: 0, openedAt: null };

    // Check if circuit is open
    if (state.openedAt !== null) {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed < openDurationMs) {
        // Circuit open — fast fail
        recordRequestEvent({
          correlationId: ctx.correlationId,
          url: ctx.url,
          method: (ctx.options.method ?? "GET").toUpperCase(),
          statusCode: 503,
          latencyMs: 0,
          retries: ctx.retries,
          cached: false,
          success: false,
          blocked: true,
          timestamp: Date.now(),
        });
        return new Response(
          JSON.stringify({ error: "Circuit open", code: "CIRCUIT_OPEN" }),
          { status: 503, headers: { "content-type": "application/json" } }
        );
      }
      // Half-open — allow one probe request through
      state.openedAt = null;
      _circuits.set(host, state);
    }

    try {
      const resp = await next();
      if (resp.ok || resp.status < 500) {
        // Success or client error — reset failure count
        state.failures = 0;
        _circuits.set(host, state);
      } else {
        state.failures += 1;
        if (state.failures >= threshold) {
          state.openedAt = Date.now();
        }
        _circuits.set(host, state);
      }
      return resp;
    } catch (err) {
      state.failures += 1;
      if (state.failures >= threshold) {
        state.openedAt = Date.now();
      }
      _circuits.set(host, state);
      throw err;
    }
  };
}

/** Reset all circuit states (useful in tests). */
export function resetCircuits(): void {
  _circuits.clear();
}

/** Get the circuit state for a given host. */
export function getCircuitState(host: string): CircuitState | undefined {
  return _circuits.get(host);
}

/**
 * Request analytics middleware.
 * Must be registered LAST in the pipeline so it measures total round-trip time.
 */
export const analyticsMiddleware: RequestMiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  let statusCode = 0;
  let success = false;

  try {
    const resp = await next();
    statusCode = resp.status;
    success = resp.ok;
    return resp;
  } catch (err) {
    statusCode = 0;
    success = false;
    throw err;
  } finally {
    recordRequestEvent({
      correlationId: ctx.correlationId,
      url: ctx.url,
      method: (ctx.options.method ?? "GET").toUpperCase(),
      statusCode,
      latencyMs: Date.now() - start,
      retries: ctx.retries,
      cached: ctx.cached,
      success,
      blocked: false,
      timestamp: Date.now(),
    });
  }
};

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  middlewares: RequestMiddlewareFn[];
}

export class RequestMiddlewarePipeline {
  private readonly middlewares: RequestMiddlewareFn[];

  constructor(options: PipelineOptions) {
    this.middlewares = options.middlewares;
  }

  /**
   * Execute a request through the full middleware chain.
   * Returns the raw `Response` object.
   */
  async execute(url: string, init: RequestInit = {}): Promise<Response> {
    const ctx: RequestContext = {
      url,
      options: {
        method: "GET",
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers as Record<string, string> ?? {}),
        },
      },
      startedAt: Date.now(),
      correlationId: generateCorrelationId(),
      retries: 0,
      cached: false,
      meta: {},
    };

    const middlewares = [...this.middlewares];

    const dispatch = (index: number): Promise<Response> => {
      if (index >= middlewares.length) {
        // Terminal — issue the real fetch
        return fetch(ctx.url, ctx.options);
      }
      const mw = middlewares[index];
      return mw(ctx, () => dispatch(index + 1));
    };

    return dispatch(0);
  }

  /**
   * Execute and parse the JSON body. Throws if the response is not ok.
   */
  async executeJson<T>(url: string, init: RequestInit = {}): Promise<{
    data: T;
    statusCode: number;
    latencyMs: number;
    correlationId: string;
    retries: number;
    cached: boolean;
  }> {
    const start = Date.now();
    const ctx: RequestContext = {
      url,
      options: {
        method: "GET",
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers as Record<string, string> ?? {}),
        },
      },
      startedAt: start,
      correlationId: generateCorrelationId(),
      retries: 0,
      cached: false,
      meta: {},
    };

    const middlewares = [...this.middlewares];
    const dispatch = (index: number): Promise<Response> => {
      if (index >= middlewares.length) {
        return fetch(ctx.url, ctx.options);
      }
      return middlewares[index](ctx, () => dispatch(index + 1));
    };

    const response = await dispatch(0);
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      const message = (errBody.message as string) ?? `HTTP ${response.status}`;
      throw Object.assign(new Error(message), {
        statusCode: response.status,
        correlationId: ctx.correlationId,
      });
    }

    const data = await response.json() as T;

    return {
      data,
      statusCode: response.status,
      latencyMs,
      correlationId: ctx.correlationId,
      retries: ctx.retries,
      cached: ctx.cached,
    };
  }
}
