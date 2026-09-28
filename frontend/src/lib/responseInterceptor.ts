/**
 * ArenaX — Response Interceptor
 *
 * Central pipeline that processes every raw API response before it reaches
 * the application. Responsibilities:
 *
 *  1. Envelope normalization   — ensure { success, data, message } shape
 *  2. Data transformation      — camelCase keys, date parsing, null pruning
 *  3. Metadata injection       — latency, traceId, requestPath, retries
 *  4. Governance enforcement   — policy checks with violation recording
 *  5. Analytics emission       — per-request performance events
 *  6. Monitoring               — rolling window of response statistics
 *
 * The interceptor is intentionally framework-agnostic: it takes a plain
 * `InterceptedRequest` descriptor and a raw response value, and returns a
 * `StandardResponse<T>`.  The `EnhancedApiClient` calls it at the end of
 * `fetchWithRetry`.
 */

"use client";

import type {
  StandardResponse,
  StandardErrorResponse,
  ResponseMeta,
  PaginatedStandardResponse,
  PaginationMeta,
  ResponseAnalyticsEvent,
  ResponseMonitorSnapshot,
  InterceptorConfig,
  GovernancePolicy,
} from "@/types/response";
import {
  transformValue,
  buildTransformationLog,
  type TransformerOptions,
} from "./responseTransformer";
import { runGovernance, type GovernanceRunnerOptions } from "./responseGovernance";

// ─── Internal types ───────────────────────────────────────────────────────────

/**
 * Descriptor passed by the API client to the interceptor.
 * Contains everything needed to build `ResponseMeta`.
 */
export interface InterceptedRequest {
  /** Full request URL. */
  url: string;
  /** HTTP method. */
  method: string;
  /** HTTP status code actually received. */
  statusCode: number;
  /** Round-trip latency in ms (measured by the client). */
  latencyMs: number;
  /** How many retry attempts were made. */
  retries: number;
  /** Whether the response was served from the in-flight dedup cache. */
  cached?: boolean;
  /** Trace / correlation ID from response header (X-Trace-Id). */
  traceId?: string;
}

// ─── Trace ID generator ───────────────────────────────────────────────────────

let _traceCounter = 0;

function generateTraceId(): string {
  _traceCounter = (_traceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `tx-${Date.now().toString(36)}-${_traceCounter.toString(36)}`;
}

// ─── Path extraction ──────────────────────────────────────────────────────────

/** Strips origin + query string, keeping only the path (e.g. /tournaments/1). */
function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    // url is already a relative path
    return url.split("?")[0] ?? url;
  }
}

// ─── Analytics store ──────────────────────────────────────────────────────────

const MAX_ANALYTICS_EVENTS = 500;
const _analyticsEvents: ResponseAnalyticsEvent[] = [];

function recordAnalyticsEvent(event: ResponseAnalyticsEvent): void {
  _analyticsEvents.unshift(event);
  if (_analyticsEvents.length > MAX_ANALYTICS_EVENTS) {
    _analyticsEvents.length = MAX_ANALYTICS_EVENTS;
  }
}

export function getAnalyticsEvents(): readonly ResponseAnalyticsEvent[] {
  return _analyticsEvents;
}

export function clearAnalyticsEvents(): void {
  _analyticsEvents.length = 0;
}

// ─── Monitoring store ─────────────────────────────────────────────────────────

const MAX_MONITOR_WINDOW = 200;
const _monitorWindow: ResponseAnalyticsEvent[] = [];
const _errorsByCode: Record<string, number> = {};
const _latencyByEndpoint: Record<string, number[]> = {};

function updateMonitor(event: ResponseAnalyticsEvent): void {
  _monitorWindow.unshift(event);
  if (_monitorWindow.length > MAX_MONITOR_WINDOW) _monitorWindow.pop();

  if (!event.success) {
    const code = String(event.statusCode);
    _errorsByCode[code] = (_errorsByCode[code] ?? 0) + 1;
  }

  const path = event.endpoint;
  if (!_latencyByEndpoint[path]) _latencyByEndpoint[path] = [];
  _latencyByEndpoint[path].push(event.latencyMs);
  // Keep at most 50 samples per endpoint
  if (_latencyByEndpoint[path].length > 50) _latencyByEndpoint[path].shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.floor((sorted.length * p) / 100),
    sorted.length - 1,
  );
  return sorted[idx] ?? 0;
}

export function getMonitorSnapshot(): ResponseMonitorSnapshot {
  const total = _monitorWindow.length;
  if (total === 0) {
    return {
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      cachedCount: 0,
      successRate: 1,
      averageLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      slowRequestCount: 0,
      slowRequestRate: 0,
      errorsByCode: {},
      latencyByEndpoint: {},
      lastUpdated: Date.now(),
    };
  }

  const successCount = _monitorWindow.filter((e) => e.success).length;
  const cachedCount = _monitorWindow.filter((e) => e.cached).length;
  const slowCount = _monitorWindow.filter((e) => e.slow).length;
  const latencies = [..._monitorWindow]
    .map((e) => e.latencyMs)
    .sort((a, b) => a - b);

  const avgLatency =
    latencies.reduce((s, v) => s + v, 0) / latencies.length;

  // Compute average latency per endpoint
  const latencyByEndpoint: Record<string, number> = {};
  for (const [ep, samples] of Object.entries(_latencyByEndpoint)) {
    latencyByEndpoint[ep] =
      Math.round(samples.reduce((s, v) => s + v, 0) / samples.length);
  }

  return {
    totalRequests: total,
    successCount,
    errorCount: total - successCount,
    cachedCount,
    successRate: successCount / total,
    averageLatencyMs: Math.round(avgLatency),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    slowRequestCount: slowCount,
    slowRequestRate: slowCount / total,
    errorsByCode: { ..._errorsByCode },
    latencyByEndpoint,
    lastUpdated: Date.now(),
  };
}

export function clearMonitor(): void {
  _monitorWindow.length = 0;
  Object.keys(_errorsByCode).forEach((k) => delete _errorsByCode[k]);
  Object.keys(_latencyByEndpoint).forEach((k) => delete _latencyByEndpoint[k]);
}

// ─── Raw response envelope detection ─────────────────────────────────────────

interface RawEnvelope {
  success?: boolean;
  data?: unknown;
  message?: string;
  // Pagination
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  total_pages?: number;
}

function isRawEnvelope(value: unknown): value is RawEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("data" in value || "success" in value)
  );
}

function isPaginatedRawEnvelope(value: unknown): value is RawEnvelope & { data: unknown[] } {
  return (
    isRawEnvelope(value) &&
    Array.isArray((value as RawEnvelope).data) &&
    (typeof (value as RawEnvelope).total === "number" ||
      typeof (value as RawEnvelope).totalPages === "number" ||
      typeof (value as RawEnvelope).total_pages === "number")
  );
}

// ─── Response Interceptor class ───────────────────────────────────────────────

export interface ResponseInterceptorOptions {
  config?: InterceptorConfig;
  governance?: GovernanceRunnerOptions & { extraPolicies?: GovernancePolicy[] };
}

export class ResponseInterceptor {
  private readonly config: Required<InterceptorConfig>;
  private readonly governanceOptions: GovernanceRunnerOptions;

  constructor(options: ResponseInterceptorOptions = {}) {
    const cfg = options.config ?? {};
    this.config = {
      normalizeCasing: cfg.normalizeCasing ?? true,
      parseDates: cfg.parseDates ?? false,
      stripNulls: cfg.stripNulls ?? false,
      maxCacheAgeMs: cfg.maxCacheAgeMs ?? 0,
      analyticsEnabled: cfg.analyticsEnabled ?? true,
      slowResponseThresholdMs: cfg.slowResponseThresholdMs ?? 2_000,
    };
    this.governanceOptions = options.governance ?? {};
  }

  // ─── Main intercept method ──────────────────────────────────────────────────

  /**
   * Apply the configured payload transforms (casing, dates, nulls) to a raw
   * value WITHOUT wrapping it in a `StandardResponse` envelope or running
   * governance/analytics. Used by the API client to return the payload
   * exactly as the server sent it, so envelope-aware callers such as
   * `getEnveloped()` can unwrap the envelope themselves.
   */
  transform<T>(raw: unknown): T {
    const transformOptions: TransformerOptions = {
      normalizeCasing: this.config.normalizeCasing,
      parseDates: this.config.parseDates,
      stripNulls: this.config.stripNulls,
    };
    return transformValue(raw, transformOptions) as T;
  }

  /**
   * Process a raw API response through the full pipeline.
   *
   * @param raw     The parsed JSON value returned by the API client.
   * @param request Descriptor with timing and routing metadata.
   * @returns A `StandardResponse<T>` with normalized data and injected meta.
   */
  intercept<T>(raw: unknown, request: InterceptedRequest): StandardResponse<T> {
    const traceId = request.traceId ?? generateTraceId();
    const path = extractPath(request.url);

    // ── Build transformation options ──────────────────────────────────────
    const transformOptions: TransformerOptions = {
      normalizeCasing: this.config.normalizeCasing,
      parseDates: this.config.parseDates,
      stripNulls: this.config.stripNulls,
    };

    const transformations = buildTransformationLog(transformOptions);

    // ── Normalize the raw envelope ────────────────────────────────────────
    let data: unknown;
    let message: string | undefined;
    let success: boolean;

    if (isRawEnvelope(raw)) {
      data = raw.data;
      message = raw.message;
      success = raw.success ?? (request.statusCode >= 200 && request.statusCode < 300);
    } else {
      // Raw value with no envelope (e.g. auth endpoints returning { user, tokens })
      data = raw;
      message = undefined;
      success = request.statusCode >= 200 && request.statusCode < 300;
    }

    // ── Apply data transformations ────────────────────────────────────────
    const transformedData = transformValue(data, transformOptions) as T;

    // ── Build metadata ────────────────────────────────────────────────────
    const meta: ResponseMeta = {
      receivedAt: new Date().toISOString(),
      latencyMs: request.latencyMs,
      statusCode: request.statusCode,
      requestPath: path,
      requestMethod: request.method.toUpperCase(),
      traceId,
      retries: request.retries,
      cached: request.cached ?? false,
      transformations,
    };

    const response: StandardResponse<T> = {
      success,
      status: success ? "success" : "error",
      data: transformedData,
      message,
      meta,
    };

    // ── Governance checks ─────────────────────────────────────────────────
    runGovernance(response as StandardResponse, meta, this.governanceOptions);

    // ── Analytics + monitoring ────────────────────────────────────────────
    if (this.config.analyticsEnabled) {
      let payloadBytes: number | undefined;
      try {
        payloadBytes = new TextEncoder().encode(JSON.stringify(transformedData)).length;
      } catch {
        // ignore
      }

      const isSlow = request.latencyMs > this.config.slowResponseThresholdMs;

      const analyticsEvent: ResponseAnalyticsEvent = {
        traceId,
        endpoint: path,
        method: request.method.toUpperCase(),
        statusCode: request.statusCode,
        latencyMs: request.latencyMs,
        success,
        retries: request.retries,
        cached: request.cached ?? false,
        timestamp: Date.now(),
        payloadBytes,
        slow: isSlow,
      };

      recordAnalyticsEvent(analyticsEvent);
      updateMonitor(analyticsEvent);

      if (isSlow && process.env.NODE_ENV === "development") {
        console.warn(
          `[ArenaX Response] Slow response: ${request.method.toUpperCase()} ${path} took ${request.latencyMs}ms`,
        );
      }
    }

    return response;
  }

  /**
   * Process a raw paginated API response.
   *
   * Expects the raw value to include `total`, `page`, `limit`, `totalPages`
   * alongside a `data` array. Falls back gracefully if pagination fields are absent.
   */
  interceptPaginated<T>(
    raw: unknown,
    request: InterceptedRequest,
  ): PaginatedStandardResponse<T> {
    const base = this.intercept<T[]>(raw, request);

    let pagination: PaginationMeta;

    if (isPaginatedRawEnvelope(raw)) {
      const totalPages = raw.totalPages ?? raw.total_pages ?? 1;
      const page = raw.page ?? 1;
      pagination = {
        page,
        limit: raw.limit ?? 20,
        total: raw.total ?? 0,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    } else {
      // Non-paginated response wrapped as paginated
      const items = Array.isArray(base.data) ? base.data : [];
      pagination = {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      };
    }

    return { ...base, pagination };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const responseInterceptor = new ResponseInterceptor({
  config: {
    normalizeCasing: true,
    parseDates: false,          // Keep dates as strings (SSR hydration safety)
    stripNulls: false,
    analyticsEnabled: true,
    slowResponseThresholdMs: 2_000,
  },
});

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Build a `StandardErrorResponse` for failed requests.
 * Used by the API client when it catches an error before the response is parsed.
 */
export function buildErrorResponse(
  error: { message: string; statusCode?: number; code?: string; field?: string },
  request: Omit<InterceptedRequest, "statusCode"> & { statusCode?: number },
): StandardErrorResponse {
  const path = extractPath(request.url);
  const meta: ResponseMeta = {
    receivedAt: new Date().toISOString(),
    latencyMs: request.latencyMs,
    statusCode: request.statusCode ?? 0,
    requestPath: path,
    requestMethod: request.method.toUpperCase(),
    traceId: request.traceId ?? generateTraceId(),
    retries: request.retries,
    cached: request.cached ?? false,
    transformations: [],
  };

  return {
    success: false,
    status: "error",
    error: {
      code: error.code ?? "UNKNOWN_ERROR",
      message: error.message,
      field: error.field,
      statusCode: error.statusCode,
    },
    meta,
  };
}
