import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuditService } from '../services/audit.service';
import paymentMonitorWorker from '../services/payment-monitor.worker';
import prisma from '../services/database.service';

const matchService = new MatchService();

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
