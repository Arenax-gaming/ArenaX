import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuditService } from '../services/audit.service';
import paymentMonitorWorker from '../services/payment-monitor.worker';
import prisma from '../services/database.service';
import { createAdminService, AdminService } from '../services/admin.service';

const matchService = new MatchService();
const adminService: AdminService = createAdminService();

export const listDisputes = async (_req: Request, res: Response): Promise<void> => {
    try {
        const disputes = await matchService.listOpenDisputes();
        res.status(200).json(disputes);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const resolveDispute = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { status, resolution, winnerOverrideId } = req.body;
        const result = await matchService.resolveDispute(id, req.user!.id, {
            status,
            resolution,
            winnerOverrideId
        });

        // Detailed Audit
        await AuditService.logAction({
            adminId: req.user!.id,
            action: 'RESOLVE_DISPUTE',
            targetType: 'DISPUTE',
            targetId: id,
            details: { status, resolution },
            requestId: req.auditContext?.requestId,
            ipAddress: req.auditContext?.ipAddress,
            userAgent: req.auditContext?.userAgent
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
        const logs = await AuditService.listLogs(req.query as any);
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const replayPayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const payment = await prisma.payment.findUnique({ where: { id } });

        if (!payment) {
            res.status(404).json({ error: 'Payment not found' });
            return;
        }

        // Reset retry metadata and set to PENDING
        await prisma.payment.update({
            where: { id },
            data: {
                status: 'PENDING',
                retryCount: 0,
                nextRetryAt: null,
                lastError: null,
                updatedAt: new Date()
            }
        });

        // Log the action with detailed context
        await AuditService.logAction({
            adminId: req.user!.id,
            action: 'REPLAY_PAYMENT',
            targetType: 'PAYMENT',
            targetId: id,
            details: { previousStatus: payment.status },
            requestId: req.auditContext?.requestId,
            ipAddress: req.auditContext?.ipAddress,
            userAgent: req.auditContext?.userAgent
        });

        res.status(200).json({ message: 'Payment replay triggered successfully.' });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const getAdminStatus = (req: Request, res: Response): void => {
    res.status(200).json({
        message: 'Admin access granted',
        user: req.user
    });
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        const filters = {
            role: req.query.role as string | undefined,
            status: req.query.status as any,
            search: req.query.search as string | undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        };

        const result = await adminService.getUserList(filters as any);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const banUnbanUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { action, reason, duration } = req.body as { action: 'ban' | 'unban'; reason?: string; duration?: number };

        if (action === 'ban') {
            if (!reason) {
                res.status(400).json({ error: 'reason is required to ban a user' });
                return;
            }

            await adminService.banUser({ userId: id, reason, duration });

            await AuditService.logAction({
                adminId: req.user!.id,
                action: 'BAN_USER',
                targetType: 'USER',
                targetId: id,
                details: { reason, duration },
                requestId: req.auditContext?.requestId,
                ipAddress: req.auditContext?.ipAddress,
                userAgent: req.auditContext?.userAgent
            });

            res.status(200).json({ message: 'User banned' });
            return;
        }

        if (action === 'unban') {
            await adminService.unbanUser(id);

            await AuditService.logAction({
                adminId: req.user!.id,
                action: 'UNBAN_USER',
                targetType: 'USER',
                targetId: id,
                details: {},
                requestId: req.auditContext?.requestId,
                ipAddress: req.auditContext?.ipAddress,
                userAgent: req.auditContext?.userAgent
            });

            res.status(200).json({ message: 'User unbanned' });
            return;
        }

        res.status(400).json({ error: 'invalid action' });
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const bulkUserOperation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { action, userIds, reason, duration } = req.body as { action: 'ban' | 'unban'; userIds: string[]; reason?: string; duration?: number };

        if (!Array.isArray(userIds) || userIds.length === 0) {
            res.status(400).json({ error: 'userIds must be a non-empty array' });
            return;
        }

        const results: Record<string, boolean | string> = {};

        for (const uid of userIds) {
            try {
                if (action === 'ban') {
                    if (!reason) throw new Error('reason required to ban');
                    await adminService.banUser({ userId: uid, reason, duration });
                    results[uid] = true;
                } else {
                    await adminService.unbanUser(uid);
                    results[uid] = true;
                }
            } catch (err) {
                results[uid] = (err as Error).message;
            }
        }

        await AuditService.logAction({
            adminId: req.user!.id,
            action: 'BULK_USER_OPERATION',
            targetType: 'USER_BULK',
            targetId: `bulk-${Date.now()}`,
            details: { action, userIds, reason, duration, results },
            requestId: req.auditContext?.requestId,
            ipAddress: req.auditContext?.ipAddress,
            userAgent: req.auditContext?.userAgent
        });

        res.status(200).json({ results });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const getGameConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        const cfg = await adminService.getGameConfig();
        res.status(200).json(cfg);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const updateGameConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        const updated = await adminService.updateGameConfig(req.body as any);

        await AuditService.logAction({
            adminId: req.user!.id,
            action: 'UPDATE_GAME_CONFIG',
            targetType: 'GAME_CONFIG',
            targetId: 'GAME_CONFIG',
            details: { updated },
            requestId: req.auditContext?.requestId,
            ipAddress: req.auditContext?.ipAddress,
            userAgent: req.auditContext?.userAgent
        });

        res.status(200).json(updated);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const getModerationQueue = async (req: Request, res: Response): Promise<void> => {
    try {
        const queue = await adminService.getModerationQueue();
        res.status(200).json(queue);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const reviewContent = async (req: Request, res: Response): Promise<void> => {
    try {
        const { contentId, action } = req.body as { contentId: string; action: 'approve' | 'reject' | 'remove' };

        if (!contentId || !action) {
            res.status(400).json({ error: 'contentId and action are required' });
            return;
        }

        await adminService.reviewContent(contentId, action);

        await AuditService.logAction({
            adminId: req.user!.id,
            action: 'REVIEW_CONTENT',
            targetType: 'CONTENT',
            targetId: contentId,
            details: { action },
            requestId: req.auditContext?.requestId,
            ipAddress: req.auditContext?.ipAddress,
            userAgent: req.auditContext?.userAgent
        });

        res.status(200).json({ message: 'review processed' });
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const getSystemHealth = async (_req: Request, res: Response): Promise<void> => {
    try {
        const health = await adminService.getSystemHealth();
        res.status(200).json(health);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
