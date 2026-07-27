/**
 * ArenaX Enhanced API Client — Issue #693
 *
 * Features:
 * - Strongly-typed request/response wrappers
 * - Auth interceptor (token injection + refresh)
 * - Exponential-backoff retry logic for network/5xx errors
 * - Standardised error mapping (ApiError, NetworkError, ValidationError)
 * - Analytics/monitoring middleware (latency, success-rate tracking)
 * - Request deduplication via in-flight cache
 * - Response interceptor pipeline (normalization, transformation, governance)
 */

"use client";

import {
  ApiError,
  NetworkError,
  ValidationError,
  ArenaXError,
  ErrorCategory,
  ErrorSeverity,
} from "@/lib/errors";
import type { ApiResponse, PaginatedResponse } from "@/types";
import {
  responseInterceptor,
  type InterceptedRequest,
} from "@/lib/responseInterceptor";
import type { StandardResponse, PaginatedStandardResponse } from "@/types/response";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body */
  body?: unknown;
  /** Disable retry for this request */
  noRetry?: boolean;
  /** Override default timeout (ms) */
  timeoutMs?: number;
  /** Skip analytics tracking for this request */
  noAnalytics?: boolean;
  /** Additional query params appended to the URL */
  params?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Skip the response interceptor pipeline for this request.
   * Use only for internal calls (e.g. token refresh) that should not be
   * tracked or transformed.
   */
  skipInterceptor?: boolean;
}

export interface ClientConfig {
  baseURL: string;
  /** Default timeout in ms (default: 15 000) */
  timeoutMs?: number;
  /** Maximum retry attempts for retryable errors (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential back-off in ms (default: 500) */
  retryBaseDelayMs?: number;
  /** Max delay cap in ms (default: 16 000) */
  retryMaxDelayMs?: number;
}

export interface RequestMetrics {
  url: string;
  method: string;
  status: number | null;
  durationMs: number;
  success: boolean;
  retries: number;
  errorType?: string;
  timestamp: number;
}

// ─── In-memory metrics store (max 200 entries) ────────────────────────────────

const _metrics: RequestMetrics[] = [];
const MAX_METRICS = 200;

function recordMetric(m: RequestMetrics): void {
  _metrics.unshift(m);
  if (_metrics.length > MAX_METRICS) _metrics.length = MAX_METRICS;
}

export function getRequestMetrics(): readonly RequestMetrics[] {
  return _metrics;
}

export function getMetricsSummary(): {
  total: number;
  successCount: number;
  failureCount: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  successRate: number;
} {
  if (_metrics.length === 0) {
    return { total: 0, successCount: 0, failureCount: 0, averageLatencyMs: 0, p95LatencyMs: 0, successRate: 1 };
  }
  const successCount = _metrics.filter((m) => m.success).length;
  const failureCount = _metrics.length - successCount;
  const latencies = [..._metrics].map((m) => m.durationMs).sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] ?? 0;
  return {
    total: _metrics.length,
    successCount,
    failureCount,
    averageLatencyMs: Math.round(avg),
    p95LatencyMs: p95,
    successRate: successCount / _metrics.length,
  };
}

export function clearMetrics(): void {
  _metrics.length = 0;
}

// ─── Token storage helpers ────────────────────────────────────────────────────

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token");
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("refresh_token") ?? sessionStorage.getItem("refresh_token");
}

function storeTokens(access: string, refresh?: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("auth_token", access);
  if (refresh) localStorage.setItem("refresh_token", refresh);
}

function clearTokens(): void {
  if (typeof window === "undefined") return;
  ["auth_token", "refresh_token"].forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

// ─── Retry helpers ────────────────────────────────────────────────────────────

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError && error.statusCode != null) {
    return isRetryableStatus(error.statusCode);
  }
  return false;
}

function retryDelay(attempt: number, base: number, cap: number): number {
  if (cap === 0) return 0;
  const jitter = Math.random() * 200;
  return Math.min(base * Math.pow(2, attempt) + jitter, cap);
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

function buildURL(base: string, endpoint: string, params?: RequestOptions["params"]): string {
  const url = `${base}${endpoint}`;
  if (!params) return url;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) query.set(k, String(v));
  }
  const qs = query.toString();
  return qs ? `${url}?${qs}` : url;
}

// ─── Enhanced API Client ──────────────────────────────────────────────────────

export class EnhancedApiClient {
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  /** In-flight GET dedupe cache: url → Promise */
  private readonly _inFlight = new Map<string, Promise<unknown>>();
  /** Track whether a token refresh is in progress */
  private _refreshPromise: Promise<string | null> | null = null;

  constructor(config: ClientConfig) {
    this.baseURL = config.baseURL;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 500;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 16_000;
  }

  // ─── Token refresh ──────────────────────────────────────────────────────────

  private async refreshAccessToken(): Promise<string | null> {
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return null;
      try {
        const res = await fetch(`${this.baseURL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          clearTokens();
          return null;
        }
        const json = await res.json() as { accessToken?: string; tokens?: { accessToken: string; refreshToken?: string } };
        const accessToken =
          json?.accessToken ??
          json?.tokens?.accessToken ??
          null;
        if (accessToken) storeTokens(accessToken, json?.tokens?.refreshToken);
        return accessToken;
      } catch {
        return null;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  // ─── Core fetch with retry ──────────────────────────────────────────────────

  private async fetchWithRetry<T>(
    url: string,
    init: RequestInit,
    options: { noRetry?: boolean; noAnalytics?: boolean; skipInterceptor?: boolean },
    attempt = 0,
    requestStartTime = performance.now(),
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const startTime = attempt === 0 ? requestStartTime : performance.now();
    let status: number | null = null;
    let success = false;

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      status = response.status;

      // 401 → attempt token refresh once
      if (status === 401 && attempt === 0) {
        const newToken = await this.refreshAccessToken();
        if (newToken) {
          const retryInit: RequestInit = {
            ...init,
            headers: {
              ...(init.headers as Record<string, string>),
              Authorization: `Bearer ${newToken}`,
            },
          };
          return this.fetchWithRetry<T>(url, retryInit, options, attempt + 1, requestStartTime);
        }
        // Refresh failed — clear tokens and throw auth error
        clearTokens();
        throw new ApiError("Session expired. Please log in again.", 401, { url });
      }

      if (!response.ok) {
        let errorPayload: Record<string, unknown> = {};
        try {
          errorPayload = (await response.json()) as Record<string, unknown>;
        } catch { /* ignore parse errors */ }

        const message =
          (errorPayload?.error as { message?: string } | undefined)?.message ??
          (errorPayload?.message as string | undefined) ??
          `HTTP ${status}`;
        const code =
          (errorPayload?.error as { code?: string } | undefined)?.code ??
          (errorPayload?.code as string | undefined);

        if (status === 422 || status === 400) {
          const field = (errorPayload?.field as string | undefined);
          throw new ValidationError(message, field, { url, status, code });
        }
        throw new ApiError(message, status, { url, code });
      }

      const data = await response.json() as unknown;

      // ── Response interceptor pipeline ──────────────────────────────────
      if (!options.skipInterceptor) {
        const latencyMs = Math.round(performance.now() - requestStartTime);
        const traceId =
          response.headers.get("x-trace-id") ??
          response.headers.get("x-request-id") ??
          undefined;

        const interceptorRequest: InterceptedRequest = {
          url,
          method: (init.method ?? "GET").toUpperCase(),
          statusCode: status,
          latencyMs,
          retries: attempt,
          cached: false,
          traceId,
        };

        const standardResponse = responseInterceptor.intercept<T>(
          data,
          interceptorRequest,
        );

        success = true;
        // Return the raw transformed data (unwrapped from StandardResponse)
        // so existing callers (TanStack Query hooks) continue working unchanged.
        return standardResponse.data;
      }

      success = true;
      return data as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ArenaXError) {
        // Only retry for retryable errors
        if (
          !options.noRetry &&
          attempt < this.maxRetries &&
          isRetryableError(err)
        ) {
          const delay = retryDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
          await new Promise((r) => setTimeout(r, delay));
          return this.fetchWithRetry<T>(url, init, options, attempt + 1, requestStartTime);
        }
        throw err;
      }

      // AbortError → NetworkError (timeout)
      if (err instanceof Error && err.name === "AbortError") {
        const netErr = new NetworkError(`Request timed out after ${this.timeoutMs}ms`, { url });
        if (!options.noRetry && attempt < this.maxRetries) {
          const delay = retryDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
          await new Promise((r) => setTimeout(r, delay));
          return this.fetchWithRetry<T>(url, init, options, attempt + 1, requestStartTime);
        }
        throw netErr;
      }

      // Generic fetch failure (offline)
      if (err instanceof TypeError) {
        const netErr = new NetworkError(err.message, { url });
        if (!options.noRetry && attempt < this.maxRetries) {
          const delay = retryDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
          await new Promise((r) => setTimeout(r, delay));
          return this.fetchWithRetry<T>(url, init, options, attempt + 1, requestStartTime);
        }
        throw netErr;
      }

      throw new ArenaXError(
        err instanceof Error ? err.message : String(err),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.MEDIUM,
        { url },
      );
    } finally {
      if (!options.noAnalytics) {
        recordMetric({
          url,
          method: (init.method ?? "GET").toUpperCase(),
          status,
          durationMs: Math.round(performance.now() - startTime),
          success,
          retries: attempt,
          errorType: success ? undefined : status != null ? `HTTP_${status}` : "NETWORK",
          timestamp: Date.now(),
        });
      }
    }
  }

  // ─── Public request API ─────────────────────────────────────────────────────

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { body, noRetry, timeoutMs: _t, noAnalytics, params, skipInterceptor, ...fetchOpts } = options;
    const url = buildURL(this.baseURL, endpoint, params);
    const token = getStoredToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(fetchOpts.headers as Record<string, string> | undefined),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const init: RequestInit = {
      ...fetchOpts,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    return this.fetchWithRetry<T>(url, init, { noRetry, noAnalytics, skipInterceptor }, 0, performance.now());
  }

  /** GET with in-flight deduplication */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const url = buildURL(this.baseURL, endpoint, options?.params);
    const existing = this._inFlight.get(url);
    if (existing) return existing as Promise<T>;

    const promise = this.request<T>(endpoint, { ...options, method: "GET" });
    this._inFlight.set(url, promise);
    promise.finally(() => this._inFlight.delete(url));
    return promise;
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "POST", body });
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PUT", body });
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PATCH", body });
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  // ─── Convenience: unwrap standard { success, data } envelope ───────────────

  async getEnveloped<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const res = await this.get<ApiResponse<T>>(endpoint, options);
    return res.data;
  }

  async postEnveloped<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const res = await this.post<ApiResponse<T>>(endpoint, body, options);
    return res.data;
  }

  async getPaginated<T>(endpoint: string, options?: RequestOptions): Promise<PaginatedResponse<T>> {
    return this.get<PaginatedResponse<T>>(endpoint, options);
  }

  // ─── Token management (public for AuthProvider) ─────────────────────────────

  setTokens(access: string, refresh?: string): void {
    storeTokens(access, refresh);
  }

  clearAuth(): void {
    clearTokens();
  }

  // ─── Standard response API (returns full StandardResponse envelope) ─────────

  /**
   * Like `.get()` but returns the full `StandardResponse<T>` envelope,
   * including `meta`, `status`, and `message` fields.
   * Use when you need access to traceId, latency, or governance data.
   */
  async getStandard<T>(endpoint: string, options?: RequestOptions): Promise<StandardResponse<T>> {
    const url = buildURL(this.baseURL, endpoint, options?.params);
    const token = getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string> | undefined),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const startTime = performance.now();
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await response.json() as unknown;
    const latencyMs = Math.round(performance.now() - startTime);
    const traceId =
      response.headers.get("x-trace-id") ??
      response.headers.get("x-request-id") ??
      undefined;

    return responseInterceptor.intercept<T>(raw, {
      url,
      method: "GET",
      statusCode: response.status,
      latencyMs,
      retries: 0,
      cached: false,
      traceId,
    });
  }

  /**
   * Like `.getPaginated()` but returns the full `PaginatedStandardResponse<T>` envelope.
   */
  async getPaginatedStandard<T>(
    endpoint: string,
    options?: RequestOptions,
  ): Promise<PaginatedStandardResponse<T>> {
    const url = buildURL(this.baseURL, endpoint, options?.params);
    const token = getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string> | undefined),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const startTime = performance.now();
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await response.json() as unknown;
    const latencyMs = Math.round(performance.now() - startTime);
    const traceId =
      response.headers.get("x-trace-id") ??
      response.headers.get("x-request-id") ??
      undefined;

    return responseInterceptor.interceptPaginated<T>(raw, {
      url,
      method: "GET",
      statusCode: response.status,
      latencyMs,
      retries: 0,
      cached: false,
      traceId,
    });
  }
}

// ─── Singleton instance ───────────────────────────────────────────────────────

export const apiClient = new EnhancedApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "/api",
  timeoutMs: 15_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 16_000,
});
