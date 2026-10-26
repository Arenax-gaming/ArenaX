import { Request, Response, NextFunction } from 'express';
import { MatchService } from '../services/match.service';

const matchService = new MatchService();

export const reportScore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        const { scoreA, scoreB } = req.body;
        const file = req.file;

        if (
            scoreA === undefined || scoreB === undefined ||
            scoreA === '' || scoreB === '' ||
            !Number.isSafeInteger(Number(scoreA)) ||
            !Number.isSafeInteger(Number(scoreB)) ||
            Number(scoreA) < 0 || Number(scoreB) < 0
        ) {
            res.status(400).json({
                error: 'scoreA and scoreB must be non-negative integers',
            });
            return;
        }

        if (!file) {
            res.status(400).json({
                error: 'A screenshot is required in the screenshot field',
            });
            return;
        }

        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
            res.status(400).json({
                error: 'Screenshot must be a JPEG or PNG image',
            });
            return;
        }

        const result = await matchService.submitScoreReport(
            id,
            req.user!.id,
            Number(scoreA),
            Number(scoreB),
            file
        );

        res.status(200).json(result);
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
            evidenceUrls,
        });

        res.status(201).json(dispute);
    } catch (error) {
        next(error);
    }
};

export const createMatch = async (req: Request, res: Response): Promise<void> => {
    try {
        const { playerAId, playerBId, onChainId } = req.body;

        if (!playerAId || !playerBId || !onChainId) {
            res.status(400).json({
                error: 'playerAId, playerBId, and onChainId are required',
            });
            return;
        }

        const match = await matchService.createMatch(playerAId, playerBId, onChainId);
        res.status(201).json(match);
    } catch (error) {
        if ((error as Error).message.includes('under heavy load')) {
            res.status(429).json({ error: (error as Error).message });
        } else {
            res.status(500).json({ error: (error as Error).message });
        }
    }
};
