import { KafkaMessage } from 'kafkajs';
import { kafkaClient } from './kafka.client';
import { logger } from '../logger.service';

/**
 * Routes poison-pill messages to their domain DLQ topic.
 * DLQ messages carry the original payload plus failure metadata headers.
 */
export class DLQHandler {
  /**
   * Forward a failed message to the specified DLQ topic.
   *
   * @param dlqTopic  Target DLQ topic (e.g. "arenax.match.events.dlq").
   * @param original  The original KafkaMessage that failed.
   * @param reason    Machine-readable failure reason.
   * @param detail    Human-readable error detail for debugging.
   */
  static async send(
    dlqTopic: string,
    original: KafkaMessage,
    reason: string,
    detail: string,
  ): Promise<void> {
    try {
      const producer = kafkaClient.getProducer();
      await producer.send({
        topic: dlqTopic,
        messages: [
          {
            key: original.key,
            value: original.value,
            headers: {
              ...original.headers,
              'dlq.reason': reason,
              'dlq.detail': detail.slice(0, 512), // cap header size
              'dlq.timestamp': new Date().toISOString(),
              'dlq.originalTopic': dlqTopic.replace('.dlq', ''),
            },
          },
        ],
      });

      logger.warn('Message forwarded to DLQ', { dlqTopic, reason, detail: detail.slice(0, 200) });
    } catch (err) {
      // DLQ failure must never crash the consumer — log and move on.
      logger.error('Failed to write to DLQ', {
        dlqTopic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
