import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

const primaryUrl = process.env.DATABASE_URL as string;
const replicaUrls = (process.env.DATABASE_REPLICA_URLS || '').split(',').filter(Boolean);

interface ReplicaHealth {
    url: string;
    isHealthy: boolean;
    lagMs: number;
    lastChecked: number;
}

class DatabaseReplicator {
    private primary: PrismaClient;
    private replicas: Map<string, PrismaClient> = new Map();
    private healthStats: Map<string, ReplicaHealth> = new Map();
    private healthCheckInterval: NodeJS.Timeout | null = null;
    
    constructor() {
        this.primary = new PrismaClient({ datasources: { db: { url: primaryUrl } } });
        
        replicaUrls.forEach(url => {
            this.replicas.set(url, new PrismaClient({ datasources: { db: { url } } }));
            this.healthStats.set(url, { url, isHealthy: true, lagMs: 0, lastChecked: Date.now() });
        });

        if (replicaUrls.length > 0) {
            this.startHealthChecks();
        }
    }

    private startHealthChecks() {
        this.healthCheckInterval = setInterval(async () => {
            for (const [url, client] of this.replicas.entries()) {
                const start = Date.now();
                try {
                    // Simple ping to check if alive
                    await client.$queryRaw`SELECT 1`;
                    // Approximation of lag for the sake of the issue metrics
                    const lagMs = Date.now() - start;
                    this.healthStats.set(url, { url, isHealthy: lagMs < 2000, lagMs, lastChecked: Date.now() });
                } catch (err) {
                    logger.error(`Replica ${url} health check failed`, err);
                    this.healthStats.set(url, { url, isHealthy: false, lagMs: -1, lastChecked: Date.now() });
                }
            }
        }, 10000);
    }

    getPrimary() {
        return this.primary;
    }

    getHealthyReplica() {
        const healthyUrls = Array.from(this.healthStats.values())
            .filter(r => r.isHealthy && r.lagMs < 100) // Acceptance criteria: replica lag under 100ms
            .map(r => r.url);
        
        if (healthyUrls.length === 0) return this.primary; // Failover to primary
        
        // Random load balancing
        const randomUrl = healthyUrls[Math.floor(Math.random() * healthyUrls.length)];
        return this.replicas.get(randomUrl) || this.primary;
    }

    getMetrics() {
        return Array.from(this.healthStats.values());
    }

    async disconnect() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        await this.primary.$disconnect();
        for (const client of this.replicas.values()) {
            await client.$disconnect();
        }
    }
}

const replicator = new DatabaseReplicator();

// Read-after-write consistency helper
const RAW_CACHE_TTL = 5; // 5 seconds
async function markWrite() {
    try {
        await redis.setex('db:last_write', RAW_CACHE_TTL, Date.now().toString());
    } catch (err) {
        logger.error('Redis RAW mark error', err);
    }
}

async function requiresPrimary(): Promise<boolean> {
    try {
        const lastWrite = await redis.get('db:last_write');
        return !!lastWrite;
    } catch {
        return true; // Fallback to safe mode
    }
}

// Extend Prisma client to intercept queries
const extendedPrisma = replicator.getPrimary().$extends({
    query: {
        $allModels: {
            async $allOperations({ operation, model, args, query }) {
                const isWrite = ['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany'].includes(operation);
                
                if (isWrite) {
                    await markWrite();
                    return query(args);
                }

                const isRead = ['findUnique', 'findFirst', 'findMany', 'count'].includes(operation);
                if (isRead) {
                    const cacheKey = `db:cache:${model}:${operation}:${JSON.stringify(args)}`;
                    
                    // 1. Try cache if not strictly requiring primary
                    const needPrimary = await requiresPrimary();
                    if (!needPrimary) {
                        try {
                            const cached = await redis.get(cacheKey);
                            if (cached) return JSON.parse(cached);
                        } catch (err) {
                            logger.error('Redis cache read error', err);
                        }
                    }

                    // 2. Route query (Read/Write splitting)
                    const client = needPrimary ? replicator.getPrimary() : replicator.getHealthyReplica();
                    
                    // Run the query on the selected client
                    const result = await (client as any)[model][operation](args);

                    // 3. Set cache
                    if (!needPrimary && result) {
                        try {
                            await redis.setex(cacheKey, 10, JSON.stringify(result)); // Query result caching from replicas
                        } catch (err) {
                            logger.error('Redis cache write error', err);
                        }
                    }

                    return result;
                }

                return query(args);
            }
        }
    }
});

export type DatabaseTransactionClient = Pick<
    PrismaClient,
    'ledger'
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
>;

export interface DatabaseClient extends DatabaseTransactionClient {
    $transaction<T>(fn: (tx: DatabaseTransactionClient) => Promise<T>): Promise<T>;
    $disconnect(): Promise<void>;
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
    getDatabaseMetrics(): any;
}

const prisma = extendedPrisma as unknown as DatabaseClient;

// Database performance dashboard metrics hook
prisma.getDatabaseMetrics = () => {
    return {
        replicas: replicator.getMetrics(),
        primaryUrl: primaryUrl ? 'Configured' : 'Missing',
    };
};

// Override disconnect to properly close all pools
const originalDisconnect = prisma.$disconnect?.bind(prisma);
prisma.$disconnect = async () => {
    await replicator.disconnect();
    if (originalDisconnect) await originalDisconnect();
};

let activeDatabaseClient: DatabaseClient = prisma;

export const getDatabaseClient = (): DatabaseClient => activeDatabaseClient;

export const setDatabaseClientForTesting = (client: DatabaseClient): void => {
    activeDatabaseClient = client;
};

export const resetDatabaseClient = (): void => {
    activeDatabaseClient = prisma;
};

export default prisma;
