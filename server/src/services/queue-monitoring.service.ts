import { getConfirmChannel, isConnected } from '../config/rabbitmq.config';
import { logger } from './logger.service';

export interface QueueStats {
    queue: string;
    messages: number;
    consumers: number;
    messageRate?: number;
}

export interface QueueMonitoringResult {
    connected: boolean;
    queues: QueueStats[];
    timestamp: number;
}

export class QueueMonitoringService {
    async getStats(): Promise<QueueMonitoringResult> {
        if (!isConnected()) {
            return { connected: false, queues: [], timestamp: Date.now() };
        }

        try {
            const ch = await getConfirmChannel();
            const queueNames = [
                'arenax.email.send',
                'arenax.report.generate',
                'arenax.analytics.rollup',
                'arenax.notification.batch',
                'arenax.blockchain.monitor',
                'arenax.data.cleanup',
                'arenax.dlq.email.send',
                'arenax.dlq.report.generate',
                'arenax.dlq.analytics.rollup',
                'arenax.dlq.notification.batch',
                'arenax.dlq.blockchain.monitor',
                'arenax.dlq.data.cleanup',
            ];

            const queues: QueueStats[] = [];
            for (const qName of queueNames) {
                try {
                    const info = await ch.checkQueue(qName);
                    queues.push({
                        queue: qName,
                        messages: info.messageCount,
                        consumers: info.consumerCount,
                    });
                } catch {
                    // Queue doesn't exist yet — that's fine
                }
            }

            return { connected: true, queues, timestamp: Date.now() };
        } catch (error) {
            logger.error('Failed to get queue stats', { error: (error as Error).message });
            return { connected: false, queues: [], timestamp: Date.now() };
        }
    }

    async getQueueHealth(): Promise<{ healthy: boolean; details: string }> {
        if (!isConnected()) {
            return { healthy: false, details: 'RabbitMQ not connected' };
        }

        const stats = await this.getStats();
        const dlqMessages = stats.queues
            .filter((q) => q.queue.startsWith('arenax.dlq.'))
            .reduce((sum, q) => sum + q.messages, 0);

        if (dlqMessages > 100) {
            return {
                healthy: false,
                details: `Dead letter queue backlog: ${dlqMessages} messages`,
            };
        }

        return {
            healthy: true,
            details: `Connected. ${stats.queues.length} queues tracked. DLQ: ${dlqMessages} messages.`,
        };
    }
}

export const defaultQueueMonitoringService = new QueueMonitoringService();
