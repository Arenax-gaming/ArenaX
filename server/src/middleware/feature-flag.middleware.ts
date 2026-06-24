import { NextFunction, Request, Response } from 'express';
import { featureFlagService } from '../services/feature-flag.service';
import { HttpError } from '../utils/http-error';

export const requireFeatureFlag = (flagKey: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const context = {
                userId: req.user?.id,
                role: req.user?.role,
                email: req.user?.email,
                ip: req.ip
            };

            const isEnabled = await featureFlagService.evaluate(flagKey, context);
            if (!isEnabled) {
                return next(new HttpError(403, `Feature flag '${flagKey}' is disabled`));
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};
