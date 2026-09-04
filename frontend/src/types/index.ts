/**
 * ArenaX — central type barrel
 *
 * Re-exports all domain types so consumers can import from "@/types"
 * without knowing which sub-file to reach into.
 *
 * Governance note:
 * - types/utils.ts  — generic utility / helper types (branded IDs, Result, etc.)
 * - lib/typeGuards.ts — runtime type guard functions
 * Both are intentionally NOT re-exported here to keep the barrel slim;
 * import them directly.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────
export * from "./achievement";
export * from "./admin";
export * from "./analytics";
export * from "./bracket";
// Note: collaboration is exported once (was duplicated before)
export * from "./collaboration";
export * from "./governance";
export * from "./leaderboard";
export * from "./match";
export * from "./notification";
export * from "./player";
export * from "./profile";
export * from "./settings";
export * from "./social";
export * from "./table";
export * from "./tournament";
export * from "./transaction";
export * from "./user";

// ─── Ambiguity resolution ───────────────────────────────────────────────────────
// A few type names are defined in more than one domain file (profile.ts keeps
// display-oriented variants). Explicit re-exports below take precedence over the
// star exports above, so importing these names from "@/types" is unambiguous.
export type { Achievement } from "./achievement";
export type { MatchWithPlayers, PlayerStats } from "./match";
export type { PrivacySettings } from "./settings";
export type { UserProfileUpdate, EloPoint } from "./user";

// ─── Response interceptor types ───────────────────────────────────────────────
export type {
  StandardResponse,
  PaginatedStandardResponse,
  StandardErrorResponse,
  ResponseMeta,
  PaginationMeta,
  ResponseAnalyticsEvent,
  ResponseMonitorSnapshot,
  InterceptorConfig,
  GovernancePolicy,
  GovernanceViolation,
  GovernanceViolationSeverity,
  ResponseStatus,
} from "./response";

// ─── API envelope types ───────────────────────────────────────────────────────

/** Standard success envelope returned by all non-auth API endpoints. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Standard paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Shape of error objects returned on non-2xx responses. */
export interface ApiError {
  error: string;
  message: string;
  code: string;
}

// ─── Generic async state ──────────────────────────────────────────────────────

/**
 * Simple loading-state discriminant for components that need a 4-state flag.
 * Prefer `AsyncData<T>` from `types/utils.ts` for proper narrowing.
 */
export type LoadingState = "idle" | "loading" | "success" | "error";

/**
 * Loose async state bag.  Prefer `AsyncData<T>` from `types/utils.ts` for
 * discriminated-union narrowing.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ─── Re-export utility types ──────────────────────────────────────────────────
// Selectively re-export the most commonly needed utilities so callers can
// import them from "@/types" without the extra path.
export type {
  Brand,
  Unbrand,
  UserId,
  TournamentId,
  MatchId,
  AchievementId,
  ProposalId,
  NotificationId,
  Result,
  Maybe,
  AsyncData,
  AsyncStatus,
  DeepReadonly,
  DeepPartial,
  DeepRequired,
  StrictRecord,
  RequireKeys,
  OptionalKeys,
  ISODateString,
  UrlString,
  EmailString,
  NonEmptyString,
  CursorPaginationParams,
  OffsetPaginationParams,
  CursorPaginatedResponse,
} from "./utils";

export {
  ok,
  err,
  isOk,
  isErr,
  isSome,
  isNone,
  getOrElse,
  mapResult,
  asyncIdle,
  asyncLoading,
  asyncSuccess,
  asyncError,
  satisfies,
} from "./utils";
