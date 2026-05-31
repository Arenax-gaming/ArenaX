import { Prisma } from '@prisma/client';
import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';
import { cacheService } from './cache.service';
import { logger } from './logger.service';
import { getEnv } from '../config/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialLinks {
    twitter?: string;
    twitch?: string;
    youtube?: string;
    discord?: string;
    website?: string;
    github?: string;
}

export interface UpdateProfileInput {
    bio?: string;
    socials?: SocialLinks;
}

export interface PublicProfile {
    username: string;
    bio: string | null;
    socials: SocialLinks;
    createdAt: Date;
}

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const CACHE_NAMESPACE = 'profile';
/** TTL in seconds — read from the validated env singleton. */
const PROFILE_TTL = (() => {
    try {
        return getEnv().PROFILE_CACHE_TTL_SECONDS;
    } catch {
        return Number(process.env.PROFILE_CACHE_TTL_SECONDS ?? 300);
    }
})();

/** Derive a stable cache key from a normalised username. */
const profileCacheKey = (username: string): string =>
    `${CACHE_NAMESPACE}:${username}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toSocialLinks = (value: unknown): SocialLinks => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const result: SocialLinks = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof rawValue === 'string') {
            result[key as keyof SocialLinks] = rawValue;
        }
    }

    return result;
};

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Return the public profile for `username`.
 *
 * Cache strategy: cache-aside with a per-username key.
 *   HIT  → return cached value immediately (no DB query).
 *   MISS → query DB, populate cache, return result.
 *
 * Cache errors are swallowed — a cache failure always falls through to the DB
 * so the request never fails because of the cache layer.
 */
export const getPublicProfile = async (username: string): Promise<PublicProfile> => {
    const normalizedUsername = username.trim().toLowerCase();
    const cacheKey = profileCacheKey(normalizedUsername);

    // 1. Try cache first
    const cached = await cacheService.get<PublicProfile>(cacheKey, CACHE_NAMESPACE);
    if (cached !== null) {
        logger.debug('Profile cache hit', { username: normalizedUsername });
        return cached;
    }

    // 2. Cache miss — fetch from DB
    logger.debug('Profile cache miss', { username: normalizedUsername });
    const prisma = getDatabaseClient();
    const user = await prisma.user.findUnique({
        where: { username: normalizedUsername },
        select: {
            username: true,
            bio: true,
            socials: true,
            createdAt: true
        }
    });

    if (!user) {
        throw new HttpError(404, 'Profile not found');
    }

    const profile: PublicProfile = {
        username: user.username,
        bio: user.bio,
        socials: toSocialLinks(user.socials),
        createdAt: user.createdAt
    };

    // 3. Populate cache — fire-and-forget; never block the response
    cacheService.set(cacheKey, profile, PROFILE_TTL).catch((err) =>
        logger.warn('Failed to cache profile', { username: normalizedUsername, error: err })
    );

    return profile;
};

/**
 * Update the authenticated user's profile and invalidate their cache entry
 * so the next read reflects the new data.
 */
export const updateMyProfile = async (
    userId: string,
    input: UpdateProfileInput
) => {
    const prisma = getDatabaseClient();

    const data: {
        bio?: string | null;
        socials?: Prisma.InputJsonValue;
    } = {};

    if (input.bio !== undefined) {
        data.bio = input.bio;
    }

    if (input.socials !== undefined) {
        data.socials = input.socials as Prisma.InputJsonValue;
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
            username: true,
            bio: true,
            socials: true,
            updatedAt: true
        }
    });

    // Invalidate the cached profile so the next GET fetches fresh data.
    const cacheKey = profileCacheKey(updatedUser.username);
    await cacheService.delete(cacheKey);
    logger.debug('Profile cache invalidated', { username: updatedUser.username });

    return {
        username: updatedUser.username,
        bio: updatedUser.bio,
        socials: toSocialLinks(updatedUser.socials),
        updatedAt: updatedUser.updatedAt
    };
};
