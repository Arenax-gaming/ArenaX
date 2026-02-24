import { Request, Response } from 'express';

export const getAdminStatus = (req: Request, res: Response): void => {
    res.status(200).json({
        message: 'Admin access granted',
        user: req.user
    });
};
