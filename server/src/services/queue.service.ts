import Redis, { Redis as RedisClient } from 'ioredis'
import { getEnv } from '../config/env'

/**
 * Foundation for the background-job processing system tracked in #475.
 *
 * The goal of this file is to give every async task — email sends,
 * report generation, blockchain monitoring, analytics rollups — a single
 * entry point with consistent retry, scheduling, and dead-letter
 * behaviour. The actual queue runtime is pluggable: when Bull is added
 * to package.json the {@link QueueAdapter} interface here is what it
 * needs to satisfy; until then a tiny Redis-list-backed adapter keeps
 * callers honest about job shapes so swapping in Bull becomes a
 * mechanical change rather than a design discussion.
 */

export type JobName =
    | 'email.send'
    | 'report.generate'
    | 'analytics.rollup'
    | 'notification.batch'
    | 'blockchain.monitor'
    | 'data.cleanup'

export type JobPriority = 'critical' | 'high' | 'normal' | 'low'

export interface JobOptions {
    /** Total retry budget *after* the initial attempt. Default 5. */
    attempts?: number
    /** Linear backoff base in ms. The nth retry waits `backoffMs * 2^(n-1)`. */
    backoffMs?: number
    /** Priority lane the job is queued onto. Default 'normal'. */
    priority?: JobPriority
    /**
     * Delay in ms before the job becomes eligible to run. Use for
     * one-shot schedules; recurring jobs go through {@link scheduleCron}.
     */
    delayMs?: number
    /**
     * Maximum number of concurrent runners for this job name. Defaults
     * to the queue-wide concurrency. Critical-path jobs (e.g. blockchain
     * settlement) usually want this set to 1.
     */
    concurrency?: number
}

export interface JobPayload<T = unknown> {
    /** Stable client-supplied id. Used for deduplication. */
    id: string
    name: JobName
    data: T
    enqueuedAt: number
    attempt: number
    options: Required<Omit<JobOptions, 'concurrency' | 'delayMs'>> & {
        concurrency?: number
        delayMs?: number
    }
}

export interface JobHandlerContext {
    attempt: number
    enqueuedAt: number
}

export type JobHandler<T = unknown> = (
    data: T,
    ctx: JobHandlerContext,
) => Promise<void>

export interface QueueAdapter {
    enqueue<T>(payload: JobPayload<T>): Promise<void>
    register<T>(name: JobName, handler: JobHandler<T>): void
    /** Cron expression → JobName + data. Idempotent on the same expression. */
    scheduleCron<T>(expression: string, name: JobName, data: T): Promise<void>
    /** Return jobs that exhausted their retry budget so an admin can replay them. */
    listDeadLetters(): Promise<JobPayload[]>
    /** Permanently drop a dead-letter row. */
    discardDeadLetter(id: string): Promise<void>
    stop(): Promise<void>
}

const DEFAULT_ATTEMPTS = 5
const DEFAULT_BACKOFF_MS = 1_000

const NORMALISED_PRIORITIES: Record<JobPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
}

function normaliseOptions(options: JobOptions = {}): JobPayload['options'] {
    return {
        attempts: options.attempts ?? DEFAULT_ATTEMPTS,
        backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
        priority: options.priority ?? 'normal',
        concurrency: options.concurrency,
        delayMs: options.delayMs,
    }
}

/**
 * Compute the delay before the nth retry. Exponential with jitter: keeps
 * retry storms from stampeding a recovering downstream service.
 */
export function backoffForAttempt(attempt: number, baseMs: number): number {
    const exp = baseMs * Math.pow(2, Math.max(0, attempt - 1))
    const jitter = exp * 0.25 * (Math.random() - 0.5)
    return Math.max(0, Math.floor(exp + jitter))
}

/**
 * Minimal Redis-list-backed adapter. It is *not* meant to replace Bull
 * in production — it has no fairness, no per-job concurrency, and no
 * worker liveness pings. Its purpose is to keep the callsites honest
 * about job shapes so the upgrade to Bull is a wiring change instead
 * of an interface rewrite.
 */
export class RedisListQueueAdapter implements QueueAdapter {
    private readonly redis: RedisClient
    private readonly handlers = new Map<JobName, JobHandler<unknown>>()
    private readonly cronKeys = new Set<string>()
    private running = true

    constructor(redis?: RedisClient) {
        if (!redis && !process.env.REDIS_URL) {
            throw new Error(
                'queue.service: REDIS_URL must be configured before instantiating the queue adapter.',
            );
        }
        this.redis = redis ?? new Redis(getEnv().REDIS_URL as string)
    }

    private listKey(priority: JobPriority): string {
        return `arenax:jobs:queue:${priority}`
    }

    private deadLetterKey(): string {
        return 'arenax:jobs:dead-letter'
    }

    async enqueue<T>(payload: JobPayload<T>): Promise<void> {
        await this.redis.rpush(this.listKey(payload.options.priority), JSON.stringify(payload))
    }

    register<T>(name: JobName, handler: JobHandler<T>): void {
        this.handlers.set(name, handler as JobHandler<unknown>)
    }

    async scheduleCron<T>(expression: string, name: JobName, data: T): Promise<void> {
        const key = `arenax:jobs:cron:${expression}:${name}`
        if (this.cronKeys.has(key)) return
        this.cronKeys.add(key)
        await this.redis.set(key, JSON.stringify({ expression, name, data, registeredAt: Date.now() }))
    }

    async listDeadLetters(): Promise<JobPayload[]> {
        const raw = await this.redis.lrange(this.deadLetterKey(), 0, -1)
        return raw.map((row) => JSON.parse(row) as JobPayload)
    }

    async discardDeadLetter(id: string): Promise<void> {
        const raw = await this.redis.lrange(this.deadLetterKey(), 0, -1)
        for (const row of raw) {
            const parsed = JSON.parse(row) as JobPayload
            if (parsed.id === id) {
                await this.redis.lrem(this.deadLetterKey(), 1, row)
                return
            }
        }
    }

    async stop(): Promise<void> {
        this.running = false
        await this.redis.quit()
    }

    /**
     * Single-tick worker — pulls one job from the highest-priority lane
     * that has work and runs it. Production code uses Bull, which gives
     * us multi-worker fairness for free; this helper is enough for
     * unit tests and a temporary fallback when Redis is the only
     * runtime available.
     */
    async _consumeOnce(now: number = Date.now()): Promise<boolean> {
        if (!this.running) return false
        const lanes = (Object.keys(NORMALISED_PRIORITIES) as JobPriority[]).sort(
            (a, b) => NORMALISED_PRIORITIES[a] - NORMALISED_PRIORITIES[b],
        )
        for (const lane of lanes) {
            const raw = await this.redis.lpop(this.listKey(lane))
            if (!raw) continue

            const payload = JSON.parse(raw) as JobPayload
            if (payload.options.delayMs && payload.enqueuedAt + payload.options.delayMs > now) {
                // Not yet eligible — push back to the tail so other ready
                // jobs in the same lane run first.
                await this.redis.rpush(this.listKey(lane), raw)
                continue
            }

            const handler = this.handlers.get(payload.name)
            if (!handler) {
                // Unknown job type — park to DLQ so it doesn't loop.
                await this.redis.rpush(this.deadLetterKey(), raw)
                return true
            }

            try {
                await handler(payload.data, {
                    attempt: payload.attempt,
                    enqueuedAt: payload.enqueuedAt,
                })
            } catch (err) {
                const nextAttempt = payload.attempt + 1
                if (nextAttempt > payload.options.attempts) {
                    await this.redis.rpush(this.deadLetterKey(), raw)
                } else {
                    const next: JobPayload = {
                        ...payload,
                        attempt: nextAttempt,
                        options: {
                            ...payload.options,
                            delayMs: backoffForAttempt(nextAttempt, payload.options.backoffMs),
                        },
                    }
                    await this.redis.rpush(this.listKey(lane), JSON.stringify(next))
                }
                throw err
            }
            return true
        }
        return false
    }
}

let activeAdapter: QueueAdapter | null = null

export function getQueueAdapter(): QueueAdapter {
    if (activeAdapter) return activeAdapter
    activeAdapter = new RedisListQueueAdapter()
    return activeAdapter
}

export function setQueueAdapter(adapter: QueueAdapter | null): void {
    activeAdapter = adapter
}

export async function enqueueJob<T>(
    name: JobName,
    id: string,
    data: T,
    options: JobOptions = {},
): Promise<void> {
    const payload: JobPayload<T> = {
        id,
        name,
        data,
        enqueuedAt: Date.now(),
        attempt: 1,
        options: normaliseOptions(options),
    }
    await getQueueAdapter().enqueue(payload)
}
