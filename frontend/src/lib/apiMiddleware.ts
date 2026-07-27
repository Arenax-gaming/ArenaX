/**
 * apiMiddleware.ts — wires the request pipeline + response interceptor
 * into a unified API client that replaces direct fetch() calls in api.ts.
 *
 * Features added over the base ApiClient:
 *   - Correlation IDs on every request (X-Request-Id / X-Correlation-Id)
 *   - Retry with exponential back-off + jitter on 429/5xx
 *   - GET request deduplication (collapses parallel identical fetches)
 *   - Circuit breaker per backend host
 *   - Request analytics (emitted as "arenax:request:event" DOM events)
 *   - Response normalization via ResponseInterceptor (camelCase, meta, traceId)
 *   - StandardResponse<T> returned via `*Standard` methods
 *   - Error responses wrapped in StandardErrorResponse
 *
 * The `EnhancedApiClient` is intentionally additive — `ApiClient` in api.ts
 * continues to work unchanged for backward compatibility. New hooks and
 * components should prefer `enhancedApi`.
 */

"use client";

import {
  RequestMiddlewarePipeline,
  createAuthMiddleware,
  createRetryMiddleware,
  createCircuitBreakerMiddleware,
  correlationIdMiddleware,
  deduplicationMiddleware,
  analyticsMiddleware,
} from "./requestMiddleware";
import {
  ResponseInterceptor,
  buildErrorResponse,
  type InterceptedRequest,
} from "./responseInterceptor";
import type { StandardResponse, PaginatedStandardResponse } from "@/types/response";

// ---------------------------------------------------------------------------
// Token helpers (mirror api.ts — kept local to avoid circular imports)
// ---------------------------------------------------------------------------

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(REFRESH_TOKEN_KEY) ??
    sessionStorage.getItem(REFRESH_TOKEN_KEY)
  );
}

function updateStoredTokens(access: string, refresh: string): void {
  if (typeof window === "undefined") return;
  const inLocal = !!localStorage.getItem(TOKEN_KEY);
  const storage = inLocal ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, access);
  storage.setItem(REFRESH_TOKEN_KEY, refresh);
}

// ---------------------------------------------------------------------------
// EnhancedApiClient
// ---------------------------------------------------------------------------

export interface EnhancedApiClientOptions {
  baseURL?: string;
  /** Custom retry options forwarded to `createRetryMiddleware`. */
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  /** Circuit breaker threshold (consecutive failures to open). */
  circuitBreakerThreshold?: number;
  /** Circuit breaker open duration in ms. */
  circuitBreakerOpenMs?: number;
  /** Slow response threshold in ms for analytics (default 2000). */
  slowResponseThresholdMs?: number;
}

export class EnhancedApiClient {
  private readonly baseURL: string;
  private readonly pipeline: RequestMiddlewarePipeline;
  private readonly interceptor: ResponseInterceptor;

  // Shared in-flight refresh promise — shared with legacy ApiClient via module state
  private refreshPromise: Promise<string> | null = null;
  private onAuthFailure?: () => void;

  constructor(opts: EnhancedApiClientOptions = {}) {
    this.baseURL = opts.baseURL ?? (process.env.NEXT_PUBLIC_API_URL ?? "/api");

    this.interceptor = new ResponseInterceptor({
      config: {
        normalizeCasing: true,
        parseDates: false,
        stripNulls: false,
        analyticsEnabled: true,
        slowResponseThresholdMs: opts.slowResponseThresholdMs ?? 2_000,
      },
    });

    this.pipeline = new RequestMiddlewarePipeline({
      middlewares: [
        correlationIdMiddleware,
        createAuthMiddleware(getStoredToken),
        createRetryMiddleware({
          maxAttempts: opts.retry?.maxAttempts ?? 3,
          baseDelayMs: opts.retry?.baseDelayMs ?? 300,
          maxDelayMs: opts.retry?.maxDelayMs ?? 15_000,
        }),
        deduplicationMiddleware,
        createCircuitBreakerMiddleware({
          threshold: opts.circuitBreakerThreshold ?? 5,
          openDurationMs: opts.circuitBreakerOpenMs ?? 30_000,
        }),
        analyticsMiddleware,
      ],
    });
  }

  setOnAuthFailure(callback: () => void): void {
    this.onAuthFailure = callback;
  }

  // ---------------------------------------------------------------------------
  // Core request execution
  // ---------------------------------------------------------------------------

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) throw new Error("No refresh token available");

      const url = `${this.baseURL}/auth/refresh`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!resp.ok) throw new Error("Refresh failed");
      const data = await resp.json() as {
        access_token: string;
        refresh_token: string;
      };
      updateStoredTokens(data.access_token, data.refresh_token);
      return data.access_token;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Execute a request through the full middleware pipeline and response
   * interceptor. Returns the unwrapped `data` field for backward compatibility.
   */
  async request<T>(
    endpoint: string,
    init: RequestInit = {},
    _isRetry = false
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const start = Date.now();

    try {
      const response = await this.pipeline.execute(url, init);

      // 401 — attempt token refresh and retry once
      if (response.status === 401 && !_isRetry) {
        try {
          await this.refreshAccessToken();
        } catch {
          this.onAuthFailure?.();
          throw new Error("SESSION_EXPIRED");
        }
        return this.request<T>(endpoint, init, true);
      }

      const raw = await response.json().catch(() => null);
      const latencyMs = Date.now() - start;
      const traceId = response.headers.get("x-trace-id") ?? undefined;

      const intercepted: InterceptedRequest = {
        url,
        method: (init.method ?? "GET").toUpperCase(),
        statusCode: response.status,
        latencyMs,
        retries: 0, // retries tracked inside pipeline
        traceId,
      };

      if (!response.ok) {
        const errResponse = buildErrorResponse(
          {
            message: (raw as Record<string, unknown>)?.message as string ?? `HTTP ${response.status}`,
            statusCode: response.status,
            code: (raw as Record<string, unknown>)?.code as string,
          },
          intercepted
        );
        throw Object.assign(new Error(errResponse.error.message), {
          statusCode: response.status,
          traceId: errResponse.meta.traceId,
          code: errResponse.error.code,
        });
      }

      const standardResponse = this.interceptor.intercept<T>(raw, intercepted);
      // Return unwrapped data for backward compat
      return standardResponse.data as T;
    } catch (err) {
      if (err instanceof Error && err.message === "SESSION_EXPIRED") throw err;
      throw err;
    }
  }

  /**
   * Like `request` but returns the full `StandardResponse<T>` including meta,
   * traceId, latency, and transformation log.
   */
  async requestStandard<T>(
    endpoint: string,
    init: RequestInit = {}
  ): Promise<StandardResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    const start = Date.now();

    const response = await this.pipeline.execute(url, init);

    if (response.status === 401) {
      try {
        await this.refreshAccessToken();
      } catch {
        this.onAuthFailure?.();
        throw new Error("SESSION_EXPIRED");
      }
      return this.requestStandard<T>(endpoint, init);
    }

    const raw = await response.json().catch(() => null);
    const latencyMs = Date.now() - start;
    const traceId = response.headers.get("x-trace-id") ?? undefined;

    const intercepted: InterceptedRequest = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      statusCode: response.status,
      latencyMs,
      retries: 0,
      traceId,
    };

    if (!response.ok) {
      const errResponse = buildErrorResponse(
        {
          message: (raw as Record<string, unknown>)?.message as string ?? `HTTP ${response.status}`,
          statusCode: response.status,
          code: (raw as Record<string, unknown>)?.code as string,
        },
        intercepted
      );
      return {
        success: false,
        status: "error",
        data: null as unknown as T,
        message: errResponse.error.message,
        meta: errResponse.meta,
      };
    }

    return this.interceptor.intercept<T>(raw, intercepted);
  }

  /**
   * Like `requestStandard` but for paginated endpoints.
   */
  async requestPaginatedStandard<T>(
    endpoint: string,
    init: RequestInit = {}
  ): Promise<PaginatedStandardResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    const start = Date.now();

    const response = await this.pipeline.execute(url, init);
    const raw = await response.json().catch(() => null);
    const latencyMs = Date.now() - start;
    const traceId = response.headers.get("x-trace-id") ?? undefined;

    const intercepted: InterceptedRequest = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      statusCode: response.status,
      latencyMs,
      retries: 0,
      traceId,
    };

    return this.interceptor.interceptPaginated<T>(raw, intercepted);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const enhancedApi = new EnhancedApiClient();
