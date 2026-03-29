import { Request, Response } from 'express';
import refundService from '../services/refund.service';

export const listRefundRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const requests = await refundService.listRequests(req.query);
        res.status(200).json(requests);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const updateRefundStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { status, operatorNotes } = req.body;
        
        if (!status) {
            res.status(400).json({ error: 'Status is required.' });
            return;
        }

        const updatedRequest = await refundService.updateStatus(
            id,
            req.user!.id,
            status,
            operatorNotes
        );

        // Detailed Audit (Service already logs some, but we can enrich here if needed)
        // Actually, the service should probably take the audit context.
        // Let's update RefundService better later.
        
        res.status(200).json(updatedRequest);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const createRefundRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { paymentId, amount, reason } = req.body;
        
        if (!paymentId || !amount || !reason) {
            res.status(400).json({ error: 'paymentId, amount, and reason are required.' });
            return;
        }

        const request = await refundService.createRequest({
            paymentId,
            amount,
            reason
        });

        res.status(201).json(request);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};
