import { Request, Response, NextFunction } from 'express';
import { MatchService } from '../services/match.service';

const matchService = new MatchService();

export const reportScore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        const { winnerId } = req.body;
        const match = await matchService.reportScore(id, winnerId);
        res.status(200).json(match);
    } catch (error) {
        next(error);
    }
};

export const raiseDispute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        const { reason, evidenceUrls } = req.body;
        const dispute = await matchService.raiseDispute(id, req.user!.id, {
            reason,
            evidenceUrls
        });
        res.status(201).json(dispute);
    } catch (error) {
        next(error);
    }
};
