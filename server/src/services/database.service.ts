import { PrismaClient } from '@prisma/client';
import { recordQueryExecution } from './slow-query-detector.service';
import { recordMetric } from './query-analytics.service';

export type DatabaseTransactionClient = Pick<
    PrismaClient,
    | 'ledger'
    | 'walletTransaction'
    | 'user'
    | 'refreshToken'
    | 'userWallet'
    | 'blockchainTransaction'
    | 'walletKeyAccessAudit'
    | 'walletRecoveryChallenge'
    | 'ban'
    | 'gameConfig'
    | 'moderationItem'
    | 'proposal'
    | 'vote'
    | 'match'
    | 'dispute'
    | 'auditLog'
    | 'refundRequest'
    | 'project'
    | 'payment'
    | 'kycReview'
    | 'achievement'
    | 'playerAchievement'
    | 'achievementShare'
    | 'achievementNotification'
    | 'tournament'
    | 'tournamentParticipant'
    | 'tournamentMatch'
    | 'tournamentRegistration'
    | 'gameSession'
    | 'gameSessionPlayer'
    | 'gameSessionAction'
    | 'gameSessionEvent'
    | 'blockchainEvent'
    | 'featureFlag'
    | 'featureFlagAuditLog'
    | 'apiKey'
>;

export interface DatabaseClient extends DatabaseTransactionClient {
    $transaction<T>(fn: (tx: DatabaseTransactionClient) => Promise<T>): Promise<T>;
    $disconnect(): Promise<void>;
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
    $use(cb: (params: any, next: (params: any) => Promise<any>) => Promise<any>): void;
}

const prisma = new PrismaClient() as unknown as DatabaseClient;

const SLOW_THRESHOLD = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '500', 10);

prisma.$use(async (params, next) => {
    const start = Date.now();
    try {
        const result = await next(params);
        const duration = Date.now() - start;
        const model = params.model || 'raw';
        const isSlow = duration >= SLOW_THRESHOLD;

        recordQueryExecution(model, `${params.action}.${params.model}`, params.args, duration);
        recordMetric({
            model,
            durationMs: duration,
            isSlow,
            isCached: false,
            isError: false,
            timestamp: new Date(),
        });

        return result;
    } catch (err) {
        const duration = Date.now() - start;
        recordMetric({
            model: params.model || 'raw',
            durationMs: duration,
            isSlow: false,
            isCached: false,
            isError: true,
            timestamp: new Date(),
        });
        throw err;
    }
});

let activeDatabaseClient: DatabaseClient = prisma;

export const getDatabaseClient = (): DatabaseClient => activeDatabaseClient;

/** Replace the client (test use only). */
export const setDatabaseClientForTesting = (c: DatabaseClient): void => {
    activeDatabaseClient = c;
};

export const resetDatabaseClient = (): void => {
    activeDatabaseClient = prisma;
};

// ---------------------------------------------------------------------------
// Connection pre-warming
// ---------------------------------------------------------------------------

/**
 * Pre-warms the pool by firing `minConnections` concurrent `SELECT 1` probes.
 * Call this during service startup, before accepting traffic.
 */
export async function warmPool(cfg: PoolServiceConfig = {}): Promise<void> {
    const min = cfg.minConnections ?? parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10);
    const probes = Array.from({ length: min }, () =>
        (activeDatabaseClient as any).$queryRaw`SELECT 1`.catch(() => null)
    );
    await Promise.all(probes);
    _idleCount = min;
    dbIdleConnections.set(_idleCount);
}

// ---------------------------------------------------------------------------
// Continuous health-check loop
// ---------------------------------------------------------------------------

let _healthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic health-check loop that probes the pool with `SELECT 1`.
 * Stale connections are detected and logged; Prisma automatically refreshes
 * them on the next acquire.
 *
 * @returns A cleanup function that stops the loop.
 */
export function startPoolHealthCheck(cfg: PoolServiceConfig = {}): () => void {
    const intervalMs = cfg.healthCheckIntervalMs ?? 30_000;

    if (_healthInterval) clearInterval(_healthInterval);

    _healthInterval = setInterval(async () => {
        const start = Date.now();
        try {
            incActive();
            await (activeDatabaseClient as any).$queryRaw`SELECT 1`;
            decActive();
            const latencyMs = Date.now() - start;
            if (latencyMs > 500) {
                console.warn('[db-pool] health probe slow', { latencyMs });
            }
        } catch (err) {
            decActive();
            console.error('[db-pool] health probe failed — pool may be degraded', { err });
        }
    }, intervalMs);

    // Allow the process to exit even if the interval is still active.
    if (_healthInterval.unref) _healthInterval.unref();

    return stopPoolHealthCheck;
}

function stopPoolHealthCheck(): void {
    if (_healthInterval) {
        clearInterval(_healthInterval);
        _healthInterval = null;
    }
}

// ---------------------------------------------------------------------------
// Graceful drain
// ---------------------------------------------------------------------------

/**
 * Gracefully drain the connection pool.
 * Waits for in-flight queries to finish, then calls `$disconnect()`.
 * Should be called from SIGTERM / SIGINT handlers.
 */
export async function drainPool(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    stopPoolHealthCheck();

    while (_activeCount > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
    }

    await activeDatabaseClient.$disconnect();
    _activeCount = 0;
    _idleCount = 0;
    dbActiveConnections.set(0);
    dbIdleConnections.set(0);
}

export default prisma;
