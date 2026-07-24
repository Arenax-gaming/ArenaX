import { Request, Response } from 'express';
import { AuditService } from '../services/audit.service';
import { auditAnchorService } from '../services/audit-anchor.service';

export const searchAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId, action, targetType, targetId, correlationId, from, to, limit, offset } = req.query as Record<string, string>;
        const result = await AuditService.search({
            userId, action, targetType, targetId, correlationId,
            fromDate: from ? new Date(from) : undefined,
            toDate:   to   ? new Date(to)   : undefined,
            limit:    limit  ? parseInt(limit, 10)  : 50,
            offset:   offset ? parseInt(offset, 10) : 0,
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const exportAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
        const { format = 'json', from, to, userId, action, targetType, targetId } = req.query as Record<string, string>;
        const fmt = format === 'csv' ? 'csv' : 'json';
        const data = await AuditService.exportLogs({
            format: fmt, userId, action, targetType, targetId,
            fromDate: from ? new Date(from) : undefined,
            toDate:   to   ? new Date(to)   : undefined,
        });
        const mime = fmt === 'csv' ? 'text/csv' : 'application/json';
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="audit-export.${fmt}"`);
        res.send(data);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const verifyAuditIntegrity = async (_req: Request, res: Response): Promise<void> => {
    try {
        const report = await AuditService.verifyIntegrity();
        res.status(report.ok ? 200 : 422).json(report);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const replayAuditEvents = async (req: Request, res: Response): Promise<void> => {
    try {
        const { targetType, targetId } = req.query as Record<string, string>;
        if (!targetType || !targetId) {
            res.status(400).json({ error: 'targetType and targetId are required' });
            return;
        }
        const result = await AuditService.replayEvents(targetType, targetId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const auditComplianceReport = async (req: Request, res: Response): Promise<void> => {
    try {
        const { from, to } = req.query as Record<string, string>;
        const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const toDate   = to   ? new Date(to)   : new Date();
        const report = await AuditService.complianceReport(fromDate, toDate);
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const redactUserAuditData = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        const result = await AuditService.redactUser(userId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};

export const anchorAuditLogs = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await auditAnchorService.anchorPending();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
};
