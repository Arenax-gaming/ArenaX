import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { getDatabaseClient } from './database.service';
import { logger } from './logger.service';

export type WalletKeyAccessAction =
    | 'SIGN'
    | 'EXPORT'
    | 'RECOVERY_CHALLENGE_CREATED'
    | 'RECOVERY_CHALLENGE_COMPLETED'
    | 'ROTATION';

export interface WalletAuditContext {
    walletId: string;
    actorUserId?: string | null;
    action: WalletKeyAccessAction;
    success: boolean;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
    keyVersion?: number;
    metadata?: Record<string, unknown>;
}

const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
        .join(',')}}`;
};

export class WalletAuditService {
    async record(context: WalletAuditContext): Promise<void> {
        const prisma = getDatabaseClient();
        const previousEntry = await prisma.walletKeyAccessAudit.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { entryHash: true }
        });

        const metadata = (context.metadata as Prisma.InputJsonValue | undefined) ?? undefined;
        const previousHash = previousEntry?.entryHash ?? null;

        const entryHash = crypto
            .createHash('sha256')
            .update(
                stableStringify({
                    walletId: context.walletId,
                    actorUserId: context.actorUserId ?? null,
                    action: context.action,
                    success: context.success,
                    requestId: context.requestId ?? null,
                    ipAddress: context.ipAddress ?? null,
                    userAgent: context.userAgent ?? null,
                    reason: context.reason ?? null,
                    keyVersion: context.keyVersion ?? null,
                    metadata,
                    previousHash
                })
            )
            .digest('hex');

        await prisma.walletKeyAccessAudit.create({
            data: {
                walletId: context.walletId,
                actorUserId: context.actorUserId ?? null,
                action: context.action,
                success: context.success,
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                reason: context.reason,
                keyVersion: context.keyVersion,
                ...(metadata === undefined ? {} : { metadata }),
                previousHash,
                entryHash
            }
        });

        logger.info('Wallet key access recorded', {
            walletId: context.walletId,
            actorUserId: context.actorUserId ?? null,
            action: context.action,
            success: context.success,
            requestId: context.requestId
        });
    }
}

export default new WalletAuditService();
