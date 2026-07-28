# ArenaX Data Layer — `src/data`

> **Issue #693** — Implements the frontend data layer: API client, caching, and error handling.

---

## Overview

```
src/data/
├── apiClient.ts   — Enhanced fetch wrapper with interceptors, retries, analytics
├── queries.ts     — TanStack Query v5 hooks for every API resource
└── index.ts       — Public barrel export
```

---

## API Client (`apiClient.ts`)

### Features

| Feature | Detail |
|---|---|
| **Auth interceptor** | Injects `Authorization: Bearer <token>` from `localStorage` / `sessionStorage` |
| **Token refresh** | Automatically retries a 401 with a refreshed token; clears tokens on refresh failure |
| **Exponential-backoff retry** | Retries on `5xx` / `429` / network errors with jitter; configurable attempts & delays |
| **In-flight deduplication** | Concurrent `GET`s to the same URL share one `fetch` promise |
| **Standard error types** | Maps HTTP status codes → `ApiError`, `NetworkError`, `ValidationError` |
| **Request analytics** | Tracks latency, success/failure counts, and per-request metrics in memory |
| **Timeout** | Per-request AbortController; default 15 s |

### Usage

```ts
import { apiClient } from "@/data";

// GET (returns raw JSON)
const data = await apiClient.get("/tournaments");

// GET with unwrapped { success, data } envelope
const tournament = await apiClient.getEnveloped<Tournament>("/tournaments/123");

// POST
const created = await apiClient.post<Tournament>("/tournaments", { name: "Grand Prix" });

// PATCH, PUT, DELETE
await apiClient.patch("/users/me", { bio: "Pro gamer" });
await apiClient.delete("/notifications/456");

// With query params
const list = await apiClient.get("/tournaments", {
  params: { status: "active", page: 1, limit: 20 }
});
```

### Configuration

```ts
import { EnhancedApiClient } from "@/data";

const customClient = new EnhancedApiClient({
  baseURL: "https://api.myapp.com",
  timeoutMs: 10_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 16_000,
});
```

### Error Handling

```ts
import { apiClient } from "@/data";
import { ApiError, NetworkError, ValidationError } from "@/lib/errors";

try {
  await apiClient.post("/auth/login", credentials);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error("Field error:", err.field, err.message);
  } else if (err instanceof ApiError) {
    console.error("API error:", err.statusCode, err.message);
  } else if (err instanceof NetworkError) {
    console.error("Network unreachable");
  }
}
```

### Metrics / Monitoring

```ts
import { getRequestMetrics, getMetricsSummary } from "@/data";

const metrics = getRequestMetrics();       // Full log (last 200 requests)
const summary = getMetricsSummary();       // { total, successCount, successRate, averageLatencyMs, p95LatencyMs }
```

---

## Query Hooks (`queries.ts`)

Built on **TanStack Query v5**. All hooks share a consistent stale-time strategy:

| Category | Stale time | Notes |
|---|---|---|
| Active matches / Notifications | 15 s | Refetches every 15 s |
| Tournaments / Leaderboard | 1 min | Semi-live data |
| Profiles / Governance | 5 min | Mostly static |

### Query Keys (`QK`)

Typed constant map for precise cache invalidation:

```ts
import { QK } from "@/data";

queryClient.invalidateQueries({ queryKey: QK.tournaments.all });
queryClient.invalidateQueries({ queryKey: QK.matches.detail("match-123") });
```

### Example: Tournaments

```tsx
import { useTournaments, useJoinTournament } from "@/data";

function TournamentList() {
  const { data, isLoading, error } = useTournaments({ status: "active", page: 1 });
  const join = useJoinTournament({
    onSuccess: () => toast.success("Joined!"),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return data?.data.map((t) => (
    <TournamentCard
      key={t.id}
      tournament={t}
      onJoin={() => join.mutate(t.id)}
    />
  ));
}
```

### Example: Profile

```tsx
import { useCurrentProfile, useUpdateProfile } from "@/data";

function ProfilePage() {
  const { data: profile } = useCurrentProfile();
  const update = useUpdateProfile();

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      update.mutate({ bio: "New bio" });
    }}>
      <p>{profile?.username}</p>
      <button type="submit">Save</button>
    </form>
  );
}
```

### Cache Invalidation

```tsx
import { useCacheInvalidation } from "@/data";

function AdminPanel() {
  const cache = useCacheInvalidation();

  return (
    <button onClick={cache.invalidateTournaments}>
      Refresh Tournaments
    </button>
  );
}
```

---

## Testing

Tests live in `src/__tests__/apiClient.test.ts`.

```bash
cd frontend
npx jest apiClient.test.ts
```

Test coverage:
- ✅ Successful GET / POST / PATCH / DELETE
- ✅ Auth header injection
- ✅ Error mapping (ApiError, ValidationError, NetworkError)
- ✅ Retry on 5xx (up to maxRetries)
- ✅ No-retry on 400/422
- ✅ In-flight request deduplication
- ✅ Metric recording (success, failure, latency)
- ✅ `noAnalytics` bypass
