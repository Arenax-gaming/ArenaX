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

    passportInstance.use(
        'jwt',
        new JwtStrategy(
            {
                jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
                secretOrKey: authConfig.verificationKey,
                algorithms: [authConfig.jwtAlgorithm]
            },
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
                        return done(null, false);
                    }

                    return done(null, user as AuthenticatedUser);
                } catch (error) {
                    return done(error as Error, false);
                }
            }
        )
    );

    strategyInitialized = true;
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
                return next(err);
            }

            if (!user) {
                return next(new HttpError(401, 'Unauthorized'));
            }

            req.user = user;
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
