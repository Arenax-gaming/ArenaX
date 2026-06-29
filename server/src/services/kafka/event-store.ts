/**
 * Event Sourcing: EventStore + EventReplay
 *
 * EventStore persists every domain event to the arenax.event.store Kafka
 * topic (log-compacted, infinite retention). This makes the topic the
 * single source of truth — any aggregate can be reconstructed by reading
 * from offset 0.
 *
 * EventReplay reads back events from an arbitrary time window and re-delivers
 * them to a target topic or a callback. Use for:
 *  - Rebuilding read models after a schema migration.
 *  - Debugging a production incident by replaying events in staging.
 *  - Bootstrapping a new micro-service that needs historical state.
 */

import { Consumer, EachMessagePayload } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { kafkaClient } from './kafka.client';
import { EventEnvelope, TOPICS } from './domain-events';
import { logger } from '../logger.service';

// ─── EventStore ───────────────────────────────────────────────────────────────

export class EventStore {
  /**
   * Append a domain event to the append-only event store topic.
   * All concrete producers should call this alongside their domain topic.
   */
  static async append<T>(envelope: EventEnvelope<T>): Promise<void> {
    const producer = kafkaClient.getProducer();
    await producer.send({
      topic: TOPICS.EVENT_STORE,
      messages: [
        {
          key: `${envelope.eventType}::${envelope.payload && typeof envelope.payload === 'object' && 'userId' in (envelope.payload as object) ? (envelope.payload as { userId: string }).userId : uuidv4()}`,
          value: JSON.stringify(envelope),
          headers: {
            eventType: envelope.eventType,
            version: String(envelope.version),
            traceId: envelope.traceId,
            occurredAt: envelope.occurredAt,
          },
        },
      ],
    });
  }
}

// ─── EventReplay ──────────────────────────────────────────────────────────────

export interface ReplayOptions {
  /** ISO-8601 start timestamp (inclusive). */
  fromTimestamp: string;
  /** ISO-8601 end timestamp (inclusive). Defaults to now. */
  toTimestamp?: string;
  /** Optional filter — only replay events matching these types. */
  eventTypes?: string[];
  /** Replay callback. Return false to stop early. */
  onEvent: (envelope: EventEnvelope) => Promise<boolean | void>;
  /** Consumer group used for this replay run. Unique per replay to avoid offset interference. */
  replayGroupId?: string;
}

export class EventReplay {
  /**
   * Replay events from the event store within a time window.
   *
   * Implementation uses `seekToTimestamp` on the KafkaJS consumer to jump
   * directly to the start offset corresponding to `fromTimestamp`, then
   * reads forward until `toTimestamp` is exceeded.
   */
  static async run(opts: ReplayOptions): Promise<number> {
    const groupId = opts.replayGroupId ?? `arenax.replay.${uuidv4()}`;
    const consumer: Consumer = kafkaClient.createConsumer(groupId);
    let processed = 0;
    const fromMs = new Date(opts.fromTimestamp).getTime();
    const toMs = opts.toTimestamp ? new Date(opts.toTimestamp).getTime() : Date.now();

    await consumer.connect();
    await consumer.subscribe({ topic: TOPICS.EVENT_STORE, fromBeginning: true });

    logger.info('EventReplay started', { groupId, fromTimestamp: opts.fromTimestamp, toTimestamp: opts.toTimestamp ?? 'now' });

    const admin = kafkaClient.getAdmin();
    await admin.connect();

    // Resolve start offsets by timestamp
    const offsets = await admin.fetchTopicOffsetsByTimestamp(TOPICS.EVENT_STORE, fromMs);
    await admin.disconnect();

    await consumer.run({
      autoCommit: true,
      eachMessage: async (msg: EachMessagePayload) => {
        const raw = msg.message.value?.toString();
        if (!raw) return;

        const envelope = JSON.parse(raw) as EventEnvelope;
        const eventMs = new Date(envelope.occurredAt).getTime();

        if (eventMs > toMs) {
          // Past our window — stop
          await consumer.stop();
          return;
        }

        if (opts.eventTypes && !opts.eventTypes.includes(envelope.eventType)) return;

        const cont = await opts.onEvent(envelope);
        processed++;
        if (cont === false) {
          await consumer.stop();
        }
      },
    });

    // Seek to resolved offsets before running
    for (const { partition, offset } of offsets) {
      consumer.seek({ topic: TOPICS.EVENT_STORE, partition, offset: offset ?? '0' });
    }

    await consumer.disconnect();
    logger.info('EventReplay completed', { groupId, processed });
    return processed;
  }
}
