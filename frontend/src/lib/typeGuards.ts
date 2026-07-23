/**
 * ArenaX — runtime type guards
 *
 * Every guard follows the pattern:
 *   `function isX(value: unknown): value is X`
 *
 * Guards perform structural (duck-type) validation of the minimum fields
 * needed to distinguish one shape from another.  They are intentionally
 * lenient about optional fields so they stay resilient to API evolution.
 */

import type { Maybe } from "@/types/utils";
import type {
  User,
  AuthUser,
  LoginRequest,
  RegisterRequest,
} from "@/types/user";
import type {
  Match,
  MatchWithPlayers,
  MatchStatus,
  MatchResult,
} from "@/types/match";
import type {
  Tournament,
  TournamentStatus,
  TournamentVisibility,
  TournamentType,
} from "@/types/tournament";
import type {
  PersistentNotification,
  ToastNotification,
  NotificationType,
} from "@/types/notification";
import type {
  LeaderboardEntry,
  LeaderboardCategory,
} from "@/types/leaderboard";
import type { ApiResponse, ApiError, PaginatedResponse } from "@/types/index";
import type {
  WalletSession,
  TxHistoryItem,
  TxStatus,
  WalletType,
} from "@/lib/wallet/types";
import type {
  CollaborationUser,
  CollaborationEvent,
  PresenceUser,
} from "@/types/collaboration";
import { CollaborationEventType } from "@/types/collaboration";
import type { PublicProfile, PlayerStats } from "@/types/profile";
import type { Friend, SocialUser, CommunityPost } from "@/types/social";
import type { Achievement } from "@/types/achievement";
import type { Proposal, ProposalStatus } from "@/types/governance";
import type { BracketMatch, BracketData } from "@/types/bracket";
// ─── Primitives ───────────────────────────────────────────────────────────────

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number" && !isNaN(v);
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isArray<T>(
  v: unknown,
  itemGuard?: (item: unknown) => item is T,
): v is T[] {
  if (!Array.isArray(v)) return false;
  if (itemGuard) return v.every(itemGuard);
  return true;
}

export function isNullOrUndefined(v: unknown): v is null | undefined {
  return v === null || v === undefined;
}

export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

// ─── API shapes ───────────────────────────────────────────────────────────────

/**
 * Guards the standard `ApiResponse<T>` envelope from the backend.
 * Validates the envelope shape; does NOT validate the inner `data` type.
 */
export function isApiResponse<T>(v: unknown): v is ApiResponse<T> {
  if (!isObject(v)) return false;
  return typeof v.success === "boolean" && "data" in v;
}

/**
 * Guards the `ApiError` shape returned on non-2xx responses.
 */
export function isApiError(v: unknown): v is ApiError {
  if (!isObject(v)) return false;
  return (
    typeof v.error === "string" &&
    typeof v.message === "string" &&
    typeof v.code === "string"
  );
}

/**
 * Guards the paginated response envelope.
 */
export function isPaginatedResponse<T>(
  v: unknown,
  itemGuard?: (item: unknown) => item is T,
): v is PaginatedResponse<T> {
  if (!isObject(v)) return false;
  if (
    !Array.isArray(v.data) ||
    typeof v.total !== "number" ||
    typeof v.page !== "number" ||
    typeof v.limit !== "number" ||
    typeof v.totalPages !== "number"
  ) {
    return false;
  }
  if (itemGuard) return (v.data as unknown[]).every(itemGuard);
  return true;
}

// ─── User / Auth ──────────────────────────────────────────────────────────────

/**
 * Guards a `User` object.  Checks the minimum required fields.
 */
export function isUser(v: unknown): v is User {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.username === "string" &&
    typeof v.email === "string" &&
    typeof v.isVerified === "boolean" &&
    typeof v.elo === "number" &&
    typeof v.createdAt === "string"
  );
}

/**
 * Guards an `AuthUser` (User with token fields).
 */
export function isAuthUser(v: unknown): v is AuthUser {
  if (!isUser(v)) return false;
  const candidate = v as Partial<AuthUser>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.refreshToken === "string"
  );
}

/**
 * Guards a `LoginRequest` payload.
 */
export function isLoginRequest(v: unknown): v is LoginRequest {
  if (!isObject(v)) return false;
  return typeof v.email === "string" && typeof v.password === "string";
}

/**
 * Guards a `RegisterRequest` payload.
 */
export function isRegisterRequest(v: unknown): v is RegisterRequest {
  if (!isObject(v)) return false;
  return (
    typeof v.username === "string" &&
    typeof v.email === "string" &&
    typeof v.password === "string" &&
    typeof v.confirmPassword === "string"
  );
}

// ─── Match ────────────────────────────────────────────────────────────────────

const MATCH_STATUSES: MatchStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "disputed",
  "cancelled",
];

export function isMatchStatus(v: unknown): v is MatchStatus {
  return typeof v === "string" && (MATCH_STATUSES as string[]).includes(v);
}

/**
 * Guards a `Match` object (base shape without player usernames).
 */
export function isMatch(v: unknown): v is Match {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.player1Id === "string" &&
    typeof v.player2Id === "string" &&
    typeof v.gameType === "string" &&
    isMatchStatus(v.status) &&
    typeof v.createdAt === "string"
  );
}

/**
 * Guards a `MatchWithPlayers` object (adds username fields).
 */
export function isMatchWithPlayers(v: unknown): v is MatchWithPlayers {
  if (!isMatch(v)) return false;
  const candidate = v as Partial<MatchWithPlayers>;
  return (
    typeof candidate.player1Username === "string" &&
    typeof candidate.player2Username === "string"
  );
}

/**
 * Guards a `MatchResult` payload.
 */
export function isMatchResult(v: unknown): v is MatchResult {
  if (!isObject(v)) return false;
  return (
    typeof v.matchId === "string" &&
    typeof v.winnerId === "string" &&
    typeof v.scorePlayer1 === "number" &&
    typeof v.scorePlayer2 === "number"
  );
}

// ─── Tournament ───────────────────────────────────────────────────────────────

const TOURNAMENT_STATUSES: TournamentStatus[] = [
  "draft",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
];

const TOURNAMENT_VISIBILITIES: TournamentVisibility[] = [
  "public",
  "private",
  "invite_only",
];

const TOURNAMENT_TYPES: TournamentType[] = [
  "single_elimination",
  "double_elimination",
  "round_robin",
  "swiss",
];

export function isTournamentStatus(v: unknown): v is TournamentStatus {
  return typeof v === "string" && (TOURNAMENT_STATUSES as string[]).includes(v);
}

export function isTournamentVisibility(v: unknown): v is TournamentVisibility {
  return (
    typeof v === "string" && (TOURNAMENT_VISIBILITIES as string[]).includes(v)
  );
}

export function isTournamentType(v: unknown): v is TournamentType {
  return typeof v === "string" && (TOURNAMENT_TYPES as string[]).includes(v);
}

/**
 * Guards a `Tournament` object.
 */
export function isTournament(v: unknown): v is Tournament {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.gameType === "string" &&
    typeof v.entryFee === "number" &&
    typeof v.prizePool === "number" &&
    typeof v.maxParticipants === "number" &&
    typeof v.currentParticipants === "number" &&
    isTournamentStatus(v.status) &&
    isTournamentVisibility(v.visibility) &&
    typeof v.startTime === "string" &&
    typeof v.createdAt === "string"
  );
}

// ─── Notification ─────────────────────────────────────────────────────────────

const NOTIFICATION_TYPES: NotificationType[] = [
  "info",
  "success",
  "warning",
  "error",
  "match",
];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as string[]).includes(v);
}

/**
 * Guards a `PersistentNotification` (DB-backed).
 */
export function isPersistentNotification(
  v: unknown,
): v is PersistentNotification {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    isNotificationType(v.type) &&
    typeof v.title === "string" &&
    typeof v.message === "string" &&
    typeof v.read === "boolean" &&
    typeof v.createdAt === "string"
  );
}

/**
 * Guards a `ToastNotification` (in-memory).
 */
export function isToastNotification(v: unknown): v is ToastNotification {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    isNotificationType(v.type) &&
    typeof v.title === "string" &&
    typeof v.createdAt === "number"
  );
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

const WALLET_TYPES: WalletType[] = ["freighter", "albedo"];
const TX_STATUSES: TxStatus[] = ["pending", "success", "failed"];

export function isWalletType(v: unknown): v is WalletType {
  return typeof v === "string" && (WALLET_TYPES as string[]).includes(v);
}

export function isTxStatus(v: unknown): v is TxStatus {
  return typeof v === "string" && (TX_STATUSES as string[]).includes(v);
}

/**
 * Guards a `WalletSession`.  This is the same guard used in
 * `src/lib/wallet/storage.ts` — centralised here to avoid duplication.
 */
export function isWalletSession(v: unknown): v is WalletSession {
  if (!isObject(v)) return false;
  return (
    typeof v.publicKey === "string" &&
    isWalletType(v.walletType) &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connectedAt === "string"
  );
}

/**
 * Guards a `TxHistoryItem`.
 */
export function isTxHistoryItem(v: unknown): v is TxHistoryItem {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    isTxStatus(v.status) &&
    typeof v.timestamp === "string"
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

const LEADERBOARD_CATEGORIES: LeaderboardCategory[] = [
  "global",
  "tournaments",
  "casual",
  "ranked",
];

export function isLeaderboardCategory(v: unknown): v is LeaderboardCategory {
  return (
    typeof v === "string" && (LEADERBOARD_CATEGORIES as string[]).includes(v)
  );
}

export function isLeaderboardEntry(v: unknown): v is LeaderboardEntry {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.userId === "string" &&
    typeof v.username === "string" &&
    typeof v.ranking === "number" &&
    typeof v.eloRating === "number" &&
    typeof v.wins === "number" &&
    typeof v.losses === "number"
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function isPublicProfile(v: unknown): v is PublicProfile {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.username === "string" &&
    typeof v.elo === "number" &&
    typeof v.createdAt === "string"
  );
}

export function isPlayerStats(v: unknown): v is PlayerStats {
  if (!isObject(v)) return false;
  return (
    typeof v.elo === "number" &&
    typeof v.globalRank === "number" &&
    typeof v.wins === "number" &&
    typeof v.losses === "number" &&
    typeof v.winRate === "number"
  );
}

// ─── Social ───────────────────────────────────────────────────────────────────

export function isSocialUser(v: unknown): v is SocialUser {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.username === "string" &&
    typeof v.elo === "number"
  );
}

export function isFriend(v: unknown): v is Friend {
  if (!isSocialUser(v)) return false;
  return typeof (v as Partial<Friend>).friendSince === "string";
}

export function isCommunityPost(v: unknown): v is CommunityPost {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.authorId === "string" &&
    typeof v.content === "string" &&
    typeof v.category === "string" &&
    typeof v.likes === "number" &&
    typeof v.isLiked === "boolean" &&
    typeof v.createdAt === "string"
  );
}

// ─── Achievement ──────────────────────────────────────────────────────────────

export function isAchievement(v: unknown): v is Achievement {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.points === "number" &&
    typeof v.isUnlocked !== "undefined"
  );
}

// ─── Governance ───────────────────────────────────────────────────────────────

const PROPOSAL_STATUSES: ProposalStatus[] = [
  "PENDING",
  "APPROVED",
  "EXECUTED",
  "CANCELLED",
  "FAILED",
];

export function isProposalStatus(v: unknown): v is ProposalStatus {
  return typeof v === "string" && (PROPOSAL_STATUSES as string[]).includes(v);
}

export function isProposal(v: unknown): v is Proposal {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.proposal_id === "string" &&
    typeof v.target_contract === "string" &&
    typeof v.function === "string" &&
    isProposalStatus(v.status) &&
    typeof v.proposer === "string" &&
    typeof v.created_at === "string"
  );
}

// ─── Bracket ──────────────────────────────────────────────────────────────────

export function isBracketMatch(v: unknown): v is BracketMatch {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.round === "number" &&
    typeof v.matchNumber === "number" &&
    typeof v.status === "string"
  );
}

export function isBracketData(v: unknown): v is BracketData {
  if (!isObject(v)) return false;
  return (
    typeof v.tournamentId === "string" &&
    typeof v.tournamentName === "string" &&
    typeof v.format === "string" &&
    Array.isArray(v.sections) &&
    typeof v.totalRounds === "number" &&
    Array.isArray(v.prizeDistribution)
  );
}

// ─── Collaboration ────────────────────────────────────────────────────────────

export function isCollaborationUser(v: unknown): v is CollaborationUser {
  if (!isObject(v)) return false;
  return typeof v.id === "string" && typeof v.username === "string";
}

export function isPresenceUser(v: unknown): v is PresenceUser {
  if (!isObject(v)) return false;
  return (
    typeof v.userId === "string" &&
    typeof v.username === "string" &&
    typeof v.color === "string" &&
    typeof v.status === "string"
  );
}

/**
 * Type-safe discriminated-union guard for `CollaborationEvent`.
 * Validates that the `type` field is a known event type.
 */
export function isCollaborationEvent(v: unknown): v is CollaborationEvent {
  if (!isObject(v)) return false;
  const knownTypes = Object.values(CollaborationEventType) as string[];
  return (
    typeof v.type === "string" &&
    knownTypes.includes(v.type) &&
    typeof v.channelId === "string" &&
    typeof v.timestamp === "number" &&
    typeof v.userId === "string"
  );
}

// ─── Maybe / null-safe narrowing helpers ──────────────────────────────────────

/**
 * Asserts that `value` is not null or undefined, throwing `Error(message)`
 * if it is.  Use at trust boundaries (validated form data, session storage).
 *
 * @throws Error when value is nullish
 */
export function assertDefined<T>(
  value: Maybe<T>,
  message = "Expected value to be defined",
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Narrows `value` to `T` after running `guard`.  Throws with `message`
 * when the guard fails.  Useful at API response parse boundaries.
 *
 * @throws Error when guard returns false
 */
export function assertShape<T>(
  value: unknown,
  guard: (v: unknown) => v is T,
  message = "Value did not match expected shape",
): T {
  if (!guard(value)) throw new Error(message);
  return value;
}

/**
 * Parses JSON safely.  Returns `null` instead of throwing on invalid input.
 */
export function safeJsonParse<T>(
  raw: string,
  guard?: (v: unknown) => v is T,
): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (guard) return guard(parsed) ? parsed : null;
    return parsed as T;
  } catch {
    return null;
  }
}


