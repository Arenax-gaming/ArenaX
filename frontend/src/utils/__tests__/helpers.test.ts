/**
 * Unit tests for src/utils/helpers.ts
 */
import {
  debounce,
  throttle,
  deepClone,
  groupBy,
  chunk,
  unique,
  uniqueBy,
  flatMap,
  pick,
  omit,
  sleep,
  retry,
  isObjectEmpty,
  safeJsonParse,
} from "../helpers";

// ─── debounce ─────────────────────────────────────────────────────────────────
describe("debounce", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("delays function invocation", () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on repeated calls", () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced();
    jest.advanceTimersByTime(50);
    debounced();
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes arguments to the wrapped function", () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 50);
    debounced("a", "b");
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith("a", "b");
  });
});

// ─── throttle ─────────────────────────────────────────────────────────────────
describe("throttle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("calls the function immediately on first invocation", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops calls within the throttle window", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);
    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("allows a second call after the window expires", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);
    throttled();
    jest.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("passes arguments to the wrapped function", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);
    throttled("x");
    expect(fn).toHaveBeenCalledWith("x");
  });
});

// ─── deepClone ────────────────────────────────────────────────────────────────
describe("deepClone", () => {
  it("returns a value equal to the original", () => {
    const obj = { a: 1, b: { c: 2 } };
    expect(deepClone(obj)).toEqual(obj);
  });

  it("returns a new reference, not the original", () => {
    const obj = { a: 1 };
    const clone = deepClone(obj);
    clone.a = 99;
    expect(obj.a).toBe(1);
  });

  it("deep-clones nested objects", () => {
    const obj = { level1: { level2: { value: 42 } } };
    const clone = deepClone(obj);
    clone.level1.level2.value = 0;
    expect(obj.level1.level2.value).toBe(42);
  });

  it("clones arrays", () => {
    const arr = [1, 2, 3];
    const clone = deepClone(arr);
    clone[0] = 99;
    expect(arr[0]).toBe(1);
  });

  it("clones an array of objects", () => {
    const arr = [{ id: 1 }, { id: 2 }];
    const clone = deepClone(arr);
    clone[0].id = 99;
    expect(arr[0].id).toBe(1);
  });
});

// ─── groupBy ──────────────────────────────────────────────────────────────────
describe("groupBy", () => {
  it("groups items by a key", () => {
    const items = [
      { type: "a", v: 1 },
      { type: "b", v: 2 },
      { type: "a", v: 3 },
    ];
    const result = groupBy(items, "type");
    expect(result["a"]).toHaveLength(2);
    expect(result["b"]).toHaveLength(1);
  });

  it("returns an empty object for empty array", () => {
    expect(groupBy([], "key" as never)).toEqual({});
  });

  it("handles numeric key values", () => {
    const items = [{ score: 1 }, { score: 2 }, { score: 1 }];
    const result = groupBy(items, "score");
    expect(result["1"]).toHaveLength(2);
    expect(result["2"]).toHaveLength(1);
  });
});

// ─── chunk ────────────────────────────────────────────────────────────────────
describe("chunk", () => {
  it("splits an array into equal chunks", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("handles a remainder chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles chunk size larger than array", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it("returns empty array for size ≤ 0", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([]);
    expect(chunk([1, 2, 3], -1)).toEqual([]);
  });
});

// ─── unique ───────────────────────────────────────────────────────────────────
describe("unique", () => {
  it("removes duplicate primitives", () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it("handles an array with no duplicates", () => {
    expect(unique([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns empty array for empty input", () => {
    expect(unique([])).toEqual([]);
  });

  it("handles string arrays", () => {
    expect(unique(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});

// ─── uniqueBy ─────────────────────────────────────────────────────────────────
describe("uniqueBy", () => {
  it("removes duplicates based on a key", () => {
    const items = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 1, v: "c" }];
    const result = uniqueBy(items, "id");
    expect(result).toHaveLength(2);
    expect(result[0].v).toBe("a"); // first occurrence wins
  });

  it("returns empty array for empty input", () => {
    expect(uniqueBy([], "id" as never)).toEqual([]);
  });
});

// ─── flatMap ──────────────────────────────────────────────────────────────────
describe("flatMap", () => {
  it("maps and flattens one level", () => {
    expect(flatMap([1, 2, 3], (n) => [n, n * 2])).toEqual([1, 2, 2, 4, 3, 6]);
  });

  it("returns empty array for empty input", () => {
    expect(flatMap([], (x) => [x])).toEqual([]);
  });

  it("handles mapping to empty arrays (filter-like)", () => {
    expect(flatMap([1, 2, 3], (n) => (n % 2 === 0 ? [n] : []))).toEqual([2]);
  });
});

// ─── pick ─────────────────────────────────────────────────────────────────────
describe("pick", () => {
  it("picks the specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("ignores keys not present in the object", () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, ["a", "d" as keyof typeof obj])).toEqual({ a: 1 });
  });

  it("returns empty object when no keys are specified", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });
});

// ─── omit ─────────────────────────────────────────────────────────────────────
describe("omit", () => {
  it("omits the specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("returns a full copy when no keys are specified", () => {
    expect(omit({ a: 1, b: 2 }, [])).toEqual({ a: 1, b: 2 });
  });

  it("does not mutate the original object", () => {
    const obj = { a: 1, b: 2 };
    omit(obj, ["a"]);
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});

// ─── sleep ────────────────────────────────────────────────────────────────────
describe("sleep", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resolves after the specified delay", async () => {
    const promise = sleep(200);
    jest.advanceTimersByTime(200);
    await expect(promise).resolves.toBeUndefined();
  });
});

// ─── retry ────────────────────────────────────────────────────────────────────
describe("retry", () => {
  it("resolves on first attempt if fn succeeds", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await retry(fn, 3);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and resolves on subsequent success", async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("fail"));
      return Promise.resolve("success");
    });
    const result = await retry(fn, 3);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after all attempts fail", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("always fails"));
    await expect(retry(fn, 2)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ─── isObjectEmpty ────────────────────────────────────────────────────────────
describe("isObjectEmpty", () => {
  it("returns true for an empty object", () => {
    expect(isObjectEmpty({})).toBe(true);
  });

  it("returns false for a non-empty object", () => {
    expect(isObjectEmpty({ key: "value" })).toBe(false);
  });

  it("returns false for an object with one key", () => {
    expect(isObjectEmpty({ a: 1 })).toBe(false);
  });
});

// ─── safeJsonParse ───────────────────────────────────────────────────────────
describe("safeJsonParse", () => {
  it("parses a valid JSON string", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it("returns the fallback for invalid JSON", () => {
    expect(safeJsonParse("not json", null)).toBeNull();
  });

  it("returns the fallback for empty string", () => {
    expect(safeJsonParse("", [])).toEqual([]);
  });

  it("parses a JSON array", () => {
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  it("parses a JSON primitive", () => {
    expect(safeJsonParse("42", 0)).toBe(42);
    expect(safeJsonParse('"hello"', "")).toBe("hello");
  });
});
