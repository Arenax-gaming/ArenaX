# ArenaX Advanced Hooks Library

## Overview

The `src/hooks/` directory provides 47 custom React hooks organized into six categories. This document covers the **advanced hooks** added in issue #691: state management, data fetching, side effects, analytics, and optimization.

---

## Hook Categories

| Category | Hooks |
|---|---|
| **State Management** | `useLocalStorage`, `useOptimisticState`, `useStateMachine` |
| **Data Fetching** | `usePaginatedQuery`, `usePolling` |
| **Side Effects** | `useInterval`, `useTimeout`, `useClipboard` |
| **Analytics** | `useHookAnalytics` |
| **Existing — Auth** | `useAuth` |
| **Existing — Data** | `useMatches`, `useTournaments`, `useGovernance`, `useReputation`, `useSocial`, `useLeaderboard`, `useAchievements` |
| **Existing — UI** | `useSearch`, `useInfiniteScroll`, `useDataTable`, `useVirtualScrollAnalytics` |
| **Existing — Network** | `useNetworkStatus`, `useMatchWebSocket`, `useCollaboration` |

---

## State Management Hooks

### `useLocalStorage<T>`

Persistent state backed by `localStorage` with cross-tab sync and SSR safety.

```ts
import { useLocalStorage } from "@/hooks/useLocalStorage";

// Simple value
const [theme, setTheme, removeTheme] = useLocalStorage("theme", "dark");

// With a type validator (discards invalid stored values)
const isNumber = (v: unknown): v is number => typeof v === "number";
const [elo, setElo] = useLocalStorage("elo", 1200, { validate: isNumber });

// Updater function
setTheme((prev) => prev === "dark" ? "light" : "dark");

// Remove from storage and reset to initialValue
removeTheme();
```

**Features:**
- Reads from `localStorage` on mount (SSR-safe: returns `initialValue` during SSR)
- Persists on every state change
- Cross-tab sync via the `storage` event
- Optional `validate` guard — discards stale/malformed stored values
- Custom `serialize`/`deserialize` functions for non-JSON storage

**API:**
```ts
function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: {
    validate?: (value: unknown) => value is T;
    serialize?: (value: T) => string;
    deserialize?: (raw: string) => T;
  }
): [T, (value: T | ((prev: T) => T)) => void, () => void]
```

---

### `useOptimisticState<T>`

Optimistic UI state with automatic rollback on async failure.

```ts
import { useOptimisticState } from "@/hooks/useOptimisticState";

const { value, update, isPending, error } = useOptimisticState(
  initialTournament,
  (next) => api.updateTournament(next.id, next),
  {
    onSuccess: (next, prev) => toast("Saved!"),
    onError: (err, attempted, rolledBack) => toast.error(err.message),
  }
);

// Applies update to UI immediately, confirms with server
await update({ ...currentTournament, name: "New Name" });
```

**Features:**
- Zero-latency UI update — applied before the async call resolves
- Automatic rollback to the last server-confirmed value on failure
- `isPending` flag for loading indicators
- `onSuccess` / `onError` callbacks
- Queue-aware: multiple concurrent updates tracked correctly
- `reset(value)` to force both optimistic and confirmed state

**API:**
```ts
function useOptimisticState<T>(
  initialValue: T,
  asyncOperation: (next: T) => Promise<T | void>,
  options?: {
    onSuccess?: (next: T, prev: T) => void;
    onError?: (error: Error, attempted: T, rolledBackTo: T) => void;
    rollbackDelayMs?: number;
  }
): {
  value: T;
  confirmedValue: T;
  update: (nextValue: T) => Promise<boolean>;
  isPending: boolean;
  error: Error | null;
  clearError: () => void;
  reset: (value: T) => void;
}
```

---

### `useStateMachine<S, E>`

Lightweight finite state machine for complex async UI flows.

```ts
import { useStateMachine, MATCH_FLOW_CONFIG } from "@/hooks/useStateMachine";

// Use the built-in match flow
const machine = useStateMachine(MATCH_FLOW_CONFIG, "idle");
machine.send("LOAD");       // idle → loading
machine.send("LOADED");     // loading → active
machine.send("DISPUTE");    // active → disputed

// Check state
machine.is("disputed");     // true
machine.can("RESOLVE");     // true
machine.state;              // "disputed"
machine.availableEvents;    // ["RESOLVE", "COMPLETE"]
machine.history;            // last 20 transitions
machine.reset();            // back to "idle"
```

**Built-in configs:**

`MATCH_FLOW_CONFIG` — the full match lifecycle:
```
idle → loading → active → reporting → active
                        → disputed → active
                                   → completed
      loading → error → loading (retry)
```

**Custom machine:**
```ts
import { useStateMachine, StateConfig } from "@/hooks/useStateMachine";

type S = "draft" | "review" | "published" | "archived";
type E = "SUBMIT" | "APPROVE" | "REJECT" | "ARCHIVE";

const config: StateConfig<S, E> = {
  transitions: {
    draft:     { SUBMIT:  { target: "review" } },
    review:    {
      APPROVE: { target: "published" },
      REJECT:  { target: "draft" },
    },
    published: { ARCHIVE: { target: "archived" } },
    archived:  {},
  },
  onEnter: (state) => console.log("entered", state),
  historyLimit: 50,
};

const machine = useStateMachine(config, "draft");
```

**Transition guards:**
```ts
APPROVE: {
  target: "published",
  guard: (ctx) => (ctx as { approvals: number }).approvals >= 2,
  action: (from, to) => notifyPublished(),
}
```

---

## Data Fetching Hooks

### `usePaginatedQuery<T>`

Page/offset pagination with next-page prefetching, built on TanStack Query.

```ts
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";

const {
  data,
  page,
  totalPages,
  total,
  isLoading,
  isFetching,
  isFirstPage,
  isLastPage,
  hasNextPage,
  hasPrevPage,
  goToNext,
  goToPrev,
  goToPage,
  reset,
} = usePaginatedQuery({
  queryKey: ["tournaments", filters],
  queryFn: (page, pageSize) =>
    api.getTournaments({ page, limit: pageSize }),
  pageSize: 20,
  initialPage: 1,
  prefetchNext: true,
});
```

**Your `queryFn` can return either:**
- `PaginatedResponse<T>` — `{ data, total, page, pageSize, totalPages }`
- `T[]` — treated as a single page with `totalPages = 1`

**Features:**
- Automatic next-page prefetch in the background
- `placeholderData` keeps previous page visible while fetching
- Navigation helpers: `goToNext`, `goToPrev`, `goToPage(n)`
- Derived flags: `isFirstPage`, `isLastPage`, `hasNextPage`, `hasPrevPage`

---

### `usePolling<T>`

Periodic data fetching with tab-visibility awareness and pause/resume.

```ts
import { usePolling } from "@/hooks/usePolling";

const { data, isPolling, isLoading, error, pause, resume, refetch } =
  usePolling({
    fn: () => api.getMatchStatus(matchId),
    interval: 3000,          // poll every 3s
    pauseOnError: true,      // stop on first failure
    pauseOnHidden: true,     // pause when tab is hidden
    onUpdate: (status) => {
      if (status.completed) pause();
    },
  });

// Manual controls
pause();   // stop
resume();  // restart
refetch(); // immediate fetch without resetting interval
```

**Features:**
- Auto-pauses when `document.hidden` (tab hidden / window minimized)
- `pauseOnError` prevents hammering a down service
- `immediate: false` to skip the first fetch on mount
- `onUpdate` and `onError` callbacks

---

## Side Effect Hooks

### `useInterval` / `useTimeout`

Declarative, safe wrappers around `setInterval` / `setTimeout`.

```ts
import { useInterval, useTimeout } from "@/hooks/useInterval";

// Count every second, pause/resume manually
const { isRunning, pause, resume, reset } = useInterval(
  () => setCount((c) => c + 1),
  1000
);

// Pass null to disable without unmounting
useInterval(callback, isPaused ? null : 500);

// Fire once after 3s
const { cancel } = useTimeout(() => setToast(null), 3000);
```

**`useInterval` features:**
- Always calls the latest version of the callback (ref pattern — no stale closures)
- `delay: null` pauses without unmounting
- Manual `pause()`, `resume()`, `reset()`
- `isRunning` state flag

**`useTimeout` features:**
- `cancel()` to abort before firing
- `reset()` to restart the timer
- `delay: null` is a no-op (safe to pass conditionally)

---

### `useClipboard`

Copy text to the clipboard with feedback state and automatic reset.

```ts
import { useClipboard } from "@/hooks/useClipboard";

const { copy, hasCopied, value, error } = useClipboard({ resetAfterMs: 2000 });

// In JSX
<button onClick={() => copy(shareUrl)}>
  {hasCopied ? "Copied!" : "Share"}
</button>
```

**Features:**
- Uses modern `navigator.clipboard.writeText` with `document.execCommand` fallback
- `hasCopied` resets automatically after `resetAfterMs` ms (default 2000)
- `value` holds the last successfully copied string
- `error` captures permission or API failures

---

## Analytics Hooks

### `useHookAnalytics`

Instruments any custom hook with mount/unmount tracking, operation timers, error tracking, and feature flag events — without coupling to any specific analytics provider.

```ts
import { useHookAnalytics } from "@/hooks/useHookAnalytics";

function useTournaments() {
  const analytics = useHookAnalytics("useTournaments");
  // mount/unmount events are tracked automatically

  const load = async () => {
    const timer = analytics.startTimer("fetchTournaments");
    try {
      const data = await api.getTournaments();
      timer.end({ count: data.length });
      return data;
    } catch (err) {
      analytics.trackError(err, "fetchTournaments");
      timer.end({ error: true });
      throw err;
    }
  };

  return { load };
}
```

**Events dispatched** as `"arenax:hook:event"` custom DOM events:

| `eventType` | Fired when |
|---|---|
| `mount` | Hook renders for the first time |
| `unmount` | Hook's component unmounts |
| `operation_start` | `startTimer(name)` called |
| `operation_end` | `timer.end()` called, includes `durationMs` |
| `error` | `trackError(err)` called |
| `feature_activated` | `trackFeature(name)` called |

**Subscribing to events** (e.g., from an analytics provider):
```ts
import { subscribeToHookAnalytics } from "@/hooks/useHookAnalytics";

const unsub = subscribeToHookAnalytics((event) => {
  myAnalytics.track(event.eventType, {
    hook: event.hookName,
    operation: event.operation,
    duration: event.durationMs,
    ...event.metadata,
  });
});

// later
unsub();
```

---

## Hook Optimization Patterns

### Stable callbacks with `useCallback`

All hooks use `useCallback` for functions exposed in their return values, preventing unnecessary re-renders in child components.

### Ref pattern for latest callback

Hooks that register event listeners (intervals, timeouts, WebSocket handlers) store the callback in a `useRef` and read from it at call time. This means you never need to add the callback to a `useEffect` dependency array or worry about stale closures.

```ts
// Pattern used throughout — e.g., useInterval, usePolling
const callbackRef = useRef(callback);
callbackRef.current = callback; // always latest
```

### Concurrent update tracking (`useOptimisticState`)

`pendingCountRef` tracks in-flight async operations as a count rather than a boolean, so concurrent updates don't flip `isPending` to `false` prematurely.

### `placeholderData` for smooth pagination

`usePaginatedQuery` passes `placeholderData: (prev) => prev` to TanStack Query, keeping the previous page's data visible in the UI while the next page loads — eliminating loading flicker between page changes.

---

## Testing

All advanced hooks are tested in `src/__tests__/advanced-hooks.test.ts`:

```bash
npx jest --testPathPattern="advanced-hooks" --forceExit
```

**49 tests, 9 test suites:**

| Suite | Tests |
|---|---|
| `useLocalStorage` | 8 |
| `useOptimisticState` | 6 |
| `useStateMachine` | 10 |
| `usePolling` | 6 |
| `useInterval` | 4 |
| `useTimeout` | 3 |
| `useClipboard` | 5 |
| `useHookAnalytics` | 6 |
| *(shared setup)* | 1 |

---

## Adding a New Hook

1. Create `src/hooks/useMyHook.ts`
2. Add `"use client";` directive if it uses browser APIs or React state
3. Export named function(s) — no default exports
4. Add JSDoc with `@example`
5. Add tests in `src/__tests__/advanced-hooks.test.ts` (or a new file)
6. Add an entry to this document

**Checklist:**
- [ ] All returned functions wrapped in `useCallback`
- [ ] No stale closure risk in `useEffect` / `setInterval` (use ref pattern)
- [ ] SSR-safe: guard all `window`/`document`/`localStorage` access with `typeof window !== "undefined"`
- [ ] `"use client"` added if any browser API is used
- [ ] Tests cover: happy path, error path, cleanup on unmount
