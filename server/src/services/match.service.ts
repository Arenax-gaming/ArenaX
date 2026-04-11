<<<<<<< HEAD
import { getDatabaseClient } from './database.service';
import { MatchStatus } from '@prisma/client';
import { AuditService } from './audit.service';
=======
import Redis from "ioredis";
>>>>>>> c7b3506 (feat(server): implement Redis based queue with ZSET and metadata storage)

export class MatchService {
    private redis: Redis;

    constructor(redisClient: Redis) {
        this.redis = redisClient;
    }

    /**
     * Create if a player is already queued.
     */
<<<<<<< HEAD
    async createMatch(playerAId: string, playerBId: string, onChainId: string) {
        const prisma = getDatabaseClient();
        return await prisma.match.create({
            data: {
                playerAId,
                playerBId,
                onChainId,
                status: MatchStatus.CREATED,
            },
        });
=======
    async isQueued(playerId: string): Promise<boolean> {
        const exists = await this.redis.sismember("queue:active", playerId);
        return exists === 1;
    }
    /**
     * Add a player to matchmaking queue.
     */
    async joinQueue(playerId: string, elo: number, group: string) {
        const alreadyQueued = await this.isQueued(playerId);

        if(alreadyQueued) {
            throw new Error("Player already in matchmaking queue");
        }
        const queueKey = `queue:elo:${group}`;
        const metaKey = `queue:meta:${playerId}`;
        const now = Date.now();

        const multi = this.redis.multi();

        //Add to sorted set(score = elo)
        multi.zadd(queueKey, elo, playerId);

        //Store metadata
        multi.hset(metaKey, {
            elo: elo.toString(),
            joinedAt: now.toString(),
            group,
        });
        //Add to active set
        multi.sadd("queue:active", playerId);
        await multi.exec();
        return {success:  true};

    }
    /**
     * Remove player from matchmaking queue.
     */
    async leaveQueue(playerId: string) {
        const metaKey = `queue:meta:${playerId}`;
        const metadata = await this.redis.hgetall(metaKey);

        if (!metadata || !metadata.group) {
            throw new Error("Player is not in queue");
        }
        const queueKey = `queue:elo:${metadata.group}`;
        const multi = this.redis.multi();

        //remove from sorted set
        multi.zrem(queueKey, playerId);

        //delete metadata
        multi.del(metaKey);

        //remove from active set
        multi.srem("queue:active", playerId);

        await multi.exec();

        return {success: true};


    }
    async createMatch(player1Id: string, player2Id: string, matchType: string) {
        // Placeholder for match creation
        console.log(`Creating match ${player1Id} vs ${player2Id}`);

        //TODO: Save in DB
        return {
            player1Id,
            player2Id,
            state: "PENDING",
            matchType,
        }
>>>>>>> c7b3506 (feat(server): implement Redis based queue with ZSET and metadata storage)
    }

    /**
     * Report score for a match.
     */
    async reportScore(matchId: string, winnerId: string) {
        const prisma = getDatabaseClient();
        return await prisma.match.update({
            where: { id: matchId },
            data: {
                winnerId,
                status: MatchStatus.COMPLETED,
                endedAt: new Date(),
            },
        });
    }

    /**
     * Raise a dispute for a match.
     */
    async raiseDispute(matchId: string, reporterId: string, data: {
        reason: string;
        evidenceUrls: string[];
    }) {
        const prisma = getDatabaseClient();
        
        return await prisma.$transaction(async (tx) => {
            // Update match status to DISPUTED
            await tx.match.update({
                where: { id: matchId },
                data: { status: MatchStatus.DISPUTED },
            });

            // Create dispute record
            return await tx.dispute.create({
                data: {
                    matchId,
                    reporterId,
                    reason: data.reason,
                    evidenceUrls: data.evidenceUrls,
                    status: 'OPEN',
                },
            });
        });
    }

    /**
     * Resolve a dispute (Admin action).
     */
    async resolveDispute(disputeId: string, adminId: string, data: {
        status: 'RESOLVED' | 'DISMISSED';
        resolution?: string;
        winnerOverrideId?: string;
    }) {
        const prisma = getDatabaseClient();
        
        return await prisma.$transaction(async (tx) => {
            const dispute = await tx.dispute.findUnique({
                where: { id: disputeId },
                include: { match: true }
            });

            if (!dispute) throw new Error('Dispute not found');

            // Update dispute
            const updatedDispute = await tx.dispute.update({
                where: { id: disputeId },
                data: {
                    status: data.status,
                    resolution: data.resolution,
                    resolvedById: adminId,
                    resolvedAt: new Date(),
                },
            });

            // If resolved, update match status and optionally winner
            if (data.status === 'RESOLVED') {
                await tx.match.update({
                    where: { id: dispute.matchId },
                    data: {
                        status: MatchStatus.FINALIZED,
                        winnerId: data.winnerOverrideId || dispute.match.winnerId,
                    },
                });
            } else {
                // If dismissed, just finalize the match with original result
                await tx.match.update({
                    where: { id: dispute.matchId },
                    data: { status: MatchStatus.FINALIZED },
                });
            }

            // Log the admin action
            await AuditService.logAction({
                adminId,
                action: data.status === 'RESOLVED' ? 'DISPUTE_RESOLVED' : 'DISPUTE_DISMISSED',
                targetType: 'MATCH',
                targetId: dispute.matchId,
                details: {
                    disputeId,
                    resolution: data.resolution,
                    winnerOverrideId: data.winnerOverrideId,
                },
            });

            return updatedDispute;
        });
    }

    /**
     * List open disputes for the dashboard.
     */
    async listOpenDisputes() {
        const prisma = getDatabaseClient();
        return await prisma.dispute.findMany({
            where: { status: 'OPEN' },
            include: {
                match: true,
                reporter: {
                    select: { username: true }
                }
            },
            orderBy: { createdAt: 'asc' },
        });
    }
}
