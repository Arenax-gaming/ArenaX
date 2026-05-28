import { useQuery, useMutation } from '@tanstack/react-query'
import {
    Achievement,
    PlayerAchievementsResponse,
    AchievementStats,
    AchievementUnlockedEvent,
    ShareAchievementResponse,
} from '@/types/achievement'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'

export const useAchievements = () => {
    return useQuery({
        queryKey: ['achievements'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/achievements`)
            if (!res.ok) throw new Error('Failed to fetch achievements')
            const data = await res.json()
            return data.data as Achievement[]
        },
    })
}

export const usePlayerAchievements = (playerId: string) => {
    return useQuery({
        queryKey: ['playerAchievements', playerId],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/achievements/player/${playerId}`)
            if (!res.ok) throw new Error('Failed to fetch player achievements')
            const data = await res.json()
            return data.data as PlayerAchievementsResponse
        },
    })
}

export const useAchievementStats = (achievementId: string) => {
    return useQuery({
        queryKey: ['achievementStats', achievementId],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/achievements/${achievementId}/stats`)
            if (!res.ok) throw new Error('Failed to fetch achievement stats')
            const data = await res.json()
            return data.data as AchievementStats
        },
    })
}

export const useUpdateAchievementProgress = () => {
    return useMutation({
        mutationFn: async ({ achievementId, progress }: { achievementId: string; progress: number }) => {
            const res = await fetch(`${API_BASE}/achievements/${achievementId}/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress }),
            })
            if (!res.ok) throw new Error('Failed to update achievement progress')
            const data = await res.json()
            return data.data as AchievementUnlockedEvent | null
        },
    })
}

export const useShareAchievement = () => {
    return useMutation({
        mutationFn: async (achievementId: string) => {
            const res = await fetch(`${API_BASE}/achievements/${achievementId}/share`, {
                method: 'POST',
            })
            if (!res.ok) throw new Error('Failed to share achievement')
            const data = await res.json()
            return data.data as ShareAchievementResponse
        },
    })
}

export const useCheckAchievements = () => {
    return useMutation({
        mutationFn: async ({
            eventType,
            eventData,
        }: {
            eventType: string
            eventData: Record<string, any>
        }) => {
            const res = await fetch(`${API_BASE}/achievements/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_type: eventType, event_data: eventData }),
            })
            if (!res.ok) throw new Error('Failed to check achievements')
            const data = await res.json()
            return data.data.unlocked_achievements as AchievementUnlockedEvent[]
        },
    })
}
