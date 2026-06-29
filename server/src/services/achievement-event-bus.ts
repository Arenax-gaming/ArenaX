/**
 * achievement-event-bus.ts — Kafka-backed replacement for the previous
 * in-process EventEmitter bus.
 *
 * Backwards-compatible surface: existing callers that use `emitGameEvent` /
 * `onGameEvent` continue to work. Events are now also published to Kafka so
 * downstream services can consume them independently.
 *
 * Migration path:
 *  - Phase 1 (now): hybrid mode — local EventEmitter fires synchronously
 *    for in-process handlers; Kafka publish runs async in the background.
 *  - Phase 2: remove local EventEmitter once all handlers are migrated to
 *    dedicated Kafka consumers.
 */
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.service';
import { achievementProducer, matchProducer, userProducer } from './kafka/producers';
import { EventStore } from './kafka/event-store';
import type { EventEnvelope } from './kafka/domain-events';

export type GameEventType =
  | 'MATCH_WON'
  | 'MATCH_COMPLETED'
  | 'PROFILE_UPDATED'
  | 'KYC_APPROVED'
  | 'SEASONAL_ACTIVE';

export interface GameEvent {
  type: GameEventType;
  playerId: string;
  payload?: Record<string, unknown>;
  /** Optional trace id — generated if absent. */
  traceId?: string;
}

type GameEventHandler = (event: GameEvent) => void | Promise<void>;

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Emit a game event. Local handlers fire immediately; Kafka publish is fire-and-forget. */
export const emitGameEvent = (event: GameEvent): void => {
  const traceId = event.traceId ?? uuidv4();
  const enriched = { ...event, traceId };

  // 1. In-process fan-out (backwards-compatible)
  setImmediate(() => {
    bus.emit('game', enriched);
  });

  // 2. Kafka publish — non-blocking
  void publishToKafka(enriched, traceId).catch((err) => {
    logger.warn('Kafka publish failed for game event (non-fatal)', {
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
  });
};

export const onGameEvent = (handler: GameEventHandler): void => {
  bus.on('game', (evt: GameEvent) => {
    void Promise.resolve(handler(evt)).catch((err: unknown) => {
      logger.error('achievement game event handler failed', {
        type: evt.type,
        playerId: evt.playerId,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });
};

// ─── Internal: map game events → domain events ────────────────────────────────

async function publishToKafka(event: GameEvent, traceId: string): Promise<void> {
  await achievementProducer.connect();

  switch (event.type) {
    case 'MATCH_WON':
    case 'MATCH_COMPLETED': {
      const payload = event.payload ?? {};
      const envelope: EventEnvelope = {
        eventId: uuidv4(),
        eventType: 'match.ended',
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'achievement-event-bus',
        traceId,
        payload: {
          matchId: (payload.matchId as string) ?? uuidv4(),
          playerAId: event.playerId,
          playerBId: (payload.opponentId as string) ?? '',
          winnerId: event.type === 'MATCH_WON' ? event.playerId : (payload.winnerId as string) ?? '',
          winnerEloChange: (payload.winnerEloChange as number) ?? 0,
          loserEloChange: (payload.loserEloChange as number) ?? 0,
          durationSeconds: (payload.durationSeconds as number) ?? 0,
        },
      };
      await matchProducer.publish(envelope.payload as never, traceId, envelope.eventId);
      await EventStore.append(envelope);
      break;
    }

    case 'KYC_APPROVED': {
      const envelope: EventEnvelope = {
        eventId: uuidv4(),
        eventType: 'user.registered',
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'achievement-event-bus',
        traceId,
        payload: {
          userId: event.playerId,
          username: (event.payload?.username as string) ?? '',
          email: (event.payload?.email as string) ?? '',
          registeredVia: 'phone',
        },
      };
      await userProducer.publish(envelope.payload as never, traceId, event.playerId);
      await EventStore.append(envelope);
      break;
    }

    default:
      // PROFILE_UPDATED, SEASONAL_ACTIVE — store only, no specific domain topic
      {
        const envelope: EventEnvelope = {
          eventId: uuidv4(),
          eventType: event.type.toLowerCase().replace('_', '.'),
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'achievement-event-bus',
          traceId,
          payload: { playerId: event.playerId, ...event.payload },
        };
        await EventStore.append(envelope);
      }
      break;
  }
}
