# ArenaX Response Interceptor

Consistent, observable, and governed API response handling for the ArenaX frontend.

---

## Overview

Every HTTP response from the backend now flows through a **pipeline** before reaching application code:

```
Raw fetch response
       │
       ▼
 Envelope detection     ← unwrap { success, data, message }
       │
       ▼
 Data transformation    ← camelCase keys, date parsing, null pruning
       │
       ▼
 Metadata injection     ← latencyMs, traceId, requestPath, retries
       │
       ▼
 Governance policies    ← structural + performance rules
       │
       ▼
 Analytics recording    ← per-request events + rolling window
       │
       ▼
 StandardResponse<T>    ← returned to TanStack Query / caller
```

---

## Files

| File | Purpose |
|---|---|
| `src/types/response.ts` | All TypeScript types for the pipeline |
| `src/lib/responseTransformer.ts` | Data transformation utilities |
| `src/lib/responseGovernance.ts` | Policy engine + violation store |
| `src/lib/responseInterceptor.ts` | Core interceptor class + analytics |
| `src/hooks/useResponseMonitor.ts` | React hooks for monitoring data |
| `src/data/apiClient.ts` | Wired into `EnhancedApiClient` |

---

## Standard Response Shape

Every successful response is normalized to:

```typescript
interface StandardResponse<T> {
  success: boolean;
  status: "success" | "error" | "partial";
  data: T;           // transformed payload
  message?: string;  // optional server message
  meta: {
    receivedAt: string;   // ISO-8601 client timestamp
    latencyMs: number;    // round-trip time
    statusCode: number;   // HTTP status
    requestPath: string;  // /path/to/endpoint (no origin/query)
    requestMethod: string;
    traceId: string;      // from X-Trace-Id header or auto-generated
    retries: number;
    cached: boolean;
    transformations: string[]; // applied pipeline stages
  };
}
```

Paginated responses add:

```typescript
interface PaginatedStandardResponse<T> extends StandardResponse<T[]> {
  pagination: {
    page: number; limit: number; total: number;
    totalPages: number; hasNextPage: boolean; hasPrevPage: boolean;
  };
}
```

---

## Using the Interceptor Directly

The singleton `responseInterceptor` is pre-configured with sensible defaults and is used automatically by `EnhancedApiClient` (`apiClient`). You can create a custom instance for special use cases:

```typescript
import { ResponseInterceptor } from "@/lib/responseInterceptor";

const myInterceptor = new ResponseInterceptor({
  config: {
    normalizeCasing: true,
    parseDates: true,       // parse ISO date strings → Date objects
    stripNulls: true,       // remove null/undefined leaves
    slowResponseThresholdMs: 1_000,
  },
});

const result = myInterceptor.intercept<MyType>(rawJson, {
  url: "https://api.arenax.gg/matches/123",
  method: "GET",
  statusCode: 200,
  latencyMs: 85,
  retries: 0,
});
```

---

## Getting the Full Envelope (with meta)

By default the `apiClient` unwraps the `data` field for backward-compatibility with TanStack Query hooks. Use the `*Standard` methods to get the full `StandardResponse`:

```typescript
import { apiClient } from "@/data/apiClient";

// Full StandardResponse<Tournament> — includes meta, traceId, latency
const response = await apiClient.getStandard<Tournament>("/tournaments/123");
console.log(response.meta.latencyMs);
console.log(response.meta.traceId);

// Full PaginatedStandardResponse<Tournament>
const paginatedResponse = await apiClient.getPaginatedStandard<Tournament>("/tournaments");
console.log(paginatedResponse.pagination.totalPages);
```

---

## Data Transformation

The transformer (`responseTransformer.ts`) normalizes raw payloads:

| Option | Default | Effect |
|---|---|---|
| `normalizeCasing` | `true` | `snake_case` keys → `camelCase` |
| `parseDates` | `false` | ISO-8601 strings → `Date` objects (key must match `*_at`, `*At`, `*Date`, etc.) |
| `stripNulls` | `false` | Remove `null`/`undefined` leaf values |
| `coerceNumbers` | `false` | Numeric strings → numbers |

> **Why parseDates defaults to false?**  
> Parsing strings to `Date` objects during SSR can cause React hydration mismatches. Enable it only on pure client-side queries.

```typescript
import { defaultTransform, fullTransform } from "@/lib/responseTransformer";

// camelCase only (fast path)
const data = defaultTransform<MyType>(rawPayload);

// All transformations
const data = fullTransform<MyType>(rawPayload, { parseDates: true, stripNulls: true });
```

---

## Governance Policies

Built-in policies run against every response:

| Policy | Severity | Rule |
|---|---|---|
| `envelope-shape` | warn | Response must have a `success` field |
| `success-status-mismatch` | warn | 2xx status but `success: false` |
| `payload-size` | warn | Payload > 500 KB — consider pagination |
| `rate-limit` | warn | HTTP 429 received |
| `latency-threshold` | error | Round-trip > 10 seconds |

Add custom policies:

```typescript
import { ResponseInterceptor } from "@/lib/responseInterceptor";
import type { GovernancePolicy } from "@/types/response";

const sensitiveDataPolicy: GovernancePolicy = {
  name: "no-password-in-response",
  severity: "critical",
  validate(response) {
    const json = JSON.stringify(response.data);
    if (json.includes('"password"')) return "Response contains a password field";
    return null;
  },
};

const secureInterceptor = new ResponseInterceptor({
  governance: {
    extraPolicies: [sensitiveDataPolicy],
    throwOnCritical: true,       // throw in dev/CI on critical violations
  },
});
```

Query violations:

```typescript
import {
  getGovernanceViolations,
  getGovernanceSummary,
  getViolationsBySeverity,
} from "@/lib/responseGovernance";

const all = getGovernanceViolations();         // newest first, max 100
const summary = getGovernanceSummary();        // aggregates + top offenders
const errors = getViolationsBySeverity("error");
```

---

## Response Monitoring

### `useResponseMonitor` hook

```tsx
import { useResponseMonitor } from "@/hooks/useResponseMonitor";

function MonitorDashboard() {
  const { snapshot, events, governance, refresh, startPolling } =
    useResponseMonitor({ autoStart: true, pollIntervalMs: 3_000 });

  return (
    <div>
      <p>Success rate: {(snapshot.successRate * 100).toFixed(1)}%</p>
      <p>p95 latency: {snapshot.p95LatencyMs}ms</p>
      <p>Slow requests: {snapshot.slowRequestCount}</p>
      <p>Governance violations: {governance.summary.totalViolations}</p>
    </div>
  );
}
```

### `useResponseSnapshot` (lightweight)

```tsx
import { useResponseSnapshot } from "@/hooks/useResponseMonitor";

function StatusBar() {
  const snap = useResponseSnapshot(5_000);
  return <span>{(snap.successRate * 100).toFixed(0)}% OK</span>;
}
```

### `useRecentResponseEvents`

```tsx
import { useRecentResponseEvents } from "@/hooks/useResponseMonitor";

function RecentRequestsTable() {
  const events = useRecentResponseEvents(20, 2_000);
  return (
    <table>
      {events.map((e) => (
        <tr key={e.traceId}>
          <td>{e.method}</td>
          <td>{e.endpoint}</td>
          <td>{e.latencyMs}ms</td>
          <td>{e.statusCode}</td>
        </tr>
      ))}
    </table>
  );
}
```

### Raw access (outside React)

```typescript
import { getMonitorSnapshot, getAnalyticsEvents } from "@/lib/responseInterceptor";

const snap   = getMonitorSnapshot();
const events = getAnalyticsEvents();   // newest first, max 500
```

---

## Analytics Events

Each request emits a `ResponseAnalyticsEvent`:

```typescript
interface ResponseAnalyticsEvent {
  traceId: string;
  endpoint: string;        // path only, no origin/query
  method: string;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  retries: number;
  cached: boolean;
  timestamp: number;
  payloadBytes?: number;   // approximate response size
  slow: boolean;           // latency > slowResponseThresholdMs
}
```

---

## Configuration Reference

```typescript
interface InterceptorConfig {
  normalizeCasing?: boolean;         // default: true
  parseDates?: boolean;              // default: false
  stripNulls?: boolean;              // default: false
  maxCacheAgeMs?: number;            // default: 0
  analyticsEnabled?: boolean;        // default: true
  slowResponseThresholdMs?: number;  // default: 2000
}
```

The singleton instance (`responseInterceptor`) is configured with production-safe defaults. Override via `new ResponseInterceptor({ config: {...} })` for custom scenarios.
