import { getDatabaseClient } from './database.service';
import { MatchStatus } from '@prisma/client';
import { AuditService } from './audit.service';

export class MatchService {
    /**
     * Create a new match between players.
     */
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
