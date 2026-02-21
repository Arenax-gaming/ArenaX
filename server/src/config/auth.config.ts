import fs from 'fs';
import path from 'path';
import { Algorithm } from 'jsonwebtoken';

const durationRegex = /^(\d+)([smhd])$/;

type DurationUnit = 's' | 'm' | 'h' | 'd';

const durationUnitInMs: Record<DurationUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
};

const readKeyFromEnvOrFile = (
    envValue?: string,
    envFilePath?: string
): string | undefined => {
    if (envValue && envValue.trim().length > 0) {
        return envValue.replace(/\\n/g, '\n');
    }

    if (envFilePath && envFilePath.trim().length > 0) {
        const resolvedPath = path.isAbsolute(envFilePath)
            ? envFilePath
            : path.resolve(process.cwd(), envFilePath);
        return fs.readFileSync(resolvedPath, 'utf8');
    }

    return undefined;
};

const parseDurationToMs = (value: string, envName: string): number => {
    const match = value.match(durationRegex);
    if (!match) {
        throw new Error(
            `${envName} must match "<number><unit>" where unit is one of s,m,h,d`
        );
    }

    const [, amountRaw, unitRaw] = match;
    const amount = Number(amountRaw);
    const unit = unitRaw as DurationUnit;
    return amount * durationUnitInMs[unit];
};

export interface AuthConfig {
    accessTokenTtl: string;
    accessTokenTtlMs: number;
    refreshTokenTtl: string;
    refreshTokenTtlMs: number;
    jwtAlgorithm: Algorithm;
    signingKey: string | Buffer;
    verificationKey: string | Buffer;
}

const buildAuthConfig = (): AuthConfig => {
    const accessTokenTtl =
        process.env.ACCESS_TOKEN_TTL || process.env.JWT_EXPIRES_IN || '15m';
    const refreshTokenTtl =
        process.env.REFRESH_TOKEN_TTL ||
        process.env.REFRESH_TOKEN_EXPIRES_IN ||
        '7d';

    const privateKey = readKeyFromEnvOrFile(
        process.env.JWT_PRIVATE_KEY,
        process.env.JWT_PRIVATE_KEY_FILE
    );
    const publicKey = readKeyFromEnvOrFile(
        process.env.JWT_PUBLIC_KEY,
        process.env.JWT_PUBLIC_KEY_FILE
    );

    if (privateKey || publicKey) {
        if (!privateKey || !publicKey) {
            throw new Error(
                'Both JWT_PRIVATE_KEY/JWT_PUBLIC_KEY (or file variants) are required for RS256'
            );
        }

        return {
            accessTokenTtl,
            accessTokenTtlMs: parseDurationToMs(
                accessTokenTtl,
                'ACCESS_TOKEN_TTL'
            ),
            refreshTokenTtl,
            refreshTokenTtlMs: parseDurationToMs(
                refreshTokenTtl,
                'REFRESH_TOKEN_TTL'
            ),
            jwtAlgorithm: 'RS256',
            signingKey: privateKey,
            verificationKey: publicKey
        };
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 32) {
        throw new Error(
            'JWT_SECRET must be set and at least 32 characters when RS256 keys are not configured'
        );
    }

    return {
        accessTokenTtl,
        accessTokenTtlMs: parseDurationToMs(accessTokenTtl, 'ACCESS_TOKEN_TTL'),
        refreshTokenTtl,
        refreshTokenTtlMs: parseDurationToMs(
            refreshTokenTtl,
            'REFRESH_TOKEN_TTL'
        ),
        jwtAlgorithm: 'HS256',
        signingKey: jwtSecret,
        verificationKey: jwtSecret
    };
};

export const authConfig = buildAuthConfig();
