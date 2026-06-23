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
// Expecting URLs in format: "region|url,region|url"
// e.g. "us-east|postgresql://...,eu-west|postgresql://..."
const rawReplicas = (process.env.DATABASE_REPLICA_URLS || '').split(',').filter(Boolean);

interface ReplicaConfig {
    region: string;
    url: string;
}

interface ReplicaHealth {
    config: ReplicaConfig;
    isHealthy: boolean;
    lagMs: number;
    lastChecked: number;
}

const parseReplicaConfig = (raw: string): ReplicaConfig => {
    const parts = raw.split('|');
    if (parts.length === 2) return { region: parts[0], url: parts[1] };
    return { region: 'global', url: raw }; // Default region
};

class DatabaseReplicator {
    private primary: PrismaClient;
    private replicas: Map<string, PrismaClient> = new Map();
    private healthStats: Map<string, ReplicaHealth> = new Map();
    private healthCheckInterval: NodeJS.Timeout | null = null;
    
    constructor() {
        // Database connection pooling is handled natively by Prisma via the connection_limit in the URL.
        // We append connection_limit=20 to ensure pooling is explicitly configured if missing.
        const poolPrimary = primaryUrl.includes('connection_limit') ? primaryUrl : `${primaryUrl}${primaryUrl.includes('?') ? '&' : '?'}connection_limit=20`;
        this.primary = new PrismaClient({ datasources: { db: { url: poolPrimary } } });
        
        rawReplicas.forEach(raw => {
            const config = parseReplicaConfig(raw);
            const poolUrl = config.url.includes('connection_limit') ? config.url : `${config.url}${config.url.includes('?') ? '&' : '?'}connection_limit=20`;
            
            this.replicas.set(config.url, new PrismaClient({ datasources: { db: { url: poolUrl } } }));
            this.healthStats.set(config.url, { config, isHealthy: true, lagMs: 0, lastChecked: Date.now() });
        });

        if (rawReplicas.length > 0) {
            this.startHealthChecks();
        }
    }

    private startHealthChecks() {
        // Replica health checking
        this.healthCheckInterval = setInterval(async () => {
            for (const [url, client] of this.replicas.entries()) {
                const start = Date.now();
                try {
                    await client.$queryRaw`SELECT 1`;
                    // Replica lag monitoring approximation
                    const lagMs = Date.now() - start;
                    const health = this.healthStats.get(url)!;
                    this.healthStats.set(url, { ...health, isHealthy: lagMs < 2000, lagMs, lastChecked: Date.now() });
                } catch (err) {
                    logger.error(`Replica ${url} health check failed`, err);
                    const health = this.healthStats.get(url)!;
                    this.healthStats.set(url, { ...health, isHealthy: false, lagMs: -1, lastChecked: Date.now() });
                }
            }
        }, 10000);
    }

    getPrimary() {
        return this.primary;
    }

    // Automatic replica selection based on latency & Geographic read routing
    getHealthyReplica(preferredRegion?: string) {
        let healthyReplicas = Array.from(this.healthStats.values())
            .filter(r => r.isHealthy && r.lagMs < 100); // Replica lag is under 100ms
        
        if (healthyReplicas.length === 0) return this.primary; // Failover mechanism
        
        if (preferredRegion) {
            const regionalReplicas = healthyReplicas.filter(r => r.config.region === preferredRegion);
            if (regionalReplicas.length > 0) {
                healthyReplicas = regionalReplicas;
            }
        }
        
        // Replica load balancing: sort by latency (lowest lag first)
        healthyReplicas.sort((a, b) => a.lagMs - b.lagMs);
        
        // Pick the best one based on latency
        const bestUrl = healthyReplicas[0].config.url;
        return this.replicas.get(bestUrl) || this.primary;
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

// Read-after-write consistency
const RAW_CACHE_TTL = 5; 
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
        return true; 
    }
}

const extendedPrisma = replicator.getPrimary().$extends({
    query: {
        $allModels: {
            async $allOperations({ operation, model, args, query }) {
                // Read preference configuration per query
                // Custom flag can be passed in args to override routing
                const customArgs = args as any;
                const forcePrimary = customArgs?._readPreference === 'primary';
                const region = customArgs?._region;
                
                if (customArgs && '_readPreference' in customArgs) delete customArgs._readPreference;
                if (customArgs && '_region' in customArgs) delete customArgs._region;

                // Implement read/write query detection
                const isWrite = ['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany'].includes(operation);
                
                if (isWrite) {
                    await markWrite();
                    return query(customArgs);
                }

                const isRead = ['findUnique', 'findFirst', 'findMany', 'count'].includes(operation);
                if (isRead) {
                    const cacheKey = `db:cache:${model}:${operation}:${JSON.stringify(customArgs)}`;
                    
                    const needPrimary = forcePrimary || await requiresPrimary();
                    
                    // Implement query result caching from replicas
                    if (!needPrimary) {
                        try {
                            const cached = await redis.get(cacheKey);
                            if (cached) return JSON.parse(cached);
                        } catch (err) {
                            logger.error('Redis cache read error', err);
                        }
                    }

                    // Add automatic read replica routing
                    const client = needPrimary ? replicator.getPrimary() : replicator.getHealthyReplica(region);
                    
                    const result = await (client as any)[model][operation](customArgs);

                    if (!needPrimary && result) {
                        try {
                            await redis.setex(cacheKey, 10, JSON.stringify(result));
                        } catch (err) {
                            logger.error('Redis cache write error', err);
                        }
                    }

                    return result;
                }

                return query(customArgs);
            }
        }
    }
});

export type DatabaseTransactionClient = Pick<
    PrismaClient,
    'ledger' | 'walletTransaction' | 'user' | 'refreshToken' | 'userWallet' | 'blockchainTransaction' |
    'walletKeyAccessAudit' | 'walletRecoveryChallenge' | 'ban' | 'gameConfig' | 'moderationItem' | 'proposal' |
    'vote' | 'match' | 'dispute' | 'auditLog' | 'refundRequest' | 'project' | 'payment' | 'kycReview' |
    'achievement' | 'playerAchievement' | 'achievementShare' | 'achievementNotification' | 'tournament' |
    'tournamentParticipant' | 'tournamentMatch' | 'tournamentRegistration' | 'gameSession' | 'gameSessionPlayer' |
    'gameSessionAction' | 'gameSessionEvent' | 'blockchainEvent'
>;

export interface DatabaseClient extends DatabaseTransactionClient {
    // Replica-aware transaction management: ensure transactions always run on primary
    $transaction<T>(fn: (tx: DatabaseTransactionClient) => Promise<T>): Promise<T>;
    $disconnect(): Promise<void>;
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
    getDatabaseMetrics(): any;
}

const prisma = extendedPrisma as unknown as DatabaseClient;

// Replica-aware transaction management
prisma.$transaction = async <T>(fn: (tx: DatabaseTransactionClient) => Promise<T>): Promise<T> => {
    await markWrite(); // Transactions imply mutations or strict consistency needs
    return replicator.getPrimary().$transaction(fn as any);
};

// Create database performance dashboard metrics
prisma.getDatabaseMetrics = () => {
    return {
        replicas: replicator.getMetrics(),
        primaryUrl: primaryUrl ? 'Configured' : 'Missing',
    };
};

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
