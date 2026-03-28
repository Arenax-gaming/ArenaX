import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuditService } from '../services/audit.service';

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

export const getAdminStatus = (req: Request, res: Response): void => {
    res.status(200).json({
        message: 'Admin access granted',
        user: req.user
    });
};
