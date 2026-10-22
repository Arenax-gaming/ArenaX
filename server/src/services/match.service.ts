import { getDatabaseClient } from './database.service';
import { MatchStatus } from '@prisma/client';
import { AuditService } from './audit.service';
import { createNotificationService } from './notification.service';

const notificationService = createNotificationService();
import os from 'node:os';

interface MatchRequest {
    playerAId: string;
    playerBId: string;
    onChainId: string;
    resolve: (value: any) => void;
    reject: (err: any) => void;
    timestamp: number;
}

export class MatchService {
    private static creationQueue: MatchRequest[] = [];
    private static isProcessingQueue = false;
    private static CONCURRENCY_LIMIT = 5;
    private static activeProcesses = 0;

    /**
     * Create a new match between players.
     */
    async createMatch(playerAId: string, playerBId: string, onChainId: string): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const request: MatchRequest = {
                playerAId,
                playerBId,
                onChainId,
                resolve,
                reject,
                timestamp: Date.now()
            };

            const cpuLoad = this.getCpuUsage();
            
            // If CPU usage is > 90% or the queue is non-empty, queue the request
            if (cpuLoad > 90 || MatchService.creationQueue.length > 0 || MatchService.activeProcesses >= MatchService.CONCURRENCY_LIMIT) {
                // If queue is extremely long (backpressure), reject
                if (MatchService.creationQueue.length >= 100) {
                    return reject(new Error('Server is currently under heavy load. Please try again later.'));
                }
                
                MatchService.creationQueue.push(request);
                this.processQueue();
            } else {
                try {
                    MatchService.activeProcesses++;
                    const result = await this.executeCreateMatch(playerAId, playerBId, onChainId);
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    MatchService.activeProcesses--;
                    this.processQueue();
                }
            }
        });
    }

    private getCpuUsage(): number {
        const load = os.loadavg()[0];
        const cpus = os.cpus().length;
        return (load / cpus) * 100;
    }

    private async executeCreateMatch(playerAId: string, playerBId: string, onChainId: string) {
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

    private async processQueue() {
        if (MatchService.isProcessingQueue) return;
        MatchService.isProcessingQueue = true;

        while (MatchService.creationQueue.length > 0 && MatchService.activeProcesses < MatchService.CONCURRENCY_LIMIT) {
            const cpuLoad = this.getCpuUsage();
            
            if (cpuLoad > 95) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            const request = MatchService.creationQueue.shift();
            if (!request) continue;

            MatchService.activeProcesses++;
            this.executeCreateMatch(request.playerAId, request.playerBId, request.onChainId)
                .then(result => {
                    request.resolve(result);
                })
                .catch(error => {
                    request.reject(error);
                })
                .finally(() => {
                    MatchService.activeProcesses--;
                    this.processQueue();
                });
        }

        MatchService.isProcessingQueue = false;
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
        status: 'RESOLVED' | 'DISMISSED' | 'REPLAY';
        resolution?: string;
        winnerOverrideId?: string;
    }) {
        const prisma = getDatabaseClient();
        
        const { dispute, updatedDispute } = await prisma.$transaction(async (tx) => {
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
            } else if (data.status === 'REPLAY') {
                // Reset the match so both players can play it again
                await tx.match.update({
                    where: { id: dispute.matchId },
                    data: { status: MatchStatus.CREATED, winnerId: null, startedAt: null, endedAt: null },
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
                action: `DISPUTE_${data.status === 'REPLAY' ? 'REPLAY_ORDERED' : data.status}`,
                targetType: 'MATCH',
                targetId: dispute.matchId,
                details: {
                    disputeId,
                    resolution: data.resolution,
                    winnerOverrideId: data.winnerOverrideId,
                },
            });

            return { dispute, updatedDispute };
        });

        const outcome =
            data.status === 'REPLAY' ? 'A replay has been ordered.'
            : data.status === 'RESOLVED' ? 'The result has been finalized.'
            : 'The dispute was dismissed and the original result stands.';
        await Promise.all(
            [dispute.match.playerAId, dispute.match.playerBId].map((playerId) =>
                notificationService.sendNotification(
                    playerId,
                    'dispute_resolved',
                    'Match dispute resolved',
                    data.resolution ? `${outcome} ${data.resolution}` : outcome,
                ),
            ),
        );

        return updatedDispute;
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
