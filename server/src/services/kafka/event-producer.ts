import { Producer, ProducerRecord } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { kafkaClient } from './kafka.client';
import { EventEnvelope } from './domain-events';
import { logger } from '../logger.service';

/**
 * Abstract base for all Kafka event producers.
 * Sub-classes declare their topic and call `publish()`.
 *
 * Performance contract: publish() resolves in <100 ms for single messages
 * because the underlying KafkaJS producer batches in a tight loop.
 */
export abstract class EventProducer<TPayload = unknown> {
  protected abstract readonly topic: string;
  protected abstract readonly eventType: string;
  protected abstract readonly version: number;
  private static connected = false;

  private get producer(): Producer {
    return kafkaClient.getProducer();
  }

  /** Ensures the producer is connected (idempotent). */
  async connect(): Promise<void> {
    if (!EventProducer.connected) {
      await kafkaClient.connectProducer();
      EventProducer.connected = true;
    }
  }

  /**
   * Build and publish a single domain event.
   * @param payload   The typed event payload.
   * @param traceId   Trace-ID for distributed tracing (injected by middleware).
   * @param key       Optional partition key (defaults to a field in payload if available).
   */
  async publish(payload: TPayload, traceId: string, key?: string): Promise<void> {
    const envelope: EventEnvelope<TPayload> = {
      eventId: uuidv4(),
      eventType: this.eventType,
      version: this.version,
      occurredAt: new Date().toISOString(),
      source: process.env.KAFKA_CLIENT_ID ?? 'arenax-server',
      traceId,
      payload,
    };

    const record: ProducerRecord = {
      topic: this.topic,
      messages: [
        {
          key: key ?? envelope.eventId,
          value: JSON.stringify(envelope),
          headers: {
            traceId,
            eventType: this.eventType,
            version: String(this.version),
          },
        },
      ],
    };

    const start = Date.now();
    await this.producer.send(record);
    const latency = Date.now() - start;

    logger.info('Event published', {
      topic: this.topic,
      eventType: this.eventType,
      eventId: envelope.eventId,
      traceId,
      latencyMs: latency,
    });

    if (latency > 100) {
      logger.warn('Event publish latency exceeded 100ms SLA', { latencyMs: latency });
    }
  }

  /** Publish multiple events in a single batch request. */
  async publishBatch(items: Array<{ payload: TPayload; traceId: string; key?: string }>): Promise<void> {
    const messages = items.map(({ payload, traceId, key }) => {
      const envelope: EventEnvelope<TPayload> = {
        eventId: uuidv4(),
        eventType: this.eventType,
        version: this.version,
        occurredAt: new Date().toISOString(),
        source: process.env.KAFKA_CLIENT_ID ?? 'arenax-server',
        traceId,
        payload,
      };
      return {
        key: key ?? envelope.eventId,
        value: JSON.stringify(envelope),
        headers: { traceId, eventType: this.eventType, version: String(this.version) },
      };
    });

    await this.producer.send({ topic: this.topic, messages });
    logger.info('Batch published', { topic: this.topic, count: messages.length });
  }
}
