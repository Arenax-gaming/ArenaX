import { Consumer, EachMessagePayload } from 'kafkajs';
import { kafkaClient } from './kafka.client';
import { EventEnvelope } from './domain-events';
import { DLQHandler } from './dlq.handler';
import { logger } from '../logger.service';

export interface ConsumerConfig {
  /** Kafka consumer group id. */
  groupId: string;
  /** Topics to subscribe to. */
  topics: string[];
  /** Max retry attempts before routing to DLQ. Default: 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 200. */
  retryBackoffMs?: number;
}

/**
 * Abstract base for all Kafka event consumers.
 * Sub-classes implement `handle()` with their business logic.
 *
 * Reliability contract:
 *  - At-least-once delivery via manual offset commit after successful handle().
 *  - Failed messages are retried up to `maxRetries` with exponential backoff.
 *  - Exhausted messages are forwarded to the DLQ topic — never lost.
 *  - Consumer failures do NOT block the main event loop (async/Promise isolation).
 */
export abstract class EventConsumer<TPayload = unknown> {
  protected abstract readonly dlqTopic: string;
  private consumer: Consumer | null = null;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(protected readonly config: ConsumerConfig) {
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBackoffMs = config.retryBackoffMs ?? 200;
  }

  /** Business logic — implement in each concrete consumer. */
  protected abstract handle(envelope: EventEnvelope<TPayload>): Promise<void>;

  async start(): Promise<void> {
    this.consumer = kafkaClient.createConsumer(this.config.groupId);
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: this.config.topics, fromBeginning: false });

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (msg) => this.dispatch(msg),
    });

    logger.info('Kafka consumer started', {
      groupId: this.config.groupId,
      topics: this.config.topics,
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    logger.info('Kafka consumer stopped', { groupId: this.config.groupId });
  }

  private async dispatch(msg: EachMessagePayload): Promise<void> {
    const raw = msg.message.value?.toString();
    if (!raw) return;

    let envelope: EventEnvelope<TPayload>;
    try {
      envelope = JSON.parse(raw) as EventEnvelope<TPayload>;
    } catch {
      logger.error('Failed to parse Kafka message — routing to DLQ', {
        topic: msg.topic,
        offset: msg.message.offset,
      });
      await DLQHandler.send(this.dlqTopic, msg.message, 'parse_error', 'invalid JSON');
      await this.commit(msg);
      return;
    }

    await this.withRetry(envelope, msg);
  }

  private async withRetry(envelope: EventEnvelope<TPayload>, msg: EachMessagePayload): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.handle(envelope);
        await this.commit(msg);
        return;
      } catch (err) {
        lastError = err;
        const backoff = this.retryBackoffMs * Math.pow(2, attempt - 1);
        logger.warn('Consumer handle failed, retrying', {
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          attempt,
          backoffMs: backoff,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(backoff);
      }
    }

    // All retries exhausted → DLQ
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    logger.error('Event routed to DLQ after exhausting retries', {
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      dlqTopic: this.dlqTopic,
    });
    await DLQHandler.send(this.dlqTopic, msg.message, 'max_retries_exceeded', errMsg);
    await this.commit(msg);
  }

  private async commit(msg: EachMessagePayload): Promise<void> {
    await this.consumer?.commitOffsets([
      { topic: msg.topic, partition: msg.partition, offset: String(Number(msg.message.offset) + 1) },
    ]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
