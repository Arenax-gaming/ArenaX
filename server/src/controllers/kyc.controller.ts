import { Request, Response } from 'express';
import { KycService } from '../services/kyc.service';
import { AuditService } from '../services/audit.service';
import { KycStatus } from '@prisma/client';

const kycService = new KycService();

export const listKycReviews = async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, limit, offset } = req.query;
        const result = await kycService.listReviews({
            status: status as KycStatus,
            limit: Number(limit) || 20,
            offset: Number(offset) || 0
        });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const getKycReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const review = await kycService.getReview(id);
        res.status(200).json(review);
    } catch (error) {
        res.status(404).json({ error: (error as Error).message });
    }
};

export const processKycReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        if (!status) {
            res.status(400).json({ error: 'Status is required' });
            return;
        }

        const review = await kycService.processReview(id, (req as any).user.id, {
            status: status as KycStatus,
            notes
        });

        // Audit Logging
        await AuditService.logAction({
            adminId: (req as any).user.id,
            action: 'PROCESS_KYC_REVIEW',
            targetType: 'KYC_REVIEW',
            targetId: id,
            details: { status, notes },
            requestId: (req as any).auditContext?.requestId,
            ipAddress: (req as any).auditContext?.ipAddress,
            userAgent: (req as any).auditContext?.userAgent
        });

        res.status(200).json(review);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const submitKycReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const { documents } = req.body;
        const userId = (req as any).user.id;

        const review = await kycService.createReview(userId, documents);
        
        res.status(201).json(review);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};
