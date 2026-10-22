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
    resendVerificationEmail,
    forgotPassword,
    resetPassword,
    enroll2FA,
    verifyAndEnable2FA,
    login2FA
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

// Twitch supports the Authorization Code flow (`code` + `redirectUri`), which
// exchanges the code server-side; `accessToken` remains for google/discord and
// for existing Twitch clients (#1160). Which combination is valid depends on
// the provider, so that check lives in the service where the error message can
// name the provider.
const socialAuthSchema = z.object({
    provider: z.enum(['google', 'discord', 'twitch']),
    accessToken: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    redirectUri: z.string().url().optional()
});

const verifyEmailSchema = z.object({
    token: z.string().min(1)
});

const resendVerificationEmailSchema = z.object({
    email: z.string().email()
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
        const token = req.body?.token || req.query?.token;
        const payload = parseBody(verifyEmailSchema, { token });
        const result = await verifyEmail(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const resendVerificationEmailHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(resendVerificationEmailSchema, req.body);
        const result = await resendVerificationEmail(payload);
        res.status(200).json(result);
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

const verify2FASchema = z.object({
    code: z.string().min(1).max(32)
});

const login2FASchema = z.object({
    tempToken: z.string().min(1),
    code: z.string().min(1).max(32)
});

export const enroll2FAHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req.user as any)?.id;
        if (!userId) {
            throw new HttpError(401, 'Authentication required');
        }
        const result = await enroll2FA(userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const verify2FAHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req.user as any)?.id;
        if (!userId) {
            throw new HttpError(401, 'Authentication required');
        }
        const payload = parseBody(verify2FASchema, req.body);
        const result = await verifyAndEnable2FA(userId, payload.code);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const login2FAHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = parseBody(login2FASchema, req.body);
        const result = await login2FA(payload);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};
