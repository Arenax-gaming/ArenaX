import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { achievementService } from '../services/achievement.service';
import { HttpError } from '../utils/http-error';

const progressBodySchema = z
    .object({
        progress: z.number().finite().nonnegative().optional(),
        delta: z.number().finite().positive().optional()
    })
    .refine((v) => v.progress !== undefined || v.delta !== undefined, {
        message: 'Provide progress or delta'
    })
    .refine((v) => !(v.progress !== undefined && v.delta !== undefined), {
        message: 'Provide only one of progress or delta'
    });

const shareBodySchema = z
    .object({
        caption: z.string().max(280).optional(),
        platform: z.enum(['twitter', 'discord', 'facebook', 'other']).optional()
    })
    .strict();

const parseBody = <T>(schema: z.ZodSchema<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid request');
    }

    return parsed.data;
};

export const listAchievements = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const includeHidden = req.query.includeHidden === 'true' && req.user?.role === 'ADMIN';
        const achievements = await achievementService.listAchievements({ includeHidden });
        res.status(200).json({ achievements });
    } catch (error) {
        next(error);
    }
};

export const getPlayerAchievements = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { playerId } = req.params;
        const viewerId = req.user?.id ?? null;
        const payload = await achievementService.getPlayerAchievements(playerId, viewerId);
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
};

export const postAchievementProgress = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const { id } = req.params;
        const body = parseBody(progressBodySchema, req.body);

        if (body.progress !== undefined) {
            await achievementService.updateProgress(req.user.id, id, body.progress);
        } else if (body.delta !== undefined) {
            const row = await achievementService.getPlayerAchievements(req.user.id, req.user.id);
            const entry = row.achievements.find((a) => a.achievement.id === id);
            const current = entry?.progress ?? 0;
            await achievementService.updateProgress(req.user.id, id, current + body.delta);
        }

        const refreshed = await achievementService.getPlayerAchievements(req.user.id, req.user.id);
        const updated = refreshed.achievements.find((a) => a.achievement.id === id);
        res.status(200).json({ achievement: updated });
    } catch (error) {
        next(error);
    }
};

export const getAchievementStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const stats = await achievementService.getAchievementStats(id);
        res.status(200).json({ stats });
    } catch (error) {
        next(error);
    }
};

export const shareAchievement = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const { id } = req.params;
        const body = parseBody(shareBodySchema, req.body);
        const result = await achievementService.shareAchievement(req.user.id, id, body);

        const proto = req.get('x-forwarded-proto') ?? req.protocol;
        const host = req.get('host');
        const absoluteUrl =
            host !== undefined ? `${proto}://${host}${result.sharedPath}` : result.sharedPath;

        res.status(201).json({
            ...result,
            shareUrl: absoluteUrl
        });
    } catch (error) {
        next(error);
    }
};
