/**
 * array.ts — comprehensive array utility library
 *
 * Pure functions — no side effects. All tree-shakeable.
 */

// ---------------------------------------------------------------------------
// Filtering & partitioning
// ---------------------------------------------------------------------------

/**
 * Remove duplicate primitives or objects (by structural equality).
 * Uses a Set for primitives, JSON.stringify for objects (simple but slow).
 */
export function unique<T>(arr: T[]): T[] {
  if (arr.length === 0) return [];
  if (typeof arr[0] !== "object") return [...new Set(arr)];
  // Object deduplication — JSON stringify (imperfect for objects with functions/symbols)
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Remove duplicate objects by a key selector.
 * @example
 * uniqueBy([{id:1,name:"a"},{id:1,name:"b"}], x => x.id) // [{id:1,name:"a"}]
 */
export function uniqueBy<T, K>(arr: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Split an array into two based on a predicate: [pass[], fail[]].
 */
export function partition<T>(
  arr: T[],
  predicate: (item: T, index: number) => boolean
): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  arr.forEach((item, i) => {
    (predicate(item, i) ? pass : fail).push(item);
  });
  return [pass, fail];
}

/**
 * Remove all falsy values (false, null, undefined, 0, "", NaN).
 */
export function compact<T>(arr: (T | null | undefined | false | "" | 0)[]): T[] {
  return arr.filter(Boolean) as T[];
}

// ---------------------------------------------------------------------------
// Chunking & grouping
// ---------------------------------------------------------------------------

/**
 * Split an array into chunks of size `size`.
 * @example
 * chunk([1,2,3,4,5], 2) // [[1,2], [3,4], [5]]
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Group array items by a key function, returning a Map<K, T[]>.
 * @example
 * groupBy([{type:"a",val:1},{type:"b",val:2},{type:"a",val:3}], x=>x.type)
 * // Map { "a" => [{type:"a",val:1}, {type:"a",val:3}], "b" => [{type:"b",val:2}] }
 */
export function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  arr.forEach((item) => {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  });
  return map;
}

/**
 * Convert a grouped Map back to an object (keys must be strings).
 */
export function groupByObject<T>(
  arr: T[],
  keyFn: (item: T) => string
): Record<string, T[]> {
  const obj: Record<string, T[]> = {};
  arr.forEach((item) => {
    const key = keyFn(item);
    (obj[key] ??= []).push(item);
  });
  return obj;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort an array of objects by a key (ascending).
 */
export function sortBy<T>(arr: T[], keyFn: (item: T) => number | string): T[] {
  return [...arr].sort((a, b) => {
    const aVal = keyFn(a);
    const bVal = keyFn(b);
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });
}

/**
 * Sort an array of objects by a key (descending).
 */
export function sortByDesc<T>(arr: T[], keyFn: (item: T) => number | string): T[] {
  return [...arr].sort((a, b) => {
    const aVal = keyFn(a);
    const bVal = keyFn(b);
    if (aVal < bVal) return 1;
    if (aVal > bVal) return -1;
    return 0;
  });
}

/**
 * Shuffle an array in place (Fisher-Yates algorithm).
 * Returns a new shuffled array (does not mutate).
 */
export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

/** Return items in both arrays (set intersection). */
export function intersection<T>(arr1: T[], arr2: T[]): T[] {
  const set2 = new Set(arr2);
  return unique(arr1.filter((item) => set2.has(item)));
}

/** Return items in arr1 but not in arr2 (set difference). */
export function difference<T>(arr1: T[], arr2: T[]): T[] {
  const set2 = new Set(arr2);
  return arr1.filter((item) => !set2.has(item));
}

/** Return items in either array but not in both (symmetric difference). */
export function symmetricDifference<T>(arr1: T[], arr2: T[]): T[] {
  return difference(arr1, arr2).concat(difference(arr2, arr1));
}

/** Return all items from both arrays (set union). */
export function union<T>(arr1: T[], arr2: T[]): T[] {
  return unique([...arr1, ...arr2]);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Return a random item from the array.
 */
export function sample<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Return `n` random items from the array (without replacement).
 */
export function sampleSize<T>(arr: T[], n: number): T[] {
  const shuffled = shuffle(arr);
  return shuffled.slice(0, Math.min(n, arr.length));
}

/**
 * Return the first item matching the predicate.
 */
export function find<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  return arr.find(predicate);
}

/**
 * Return the last item matching the predicate.
 */
export function findLast<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Sum all numbers in an array.
 */
export function sum(arr: number[]): number {
  return arr.reduce((acc, n) => acc + n, 0);
}

/**
 * Sum all numbers extracted by `keyFn`.
 * @example
 * sumBy([{val:2},{val:3}], x => x.val) // 5
 */
export function sumBy<T>(arr: T[], keyFn: (item: T) => number): number {
  return arr.reduce((acc, item) => acc + keyFn(item), 0);
}

/**
 * Return the minimum value in an array.
 */
export function min(arr: number[]): number {
  return Math.min(...arr);
}

/**
 * Return the maximum value in an array.
 */
export function max(arr: number[]): number {
  return Math.max(...arr);
}

/**
 * Return the item with the minimum value extracted by `keyFn`.
 */
export function minBy<T>(arr: T[], keyFn: (item: T) => number): T | undefined {
  if (arr.length === 0) return undefined;
  return arr.reduce((minItem, item) =>
    keyFn(item) < keyFn(minItem) ? item : minItem
  );
}

/**
 * Return the item with the maximum value extracted by `keyFn`.
 */
export function maxBy<T>(arr: T[], keyFn: (item: T) => number): T | undefined {
  if (arr.length === 0) return undefined;
  return arr.reduce((maxItem, item) =>
    keyFn(item) > keyFn(maxItem) ? item : maxItem
  );
}

/**
 * Return the average (mean) of all numbers in an array.
 */
export function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : sum(arr) / arr.length;
}

/**
 * Return the median of all numbers in an array.
 */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/**
 * Flatten an array one level deep.
 * [[1,2],[3,4]] → [1,2,3,4]
 */
export function flatten<T>(arr: (T | T[])[]): T[] {
  return arr.flat() as T[];
}

/**
 * Flatten an array recursively to any depth.
 */
export function flattenDeep<T>(arr: unknown[]): T[] {
  return arr.flat(Infinity) as T[];
}

// ---------------------------------------------------------------------------
// Range generation
// ---------------------------------------------------------------------------

/**
 * Generate an array of numbers from `start` to `end` (exclusive) with step.
 * @example
 * range(0, 5) // [0,1,2,3,4]
 * range(0, 10, 2) // [0,2,4,6,8]
 */
export function range(start: number, end: number, step = 1): number[] {
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < end; i += step) result.push(i);
  } else if (step < 0) {
    for (let i = start; i > end; i += step) result.push(i);
  }
  return result;
}

/**
 * Generate an array of `n` repeated copies of `value`.
 * @example
 * repeat("x", 3) // ["x","x","x"]
 */
export function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value);
}

// ---------------------------------------------------------------------------
// Counting & checking
// ---------------------------------------------------------------------------

/**
 * Count items that pass the predicate.
 */
export function countBy<T>(arr: T[], predicate: (item: T) => boolean): number {
  return arr.filter(predicate).length;
}

/**
 * Return true if all items pass the predicate.
 */
export function every<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  return arr.every(predicate);
}

/**
 * Return true if any item passes the predicate.
 */
export function some<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  return arr.some(predicate);
}

/**
 * Return true if no item passes the predicate.
 */
export function none<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  return !arr.some(predicate);
}
