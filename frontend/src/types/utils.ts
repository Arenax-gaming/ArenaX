/**
 * ArenaX — shared TypeScript utility types
 *
 * Provides:
 * - Branded / nominal types for IDs
 * - Result / Maybe / Option monads
 * - Deep utilities (DeepReadonly, DeepPartial, DeepRequired)
 * - Strict record helpers
 * - Async state helpers
 * - Discriminated-union helpers
 * - Component prop utilities
 */

// ─── Branded / Nominal types ──────────────────────────────────────────────────

/**
 * Creates a nominal type that is structurally identical to `T` but not
 * assignable from plain `T`. Use to prevent mixing up string IDs.
 *
 * @example
 * type UserId      = Brand<string, "UserId">;
 * type TournamentId = Brand<string, "TournamentId">;
 *
 * function getUser(id: UserId) { … }
 * getUser("raw-string");        // ✗ — Type error
 * getUser("raw-string" as UserId); // ✓
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Unwraps a brand back to the base type. */
export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;

// Domain-specific branded string IDs
export type UserId       = Brand<string, "UserId">;
export type TournamentId = Brand<string, "TournamentId">;
export type MatchId      = Brand<string, "MatchId">;
export type AchievementId= Brand<string, "AchievementId">;
export type ProposalId   = Brand<string, "ProposalId">;
export type MessageId    = Brand<string, "MessageId">;
export type NotificationId = Brand<string, "NotificationId">;

/** Creates a branded string value at runtime. Use sparingly. */
export function brand<T extends string, B extends string>(
  value: string,
): Brand<T, B> {
  return value as unknown as Brand<T, B>;
}

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * A discriminated union for operations that can succeed or fail.
 * Avoids throwing exceptions for expected failure cases.
 *
 * @example
 * function parse(raw: string): Result<number, string> {
 *   const n = Number(raw);
 *   return isNaN(n) ? err("not a number") : ok(n);
 * }
 *
 * const result = parse("42");
 * if (result.ok) console.log(result.value); // 42
 * else           console.error(result.error);
 */
export type Result<T, E = Error> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wraps a success value in `Result`. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wraps a failure value in `Result`. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Returns `true` when the Result is a success. */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

/** Returns `true` when the Result is a failure. */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

/**
 * Maps the success value of a Result.  Passes failures through unchanged.
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

// ─── Maybe / Option ───────────────────────────────────────────────────────────

/**
 * `Maybe<T>` represents a value that may or may not be present.
 * Semantically equivalent to `T | null | undefined` but more explicit.
 */
export type Maybe<T> = T | null | undefined;

/** Returns `true` when the value is not null or undefined. */
export function isSome<T>(value: Maybe<T>): value is T {
  return value !== null && value !== undefined;
}

/** Returns `true` when the value is null or undefined. */
export function isNone<T>(value: Maybe<T>): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Returns `fallback` when `value` is null/undefined, otherwise returns `value`.
 */
export function getOrElse<T>(value: Maybe<T>, fallback: T): T {
  return isSome(value) ? value : fallback;
}

// ─── Deep utilities ───────────────────────────────────────────────────────────

/**
 * Makes every property (and nested property) in `T` readonly.
 *
 * @example
 * type Config = DeepReadonly<{ server: { host: string; port: number } }>;
 * // config.server.host = "x"; // ✗ — cannot assign to read only property
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/**
 * Makes every property (and nested property) in `T` optional.
 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/**
 * Makes every property (and nested property) in `T` required (non-optional).
 */
export type DeepRequired<T> = T extends object
  ? { [K in keyof T]-?: DeepRequired<T[K]> }
  : T;

/**
 * Makes every property (and nested property) in `T` mutable (removes readonly).
 */
export type DeepMutable<T> = T extends ReadonlyArray<infer U>
  ? Array<DeepMutable<U>>
  : T extends object
  ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T;

// ─── Pick / Omit utilities ────────────────────────────────────────────────────

/**
 * Pick only the keys of `T` whose values are assignable to `V`.
 *
 * @example
 * type StringKeys = PickByValue<{ a: string; b: number; c: string }, string>;
 * // → { a: string; c: string }
 */
export type PickByValue<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};

/**
 * Omit keys of `T` whose values are assignable to `V`.
 */
export type OmitByValue<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};

// ─── Strict record ────────────────────────────────────────────────────────────

/**
 * A `Record` variant that enforces exhaustive keys.
 * All values of the key union MUST be present.
 *
 * @example
 * type StatusLabel = StrictRecord<"open" | "closed", string>;
 * const labels: StatusLabel = { open: "Open", closed: "Closed" }; // ✓
 * const bad: StatusLabel = { open: "Open" }; // ✗ — missing "closed"
 */
export type StrictRecord<K extends string | number | symbol, V> = {
  [key in K]: V;
};

// ─── Async state ──────────────────────────────────────────────────────────────

export type AsyncStatus = "idle" | "loading" | "success" | "error";

/**
 * Discriminated union for async operations. Replaces the looser
 * `AsyncState<T>` in `index.ts` with proper narrowing.
 *
 * @example
 * function Component() {
 *   const state: AsyncData<User[]> = useUsers();
 *   if (state.status === "loading") return <Spinner />;
 *   if (state.status === "error")   return <Error msg={state.error} />;
 *   return <List items={state.data} />;
 * }
 */
export type AsyncData<T, E = string> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error";   readonly error: E };

export function asyncIdle(): AsyncData<never> {
  return { status: "idle" };
}

export function asyncLoading(): AsyncData<never> {
  return { status: "loading" };
}

export function asyncSuccess<T>(data: T): AsyncData<T> {
  return { status: "success", data };
}

export function asyncError<E = string>(error: E): AsyncData<never, E> {
  return { status: "error", error };
}

// ─── Discriminated-union helpers ──────────────────────────────────────────────

/**
 * Extracts the member of a discriminated union `T` whose discriminant field
 * `K` equals value `V`.
 *
 * @example
 * type Event = { type: "click"; x: number } | { type: "keydown"; key: string };
 * type ClickEvent = DiscriminatedMember<Event, "type", "click">;
 * // → { type: "click"; x: number }
 */
export type DiscriminatedMember<
  T,
  K extends keyof T,
  V extends T[K],
> = T extends Record<K, V> ? T : never;

// ─── Function helpers ─────────────────────────────────────────────────────────

/** A function that returns `void`. */
export type VoidFn = () => void;

/** A function that accepts any arguments and returns `void`. */
export type AnyVoidFn = (...args: unknown[]) => void;

/** The resolved type of a `Promise<T>`. */
export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;

/**
 * Infers the return type of an async function.
 *
 * @example
 * async function fetchUser() { return { id: "1", name: "Alice" }; }
 * type User = AsyncReturn<typeof fetchUser>; // { id: string; name: string }
 */
export type AsyncReturn<T extends (...args: unknown[]) => Promise<unknown>> =
  Awaited<ReturnType<T>>;

// ─── Component props utilities ────────────────────────────────────────────────

/** Extracts the props of a React component type. */
export type PropsOf<C> = C extends React.ComponentType<infer P> ? P : never;

/**
 * Allows a prop to be either a value or a render function that returns JSX.
 *
 * @example
 * interface Props {
 *   label: RenderProp<{ count: number }>;
 * }
 */
export type RenderProp<P = Record<string, never>> = React.ReactNode | ((props: P) => React.ReactNode);

/**
 * Makes the specified keys of `T` required while leaving the rest optional.
 *
 * @example
 * type Props = RequireKeys<{ id?: string; name?: string; age?: number }, "id" | "name">;
 * // → { id: string; name: string; age?: number }
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Makes the specified keys of `T` optional while leaving the rest required.
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ─── String / number utilities ────────────────────────────────────────────────

/** Extracts only the string keys of an object type. */
export type StringKeys<T> = Extract<keyof T, string>;

/** A string that is not empty (enforced by convention, not the type system). */
export type NonEmptyString = Brand<string, "NonEmptyString">;

/**
 * An ISO-8601 datetime string.
 * Use instead of `string` for date fields to communicate intent.
 */
export type ISODateString = Brand<string, "ISODateString">;

/** A URL string. */
export type UrlString = Brand<string, "UrlString">;

/** An email address string. */
export type EmailString = Brand<string, "EmailString">;

// ─── Pagination ───────────────────────────────────────────────────────────────

/** Standard cursor-based pagination parameters. */
export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: "forward" | "backward";
}

/** Standard offset-based pagination parameters. */
export interface OffsetPaginationParams {
  page: number;
  limit: number;
}

/** Cursor-based paginated response. */
export interface CursorPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  total?: number;
}

// ─── Satisfies helper ─────────────────────────────────────────────────────────

/**
 * Forces `value` to satisfy `T` at the call site while keeping the
 * more specific inferred type.  Sugar around `as const satisfies T`.
 */
export function satisfies<T>() {
  return <V extends T>(value: V): V => value;
}

// Need React import for component types
import type React from "react";
