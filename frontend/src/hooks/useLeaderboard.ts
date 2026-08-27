import { useQuery, useMutation } from '@tanstack/react-query'
import {
  LeaderboardResponse,
  PlayerRankResponse,
  RankHistory,
  SeasonalLeaderboard,
  LeaderboardStats,
} from '@/types/leaderboard'
import { API_BASE } from '@/lib/constants'
import { api } from '@/lib/api'

export const useLeaderboard = (
  category: string,
  limit = 100,
  offset = 0,
  season?: string,
  search?: string,
) => {
  return useQuery({
    queryKey: ['leaderboard', category, limit, offset, season, search],
    queryFn: () => api.getLeaderboard(category, limit, offset, season, search),
  })
}

export const useSeasonalLeaderboard = (
  category: string,
  season: string,
  limit = 100,
  offset = 0,
) => {
  return useQuery({
    queryKey: ['leaderboard', 'seasonal', category, season, limit, offset],
    queryFn: () => api.getSeasonalLeaderboard(category, season, limit, offset),
  })
}

export const usePlayerRank = (category: string, playerId: string) => {
  return useQuery({
    queryKey: ['playerRank', category, playerId],
    queryFn: () => api.getPlayerRank(category, playerId),
  })
}

export const useRankHistory = (category: string, playerId: string, days = 30) => {
  return useQuery({
    queryKey: ['rankHistory', category, playerId, days],
    queryFn: () => api.getRankHistory(category, playerId, days),
  })
}

export const useLeaderboardStats = (category: string) => {
  return useQuery({
    queryKey: ['leaderboardStats', category],
    queryFn: () => api.getLeaderboardStats(category),
  })
}

export const useRefreshLeaderboard = () => {
  return useMutation({
    mutationFn: (category: string) => api.refreshLeaderboard(category),
  })
}
