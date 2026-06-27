import { EventProducer } from './event-producer';
import {
  TOPICS,
  MatchEndedPayload,
  UserRegisteredPayload,
  AchievementUnlockedPayload,
  WalletCreditedPayload,
} from './domain-events';

// ─── MatchProducer ────────────────────────────────────────────────────────────

export class MatchProducer extends EventProducer<MatchEndedPayload> {
  protected readonly topic = TOPICS.MATCH_EVENTS;
  protected readonly eventType = 'match.ended';
  protected readonly version = 1;

  async publishMatchEnded(payload: MatchEndedPayload, traceId: string): Promise<void> {
    // Partition by matchId so all events for the same match land on the same partition
    await this.publish(payload, traceId, payload.matchId);
  }
}

// ─── UserProducer ─────────────────────────────────────────────────────────────

export class UserProducer extends EventProducer<UserRegisteredPayload> {
  protected readonly topic = TOPICS.USER_EVENTS;
  protected readonly eventType = 'user.registered';
  protected readonly version = 1;

  async publishUserRegistered(payload: UserRegisteredPayload, traceId: string): Promise<void> {
    await this.publish(payload, traceId, payload.userId);
  }
}

// ─── AchievementProducer ──────────────────────────────────────────────────────

export class AchievementProducer extends EventProducer<AchievementUnlockedPayload> {
  protected readonly topic = TOPICS.ACHIEVEMENT_EVENTS;
  protected readonly eventType = 'achievement.unlocked';
  protected readonly version = 1;

  async publishAchievementUnlocked(payload: AchievementUnlockedPayload, traceId: string): Promise<void> {
    await this.publish(payload, traceId, payload.userId);
  }
}

// ─── WalletProducer ───────────────────────────────────────────────────────────

export class WalletProducer extends EventProducer<WalletCreditedPayload> {
  protected readonly topic = TOPICS.WALLET_EVENTS;
  protected readonly eventType = 'wallet.credited';
  protected readonly version = 1;

  async publishWalletCredited(payload: WalletCreditedPayload, traceId: string): Promise<void> {
    await this.publish(payload, traceId, payload.userId);
  }
}

// ─── Singleton instances ──────────────────────────────────────────────────────

export const matchProducer = new MatchProducer();
export const userProducer = new UserProducer();
export const achievementProducer = new AchievementProducer();
export const walletProducer = new WalletProducer();
