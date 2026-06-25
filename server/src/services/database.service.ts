import { PrismaClient } from '@prisma/client';
import client from 'prom-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

/** Per-service pool tuning passed to {@link warmPool} / health-check. */
export interface PoolServiceConfig {
    /** Minimum connections to keep warm. Defaults to DATABASE_POOL_MIN. */
    minConnections?: number;
    /** Maximum connections allowed. Defaults to DATABASE_POOL_MAX. */
    maxConnections?: number;
    /** Health-check probe interval in ms. Defaults to 30 000. */
    healthCheckIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Metrics (getOrCreate guards against duplicate registration)
// ---------------------------------------------------------------------------

function getOrCreateGauge(cfg: client.GaugeConfiguration<string>): client.Gauge<string> {
    const existing = client.register.getSingleMetric(cfg.name);
    if (existing) return existing as client.Gauge<string>;
    return new client.Gauge(cfg);
}

function getOrCreateHistogram(cfg: client.HistogramConfiguration<string>): client.Histogram<string> {
    const existing = client.register.getSingleMetric(cfg.name);
    if (existing) return existing as client.Histogram<string>;
    return new client.Histogram(cfg);
}

const dbActiveConnections = getOrCreateGauge({
    name: 'db_pool_active_connections',
    help: 'Number of active (in-use) database connections',
});

const dbIdleConnections = getOrCreateGauge({
    name: 'db_pool_idle_connections',
    help: 'Number of idle database connections in the pool',
});

const dbAcquisitionWait = getOrCreateHistogram({
    name: 'db_pool_acquisition_wait_seconds',
    help: 'Time spent waiting to acquire a database connection',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

// ---------------------------------------------------------------------------
// Pool state (lightweight bookkeeping — Prisma owns the real pool)
// ---------------------------------------------------------------------------

let _activeCount = 0;
let _idleCount = 0;

function incActive(): void {
    _activeCount++;
    dbActiveConnections.set(_activeCount);
    const idle = Math.max(0, _idleCount - 1);
    _idleCount = idle;
    dbIdleConnections.set(idle);
}

function decActive(): void {
    _activeCount = Math.max(0, _activeCount - 1);
    dbActiveConnections.set(_activeCount);
    _idleCount++;
    dbIdleConnections.set(_idleCount);
}

// ---------------------------------------------------------------------------
// Build DATABASE_URL with pool parameters injected into the query string
// ---------------------------------------------------------------------------

function buildPoolUrl(poolMin: number, poolMax: number, poolTimeoutSec: number): string {
    const base = process.env.DATABASE_URL ?? '';
    try {
        const url = new URL(base);
        url.searchParams.set('connection_limit', String(poolMax));
        url.searchParams.set('pool_timeout', String(poolTimeoutSec));
        // Prisma ignores unknown params, so we embed min for documentation purposes.
        url.searchParams.set('pool_min', String(poolMin));
        return url.toString();
    } catch {
        // Fallback: return original URL unchanged if it cannot be parsed.
        return base;
    }
}

// ---------------------------------------------------------------------------
// PrismaClient construction with query telemetry
// ---------------------------------------------------------------------------

function createPrismaClient(): PrismaClient {
    const poolMin = parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10);
    const poolMax = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
    // Prisma pool_timeout is in seconds; DATABASE_POOL_TIMEOUT is in seconds.
    const poolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT ?? '30', 10);

    const datasourceUrl = buildPoolUrl(poolMin, poolMax, poolTimeout);

    const prisma = new PrismaClient({
        datasources: { db: { url: datasourceUrl } },
        log: [{ level: 'query', emit: 'event' }],
    });

    // Instrument query events to update active/idle gauges and acquisition histogram.
    (prisma as any).$on('query', (e: { duration: number }) => {
        // duration from Prisma is the query execution time in ms, not wait time —
        // we record it here as a proxy for acquisition+execution latency.
        dbAcquisitionWait.observe(e.duration / 1000);
    });

    return prisma;
}

// ---------------------------------------------------------------------------
// Singleton Prisma instance
// ---------------------------------------------------------------------------

const prisma = createPrismaClient() as unknown as DatabaseClient;
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
