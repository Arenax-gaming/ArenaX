# ArenaX Frontend — Error Handling Architecture

This document describes the complete error handling system for the ArenaX frontend.

---

## Table of Contents

1. [Overview](#overview)
2. [Error Types](#error-types)
3. [Error Logger](#error-logger)
4. [Error Boundaries](#error-boundaries)
5. [Error Recovery Hook](#error-recovery-hook)
6. [Error Provider & Context](#error-provider--context)
7. [Query Layer Integration](#query-layer-integration)
8. [Error Monitor Dashboard](#error-monitor-dashboard)
9. [Analytics & Monitoring](#analytics--monitoring)
10. [Testing](#testing)
11. [Decision Log](#decision-log)

---

## Overview

The error handling system is built around three principles:

| Principle | Implementation |
|-----------|---------------|
| **Structured errors** | All application errors extend `ArenaXError` with `category` and `severity` |
| **Single source of truth** | `errorLogger` singleton captures every error — boundaries, hooks, query cache |
| **Progressive disclosure** | Full-page → page-section → inline, depending on how critical the failure is |

```
                    ┌────────────────────────────────────┐
                    │          ErrorBoundary             │  ← full-page, wraps locale layout
                    │   (src/components/ui)              │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼─────────────────────┐
                    │       PageErrorBoundary            │  ← per-page, lightweight
                    │   (src/components/common)          │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼─────────────────────┐
                    │     SectionErrorBoundary           │  ← per-widget, inline fallback
                    │   (src/components/common)          │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼─────────────────────┐
                    │       useErrorRecovery             │  ← async retry / back-off
                    │   (src/hooks)                      │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼─────────────────────┐
                    │          errorLogger               │  ← structured logging + analytics
                    │   (src/lib/errorLogger.ts)         │
                    └────────────────────────────────────┘
```

---

## Error Types

**File:** `src/lib/errors.ts`

### Base class

```ts
new ArenaXError(message, category?, severity?, metadata?)
```

All application errors extend `ArenaXError`, which attaches:
- `category: ErrorCategory` — what part of the system failed
- `severity: ErrorSeverity` — how serious the failure is
- `metadata?: Record<string, unknown>` — arbitrary structured context

### Specialised subclasses

| Class | Category | Default Severity | Use when |
|-------|----------|-----------------|----------|
| `NetworkError` | `NETWORK` | `HIGH` | fetch/XHR failure, offline |
| `AuthenticationError` | `AUTHENTICATION` | `HIGH` | 401 / expired token |
| `ValidationError` | `VALIDATION` | `LOW` | form input is invalid |
| `ApiError` | `API` | `HIGH` (5xx) / `MEDIUM` (4xx) | API endpoint returned an error status |

### Enums

```ts
enum ErrorCategory { NETWORK, AUTHENTICATION, VALIDATION, RUNTIME, API, UNKNOWN }
enum ErrorSeverity { LOW, MEDIUM, HIGH, CRITICAL }
```

### Recovery strategies

```ts
getRecoveryStrategy(category: ErrorCategory): RecoveryStrategy | null
```

Returns `null` for non-retryable categories (`AUTHENTICATION`, `VALIDATION`, `UNKNOWN`).
Returns a `RecoveryStrategy` for retryable categories:

| Category | maxAttempts | baseDelayMs | Exponential | maxDelayMs |
|----------|-------------|-------------|-------------|-----------|
| NETWORK | 3 | 1 000 | ✓ | 15 000 |
| API | 2 | 2 000 | ✓ | 10 000 |
| RUNTIME | 1 | 500 | ✗ | 500 |

---

## Error Logger

**File:** `src/lib/errorLogger.ts`

A singleton `errorLogger` instance is created at module load time.  It:

1. Captures `window.error` and `unhandledrejection` globally
2. Persists up to 100 recent errors in `localStorage` (`arenax_errors`)
3. Emits structured console output scaled to severity (error / warn / info)
4. Fires `gtag("event", "exception", …)` if Google Analytics is present
5. Calls `DD_RUM.addError(…)` if Datadog RUM is initialised

### API

```ts
// Convenience functions
logError(error: Error, metadata?)    // log + return LoggedError
getLoggedErrors()                    // return all stored errors
clearLoggedErrors()                  // wipe storage
getErrorSummary()                    // return ErrorSummary counts

// Singleton methods
errorLogger.recordRecoveryAttempt(id, succeeded)
errorLogger.getErrorsByCategory(category)
errorLogger.getErrorsBySeverity(severity)
errorLogger.getRecentErrors(windowMs?)     // default 60 s
errorLogger.getSummary()                   // ErrorSummary
```

### LoggedError shape

```ts
interface LoggedError {
  id: string;           // e.g. "1720000000000-x7k3m"
  timestamp: number;    // unix ms
  message: string;
  stack?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata?: Record<string, unknown>;
  recoveryAttempts?: number;
  recovered?: boolean;
}
```

---

## Error Boundaries

### `ErrorBoundary` — full-page

**File:** `src/components/ui/ErrorBoundary.tsx`

Wraps the entire locale layout.  Catches any render error that escapes inner boundaries.  Shows a full-screen fallback with context-aware actions (Retry, Go Home, Report, Sign In for auth errors).

```tsx
<ErrorBoundary fallback={<CustomFallback />} onError={handler}>
  {children}
</ErrorBoundary>
```

### `PageErrorBoundary` — per-page

**File:** `src/components/common/PageErrorBoundary.tsx`

Lightweight boundary for individual pages.  Uses the shared `PageError` component.

```tsx
<PageErrorBoundary title="Tournament Page Error">
  <TournamentDetail />
</PageErrorBoundary>
```

### `SectionErrorBoundary` — inline widget

**File:** `src/components/common/SectionErrorBoundary.tsx`

Use this around individual panels, cards, or data-fetching widgets so one widget failure never breaks the whole page.  Shows a compact inline fallback with up to 3 retries.

```tsx
<SectionErrorBoundary label="Match Feed">
  <MatchFeedWidget />
</SectionErrorBoundary>
```

Props:

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string?` | Section name shown in the fallback, e.g. `"Match Feed"` |
| `fallback` | `ReactNode?` | Custom fallback overrides the default UI |
| `className` | `string?` | Extra Tailwind classes on the wrapper |
| `onError` | `(error, info) => void` | Optional error callback |

### `ErrorBoundaryWithRetry` — configurable retries

**File:** `src/components/common/ErrorBoundaryWithRetry.tsx`

A design-system–compliant boundary with a configurable `maxRetries` prop.  After all retries are exhausted it shows either a custom `fallback` or a "contact support" message.

```tsx
<ErrorBoundaryWithRetry maxRetries={2}>
  <HeavyWidget />
</ErrorBoundaryWithRetry>
```

### `MobileErrorBoundary` — mobile-specific

**File:** `src/components/ui/MobileErrorBoundary.tsx`

Identical to `ErrorBoundary` but tuned for mobile: maps error categories to mobile-friendly messages (network, timeout, offline, auth) using the shared `determineErrorCategory` utility.

---

## Error Recovery Hook

**File:** `src/hooks/useErrorRecovery.ts`

```tsx
const { execute, status, attempts, error, loggedError, reset, isRetryable } =
  useErrorRecovery<TResult>(options?);
```

Wraps any `() => Promise<T>` with automatic retry and exponential back-off.

### Options

```ts
interface UseErrorRecoveryOptions {
  strategy?: Partial<RecoveryStrategy>;  // override defaults per-call
  onExhausted?: (error: Error, attempts: number) => void;
  onRecovered?: (attempts: number) => void;
}
```

### Status transitions

```
idle → (execute called)
  → succeeded          (no error or recovered)
  → retrying           (error caught, attempt < max)
  → failed             (non-retryable OR attempts exhausted)
```

### Example

```tsx
function TournamentList() {
  const { execute, status, error } = useErrorRecovery<Tournament[]>({
    onExhausted: (err) => toast.error(`Could not load tournaments: ${err.message}`),
  });

  const load = useCallback(
    () => execute(() => api.getTournaments()),
    [execute],
  );

  useEffect(() => { load(); }, [load]);

  if (status === "retrying") return <Spinner label="Retrying…" />;
  if (status === "failed") return <PageError message={error?.message} onRetry={load} />;
  // …
}
```

---

## Error Provider & Context

**File:** `src/components/providers/ErrorProvider.tsx`

Wraps the app and exposes a React context for components that need to imperatively log errors or read the error list.

```tsx
const { errors, addError, clearErrors, getByCategory, getBySeverity, summary } = useError();
```

The `summary` field (`ErrorSummary`) is updated after every `addError` / `clearErrors` call and is consumed by `ErrorMonitorDashboard`.

---

## Query Layer Integration

**File:** `src/components/providers/QueryProvider.tsx`

`QueryClient` is configured with `QueryCache` and `MutationCache` global error handlers that call `logError` for every failed query or mutation.  This means all TanStack Query errors are automatically tracked without any per-call boilerplate.

```ts
// Behind the scenes — no action needed from feature developers
queryCache: new QueryCache({
  onError: (error, query) => logError(error, { queryKey: … }),
}),
mutationCache: new MutationCache({
  onError: (error, _, __, mutation) => logError(error, { mutationKey: … }),
}),
```

---

## Error Monitor Dashboard

**File:** `src/components/common/ErrorMonitorDashboard.tsx`

A read-only developer/admin component that visualises all logged errors.

Features:
- Summary cards: total, last-60s, critical+high, recovered
- Per-category count grid
- Filterable error list (by category and severity)
- Expandable rows showing stack trace, metadata, recovery status
- Clear and Refresh controls

Usage (e.g. in `/analytics` or an admin page):

```tsx
import { ErrorMonitorDashboard } from "@/components/common/ErrorMonitorDashboard";

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <ErrorMonitorDashboard />
    </div>
  );
}
```

> **Note:** Do not render this component for end-users in production.  Guard it behind an admin role check.

---

## Analytics & Monitoring

Every logged error is dispatched to the following sinks automatically by `errorLogger`:

| Sink | Condition | Data sent |
|------|-----------|-----------|
| `console.error/warn/info` | Always (dev + prod) | Error object + metadata |
| Google Analytics (`gtag`) | If `window.gtag` is present | `exception` event with `fatal`, `error_id`, `error_severity` |
| Datadog RUM (`DD_RUM`) | If `window.DD_RUM` is present | `addError` with `errorId`, `category`, `severity` |

To integrate an additional sink (e.g. Sentry):

```ts
import { errorLogger } from "@/lib/errorLogger";

errorLogger.setOnError((entry) => {
  Sentry.captureException(new Error(entry.message), {
    extra: { errorId: entry.id, category: entry.category },
  });
});
```

---

## Testing

### Test files

| File | What it covers |
|------|---------------|
| `src/__tests__/error-handling.test.ts` | `ArenaXError` + subclasses, utility functions, recovery strategies, `errorLogger` |
| `src/__tests__/error-boundaries.test.tsx` | All four boundary components (render, catch, retry, callbacks) |
| `src/__tests__/error-recovery.test.tsx` | `useErrorRecovery` hook (success, retry, exhaustion, non-retryable, reset) |

### Running tests

```bash
# All tests (single run)
npm test -- --testPathPattern="error"

# Watch mode
npm run test:watch
```

### Writing new tests

When testing components that use error boundaries, suppress React's expected `console.error` output:

```ts
const spy = jest.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => spy.mockRestore());
```

Use fake timers when testing `useErrorRecovery` to avoid real delays:

```ts
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.runAllTimers(); jest.useRealTimers(); });
```

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Single `errorLogger` singleton | Avoids React context overhead for pure logging; boundaries and hooks can both call it without a provider |
| Exponential back-off in `useErrorRecovery` | Prevents thundering-herd against a flaky API |
| `SectionErrorBoundary` separate from `ErrorBoundaryWithRetry` | Different concerns: section boundary is for UI isolation; retry boundary is for transient failures |
| `determineErrorCategory` shared across all boundaries | Single place to update keyword heuristics; previously each boundary duplicated this logic |
| `QueryCache`/`MutationCache` global handlers | Zero-boilerplate — every TanStack Query error is logged without modifying individual `useQuery` calls |
| No automatic retry for `AUTHENTICATION` / `VALIDATION` | Auth errors need user action (sign in); validation errors are deterministic and would just fail again |
