import { Prisma } from '@prisma/client';
import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';
import { cacheService } from './cache.service';
import { logger } from './logger.service';
import { getEnv } from '../config/env';
import ModerationService, { PendingProfileContent } from './moderation.service';
import { enqueueJob, getQueueAdapter } from './queue.service';

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
    avatarUrl?: string;
}

export interface PublicProfile {
    username: string;
    bio: string | null;
    socials: SocialLinks;
    avatarUrl: string | null;
    createdAt: Date;
}

/**
 * Result of submitting a profile edit. The content never goes live
 * immediately (#1569) — it is queued for moderation, so the response
 * echoes back the still-current *live* values plus a `pending` flag and
 * the moderation item id the caller can use to track review status.
 */
export interface UpdateProfileResult {
    username: string;
    bio: string | null;
    socials: SocialLinks;
    avatarUrl: string | null;
    updatedAt: Date;
    pending: true;
    moderationId: string;
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
            avatarUrl: true,
            createdAt: true
        }
    });

    if (!user) {
        throw new HttpError(404, 'Profile not found');
    }

    // Only ever return the *live* columns here — pending edits awaiting
    // moderation (see updateMyProfile) are never selected, so unapproved
    // content is never visible to other users (#1569).
    const profile: PublicProfile = {
        username: user.username,
        bio: user.bio,
        socials: toSocialLinks(user.socials),
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
    };

    // 3. Populate cache — fire-and-forget; never block the response
    cacheService.set(cacheKey, profile, PROFILE_TTL).catch((err) =>
        logger.warn('Failed to cache profile', { username: normalizedUsername, error: err })
    );

    return profile;
};

/**
 * Register the async handler for the `profile.moderation` job (#1569).
 * This re-runs detection against the stored moderation item and raises
 * the admin webhook when content is flagged, off the request path. It's
 * best-effort: the pending state and the moderation-queue entry itself
 * are always created synchronously in `submitProfileContentForModeration`
 * below, so the feature works correctly even when nothing drains this
 * queue (no worker loop is wired up for `queue.service.ts` yet — see the
 * adapter's own docstring).
 */
const registerProfileModerationHandler = (() => {
    let registered = false;
    return () => {
        if (registered) return;
        registered = true;
        try {
            getQueueAdapter().register<{ moderationItemId: string; userId: string }>(
                'profile.moderation',
                async (jobData) => {
                    const prisma = getDatabaseClient();
                    const item = await prisma.moderationItem.findUnique({
                        where: { id: jobData.moderationItemId }
                    });
                    if (!item) return;

                    if (item.flagged) {
                        const { NotificationService } = await import('./notification.service');
                        await NotificationService.notifyWebhook({
                            type: 'PROFILE_MODERATION_FLAGGED',
                            payload: {
                                moderationId: item.id,
                                userId: jobData.userId,
                                reason: item.flagReason,
                                severity: item.severity
                            }
                        }).catch(() => null);
                    }
                }
            );
        } catch (err) {
            // No REDIS_URL configured (e.g. local/test env) — the queue
            // adapter can't be instantiated. Synchronous moderation still
            // works; this only skips the async webhook alert.
            logger.warn('profile.service: queue adapter unavailable, skipping async moderation handler registration', { error: err });
        }
    };
})();

/**
 * Create the pending moderation item for a profile submission: runs the
 * detectors synchronously (so the item is correctly flagged/severity-tagged
 * the moment it lands in the admin queue — see admin.service#getModerationQueue)
 * and enqueues a follow-up async job for the admin alert.
 */
const submitProfileContentForModeration = async (
    userId: string,
    content: PendingProfileContent
): Promise<{ id: string }> => {
    const prisma = getDatabaseClient();
    const detection = ModerationService.screenProfileContent(content);

    const created = await prisma.moderationItem.create({
        data: {
            type: 'profile',
            reportedUserId: userId,
            content: JSON.stringify(content),
            flagged: detection.flagged,
            flagReason: detection.reason || null,
            severity: (detection.severity ?? 'low').toUpperCase()
        }
    });

    registerProfileModerationHandler();
    await enqueueJob(
        'profile.moderation',
        created.id,
        { moderationItemId: created.id, userId },
        { priority: detection.flagged ? 'high' : 'normal' }
    ).catch((err) =>
        logger.warn('Failed to enqueue profile moderation job', { error: err, moderationItemId: created.id })
    );

    return created;
};

/**
 * Submit a profile edit for the authenticated user (#1569).
 *
 * Content never goes live immediately: bio/socials/avatar edits are
 * written to `pending*` columns and a moderation item is created in the
 * `PENDING` state. The live columns — and therefore what other users see
 * via `getPublicProfile` — are only updated once an admin approves the
 * item (see `AdminService#reviewContent`).
 */
export const updateMyProfile = async (
    userId: string,
    input: UpdateProfileInput
): Promise<UpdateProfileResult> => {
    const prisma = getDatabaseClient();

    const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, bio: true, socials: true, avatarUrl: true, updatedAt: true }
    });

    if (!current) {
        throw new HttpError(404, 'Profile not found');
    }

    // Fields left out of this submission fall back to the current *live*
    // value, so approving a partial update never clears content the user
    // didn't intend to touch.
    const pendingContent: PendingProfileContent = {
        bio: input.bio !== undefined ? input.bio : current.bio ?? undefined,
        socials: input.socials !== undefined ? input.socials : toSocialLinks(current.socials),
        avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl ?? undefined
    };

    const data: {
        pendingBio?: string | null;
        pendingSocials?: Prisma.InputJsonValue;
        pendingAvatarUrl?: string | null;
    } = {
        pendingBio: pendingContent.bio ?? null,
        pendingSocials: (pendingContent.socials ?? {}) as Prisma.InputJsonValue,
        pendingAvatarUrl: pendingContent.avatarUrl ?? null
    };

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
            username: true,
            bio: true,
            socials: true,
            avatarUrl: true,
            updatedAt: true
        }
    });

    const moderationItem = await submitProfileContentForModeration(userId, pendingContent);

    // The live profile hasn't changed, but invalidate anyway — harmless,
    // and guards against any stale cache entry outliving its TTL.
    const cacheKey = profileCacheKey(updatedUser.username);
    await cacheService.delete(cacheKey);
    logger.debug('Profile cache invalidated', { username: updatedUser.username });

    return {
        username: updatedUser.username,
        bio: updatedUser.bio,
        socials: toSocialLinks(updatedUser.socials),
        avatarUrl: updatedUser.avatarUrl,
        updatedAt: updatedUser.updatedAt,
        pending: true,
        moderationId: moderationItem.id
    };
};
