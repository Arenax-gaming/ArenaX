import { EventConsumer } from './event-consumer';
import { EventEnvelope, TOPICS, MatchEndedPayload, AchievementUnlockedPayload } from './domain-events';
import { logger } from '../logger.service';

// ─── MatchConsumer ────────────────────────────────────────────────────────────

/**
 * Consumes match.ended events and drives downstream side-effects:
 * leaderboard refresh, Elo update fan-out, wallet prize crediting.
 *
 * Extend handle() or add subscribers via the onMatchEnded hook for
 * additional cross-cutting concerns without modifying this class.
 */
export class MatchConsumer extends EventConsumer<MatchEndedPayload> {
  protected readonly dlqTopic = TOPICS.DLQ_MATCH;

  private readonly subscribers: Array<(e: EventEnvelope<MatchEndedPayload>) => Promise<void>> = [];

  constructor() {
    super({
      groupId: 'arenax.match.consumers',
      topics: [TOPICS.MATCH_EVENTS],
      maxRetries: 3,
      retryBackoffMs: 200,
    });
  }

  /** Register an additional handler for match.ended events (fan-out). */
  onMatchEnded(fn: (e: EventEnvelope<MatchEndedPayload>) => Promise<void>): void {
    this.subscribers.push(fn);
  }

  protected async handle(envelope: EventEnvelope<MatchEndedPayload>): Promise<void> {
    const { matchId, winnerId, winnerEloChange, loserEloChange } = envelope.payload;

    logger.info('Processing match.ended', { matchId, winnerId, traceId: envelope.traceId });

    // Fan-out to all registered subscribers in parallel
    await Promise.all(this.subscribers.map((fn) => fn(envelope)));
  }
}

// ─── AchievementConsumer ──────────────────────────────────────────────────────

/**
 * Consumes achievement.unlocked events.
 * Drives: notification dispatch, XP ledger update, leaderboard badge sync.
 */
export class AchievementConsumer extends EventConsumer<AchievementUnlockedPayload> {
  protected readonly dlqTopic = TOPICS.DLQ_ACHIEVEMENT;

  constructor() {
    super({
      groupId: 'arenax.achievement.consumers',
      topics: [TOPICS.ACHIEVEMENT_EVENTS],
      maxRetries: 3,
      retryBackoffMs: 200,
    });
  }

  protected async handle(envelope: EventEnvelope<AchievementUnlockedPayload>): Promise<void> {
    const { userId, achievementId, achievementName, xpAwarded } = envelope.payload;

    logger.info('Processing achievement.unlocked', {
      userId,
      achievementId,
      achievementName,
      xpAwarded,
      traceId: envelope.traceId,
    });

    // TODO: dispatch push notification, update XP ledger, sync leaderboard badge
  }
}

// ─── Singleton instances ──────────────────────────────────────────────────────

export const matchConsumer = new MatchConsumer();
export const achievementConsumer = new AchievementConsumer();
