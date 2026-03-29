import { PrismaClient } from '.prisma/client';

export type DatabaseTransactionClient = Pick<
    PrismaClient,
    'ledger'
    | 'walletTransaction'
    | 'user'
    | 'refreshToken'
    | 'userWallet'
    | 'blockchainTransaction'
    | 'proposal'
    | 'vote'
    | 'match'
    | 'dispute'
    | 'auditLog'
    | 'refundRequest'
    | 'project'
    | 'payment'
>;

export interface DatabaseClient extends DatabaseTransactionClient {
    $transaction<T>(
        fn: (tx: DatabaseTransactionClient) => Promise<T>
    ): Promise<T>;
    $disconnect(): Promise<void>;
}

const prisma = new PrismaClient() as unknown as DatabaseClient;
let activeDatabaseClient: DatabaseClient = prisma;

export const getDatabaseClient = (): DatabaseClient => activeDatabaseClient;

export const setDatabaseClientForTesting = (client: DatabaseClient): void => {
    activeDatabaseClient = client;
};

export const resetDatabaseClient = (): void => {
    activeDatabaseClient = prisma;
};

export default prisma;
