export interface Achievement {
    id: string
    name: string
    description: string
    iconUrl?: string
    category: string
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
    difficulty: number // 1-5
    points: number
    createdAt: string
}

export interface PlayerAchievement {
    id: string
    achievementId: string
    userId: string
    progress: number
    maxProgress: number
    isUnlocked: boolean
    unlockedAt?: string
    createdAt: string
}

export interface AchievementProgress {
    achievementId: string
    achievementName: string
    progress: number
    maxProgress: number
    percentage: number
    isUnlocked: boolean
    unlockedAt?: string
}

export interface PlayerAchievementsResponse {
    userId: string
    username: string
    totalAchievements: number
    unlockedAchievements: number
    totalPoints: number
    achievements: AchievementProgress[]
}

export interface AchievementStats {
    achievementId: string
    name: string
    totalUnlocked: number
    unlockPercentage: number
    averageTimeToUnlock?: number
}

export interface AchievementUnlockedEvent {
    userId: string
    achievementId: string
    achievementName: string
    points: number
    timestamp: string
}

export interface ShareAchievementResponse {
    shareUrl: string
    shareText: string
}
