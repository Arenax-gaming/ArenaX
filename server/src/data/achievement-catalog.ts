import { AchievementCategory } from '@prisma/client';

export interface AchievementCatalogEntry {
    key: string;
    name: string;
    description: string;
    category: AchievementCategory;
    targetValue: number;
    eventTypes: string[];
    rewards: Record<string, unknown>;
    hidden: boolean;
    sortOrder: number;
}

export const ACHIEVEMENT_CATALOG: AchievementCatalogEntry[] = [
    {
        key: 'first_victory',
        name: 'First Victory',
        description: 'Win your first ranked match.',
        category: AchievementCategory.COMBAT,
        targetValue: 1,
        eventTypes: ['MATCH_WON'],
        rewards: {
            grants: [{ currency: 'AX', amount: '5' }],
            badge: 'first_victory'
        },
        hidden: false,
        sortOrder: 10
    },
    {
        key: 'battle_hardened',
        name: 'Battle Hardened',
        description: 'Complete 10 matches.',
        category: AchievementCategory.PROGRESSION,
        targetValue: 10,
        eventTypes: ['MATCH_COMPLETED'],
        rewards: {
            grants: [{ currency: 'AX', amount: '10' }],
            badge: 'battle_hardened'
        },
        hidden: false,
        sortOrder: 20
    },
    {
        key: 'arena_veteran',
        name: 'Arena Veteran',
        description: 'Complete 50 matches.',
        category: AchievementCategory.PROGRESSION,
        targetValue: 50,
        eventTypes: ['MATCH_COMPLETED'],
        rewards: {
            grants: [{ currency: 'AX', amount: '25' }],
            badge: 'arena_veteran'
        },
        hidden: false,
        sortOrder: 30
    },
    {
        key: 'public_face',
        name: 'Public Face',
        description: 'Add a bio or social link to your profile.',
        category: AchievementCategory.SOCIAL,
        targetValue: 1,
        eventTypes: ['PROFILE_UPDATED'],
        rewards: {
            badge: 'public_face'
        },
        hidden: false,
        sortOrder: 40
    },
    {
        key: 'verified_competitor',
        name: 'Verified Competitor',
        description: 'Complete identity verification.',
        category: AchievementCategory.PROGRESSION,
        targetValue: 1,
        eventTypes: ['KYC_APPROVED'],
        rewards: {
            badge: 'verified_competitor'
        },
        hidden: false,
        sortOrder: 50
    },
    {
        key: 'season_champion',
        name: 'Season Champion',
        description: 'Participate in a seasonal spotlight event.',
        category: AchievementCategory.SEASONAL,
        targetValue: 1,
        eventTypes: ['SEASONAL_ACTIVE'],
        rewards: {
            badge: 'season_champion'
        },
        hidden: true,
        sortOrder: 60
    }
];
