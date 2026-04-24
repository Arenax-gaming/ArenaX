import { randomUUID } from 'node:crypto';
import { Achievement, Currency, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ACHIEVEMENT_CATALOG } from '../data/achievement-catalog';
import { NotFoundError } from '../errors/not-found-error';
import { ValidationError } from '../errors/validation-error';
import { emitGameEvent, GameEvent, onGameEvent } from './achievement-event-bus';
import { getDatabaseClient } from './database.service';
import { logger } from './logger.service';
import { WalletService } from './wallet.service';

export interface RewardGrant {
    currency: Currency;
    amount: string;
}

export interface AchievementStats {
    achievementId: string;
    playersWithProgress: number;
    unlockedCount: number;
    averageProgress: number | null;
    maxProgress: number | null;
}

export interface ShareAchievementResult {
    shareSlug: string;
    achievementId: string;
    sharedPath: string;
    caption: string | null;
    platform: string | null;
    createdAt: Date;
}

let integrationRegistered = false;

const parseGrants = (rewards: Prisma.JsonValue): RewardGrant[] => {
    if (!rewards || typeof rewards !== 'object' || Array.isArray(rewards)) {
        return [];
    }
    const raw = (rewards as Record<string, unknown>).grants;
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: RewardGrant[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const g = item as Record<string, unknown>;
        const currency = g.currency;
        const amount = g.amount;
        if (
            typeof currency === 'string' &&
            (currency === 'XLM' || currency === 'USDC' || currency === 'AX') &&
            typeof amount === 'string'
        ) {
            const dec = new Decimal(amount);
            if (dec.gt(0)) {
                out.push({ currency: currency as Currency, amount });
            }
        }
    }
    return out;
};

const progressDeltaForAchievement = (achievement: Achievement, event: GameEvent): number => {
    if (!achievement.eventTypes.includes(event.type)) {
        return 0;
    }

    switch (event.type) {
        case 'MATCH_WON':
            return event.payload?.won === true ? 1 : 0;
        case 'MATCH_COMPLETED':
            return 1;
        case 'PROFILE_UPDATED': {
            const hasBio = event.payload?.hasBio === true;
            const hasSocial = event.payload?.hasSocialLinks === true;
            return hasBio || hasSocial ? 1 : 0;
        }
        case 'KYC_APPROVED':
            return 1;
        case 'SEASONAL_ACTIVE':
            return 1;
        default:
            return 0;
    }
};

export class AchievementService {
    private readonly wallet = new WalletService();

    async syncCatalog(): Promise<void> {
        const prisma = getDatabaseClient();
        for (const entry of ACHIEVEMENT_CATALOG) {
            await prisma.achievement.upsert({
                where: { key: entry.key },
                create: {
                    id: randomUUID(),
                    key: entry.key,
                    name: entry.name,
                    description: entry.description,
                    category: entry.category,
                    targetValue: entry.targetValue,
                    eventTypes: entry.eventTypes,
                    rewards: entry.rewards as Prisma.InputJsonValue,
                    hidden: entry.hidden,
                    sortOrder: entry.sortOrder
                },
                update: {
                    name: entry.name,
                    description: entry.description,
                    category: entry.category,
                    targetValue: entry.targetValue,
                    eventTypes: entry.eventTypes,
                    rewards: entry.rewards as Prisma.InputJsonValue,
                    hidden: entry.hidden,
                    sortOrder: entry.sortOrder
                }
            });
        }
    }

    calculateRewards(achievementId: string): Promise<RewardGrant[]> {
        return this.getAchievementById(achievementId).then((a) => parseGrants(a.rewards));
    }

    async getAchievementStats(achievementId: string): Promise<AchievementStats> {
        const prisma = getDatabaseClient();
        const exists = await prisma.achievement.findUnique({
            where: { id: achievementId },
            select: { id: true }
        });
        if (!exists) {
            throw new NotFoundError('Achievement not found');
        }

        const [playersWithProgress, unlockedCount, aggregate] = await Promise.all([
            prisma.playerAchievement.count({
                where: { achievementId, progress: { gt: 0 } }
            }),
            prisma.playerAchievement.count({
                where: { achievementId, unlockedAt: { not: null } }
            }),
            prisma.playerAchievement.aggregate({
                where: { achievementId },
                _avg: { progress: true },
                _max: { progress: true }
            })
        ]);

        return {
            achievementId,
            playersWithProgress,
            unlockedCount,
            averageProgress: aggregate._avg.progress,
            maxProgress: aggregate._max.progress
        };
    }

    private async getAchievementById(achievementId: string): Promise<Achievement> {
        const prisma = getDatabaseClient();
        const achievement = await prisma.achievement.findUnique({ where: { id: achievementId } });
        if (!achievement) {
            throw new NotFoundError('Achievement not found');
        }
        return achievement;
    }

    async listAchievements(options?: { includeHidden?: boolean }): Promise<Achievement[]> {
        const prisma = getDatabaseClient();
        await this.syncCatalog();
        return prisma.achievement.findMany({
            where: options?.includeHidden ? {} : { hidden: false },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
        });
    }

    async getPlayerAchievements(
        playerId: string,
        viewerId?: string | null
    ): Promise<{
        playerId: string;
        viewerIsOwner: boolean;
        achievements: Array<{
            achievement: Achievement;
            progress: number | null;
            unlockedAt: Date | null;
            progressHidden: boolean;
        }>;
    }> {
        const prisma = getDatabaseClient();
        await this.syncCatalog();

        const userExists = await prisma.user.findUnique({
            where: { id: playerId },
            select: { id: true }
        });
        if (!userExists) {
            throw new NotFoundError('Player not found');
        }

        const viewerIsOwner = Boolean(viewerId && viewerId === playerId);

        const [catalog, rows] = await Promise.all([
            prisma.achievement.findMany({
                where: { hidden: false },
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
            }),
            prisma.playerAchievement.findMany({
                where: { userId: playerId },
                include: { achievement: true }
            })
        ]);

        const byAchievementId = new Map(rows.map((r) => [r.achievementId, r]));

        const achievements = catalog.map((achievement) => {
            const row = byAchievementId.get(achievement.id);
            const unlocked = Boolean(row?.unlockedAt);
            const progressHidden = !viewerIsOwner && !unlocked;

            return {
                achievement,
                progress: progressHidden ? null : (row?.progress ?? 0),
                unlockedAt: unlocked ? row!.unlockedAt : null,
                progressHidden
            };
        });

        if (viewerIsOwner) {
            const hiddenCatalog = await prisma.achievement.findMany({
                where: { hidden: true },
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
            });
            for (const achievement of hiddenCatalog) {
                const row = byAchievementId.get(achievement.id);
                achievements.push({
                    achievement,
                    progress: row?.progress ?? 0,
                    unlockedAt: row?.unlockedAt ?? null,
                    progressHidden: false
                });
            }
            achievements.sort((a, b) => {
                if (a.achievement.sortOrder !== b.achievement.sortOrder) {
                    return a.achievement.sortOrder - b.achievement.sortOrder;
                }
                return a.achievement.name.localeCompare(b.achievement.name);
            });
        }

        return { playerId, viewerIsOwner, achievements };
    }

    async updateProgress(playerId: string, achievementId: string, progress: number): Promise<void> {
        if (!Number.isFinite(progress) || progress < 0) {
            throw new ValidationError('progress must be a non-negative number');
        }

        const prisma = getDatabaseClient();
        const achievement = await this.getAchievementById(achievementId);
        const capped = Math.min(Math.floor(progress), achievement.targetValue);

        await prisma.playerAchievement.upsert({
            where: {
                userId_achievementId: { userId: playerId, achievementId }
            },
            create: {
                userId: playerId,
                achievementId,
                progress: capped
            },
            update: {
                progress: capped
            }
        });

        if (capped >= achievement.targetValue) {
            await this.unlockAchievement(playerId, achievementId);
        }
    }

    async unlockAchievement(playerId: string, achievementId: string): Promise<void> {
        const prisma = getDatabaseClient();
        const achievement = await this.getAchievementById(achievementId);

        let row = await prisma.playerAchievement.findUnique({
            where: {
                userId_achievementId: { userId: playerId, achievementId }
            }
        });

        if (row?.rewardClaimedAt) {
            return;
        }

        const earned = (row?.progress ?? 0) >= achievement.targetValue;
        if (!earned) {
            await prisma.playerAchievement.upsert({
                where: {
                    userId_achievementId: { userId: playerId, achievementId }
                },
                create: {
                    userId: playerId,
                    achievementId,
                    progress: achievement.targetValue,
                    unlockedAt: new Date()
                },
                update: {
                    progress: achievement.targetValue,
                    unlockedAt: row?.unlockedAt ?? new Date()
                }
            });
        } else if (!row?.unlockedAt) {
            await prisma.playerAchievement.update({
                where: {
                    userId_achievementId: { userId: playerId, achievementId }
                },
                data: {
                    unlockedAt: new Date(),
                    progress: achievement.targetValue
                }
            });
        }

        row = await prisma.playerAchievement.findUnique({
            where: {
                userId_achievementId: { userId: playerId, achievementId }
            }
        });

        if (!row?.unlockedAt || row.rewardClaimedAt) {
            return;
        }

        await this.createUnlockNotification(playerId, achievementId, achievement.name);

        const grants = parseGrants(achievement.rewards);
        if (grants.length === 0) {
            await prisma.playerAchievement.update({
                where: { id: row.id },
                data: { rewardClaimedAt: new Date() }
            });
            return;
        }

        try {
            for (const grant of grants) {
                const idempotencyKey = `achievement-reward:${achievementId}:${playerId}:${grant.currency}:${grant.amount}`;
                await this.wallet.credit(
                    playerId,
                    grant.currency,
                    new Decimal(grant.amount),
                    idempotencyKey,
                    `Achievement reward: ${achievement.name}`
                );
            }
            await prisma.playerAchievement.update({
                where: { id: row.id },
                data: { rewardClaimedAt: new Date() }
            });
        } catch (err) {
            logger.error('achievement reward distribution failed', {
                playerId,
                achievementId,
                message: err instanceof Error ? err.message : String(err)
            });
        }
    }

    private async createUnlockNotification(
        playerId: string,
        achievementId: string,
        achievementName: string
    ): Promise<void> {
        const prisma = getDatabaseClient();
        const recent = await prisma.achievementNotification.findFirst({
            where: {
                userId: playerId,
                achievementId,
                type: 'UNLOCKED'
            },
            orderBy: { createdAt: 'desc' }
        });
        if (recent && Date.now() - recent.createdAt.getTime() < 5_000) {
            return;
        }

        await prisma.achievementNotification.create({
            data: {
                userId: playerId,
                achievementId,
                type: 'UNLOCKED',
                payload: { title: 'Achievement unlocked', achievementName }
            }
        });
    }

    async checkAchievements(playerId: string, gameEvent: GameEvent): Promise<void> {
        const prisma = getDatabaseClient();
        const achievements = await prisma.achievement.findMany({
            where: {
                eventTypes: { has: gameEvent.type }
            }
        });

        for (const achievement of achievements) {
            const delta = progressDeltaForAchievement(achievement, gameEvent);
            if (delta <= 0) {
                continue;
            }

            const row = await prisma.playerAchievement.findUnique({
                where: {
                    userId_achievementId: { userId: playerId, achievementId: achievement.id }
                }
            });

            if (row?.unlockedAt) {
                continue;
            }

            const current = row?.progress ?? 0;
            const next = Math.min(current + delta, achievement.targetValue);

            await prisma.playerAchievement.upsert({
                where: {
                    userId_achievementId: { userId: playerId, achievementId: achievement.id }
                },
                create: {
                    userId: playerId,
                    achievementId: achievement.id,
                    progress: next
                },
                update: {
                    progress: next
                }
            });

            if (next >= achievement.targetValue) {
                await this.unlockAchievement(playerId, achievement.id);
            }
        }
    }

    async shareAchievement(
        playerId: string,
        achievementId: string,
        input: { caption?: string; platform?: string }
    ): Promise<ShareAchievementResult> {
        const prisma = getDatabaseClient();
        await this.getAchievementById(achievementId);

        const row = await prisma.playerAchievement.findUnique({
            where: {
                userId_achievementId: { userId: playerId, achievementId }
            }
        });

        if (!row?.unlockedAt) {
            throw new ValidationError('Achievement must be unlocked before sharing');
        }

        const share = await prisma.achievementShare.create({
            data: {
                userId: playerId,
                achievementId,
                shareSlug: randomUUID(),
                caption: input.caption,
                platform: input.platform
            }
        });

        return {
            shareSlug: share.shareSlug,
            achievementId,
            sharedPath: `/api/v1/achievements/shared/${share.shareSlug}`,
            caption: share.caption,
            platform: share.platform,
            createdAt: share.createdAt
        };
    }
}

export const achievementService = new AchievementService();

export const registerAchievementIntegration = (): void => {
    if (integrationRegistered) {
        return;
    }
    integrationRegistered = true;
    void achievementService.syncCatalog().catch((err: unknown) => {
        logger.error('achievement catalog sync failed', {
            message: err instanceof Error ? err.message : String(err)
        });
    });
    onGameEvent((event) => achievementService.checkAchievements(event.playerId, event));
};
