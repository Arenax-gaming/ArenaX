import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';

const matchService = new MatchService();

export const reportScore = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { winnerId } = req.body;
        const match = await matchService.reportScore(id, winnerId);
        res.status(200).json(match);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const raiseDispute = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { reason, evidenceUrls } = req.body;
        const dispute = await matchService.raiseDispute(id, req.user!.id, {
            reason,
            evidenceUrls
        });
        res.status(201).json(dispute);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
