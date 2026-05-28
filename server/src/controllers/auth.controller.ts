import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
    loginUser,
    logoutUser,
    refreshSession,
    registerUser,
    authenticateSocial,
    createGuestSession,
    verifyEmail,
    forgotPassword,
    resetPassword
} from '../services/auth.service';
import { HttpError } from '../utils/http-error';

const parseBody = <T>(schema: z.ZodSchema<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid request');
    }

    return parsed.data;
};

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    username: z.string().min(3).max(24).optional()
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});

const refreshSchema = z.object({
    refreshToken: z.string().min(1)
});

const socialAuthSchema = z.object({
    provider: z.enum(['google', 'discord', 'twitch']),
    accessToken: z.string().min(1)
});

const verifyEmailSchema = z.object({
    token: z.string().min(1)
});

const forgotPasswordSchema = z.object({
    email: z.string().email()
});

const resetPasswordSchema = z.object({
    token: z.string().min(1),
    newPassword: z.string().min(8).max(128)
});

export const register = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(registerSchema, req.body);
        const result = await registerUser(payload);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(loginSchema, req.body);
        const result = await loginUser(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(refreshSchema, req.body);
        const result = await refreshSession(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(refreshSchema, req.body);
        await logoutUser(payload);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};

export const socialAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { provider } = req.params;
        const payload = parseBody(socialAuthSchema, { ...req.body, provider });
        const result = await authenticateSocial(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const guestSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await createGuestSession();
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
};

export const verifyEmailHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(verifyEmailSchema, req.body);
        await verifyEmail(payload);
        res.status(200).json({ message: 'Email verified successfully' });
    } catch (error) {
        next(error);
    }
};

export const forgotPasswordHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(forgotPasswordSchema, req.body);
        const result = await forgotPassword(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const resetPasswordHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(resetPasswordSchema, req.body);
        await resetPassword(payload);
        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        next(error);
    }
};
