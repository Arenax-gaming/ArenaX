# ArenaX Utility Library (`src/lib/`)

## Overview

The `src/lib/` directory contains all shared utility functions, helper libraries, and common services. All utilities are pure functions (no side effects) unless marked `"use client"`, tree-shakeable, and tested.

---

## Module Map

| Module | Description |
|---|---|
| `string.ts` | String utilities: case, truncation, validation, generation, security |
| `array.ts` | Array utilities: deduplication, grouping, sorting, set ops, aggregation |
| `object.ts` | Deep clone, merge, diff, pick/omit, path access, transformation |
| `async.ts` | Retry, debounce, throttle, memoize, timeout, deferred, batch |
| `number.ts` | Clamp, format, ELO, random, interpolation, math helpers |
| `datetime.ts` | Format, relative time, arithmetic, predicates, tournament helpers |
| `performance.ts` | Measurement, rate limiter, idle/frame scheduling, lib analytics |
| `utils.ts` | `cn()`, `formatCurrency`, `formatDate`, `truncateText` (existing) |
| `typeGuards.ts` | Runtime type guards for all domain types (existing) |
| `errors.ts` | Error classes, categories, recovery strategies (existing) |
| `errorLogger.ts` | Error logging, global handlers, analytics sink (existing) |
| `api.ts` | API client with auth, refresh, interceptors (existing) |
| `analytics.ts` | Analytics service with adapters and consent (existing) |
| `seo.ts` | Metadata, structured data, Open Graph helpers (existing) |

---

## `string.ts`

### Case conversion
```ts
toCamelCase("hello_world")       // "helloWorld"
toSnakeCase("helloWorld")        // "hello_world"
toKebabCase("helloWorld")        // "hello-world"
toTitleCase("hello world")       // "Hello World"
toSentenceCase("HELLO WORLD")    // "Hello world"
humanize("myFieldName")          // "My Field Name"
```

### Truncation & padding
```ts
truncate("Hello World", 8)                          // "Hello W…"
truncate("Hello World foo", 10, { breakOnWord: true }) // "Hello…"
padStart("42", 5, "0")                              // "00042"
```

### Search & manipulation
```ts
countOccurrences("banana", "a")          // 3
countOccurrences("Banana", "a", true)    // 3 (case-insensitive)
replaceAll("a.b.c", ".", "-")            // "a-b-c"
reverseString("abc")                     // "cba"
highlight("hello world", "world")        // "hello <mark>world</mark>"
```

### Validation
```ts
isAlphanumeric("abc123")  // true
isEmail("user@x.com")     // true
isUrl("https://x.com")    // true
isNumericString("42")     // true
```

### Generation & formatting
```ts
randomString(12)                     // "aBcDeFgHiJkL"
slugify("Hello World! 2025")         // "hello-world-2025"
interpolate("Hi {{name}}!", { name: "ArenaX" }) // "Hi ArenaX!"
escapeHtml("<script>alert('xss')</script>")
formatBytes(1536)                    // "1.5 KB"
maskSensitive("1234567890", 4)       // "••••••7890"
getInitials("John Doe")              // "JD"
```

---

## `array.ts`

### Deduplication
```ts
unique([1, 2, 1, 3])                              // [1, 2, 3]
uniqueBy([{id:1,n:"a"},{id:1,n:"b"}], x => x.id) // [{id:1,n:"a"}]
```

### Partitioning & filtering
```ts
partition([1,2,3,4,5], n => n % 2 === 0)  // [[2,4], [1,3,5]]
compact([0, 1, null, "x", undefined])      // [1, "x"]
chunk([1,2,3,4,5], 2)                      // [[1,2],[3,4],[5]]
```

### Grouping
```ts
groupBy(["a","bb","ccc","dd"], s => s.length)
// Map { 1 => ["a"], 2 => ["bb","dd"], 3 => ["ccc"] }

groupByObject(items, item => item.status)
// { active: [...], inactive: [...] }
```

### Sorting
```ts
sortBy([{n:3},{n:1},{n:2}], x => x.n)     // [{n:1},{n:2},{n:3}]
sortByDesc([{n:3},{n:1}], x => x.n)       // [{n:3},{n:1}]
shuffle([1,2,3,4,5])                       // random order
```

### Set operations
```ts
intersection([1,2,3], [2,3,4])     // [2,3]
difference([1,2,3], [2,3])         // [1]
union([1,2], [2,3])                // [1,2,3]
symmetricDifference([1,2,3],[3,4]) // [1,2,4]
```

### Aggregation
```ts
sum([1,2,3,4])                          // 10
sumBy([{v:2},{v:3}], x => x.v)         // 5
mean([1,2,3,4,5])                       // 3
median([1,2,3,4])                       // 2.5
minBy(items, x => x.score)             // item with lowest score
range(0, 10, 2)                        // [0,2,4,6,8]
```

---

## `object.ts`

### Deep clone & merge
```ts
const b = deepClone(a)              // structural clone, no shared references
deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 99 } })
// { a: { x: 1, y: 99 } }          — non-mutating
```

### Deep equality & diff
```ts
deepEqual({ a: [1,2] }, { a: [1,2] })   // true
shallowDiff({ a:1, b:2 }, { b:99, c:3 })
// { added: {c:3}, removed: {a:1}, changed: {b:{from:2,to:99}} }
```

### Pick / omit
```ts
pick({ a:1, b:2, c:3 }, ["a","c"])  // { a:1, c:3 }
omit({ a:1, b:2, c:3 }, ["b"])      // { a:1, c:3 }
```

### Path access
```ts
getIn({ a: { b: { c: 42 } } }, "a.b.c")        // 42
getIn({}, "a.b.c", "default")                   // "default"
setIn({ a: { b: 1 } }, "a.b", 99)              // { a: { b: 99 } }
```

### Transformation
```ts
invertObject({ a: "1", b: "2" })       // { "1":"a", "2":"b" }
mapValues({ a:1, b:2 }, v => v * 2)   // { a:2, b:4 }
filterObject({ a:1, b:2, c:3 }, v => v > 1) // { b:2, c:3 }
compactObject({ a:1, b:null, c:undefined }) // { a:1 }
```

---

## `async.ts`

### retry
```ts
const data = await retry(
  () => api.getTournaments(),
  { attempts: 3, delayMs: 500, exponential: true }
);
```

### debounce / throttle
```ts
const debouncedSearch = debounce((q: string) => search(q), 300);
debouncedSearch.cancel();   // cancel pending
debouncedSearch.flush();    // invoke immediately

const throttledScroll = throttle(onScroll, 100);
throttledScroll.cancel();   // clear trailing
```

### memoize (with TTL + LRU)
```ts
const cachedFetch = memoize(
  (id: string) => api.getUser(id),
  { ttlMs: 60_000, maxSize: 100 }
);
cachedFetch.clear();   // invalidate all
cachedFetch.size();    // current entries
```

### withTimeout
```ts
// Throws TimeoutError after 5s
const result = await withTimeout(fetch(url), 5000);
```

### createDeferred
```ts
const d = createDeferred<string>();
setTimeout(() => d.resolve("done"), 1000);
const value = await d.promise; // "done"
```

### batchCalls
```ts
// 10 simultaneous callers → 1 actual API call
const batched = batchCalls(() => api.getLeaderboard(), 50);
const [r1, r2] = await Promise.all([batched(), batched()]);
```

---

## `number.ts`

### Clamping & rounding
```ts
clamp(15, 0, 10)         // 10
roundTo(3.14159, 2)      // 3.14
floorTo(3.999, 1)        // 3.9
ceilTo(3.001, 1)         // 3.1
```

### Formatting
```ts
formatCompact(12500)                      // "12.5K"
formatCompact(2_300_000)                  // "2.3M"
formatPercent(0.756)                      // "75.6%"
formatOrdinal(1)                          // "1st"
formatOrdinal(11)                         // "11th"
```

### ELO & gaming
```ts
eloExpectedScore(1400, 1200)              // ~0.76
calculateNewElo(1200, 1200, 1)           // ~1216 (win)
calculateNewElo(1200, 1200, 0)           // ~1184 (loss)
winRate(7, 10)                           // 70
```

### Interpolation
```ts
lerp(0, 100, 0.5)                        // 50
inverseLerp(0, 100, 75)                  // 0.75
remap(5, 0, 10, 0, 100)                 // 50
```

---

## `datetime.ts`

### Formatting
```ts
formatDateTime("2025-06-01T14:30:00Z", "medium")  // "Jun 1, 2025, 2:30 PM"
formatDuration(3_723_000)                          // "1h 2m 3s"
formatCountdown(90)                                // "1:30"
formatCountdown(3723)                              // "1:02:03"
timeAgo(Date.now() - 65_000)                      // "1 minute ago"
```

### Arithmetic
```ts
addTime(new Date(), 7, "days")
diffTime("2025-01-01", "2025-01-08", "days")  // 7
startOfDay("2025-06-15T14:30:00")             // 2025-06-15T00:00:00
startOfWeek("2025-06-15")                     // Monday of that week
```

### Predicates
```ts
isBefore("2025-01-01", "2025-06-01")   // true
isAfter("2025-06-01", "2025-01-01")    // true
isBetween("2025-03-01", "2025-01-01", "2025-06-01") // true
isToday(new Date())                     // true
isValidDate("not-a-date")               // false
```

### Tournament helpers
```ts
tournamentTimeLabel(futureDate)          // "Starts in 2 hours"
tournamentTimeLabel(pastStart)           // "Started 1 hour ago"
tournamentTimeLabel(pastStart, pastEnd)  // "Ended 30 minutes ago"
```

---

## `performance.ts`

### Measurement
```ts
const { result, durationMs } = measureSync(() => heavyComputation());
const { result, durationMs } = await measureAsync(() => api.call());

mark("render-start");
// ... work ...
const ms = measureBetween("render-start", "render-end");
```

### Rate limiter
```ts
const limiter = createRateLimiter({ maxCalls: 5, windowMs: 1000 });

const { allowed, remaining, resetsInMs } = limiter.check();
if (!allowed) {
  console.log(`Rate limited. Resets in ${resetsInMs}ms`);
}
```

### Idle / frame scheduling
```ts
scheduleIdle(() => preloadHeavyModule());         // requestIdleCallback or setTimeout fallback
const cancel = scheduleFrame(() => updateCanvas()); // requestAnimationFrame
cancel(); // cancel before it fires
```

### Lib analytics
```ts
import { emitLibEvent, subscribeToLibEvents } from "@/lib/performance";

// Instrument a utility
emitLibEvent({ utility: "string", operation: "slugify", durationMs: 0.2 });

// Subscribe from AnalyticsProvider
const unsub = subscribeToLibEvents((event) => {
  datadog.track("lib.operation", event);
});
```

---

## Testing

All new modules tested in `src/lib/__tests__/utils-lib.test.ts`:

```bash
npx jest --testPathPattern="utils-lib" --forceExit
```

**148 tests, all passing:**

| Module | Tests |
|---|---|
| `string` | 30 |
| `array` | 40 |
| `object` | 25 |
| `async` | 30 |
| `number` | 28 |
| `datetime` | 22 |
| `performance` | 8 |

---

## Adding a New Utility

1. Create `src/lib/my-utility.ts`
2. Export named functions only (no default exports)
3. Add JSDoc `@example` to every public function
4. Guard any browser API: `if (typeof window === "undefined") return;`
5. Add tests in `src/lib/__tests__/utils-lib.test.ts`
6. Add an entry to this document

**Checklist:**
- [ ] Pure function (no mutation of inputs)
- [ ] SSR-safe (no direct `window`/`document` access without guard)
- [ ] `"use client"` only if absolutely required
- [ ] Tests cover: happy path, edge cases (empty input, extremes), error path
