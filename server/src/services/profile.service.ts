import { Prisma } from '@prisma/client';
import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';

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

export const getPublicProfile = async (username: string) => {
    const prisma = getDatabaseClient();
    const normalizedUsername = username.trim().toLowerCase();
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

    return {
        username: user.username,
        bio: user.bio,
        socials: toSocialLinks(user.socials),
        createdAt: user.createdAt
    };
};

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

    return {
        username: updatedUser.username,
        bio: updatedUser.bio,
        socials: toSocialLinks(updatedUser.socials),
        updatedAt: updatedUser.updatedAt
    };
};
