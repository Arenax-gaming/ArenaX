import { NextFunction, Request, Response } from 'express';
import passport, { PassportStatic } from 'passport';
import {
    ExtractJwt,
    Strategy as JwtStrategy,
    VerifiedCallback
} from 'passport-jwt';
import { authConfig } from '../config/auth.config';
import { getDatabaseClient } from '../services/database.service';
import { AuthenticatedUser } from '../types/auth.types';
import { HttpError } from '../utils/http-error';
import { logger } from '../services/logger.service';

interface JwtPayload {
    sub: string;
}

let strategyInitialized = false;

export const configurePassport = (
    passportInstance: PassportStatic = passport
): void => {
    if (strategyInitialized) {
        return;
    }

    // Guard against concurrent calls (e.g. during tests or hot-reload).
    // If a previous attempt threw, strategyInitialized stays false and we retry.
    try {
        passportInstance.use(
        'jwt',
        new (JwtStrategy as any)(
            {
                jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
                secretOrKey: authConfig.verificationKey,
                algorithms: [authConfig.jwtAlgorithm],
                clockTolerance: 30
            } as any,
            async (payload: JwtPayload, done: VerifiedCallback) => {
                try {
                    const prisma = getDatabaseClient();
                    const user = await prisma.user.findUnique({
                        where: { id: payload.sub },
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            role: true
                        }
                    });

                    if (!user) {
                        logger.warn('JWT authentication failed: user not found', { sub: payload.sub });
                        return done(null, false);
                    }

                    return done(null, user as AuthenticatedUser);
                } catch (error) {
                    logger.error('JWT strategy error', { error });
                    return done(error as Error, false);
                }
            }
        )
        );

        strategyInitialized = true;
    } catch (err) {
        // Reset so the next call can retry cleanly.
        strategyInitialized = false;
        logger.error('Failed to configure passport JWT strategy', { error: err });
        throw err;
    }
};

export const authenticateJWT = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    passport.authenticate(
        'jwt',
        { session: false },
        (err: Error | null, user: Express.User | false) => {
            if (err) {
                logger.error('JWT authentication error', { error: err, path: req.originalUrl });
                return next(err);
            }

            if (!user) {
                (req.log ?? logger).warn('Unauthorized request', {
                    method: req.method,
                    path: req.originalUrl,
                    ip: req.ip
                });
                return next(new HttpError(401, 'Unauthorized'));
            }

            req.user = user;
            return next();
        }
    )(req, res, next);
};

/** Attaches `req.user` when a valid Bearer token is present; otherwise continues unauthenticated. */
export const optionalAuthenticateJWT = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    passport.authenticate(
        'jwt',
        { session: false },
        (err: Error | null, user: Express.User | false) => {
            if (err) {
                return next(err);
            }

            if (user) {
                req.user = user;
            }

            return next();
        }
    )(req, res, next);
};

export const restrictTo =
    (...roles: string[]) =>
    (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            return next(new HttpError(401, 'Unauthorized'));
        }

        if (!roles.includes(req.user.role)) {
            return next(new HttpError(403, 'Forbidden'));
        }

        return next();
    };

// Simple role -> scopes mapping for finer-grained admin permissions
const roleScopes: Record<string, string[]> = {
    ADMIN: [
        'USERS:WRITE',
        'GAMES:WRITE',
        'MODERATION:REVIEW',
        'SYSTEM:READ',
        'SYSTEM:WRITE',
        'PAYMENTS:WRITE',
        'DISPUTES:WRITE',
        'KYC:WRITE',
        'REFUNDS:WRITE'
    ],
    MODERATOR: ['MODERATION:REVIEW', 'USERS:READ'],
    SUPPORT: ['USERS:READ', 'DISPUTES:READ']
};

export const restrictToScope = (requiredScope: string) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
        return next(new HttpError(401, 'Unauthorized'));
    }

    // Admin role gets full access
    if (req.user.role === 'ADMIN') return next();

    const scopes = roleScopes[req.user.role] || [];
    if (!scopes.includes(requiredScope)) {
        return next(new HttpError(403, 'Forbidden'));
    }

    return next();
};

// Enhanced permission checking for multiple scopes
export const restrictToScopes = (requiredScopes: string[], requireAll = false) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
        return next(new HttpError(401, 'Unauthorized'));
    }

    // Admin role gets full access
    if (req.user.role === 'ADMIN') return next();

    const scopes = roleScopes[req.user.role] || [];
    
    if (requireAll) {
        const hasAll = requiredScopes.every(scope => scopes.includes(scope));
        if (!hasAll) {
            return next(new HttpError(403, 'Forbidden'));
        }
    } else {
        const hasAny = requiredScopes.some(scope => scopes.includes(scope));
        if (!hasAny) {
            return next(new HttpError(403, 'Forbidden'));
        }
    }

    return next();
};
