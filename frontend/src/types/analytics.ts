// Analytics types and event schema for ArenaX

export type ConsentStatus = "granted" | "denied" | "pending";

export interface ConsentState {
  analytics: ConsentStatus;
  updatedAt: number | null;
}

// Strongly-typed event names
export type AnalyticsEventName =
  | "page_view"
  | "game_start"
  | "game_end"
  | "matchmaking_queued"
  | "matchmaking_matched"
  | "matchmaking_cancelled"
  | "tournament_viewed"
  | "tournament_joined"
  | "tournament_left"
  | "match_score_reported"
  | "match_disputed"
  | "purchase_initiated"
  | "purchase_completed"
  | "purchase_failed"
  | "wallet_connected"
  | "wallet_deposited"
  | "wallet_withdrawn"
  | "auth_signup"
  | "auth_login"
  | "auth_logout"
  | "profile_viewed"
  | "profile_edited"
  | "achievement_unlocked"
  | "ab_test_assigned"
  | "funnel_step";

export interface SessionProperties {
  sessionId: string;
  userId?: string;
  deviceType: string;
  screenWidth: number;
  screenHeight: number;
  sessionStart: number;
}

export interface BaseEventPayload {
  event: AnalyticsEventName;
  timestamp: number;
  sessionId: string;
  userId?: string;
}

// Per-event payload shapes
export interface PageViewPayload extends BaseEventPayload {
  event: "page_view";
  path: string;
  referrer?: string;
}

export interface GameStartPayload extends BaseEventPayload {
  event: "game_start";
  gameMode: string;
  tournamentId?: string;
}

export interface GameEndPayload extends BaseEventPayload {
  event: "game_end";
  gameMode: string;
  durationMs: number;
  outcome: "win" | "loss" | "draw";
}

export interface MatchmakingPayload extends BaseEventPayload {
  event: "matchmaking_queued" | "matchmaking_matched" | "matchmaking_cancelled";
  gameMode: string;
  waitTimeMs?: number;
}

export interface TournamentPayload extends BaseEventPayload {
  event: "tournament_viewed" | "tournament_joined" | "tournament_left";
  tournamentId: string;
  entryFee?: number;
}

export interface PurchasePayload extends BaseEventPayload {
  event: "purchase_initiated" | "purchase_completed" | "purchase_failed";
  amount: number;
  currency: string;
  method?: string;
}

export interface ABTestPayload extends BaseEventPayload {
  event: "ab_test_assigned";
  experimentId: string;
  variant: string;
}

export interface FunnelStepPayload extends BaseEventPayload {
  event: "funnel_step";
  funnelName: string;
  stepName: string;
  stepIndex: number;
}

export interface GenericPayload extends BaseEventPayload {
  event: AnalyticsEventName;
  [key: string]: unknown;
}

export type AnalyticsPayload =
  | PageViewPayload
  | GameStartPayload
  | GameEndPayload
  | MatchmakingPayload
  | TournamentPayload
  | PurchasePayload
  | ABTestPayload
  | FunnelStepPayload
  | GenericPayload;

// Adapter interface for third-party integrations
export interface AnalyticsAdapter {
  name: string;
  track(payload: AnalyticsPayload): void;
  identify?(userId: string, traits?: Record<string, unknown>): void;
  reset?(): void;
}

// A/B test types
export type ABVariant = "control" | "variant";

export interface ABExperiment {
  id: string;
  /** 0–1 fraction of users assigned to variant */
  splitRatio: number;
}

export interface ABAssignment {
  experimentId: string;
  variant: ABVariant;
  assignedAt: number;
}
