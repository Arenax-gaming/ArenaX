// Export all types. We use explicit named re-exports (instead of `export *`)
// because several names — `Achievement`, `MatchWithPlayers`, `PlayerStats`,
// `EloPoint`, and `UserProfileUpdate` — are exported from more than one
// submodule, which TS flags as TS2308 module ambiguity under `export *`.
//
// Convention:
//   - Source of truth for each duplicated name is listed *first* below.
//   - We then add typing aliases for the alternate sources so consumers
//     who explicitly want that variant can still pull it by name.

export * from "./admin";
export * from "./bracket";
export * from "./leaderboard";
export * from "./match";
export * from "./notification";
export * from "./player";
export * from "./table";
export * from "./tournament";
export * from "./transaction";

// ─── achievement / profile ────────────────────────────────────────────────
// `Achievement` lives in `./achievement` (the canonical game-domain name)
// and `./profile` separately re-exports its own profile-shape `Achievement`.
// We surface the canonical one and alias the alternate to avoid
// ambiguity at consumption sites.
export type {
  Achievement,
  Achievement as ProfileAchievement,
} from "./achievement";

export * from "./profile";

// ─── match / profile ──────────────────────────────────────────────────────
// `MatchWithPlayers` and `PlayerStats` are defined in `./match` and also
// referenced by `./profile` under the same name. Both are intentionally
// the *same* shape, so surface once from `./match` and skip the redundant
// profile-level export (TS still resolves them through either path).
export type {
  MatchWithPlayers,
  PlayerStats,
} from "./match";

// ─── user / profile ───────────────────────────────────────────────────────
// `EloPoint` and `UserProfileUpdate` are defined in `./user` and also
// re-exported by `./profile`. Use the user-module definitions explicitly.
// `AuthUser`, `LoginRequest`, `RegisterRequest` are consumer-facing
// (useAuth.tsx) type-only exports from `./user`.
export type {
  AuthUser,
  LoginRequest,
  RegisterRequest,
  EloPoint,
  UserProfileUpdate,
} from "./user";

// Common API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  code: string;
}

// Common utility types
export type LoadingState = "idle" | "loading" | "success" | "error";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
