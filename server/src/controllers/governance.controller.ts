import { Request, Response } from 'express';

export const getGovernanceStatus = (req: Request, res: Response): void => {
    res.status(200).json({
        message: 'Governance access granted',
        user: req.user
    });
};
