/**
 * Utility library tests — #694
 * string · array · object · async · number · datetime · performance
 */

// ─── string ──────────────────────────────────────────────────────────────────
import {
  toCamelCase, toSnakeCase, toKebabCase, toTitleCase, toSentenceCase,
  humanize, truncate, countOccurrences, replaceAll, reverseString,
  highlight, isAlphanumeric, isEmail, isUrl, isNumericString,
  randomString, slugify, interpolate, escapeHtml, escapeRegex,
  formatBytes, maskSensitive, getInitials,
} from "../string";

// ─── array ───────────────────────────────────────────────────────────────────
import {
  unique, uniqueBy, partition, compact, chunk, groupBy, groupByObject,
  sortBy, sortByDesc, shuffle, intersection, difference, symmetricDifference,
  union, sample, sampleSize, sum, sumBy, min, max, minBy, maxBy,
  mean, median, flatten, flattenDeep, range, repeat,
  countBy, every, some, none,
} from "../array";

// ─── object ──────────────────────────────────────────────────────────────────
import {
  deepClone, deepMerge, deepEqual, shallowDiff, pick, omit,
  getIn, setIn, invertObject, mapValues, filterObject, compactObject,
  shallowEqual, isEmpty, isPlainObject,
} from "../object";

// ─── async ───────────────────────────────────────────────────────────────────
import {
  sleep, retry, debounce, throttle, memoize, withTimeout,
  TimeoutError, createDeferred, batchCalls,
} from "../async";

// ─── number ──────────────────────────────────────────────────────────────────
import {
  clamp, roundTo, floorTo, ceilTo, formatNumber, formatCompact,
  formatPercent, formatOrdinal, eloExpectedScore, calculateNewElo,
  winRate, randomInt, randomFloat, lerp, inverseLerp, remap,
  isEven, isOdd, sign, gcd, lcm, digitSum,
} from "../number";

// ─── datetime ────────────────────────────────────────────────────────────────
import {
  formatDateTime, formatDuration, formatCountdown, timeAgo,
  addTime, diffTime, startOfDay, endOfDay, startOfWeek, startOfMonth,
  isBefore, isAfter, isBetween, isToday, isValidDate, tournamentTimeLabel,
} from "../datetime";

// ─── performance ─────────────────────────────────────────────────────────────
import {
  measureSync, measureAsync, createRateLimiter,
  emitLibEvent, subscribeToLibEvents,
} from "../performance";


// ═════════════════════════════════════════════════════════════════════════════
// STRING TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("string — case conversion", () => {
  test("toCamelCase", () => {
    expect(toCamelCase("hello_world")).toBe("helloWorld");
    expect(toCamelCase("foo-bar-baz")).toBe("fooBarBaz");
    expect(toCamelCase("already")).toBe("already");
  });
  test("toSnakeCase", () => {
    expect(toSnakeCase("helloWorld")).toBe("hello_world");
    expect(toSnakeCase("FooBar")).toBe("foo_bar");
  });
  test("toKebabCase", () => {
    expect(toKebabCase("helloWorld")).toBe("hello-world");
  });
  test("toTitleCase", () => {
    expect(toTitleCase("hello world")).toBe("Hello World");
  });
  test("toSentenceCase", () => {
    expect(toSentenceCase("HELLO WORLD")).toBe("Hello world");
  });
  test("humanize", () => {
    expect(humanize("myFieldName")).toBe("My Field Name");
  });
});

describe("string — truncation", () => {
  test("truncate — no-op when short enough", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  test("truncate — appends suffix", () => {
    expect(truncate("Hello World", 8)).toBe("Hello W…");
  });
  test("truncate — breakOnWord", () => {
    expect(truncate("Hello World foo", 10, { breakOnWord: true })).toBe("Hello…");
  });
});

describe("string — search & manipulation", () => {
  test("countOccurrences", () => {
    expect(countOccurrences("banana", "a")).toBe(3);
    expect(countOccurrences("Banana", "a", true)).toBe(3);
  });
  test("replaceAll", () => {
    expect(replaceAll("a.b.c", ".", "-")).toBe("a-b-c");
  });
  test("reverseString", () => {
    expect(reverseString("abc")).toBe("cba");
  });
  test("highlight wraps matches in <mark>", () => {
    expect(highlight("hello world", "world")).toBe("hello <mark>world</mark>");
  });
});

describe("string — validation", () => {
  test("isAlphanumeric", () => {
    expect(isAlphanumeric("abc123")).toBe(true);
    expect(isAlphanumeric("abc!")).toBe(false);
  });
  test("isEmail", () => {
    expect(isEmail("user@example.com")).toBe(true);
    expect(isEmail("notanemail")).toBe(false);
  });
  test("isUrl", () => {
    expect(isUrl("https://arenax.gg")).toBe(true);
    expect(isUrl("ftp://bad")).toBe(false);
  });
  test("isNumericString", () => {
    expect(isNumericString("42")).toBe(true);
    expect(isNumericString("abc")).toBe(false);
  });
});

describe("string — generation & formatting", () => {
  test("randomString returns correct length", () => {
    expect(randomString(12).length).toBe(12);
  });
  test("slugify", () => {
    expect(slugify("Hello World! 2025")).toBe("hello-world-2025");
    expect(slugify("  --foo--  ")).toBe("foo");
  });
  test("interpolate replaces tokens", () => {
    expect(interpolate("Hi {{name}}!", { name: "ArenaX" })).toBe("Hi ArenaX!");
    expect(interpolate("{{a}} + {{b}}", { a: 1, b: 2 })).toBe("1 + 2");
  });
  test("escapeHtml", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"
    );
  });
  test("escapeRegex", () => {
    expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
  });
  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_048_576)).toBe("1 MB");
  });
  test("maskSensitive", () => {
    expect(maskSensitive("1234567890", 4)).toBe("••••••7890");
  });
  test("getInitials", () => {
    expect(getInitials("John Doe")).toBe("JD");
    expect(getInitials("Alice Bob Charlie", 3)).toBe("ABC");
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// ARRAY TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("array — deduplication", () => {
  test("unique removes primitives", () => {
    expect(unique([1, 2, 1, 3])).toEqual([1, 2, 3]);
  });
  test("uniqueBy removes objects by key", () => {
    const result = uniqueBy([{ id: 1, n: "a" }, { id: 1, n: "b" }, { id: 2, n: "c" }], (x) => x.id);
    expect(result).toHaveLength(2);
    expect(result[0].n).toBe("a");
  });
});

describe("array — partitioning & filtering", () => {
  test("partition splits by predicate", () => {
    const [evens, odds] = partition([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3, 5]);
  });
  test("compact removes falsy", () => {
    expect(compact([0, 1, null, "x", undefined, false, ""])).toEqual([1, "x"]);
  });
  test("chunk splits array", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("array — grouping", () => {
  test("groupBy returns Map", () => {
    const map = groupBy(["a", "bb", "ccc", "dd"], (s) => s.length);
    expect(map.get(1)).toEqual(["a"]);
    expect(map.get(2)).toEqual(["bb", "dd"]);
  });
  test("groupByObject returns plain object", () => {
    const obj = groupByObject(["x", "yy", "zz"], (s) => String(s.length));
    expect(obj["1"]).toEqual(["x"]);
    expect(obj["2"]).toEqual(["yy", "zz"]);
  });
});

describe("array — sorting", () => {
  test("sortBy ascending", () => {
    expect(sortBy([3, 1, 2], (n) => n)).toEqual([1, 2, 3]);
  });
  test("sortByDesc descending", () => {
    expect(sortByDesc([3, 1, 2], (n) => n)).toEqual([3, 2, 1]);
  });
  test("shuffle returns same length", () => {
    const arr = [1, 2, 3, 4, 5];
    const s = shuffle(arr);
    expect(s.length).toBe(arr.length);
    expect(s).not.toBe(arr); // new array
  });
});

describe("array — set operations", () => {
  test("intersection", () => {
    expect(intersection([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
  });
  test("difference", () => {
    expect(difference([1, 2, 3], [2, 3])).toEqual([1]);
  });
  test("symmetricDifference", () => {
    expect(symmetricDifference([1, 2, 3], [3, 4])).toEqual(expect.arrayContaining([1, 2, 4]));
  });
  test("union", () => {
    expect(union([1, 2], [2, 3])).toEqual([1, 2, 3]);
  });
});

describe("array — aggregation", () => {
  test("sum", () => expect(sum([1, 2, 3, 4])).toBe(10));
  test("sumBy", () => expect(sumBy([{ v: 2 }, { v: 3 }], (x) => x.v)).toBe(5));
  test("min", () => expect(min([3, 1, 2])).toBe(1));
  test("max", () => expect(max([3, 1, 2])).toBe(3));
  test("minBy", () => expect(minBy([{ v: 3 }, { v: 1 }], (x) => x.v)).toEqual({ v: 1 }));
  test("maxBy", () => expect(maxBy([{ v: 3 }, { v: 1 }], (x) => x.v)).toEqual({ v: 3 }));
  test("mean", () => expect(mean([1, 2, 3, 4, 5])).toBe(3));
  test("median odd", () => expect(median([3, 1, 2])).toBe(2));
  test("median even", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe("array — flattening & ranges", () => {
  test("flatten one level", () => expect(flatten([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]));
  test("flattenDeep recursive", () => expect(flattenDeep([[1, [2, [3]]]])).toEqual([1, 2, 3]));
  test("range basic", () => expect(range(0, 5)).toEqual([0, 1, 2, 3, 4]));
  test("range with step", () => expect(range(0, 10, 2)).toEqual([0, 2, 4, 6, 8]));
  test("repeat", () => expect(repeat("x", 3)).toEqual(["x", "x", "x"]));
});

describe("array — predicates", () => {
  test("every", () => {
    expect(every([2, 4, 6], (n) => n % 2 === 0)).toBe(true);
    expect(every([2, 3, 6], (n) => n % 2 === 0)).toBe(false);
  });
  test("some", () => {
    expect(some([1, 3, 4], (n) => n % 2 === 0)).toBe(true);
  });
  test("none", () => {
    expect(none([1, 3, 5], (n) => n % 2 === 0)).toBe(true);
  });
  test("countBy", () => {
    expect(countBy([1, 2, 3, 4], (n) => n % 2 === 0)).toBe(2);
  });
  test("sample returns element from array", () => {
    const arr = [10, 20, 30];
    expect(arr).toContain(sample(arr));
  });
  test("sampleSize returns n items", () => {
    expect(sampleSize([1, 2, 3, 4, 5], 3)).toHaveLength(3);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// OBJECT TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("object — deepClone", () => {
  test("returns a new object", () => {
    const a = { x: { y: 1 } };
    const b = deepClone(a);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    b.x.y = 99;
    expect(a.x.y).toBe(1);
  });
});

describe("object — deepMerge", () => {
  test("merges nested objects", () => {
    const result = deepMerge({ a: { x: 1, y: 2 }, b: 3 } as Record<string, unknown>, { a: { y: 99 } } as Record<string, unknown>);
    expect((result.a as Record<string, unknown>).x).toBe(1);
    expect((result.a as Record<string, unknown>).y).toBe(99);
    expect(result.b).toBe(3);
  });
  test("does not mutate source or target", () => {
    const target = { a: 1 };
    const source = { b: 2 };
    const result = deepMerge(target as Record<string, unknown>, source as Record<string, unknown>);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(target).toEqual({ a: 1 });
  });
});

describe("object — deepEqual", () => {
  test("equal objects", () => expect(deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true));
  test("unequal objects", () => expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false));
  test("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("x", "y")).toBe(false);
  });
  test("dates", () => {
    expect(deepEqual(new Date("2025-01-01"), new Date("2025-01-01"))).toBe(true);
    expect(deepEqual(new Date("2025-01-01"), new Date("2025-01-02"))).toBe(false);
  });
});

describe("object — shallowDiff", () => {
  test("detects added, removed, changed", () => {
    const diff = shallowDiff({ a: 1, b: 2 }, { b: 99, c: 3 });
    expect(diff.added).toEqual({ c: 3 });
    expect(diff.removed).toEqual({ a: 1 });
    expect(diff.changed.b).toEqual({ from: 2, to: 99 });
  });
});

describe("object — pick / omit", () => {
  test("pick selects keys", () => expect(pick({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 }));
  test("omit removes keys", () => expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 }));
});

describe("object — path access", () => {
  test("getIn retrieves nested value", () => {
    expect(getIn({ a: { b: { c: 42 } } } as Record<string, unknown>, "a.b.c")).toBe(42);
  });
  test("getIn returns defaultValue for missing path", () => {
    expect(getIn({} as Record<string, unknown>, "a.b", "default")).toBe("default");
  });
  test("setIn creates nested value", () => {
    const result = setIn({ a: { b: 1 } } as Record<string, unknown>, "a.b", 99);
    expect((result.a as Record<string, unknown>).b).toBe(99);
  });
  test("setIn does not mutate original", () => {
    const original = { a: { b: 1 } } as Record<string, unknown>;
    setIn(original, "a.b", 99);
    expect((original.a as Record<string, unknown>).b).toBe(1);
  });
});

describe("object — transformation helpers", () => {
  test("invertObject swaps keys and values", () => {
    expect(invertObject({ a: "1", b: "2" })).toEqual({ "1": "a", "2": "b" });
  });
  test("mapValues transforms values", () => {
    expect(mapValues({ a: 1, b: 2 }, (v) => v * 2)).toEqual({ a: 2, b: 4 });
  });
  test("filterObject keeps matching entries", () => {
    expect(filterObject({ a: 1, b: 2, c: 3 }, (v) => v > 1)).toEqual({ b: 2, c: 3 });
  });
  test("compactObject removes null/undefined", () => {
    expect(compactObject({ a: 1, b: null, c: undefined, d: 0 })).toEqual({ a: 1, d: 0 });
  });
  test("shallowEqual", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
  test("isEmpty", () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ a: 1 })).toBe(false);
  });
  test("isPlainObject", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// ASYNC TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("async — sleep", () => {
  test("resolves after delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("async — retry", () => {
  test("succeeds on first try", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(retry(fn, { attempts: 3 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  test("retries on failure then succeeds", async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("fail");
      return "done";
    });
    const result = await retry(fn, { attempts: 3, delayMs: 10 });
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });
  test("throws after max attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("always fails"));
    await expect(retry(fn, { attempts: 2, delayMs: 10 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  test("respects shouldRetry predicate", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("skip"));
    await expect(
      retry(fn, { attempts: 3, delayMs: 10, shouldRetry: () => false })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("async — debounce", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("calls fn after wait ms", () => {
    const fn = jest.fn();
    const d = debounce(fn, 200);
    d("a");
    d("b");
    d("c");
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });
  test("cancel prevents invocation", () => {
    const fn = jest.fn();
    const d = debounce(fn, 200);
    d("x");
    d.cancel();
    jest.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });
  test("flush calls immediately", () => {
    const fn = jest.fn();
    const d = debounce(fn, 200);
    d("arg");
    d.flush();
    expect(fn).toHaveBeenCalledWith("arg");
  });
});

describe("async — throttle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("calls at most once per limit", () => {
    const fn = jest.fn();
    const t = throttle(fn, 100);
    t(); t(); t();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });
  test("cancel clears trailing call", () => {
    const fn = jest.fn();
    const t = throttle(fn, 100);
    t();
    t.cancel();
    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("async — memoize", () => {
  test("caches return value", () => {
    const fn = jest.fn((x: number) => x * 2);
    const m = memoize(fn as (...args: unknown[]) => unknown);
    expect(m(5)).toBe(10);
    expect(m(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  test("evicts after TTL", async () => {
    const fn = jest.fn((x: number) => x + 1);
    const m = memoize(fn as (...args: unknown[]) => unknown, { ttlMs: 50 });
    m(1);
    await sleep(60);
    m(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  test("evicts LRU when maxSize exceeded", () => {
    const fn = jest.fn((x: number) => x);
    const m = memoize(fn as (...args: unknown[]) => unknown, { maxSize: 2 });
    m(1); m(2); m(3); // evicts 1
    expect(m.size()).toBe(2);
  });
  test("clear empties cache", () => {
    const fn = jest.fn((x: number) => x);
    const m = memoize(fn as (...args: unknown[]) => unknown);
    m(1); m(2);
    m.clear();
    expect(m.size()).toBe(0);
  });
});

describe("async — withTimeout", () => {
  test("resolves when promise completes in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100)).resolves.toBe("ok");
  });
  test("throws TimeoutError when exceeded", async () => {
    const never = new Promise(() => { /* never resolves */ });
    await expect(withTimeout(never, 50)).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("async — createDeferred", () => {
  test("resolves via resolve()", async () => {
    const d = createDeferred<string>();
    d.resolve("hello");
    await expect(d.promise).resolves.toBe("hello");
  });
  test("rejects via reject()", async () => {
    const d = createDeferred<string>();
    d.reject(new Error("nope"));
    await expect(d.promise).rejects.toThrow("nope");
  });
});

describe("async — batchCalls", () => {
  test("deduplicates parallel calls", async () => {
    const fn = jest.fn().mockResolvedValue("data");
    const batched = batchCalls(fn, 20);
    const [r1, r2, r3] = await Promise.all([batched(), batched(), batched()]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toBe("data");
    expect(r2).toBe("data");
    expect(r3).toBe("data");
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// NUMBER TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("number — clamping & rounding", () => {
  test("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
  test("roundTo", () => expect(roundTo(3.14159, 2)).toBe(3.14));
  test("floorTo", () => expect(floorTo(3.999, 1)).toBe(3.9));
  test("ceilTo", () => expect(ceilTo(3.001, 1)).toBe(3.1));
});

describe("number — formatting", () => {
  test("formatNumber adds separators", () => {
    expect(formatNumber(1234567)).toContain(",");
  });
  test("formatCompact", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(2_300_000)).toBe("2.3M");
  });
  test("formatPercent from ratio", () => {
    expect(formatPercent(0.756)).toBe("75.6%");
  });
  test("formatPercent already percent", () => {
    expect(formatPercent(75.6, { alreadyPercent: true })).toBe("75.6%");
  });
  test("formatOrdinal", () => {
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(2)).toBe("2nd");
    expect(formatOrdinal(3)).toBe("3rd");
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(21)).toBe("21st");
  });
});

describe("number — ELO & gaming", () => {
  test("eloExpectedScore 50/50 for equal ELO", () => {
    expect(eloExpectedScore(1200, 1200)).toBeCloseTo(0.5);
  });
  test("eloExpectedScore higher for stronger player", () => {
    expect(eloExpectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });
  test("calculateNewElo increases on win", () => {
    const newElo = calculateNewElo(1200, 1200, 1);
    expect(newElo).toBeGreaterThan(1200);
  });
  test("calculateNewElo decreases on loss", () => {
    const newElo = calculateNewElo(1200, 1200, 0);
    expect(newElo).toBeLessThan(1200);
  });
  test("winRate", () => {
    expect(winRate(7, 10)).toBe(70);
    expect(winRate(0, 0)).toBe(0);
  });
});

describe("number — interpolation & range", () => {
  test("lerp", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
  });
  test("inverseLerp", () => {
    expect(inverseLerp(0, 100, 50)).toBe(0.5);
    expect(inverseLerp(0, 100, 0)).toBe(0);
  });
  test("remap", () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
  });
});

describe("number — math helpers", () => {
  test("isEven / isOdd", () => {
    expect(isEven(4)).toBe(true);
    expect(isOdd(3)).toBe(true);
  });
  test("sign", () => {
    expect(sign(-5)).toBe(-1);
    expect(sign(0)).toBe(0);
    expect(sign(3)).toBe(1);
  });
  test("gcd", () => expect(gcd(12, 8)).toBe(4));
  test("lcm", () => expect(lcm(4, 6)).toBe(12));
  test("digitSum", () => expect(digitSum(123)).toBe(6));
  test("randomInt in range", () => {
    const n = randomInt(1, 10);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(10);
  });
  test("randomFloat in range", () => {
    const n = randomFloat(0, 1);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// DATETIME TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("datetime — formatting", () => {
  const ISO = "2025-06-15T14:30:00.000Z";
  test("formatDateTime returns non-empty string", () => {
    expect(formatDateTime(ISO, "medium")).toBeTruthy();
    expect(formatDateTime(ISO, "date")).toBeTruthy();
  });
  test("formatDuration", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(3_723_000)).toBe("1h 2m 3s");
  });
  test("formatCountdown", () => {
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(3723)).toBe("1:02:03");
    expect(formatCountdown(0)).toBe("0:00");
  });
});

describe("datetime — relative time", () => {
  test("timeAgo returns a non-empty string", () => {
    const past = Date.now() - 120_000;
    expect(timeAgo(past)).toBeTruthy();
  });
});

describe("datetime — arithmetic", () => {
  test("addTime days", () => {
    const d = new Date("2025-01-01T00:00:00Z");
    const result = addTime(d, 7, "days");
    expect(result.getUTCDate()).toBe(8);
  });
  test("addTime hours", () => {
    const d = new Date("2025-01-01T10:00:00Z");
    const result = addTime(d, 3, "hours");
    expect(result.getUTCHours()).toBe(13);
  });
  test("diffTime in days", () => {
    expect(diffTime("2025-01-01", "2025-01-08", "days")).toBe(7);
  });
});

describe("datetime — start/end helpers", () => {
  test("startOfDay sets to midnight", () => {
    const d = startOfDay("2025-06-15T14:30:00");
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
  test("endOfDay sets to 23:59:59", () => {
    const d = endOfDay("2025-06-15T08:00:00");
    expect(d.getHours()).toBe(23);
    expect(d.getSeconds()).toBe(59);
  });
  test("startOfMonth sets day to 1", () => {
    const d = startOfMonth("2025-06-15");
    expect(d.getDate()).toBe(1);
  });
  test("startOfWeek returns Monday", () => {
    // 2025-06-15 is a Sunday
    const d = startOfWeek("2025-06-15");
    expect(d.getDay()).toBe(1); // Monday
  });
});

describe("datetime — predicates", () => {
  test("isBefore / isAfter", () => {
    expect(isBefore("2025-01-01", "2025-06-01")).toBe(true);
    expect(isAfter("2025-06-01", "2025-01-01")).toBe(true);
  });
  test("isBetween", () => {
    expect(isBetween("2025-03-01", "2025-01-01", "2025-06-01")).toBe(true);
    expect(isBetween("2024-01-01", "2025-01-01", "2025-06-01")).toBe(false);
  });
  test("isToday with today's date", () => {
    expect(isToday(new Date())).toBe(true);
  });
  test("isValidDate", () => {
    expect(isValidDate("2025-01-01")).toBe(true);
    expect(isValidDate("not-a-date")).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });
});

describe("datetime — tournamentTimeLabel", () => {
  test("returns future label for upcoming tournament", () => {
    const future = addTime(new Date(), 2, "hours");
    const label = tournamentTimeLabel(future);
    expect(label.toLowerCase()).toContain("start");
  });
  test("returns started label for ongoing tournament", () => {
    const past = addTime(new Date(), -1, "hours");
    const label = tournamentTimeLabel(past);
    expect(label.toLowerCase()).toContain("started");
  });
  test("returns ended label when end time is in past", () => {
    const start = addTime(new Date(), -3, "hours");
    const end = addTime(new Date(), -1, "hours");
    const label = tournamentTimeLabel(start, end);
    expect(label.toLowerCase()).toContain("ended");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PERFORMANCE TESTS
// ═════════════════════════════════════════════════════════════════════════════
describe("performance — measurement", () => {
  test("measureSync returns result and durationMs", () => {
    const { result, durationMs } = measureSync(() => 42);
    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
  test("measureAsync returns result and durationMs", async () => {
    const { result, durationMs } = await measureAsync(async () => "done");
    expect(result).toBe("done");
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("performance — rate limiter", () => {
  test("allows up to maxCalls", () => {
    const limiter = createRateLimiter({ maxCalls: 3, windowMs: 1000 });
    expect(limiter.check().allowed).toBe(true);
    expect(limiter.check().allowed).toBe(true);
    expect(limiter.check().allowed).toBe(true);
    expect(limiter.check().allowed).toBe(false);
  });
  test("remaining decrements on allowed calls", () => {
    const limiter = createRateLimiter({ maxCalls: 3, windowMs: 1000 });
    limiter.check();
    const { remaining } = limiter.check();
    expect(remaining).toBe(1);
  });
  test("reset allows calls again", () => {
    const limiter = createRateLimiter({ maxCalls: 1, windowMs: 1000 });
    limiter.check();
    expect(limiter.check().allowed).toBe(false);
    limiter.reset();
    expect(limiter.check().allowed).toBe(true);
  });
});

describe("performance — lib analytics", () => {
  test("emitLibEvent dispatches custom event", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLibEvents((e) => received.push(e));
    emitLibEvent({ utility: "string", operation: "slugify" });
    expect(received).toHaveLength(1);
    expect((received[0] as { utility: string }).utility).toBe("string");
    unsub();
  });
  test("subscribeToLibEvents unsubscribes correctly", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLibEvents((e) => received.push(e));
    unsub();
    emitLibEvent({ utility: "array", operation: "unique" });
    expect(received).toHaveLength(0);
  });
});
