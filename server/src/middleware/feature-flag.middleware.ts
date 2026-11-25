import { NextFunction, Request, Response } from 'express';
import { featureFlagService, EvaluationContext } from '../services/feature-flag.service';
import { HttpError } from '../utils/http-error';

export const requireFeatureFlag = (flagKey: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = req.user as any;
            const context: EvaluationContext = {
                userId: user?.id || (req.headers['x-user-id'] as string) || (req.query?.userId as string),
                role: user?.role,
                email: user?.email,
                ip: req.ip,
                region: (req.headers['x-user-region'] || req.headers['cf-ipcountry'] || req.query?.region || user?.region) as string | undefined,
                beta: Boolean(user?.isBeta || user?.beta || req.headers['x-user-beta'] === 'true' || req.query?.beta === 'true'),
                isBeta: Boolean(user?.isBeta || user?.beta || req.headers['x-user-beta'] === 'true' || req.query?.beta === 'true'),
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
