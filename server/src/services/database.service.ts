import { PrismaClient } from '@prisma/client';
import { recordQueryExecution } from './slow-query-detector.service';
import { recordMetric } from './query-analytics.service';

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
    $transaction<T>(
        fn: (tx: DatabaseTransactionClient) => Promise<T>
    ): Promise<T>;
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

export const setDatabaseClientForTesting = (client: DatabaseClient): void => {
    activeDatabaseClient = client;
};

export const resetDatabaseClient = (): void => {
    activeDatabaseClient = prisma;
};

export default prisma;
