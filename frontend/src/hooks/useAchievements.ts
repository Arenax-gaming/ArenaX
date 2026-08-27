import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Achievement,
  PlayerAchievementsResponse,
  AchievementStats,
  AchievementUnlockedEvent,
  ShareAchievementResponse,
} from '@/types/achievement'
import { API_BASE } from '@/lib/constants'
import { api } from '@/lib/api'

export const useAchievements = () => {
  return useQuery({
    queryKey: ['achievements'],
    queryFn: () => api.getAchievements(),
  })
}

export const usePlayerAchievements = (playerId: string) => {
  return useQuery({
    queryKey: ['playerAchievements', playerId],
    queryFn: () => api.getPlayerAchievements(playerId),
  })
}

export const useAchievementStats = (achievementId: string) => {
  return useQuery({
    queryKey: ['achievementStats', achievementId],
    queryFn: () => api.getAchievementStats(achievementId),
  })
}

export const useUpdateAchievementProgress = () => {
  return useMutation({
    mutationFn: ({ achievementId, progress }: { achievementId: string; progress: number }) =>
      api.updateAchievementProgress(achievementId, progress),
  })
}

export const useShareAchievement = () => {
  return useMutation({
    mutationFn: (achievementId: string) => api.shareAchievement(achievementId),
  })
}

export const useCheckAchievements = () => {
  return useMutation({
    mutationFn: ({
      eventType,
      eventData,
    }: {
      eventType: string
      eventData: Record<string, unknown>
    }) => api.checkAchievements(eventType, eventData),
  })
}
