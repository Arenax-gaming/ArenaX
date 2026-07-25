import amqplib from 'amqplib';
import { getConfirmChannel, isConnected } from '../config/rabbitmq.config';
import {
    QueueAdapter,
    JobName,
    JobPayload,
    JobHandler,
    JobHandlerContext,
    backoffForAttempt,
} from './queue.service';
import { logger } from './logger.service';

const DLQ_EXCHANGE = 'arenax.dlx';
const MAIN_EXCHANGE = 'arenax.main';
const REPLY_EXCHANGE = 'arenax.reply';

export interface RabbitMQQueueAdapterOptions {
    dlqMaxRetries?: number;
    defaultTtlMs?: number;
}

export class RabbitMQQueueAdapter implements QueueAdapter {
    private handlers = new Map<JobName, JobHandler<unknown>>();
    private channel: any = null;
    private consumerTags: Map<string, string> = new Map();
    private running = true;
    private readonly dlqMaxRetries: number;
    private readonly defaultTtlMs: number;
    private readonly deadLetters: JobPayload[] = [];

    constructor(options: RabbitMQQueueAdapterOptions = {}) {
        this.dlqMaxRetries = options.dlqMaxRetries ?? 5;
        this.defaultTtlMs = options.defaultTtlMs ?? 86_400_000;
    }

    private async getChannel(): Promise<any> {
        if (!this.channel || !isConnected()) {
            this.channel = await getConfirmChannel();
            await this.setupExchanges();
        }
        return this.channel;
    }

    private async setupExchanges(): Promise<void> {
        const ch = this.channel!;
        await ch.assertExchange(MAIN_EXCHANGE, 'direct', { durable: true });
        await ch.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
        await ch.assertExchange(REPLY_EXCHANGE, 'fanout', { durable: false });
    }

    private queueName(name: JobName, priority?: string): string {
        return `arenax.${name}${priority ? `.${priority}` : ''}`;
    }

    private dlqQueueName(name: JobName): string {
        return `arenax.dlq.${name}`;
    }

    async enqueue<T>(payload: JobPayload<T>): Promise<void> {
        if (!this.running) return;
        const ch = await this.getChannel();
        const queue = this.queueName(payload.name, payload.options.priority);

        await ch.assertQueue(queue, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DLQ_EXCHANGE,
                'x-dead-letter-routing-key': `dlq.${payload.name}`,
                'x-message-ttl': this.defaultTtlMs,
            },
        });

        const published = ch.publish(
            MAIN_EXCHANGE,
            payload.name,
            Buffer.from(JSON.stringify(payload)),
            {
                persistent: true,
                correlationId: payload.id,
                timestamp: payload.enqueuedAt,
                headers: {
                    'x-attempt': payload.attempt,
                    'x-job-name': payload.name,
                },
            }
        );

        if (!published) {
            logger.warn('RabbitMQ channel backpressure detected', { jobId: payload.id });
        }
    }

    register<T>(name: JobName, handler: JobHandler<T>): void {
        this.handlers.set(name, handler as JobHandler<unknown>);
        this.startConsumer(name).catch((err) => {
            logger.error('Failed to start consumer', { name, error: err.message });
        });
    }

    private async startConsumer(name: JobName): Promise<void> {
        if (!this.running) return;
        const ch = await this.getChannel();
        const queue = this.queueName(name);

        await ch.assertQueue(queue, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DLQ_EXCHANGE,
                'x-dead-letter-routing-key': `dlq.${name}`,
                'x-message-ttl': this.defaultTtlMs,
            },
        });

        await ch.bindQueue(queue, MAIN_EXCHANGE, name);

        const tag = await ch.consume(
            queue,
            async (msg: any) => {
                if (!msg) return;
                await this.processMessage(msg, name);
            },
            { noAck: false }
        );

        this.consumerTags.set(name, tag.consumerTag);
        logger.info('RabbitMQ consumer started', { name, queue, tag: tag.consumerTag });
    }

    private async processMessage(msg: any, name: JobName): Promise<void> {
        const ch = this.channel!;
        try {
            const payload = JSON.parse(msg.content.toString()) as JobPayload;
            const handler = this.handlers.get(name);
            if (!handler) {
                ch.nack(msg, false, false);
                return;
            }

            await handler(payload.data, {
                attempt: payload.attempt,
                enqueuedAt: payload.enqueuedAt,
            });
            ch.ack(msg);
        } catch (error) {
            const payload = JSON.parse(msg.content.toString()) as JobPayload;
            const nextAttempt = payload.attempt + 1;
            if (nextAttempt > this.dlqMaxRetries) {
                this.deadLetters.push(payload);
                ch.nack(msg, false, false);
                logger.warn('Job moved to dead letters', { name, jobId: payload.id, attempt: nextAttempt });
            } else {
                const retryDelay = backoffForAttempt(nextAttempt, payload.options.backoffMs);
                const retryPayload: JobPayload = {
                    ...payload,
                    attempt: nextAttempt,
                    options: { ...payload.options, delayMs: retryDelay },
                };
                ch.ack(msg);
                await this.publishWithDelay(name, retryPayload, retryDelay);
            }
        }
    }

    private async publishWithDelay(name: string, payload: JobPayload, delayMs: number): Promise<void> {
        const ch = await this.getChannel();
        const queue = `${this.queueName(payload.name)}.delayed`;
        await ch.assertQueue(queue, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': MAIN_EXCHANGE,
                'x-dead-letter-routing-key': name,
                'x-message-ttl': delayMs + 1000,
            },
        });
        ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true });
    }

    async scheduleCron<T>(_expression: string, name: JobName, data: T): Promise<void> {
        logger.info('Cron scheduled via RabbitMQ', { name, expression: _expression });
        const payload: JobPayload<T> = {
            id: `cron-${name}-${Date.now()}`,
            name,
            data,
            enqueuedAt: Date.now(),
            attempt: 1,
            options: {
                attempts: this.dlqMaxRetries,
                backoffMs: 1000,
                priority: 'normal',
            },
        };
        await this.enqueue(payload);
    }

    async listDeadLetters(): Promise<JobPayload[]> {
        return [...this.deadLetters];
    }

    async discardDeadLetter(id: string): Promise<void> {
        const idx = this.deadLetters.findIndex((j) => j.id === id);
        if (idx >= 0) this.deadLetters.splice(idx, 1);
    }

    async stop(): Promise<void> {
        this.running = false;
        for (const [name, tag] of this.consumerTags) {
            try {
                if (this.channel) {
                    await this.channel.cancel(tag);
                }
            } catch (err) {
                logger.error('Failed to cancel consumer', { name, error: (err as Error).message });
            }
        }
        this.consumerTags.clear();
        this.channel = null;
    }
}
