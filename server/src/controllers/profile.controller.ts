import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getPublicProfile, updateMyProfile } from '../services/profile.service';
import { HttpError } from '../utils/http-error';

const socialsSchema = z
    .object({
        twitter: z.string().url().optional(),
        twitch: z.string().url().optional(),
        youtube: z.string().url().optional(),
        discord: z.string().url().optional(),
        website: z.string().url().optional(),
        github: z.string().url().optional()
    })
    .strict();

const updateProfileSchema = z
    .object({
        bio: z.string().max(280).optional(),
        socials: socialsSchema.optional()
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: 'At least one profile field must be provided'
    });

const parseBody = <T>(schema: z.ZodSchema<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid request');
    }

    return parsed.data;
};

export const getProfileByUsername = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const username = req.params.username;
        const profile = await getPublicProfile(username);
        res.status(200).json(profile);
    } catch (error) {
        next(error);
    }
};

export const updateMyProfileController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            throw new HttpError(401, 'Unauthorized');
        }

        const payload = parseBody(updateProfileSchema, req.body);
        const updatedProfile = await updateMyProfile(req.user.id, payload);
        res.status(200).json(updatedProfile);
    } catch (error) {
        next(error);
    }
};
