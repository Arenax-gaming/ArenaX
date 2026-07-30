# ArenaX Middleware Architecture

## Overview

Every API call flows through two composable pipelines — one for outgoing
requests and one for incoming responses.

```
Component / Hook
      │
      ▼
EnhancedApiClient.request()   ← apiMiddleware.ts
      │
      ▼  ── RequestMiddlewarePipeline ──────────────────────────────────────
      │   1. correlationIdMiddleware   attach X-Request-Id / X-Correlation-Id
      │   2. createAuthMiddleware      inject Bearer token
      │   3. createRetryMiddleware     exponential back-off + jitter on 5xx/429
      │   4. deduplicationMiddleware   collapse identical in-flight GETs
      │   5. createCircuitBreakerMiddleware  open circuit on N failures
      │   6. analyticsMiddleware       record latency + status per request
      │
      ▼  ── fetch() ──────────────────────────────────────────────────────
      │
      ▼  ── ResponseInterceptor ────────────────────────────────────────────
      │   1. Envelope normalisation    unwrap { success, data, message }
      │   2. Data transformation       camelCase keys, date parsing, null pruning
      │   3. Metadata injection        traceId, latencyMs, requestPath, retries
      │   4. Governance policies       structural + performance rules
      │   5. Analytics recording       rolling window + per-request events
      │
      ▼
  StandardResponse<T>  (or unwrapped T for backward compat)
```

---

## Files

| File | Purpose |
|---|---|
| `src/lib/requestMiddleware.ts` | Outgoing request pipeline — middlewares + `RequestMiddlewarePipeline` |
| `src/lib/apiMiddleware.ts` | `EnhancedApiClient` — wires pipeline + interceptor, exposes `enhancedApi` singleton |
| `src/lib/responseInterceptor.ts` | Incoming response pipeline — `ResponseInterceptor`, analytics, monitoring |
| `src/lib/responseTransformer.ts` | Data transformation utilities (camelCase, dates, null pruning) |
| `src/lib/responseGovernance.ts` | Policy engine + violation store |
| `src/lib/__tests__/middleware.test.ts` | 31 tests for the request pipeline |

---

## Request Middleware

### Built-in middlewares

#### `correlationIdMiddleware`
Attaches `X-Request-Id` and `X-Correlation-Id` headers to every outgoing
request using an auto-generated ID. Lets distributed traces be correlated
across client → API gateway → backend logs.

```ts
import { correlationIdMiddleware } from "@/lib/requestMiddleware";
```

#### `createAuthMiddleware(getToken, authPaths?)`
Reads the current Bearer token and injects `Authorization: Bearer <token>`.
Skips injection on `authPaths` (default: `["/auth/"]`) to avoid
circular 401 loops during login / registration.

```ts
import { createAuthMiddleware } from "@/lib/requestMiddleware";
const authMw = createAuthMiddleware(() => localStorage.getItem("auth_token"));
```

#### `createRetryMiddleware(options?)`
Retries failed requests with exponential back-off and jitter.

| Option | Default | Description |
|---|---|---|
| `maxAttempts` | `3` | Total attempts (including initial) |
| `baseDelayMs` | `300` | Base wait before first retry |
| `maxDelayMs` | `15 000` | Cap on computed delay |
| `jitter` | `0.15` | Random fraction added to prevent thundering herd |
| `retryOn` | `[429, 502, 503, 504]` | Status codes that trigger retry |

```ts
import { createRetryMiddleware } from "@/lib/requestMiddleware";
const retryMw = createRetryMiddleware({ maxAttempts: 3, baseDelayMs: 500 });
```

#### `deduplicationMiddleware`
Collapses multiple simultaneous GET requests to the same URL into a single
`fetch()` call. All callers receive the same response clone. Non-GET
requests always pass through unmodified.

```ts
import { deduplicationMiddleware } from "@/lib/requestMiddleware";
```

#### `createCircuitBreakerMiddleware(options?)`
Tracks consecutive failures per backend host. When failures reach
`threshold` the circuit opens and all subsequent requests return a
synthetic `503` immediately (fast-fail) for `openDurationMs` ms.

| Option | Default | Description |
|---|---|---|
| `threshold` | `5` | Consecutive failures to open |
| `openDurationMs` | `30 000` | Duration of open state in ms |

```ts
import { createCircuitBreakerMiddleware, getCircuitState, resetCircuits } from "@/lib/requestMiddleware";
const cbMw = createCircuitBreakerMiddleware({ threshold: 3, openDurationMs: 10_000 });

// Inspect state
const state = getCircuitState("api.arenax.gg"); // { failures, openedAt }
resetCircuits(); // clear all (useful in tests)
```

#### `analyticsMiddleware`
Must be registered **last** so it measures the total round-trip time
including all other middlewares. Emits `RequestAnalyticsEvent` objects
both to an in-memory buffer and as a DOM custom event
`"arenax:request:event"`.

```ts
import { analyticsMiddleware, getRequestAnalyticsEvents } from "@/lib/requestMiddleware";
const events = getRequestAnalyticsEvents(); // newest first, max 300
```

---

### `RequestMiddlewarePipeline`

Compose middlewares and execute requests.

```ts
import {
  RequestMiddlewarePipeline,
  correlationIdMiddleware,
  createAuthMiddleware,
  createRetryMiddleware,
  deduplicationMiddleware,
  createCircuitBreakerMiddleware,
  analyticsMiddleware,
} from "@/lib/requestMiddleware";

const pipeline = new RequestMiddlewarePipeline({
  middlewares: [
    correlationIdMiddleware,
    createAuthMiddleware(() => getToken()),
    createRetryMiddleware({ maxAttempts: 3 }),
    deduplicationMiddleware,
    createCircuitBreakerMiddleware({ threshold: 5 }),
    analyticsMiddleware,
  ],
});

// Raw Response
const response = await pipeline.execute("/api/tournaments");

// Parsed JSON + metadata
const { data, statusCode, latencyMs, correlationId } =
  await pipeline.executeJson<Tournament[]>("/api/tournaments");
```

### Custom middleware

A middleware is just an `async` function `(ctx, next) => Response`:

```ts
import type { RequestMiddlewareFn } from "@/lib/requestMiddleware";

const timingMiddleware: RequestMiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  const resp = await next();
  console.log(`${ctx.options.method} ${ctx.url} — ${Date.now() - start}ms`);
  return resp;
};

// Short-circuit (e.g., return cached value without calling next)
const cacheMiddleware: RequestMiddlewareFn = async (ctx, next) => {
  const cached = cache.get(ctx.url);
  if (cached) {
    ctx.cached = true;
    return new Response(JSON.stringify(cached), { status: 200 });
  }
  const resp = await next();
  cache.set(ctx.url, await resp.clone().json());
  return resp;
};
```

---

## `EnhancedApiClient`

Pre-wired client with the full middleware stack + response interceptor.
Use `enhancedApi` singleton for new code; the legacy `api` singleton
from `api.ts` continues to work unchanged.

```ts
import { enhancedApi, EnhancedApiClient } from "@/lib/apiMiddleware";

// Unwrapped data — backward compatible with TanStack Query hooks
const tournaments = await enhancedApi.request<Tournament[]>("/tournaments");

// Full StandardResponse — includes meta, traceId, latency
const response = await enhancedApi.requestStandard<Tournament>("/tournaments/123");
console.log(response.meta.latencyMs);   // round-trip ms
console.log(response.meta.traceId);     // correlation ID
console.log(response.meta.retries);     // retry count

// Paginated
const paged = await enhancedApi.requestPaginatedStandard<Tournament>("/tournaments");
console.log(paged.pagination.totalPages);
console.log(paged.pagination.hasNextPage);
```

Custom instance with overrides:

```ts
const strictClient = new EnhancedApiClient({
  baseURL: "https://api.arenax.gg/v1",
  retry: { maxAttempts: 2, baseDelayMs: 200 },
  circuitBreakerThreshold: 3,
  circuitBreakerOpenMs: 15_000,
  slowResponseThresholdMs: 1_000,
});
```

---

## Request Analytics

Each request emits a `RequestAnalyticsEvent`:

```ts
interface RequestAnalyticsEvent {
  correlationId: string;
  url: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  retries: number;
  cached: boolean;
  success: boolean;
  blocked: boolean;   // true when circuit breaker blocked the request
  timestamp: number;
}
```

Subscribe from an analytics provider:

```ts
window.addEventListener("arenax:request:event", (e) => {
  const event = (e as CustomEvent<RequestAnalyticsEvent>).detail;
  datadog.track("api.request", event);
});
```

Or read the buffer directly:

```ts
import { getRequestAnalyticsEvents } from "@/lib/requestMiddleware";
const recent = getRequestAnalyticsEvents(); // newest first, max 300
```

---

## Error Handling

The pipeline propagates errors as thrown `Error` objects with extra fields:

```ts
try {
  await enhancedApi.request("/missing");
} catch (err) {
  // err.message   — server error message
  // err.statusCode — HTTP status code
  // err.traceId   — correlation ID for the failed request
  // err.code      — machine-readable error code from the API
}
```

401 handling:
1. Middleware pipeline gets a `401` response
2. `EnhancedApiClient` attempts a silent token refresh
3. If refresh succeeds → retry the original request once
4. If refresh fails → calls `onAuthFailure()` and throws `SESSION_EXPIRED`

```ts
enhancedApi.setOnAuthFailure(() => {
  router.push("/login?reason=session_expired");
});
```

---

## Middleware Monitoring

```ts
import { getMonitorSnapshot, getAnalyticsEvents } from "@/lib/responseInterceptor";
import { getRequestAnalyticsEvents } from "@/lib/requestMiddleware";

// Response-side snapshot (success rate, p95 latency, errors by code)
const snap = getMonitorSnapshot();
console.log(snap.successRate, snap.p95LatencyMs, snap.errorsByCode);

// Per-request response events (newest first)
const responseEvents = getAnalyticsEvents();

// Per-request outgoing events (newest first)
const requestEvents = getRequestAnalyticsEvents();
```

See `src/lib/RESPONSE_INTERCEPTOR.md` for the full response monitoring API
including the `useResponseMonitor` React hook.

---

## Testing

```bash
# Request pipeline tests (31 tests)
npx jest --testPathPattern="middleware.test" --forceExit

# Response interceptor tests (existing)
npx jest --testPathPattern="responseInterceptor.test" --forceExit
```

**Test coverage:**

| Area | Tests |
|---|---|
| `correlationIdMiddleware` | 1 |
| `createAuthMiddleware` | 3 |
| `createRetryMiddleware` | 4 |
| `deduplicationMiddleware` | 2 |
| `createCircuitBreakerMiddleware` | 4 |
| `analyticsMiddleware` | 4 |
| `RequestMiddlewarePipeline` | 5 |
| `EnhancedApiClient` | 7 |
| Integration (full chain) | 1 |
