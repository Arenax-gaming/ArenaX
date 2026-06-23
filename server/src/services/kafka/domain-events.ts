/**
 * Domain event schemas for Kafka event bus.
 * All events carry a common envelope + a versioned payload.
 * Version is incremented only on breaking schema changes; additive
 * fields are backwards-compatible and do not require a version bump.
 */

// ─── Envelope ────────────────────────────────────────────────────────────────

export interface EventEnvelope<T = unknown> {
  /** Globally unique event id (UUID v4). */
  eventId: string;
  /** Domain event type e.g. "user.registered". */
  eventType: string;
  /** Schema version — increment on breaking change. */
  version: number;
  /** ISO-8601 timestamp of when the event was produced. */
  occurredAt: string;
  /** Service that emitted the event. */
  source: string;
  /** Correlation id for distributed tracing. */
  traceId: string;
  /** Optional causation chain. */
  causationId?: string;
  payload: T;
}

// ─── Topic constants ──────────────────────────────────────────────────────────

export const TOPICS = {
  USER_EVENTS: 'arenax.user.events',
  MATCH_EVENTS: 'arenax.match.events',
  ACHIEVEMENT_EVENTS: 'arenax.achievement.events',
  WALLET_EVENTS: 'arenax.wallet.events',
  // Dead-letter topics (one per domain)
  DLQ_USER: 'arenax.user.events.dlq',
  DLQ_MATCH: 'arenax.match.events.dlq',
  DLQ_ACHIEVEMENT: 'arenax.achievement.events.dlq',
  DLQ_WALLET: 'arenax.wallet.events.dlq',
  // Event store topic for sourcing / replay
  EVENT_STORE: 'arenax.event.store',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

// ─── user.registered (v1) ────────────────────────────────────────────────────

export interface UserRegisteredPayload {
  userId: string;
  username: string;
  email: string;
  phoneNumber?: string;
  stellarPublicKey?: string;
  registeredVia: 'phone' | 'google' | 'discord' | 'twitch';
}

export type UserRegisteredEvent = EventEnvelope<UserRegisteredPayload> & {
  eventType: 'user.registered';
  version: 1;
};

// ─── match.ended (v1) ────────────────────────────────────────────────────────

export interface MatchEndedPayload {
  matchId: string;
  tournamentId?: string;
  playerAId: string;
  playerBId: string;
  winnerId: string;
  loserEloChange: number;
  winnerEloChange: number;
  durationSeconds: number;
  onChainTxHash?: string;
}

export type MatchEndedEvent = EventEnvelope<MatchEndedPayload> & {
  eventType: 'match.ended';
  version: 1;
};

// ─── achievement.unlocked (v1) ───────────────────────────────────────────────

export interface AchievementUnlockedPayload {
  userId: string;
  achievementId: string;
  achievementName: string;
  xpAwarded: number;
  triggeredBy: string; // e.g. 'match.ended'
}

export type AchievementUnlockedEvent = EventEnvelope<AchievementUnlockedPayload> & {
  eventType: 'achievement.unlocked';
  version: 1;
};

// ─── wallet.credited (v1) ────────────────────────────────────────────────────

export interface WalletCreditedPayload {
  userId: string;
  walletId: string;
  amount: number;
  currency: 'NGN' | 'XLM' | 'AXT';
  reason: 'tournament_win' | 'refund' | 'deposit' | 'reward';
  referenceId: string;
  stellarTxHash?: string;
}

export type WalletCreditedEvent = EventEnvelope<WalletCreditedPayload> & {
  eventType: 'wallet.credited';
  version: 1;
};

// ─── Union type for all domain events ────────────────────────────────────────

export type DomainEvent =
  | UserRegisteredEvent
  | MatchEndedEvent
  | AchievementUnlockedEvent
  | WalletCreditedEvent;
