import { useQuery, useMutation } from '@tanstack/react-query'
import {
    LeaderboardResponse,
    PlayerRankResponse,
    RankHistory,
    SeasonalLeaderboard,
    LeaderboardStats,
} from '@/types/leaderboard'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'

export const useLeaderboard = (category: string, limit = 100, offset = 0) => {
    return useQuery({
        queryKey: ['leaderboard', category, limit, offset],
        queryFn: async () => {
            const res = await fetch(
                `${API_BASE}/leaderboards/${category}?limit=${limit}&offset=${offset}`
            )
            if (!res.ok) throw new Error('Failed to fetch leaderboard')
            return res.json() as Promise<LeaderboardResponse>
        },
    })
}

export const useSeasonalLeaderboard = (
    category: string,
    season: string,
    limit = 100,
    offset = 0
) => {
    return useQuery({
        queryKey: ['leaderboard', 'seasonal', category, season, limit, offset],
        queryFn: async () => {
            const res = await fetch(
                `${API_BASE}/leaderboards/${category}/season/${season}?limit=${limit}&offset=${offset}`
            )
            if (!res.ok) throw new Error('Failed to fetch seasonal leaderboard')
            return res.json() as Promise<SeasonalLeaderboard>
        },
    })
}

export const usePlayerRank = (category: string, playerId: string) => {
    return useQuery({
        queryKey: ['playerRank', category, playerId],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/leaderboards/${category}/player/${playerId}`)
            if (!res.ok) throw new Error('Failed to fetch player rank')
            return res.json() as Promise<PlayerRankResponse>
        },
    })
}

export const useRankHistory = (category: string, playerId: string, days = 30) => {
    return useQuery({
        queryKey: ['rankHistory', category, playerId, days],
        queryFn: async () => {
            const res = await fetch(
                `${API_BASE}/leaderboards/${category}/history/${playerId}?days=${days}`
            )
            if (!res.ok) throw new Error('Failed to fetch rank history')
            return res.json() as Promise<RankHistory>
        },
    })
}

export const useLeaderboardStats = (category: string) => {
    return useQuery({
        queryKey: ['leaderboardStats', category],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/leaderboards/${category}/stats`)
            if (!res.ok) throw new Error('Failed to fetch leaderboard stats')
            return res.json() as Promise<LeaderboardStats>
        },
    })
}

export const useRefreshLeaderboard = () => {
    return useMutation({
        mutationFn: async (category: string) => {
            const res = await fetch(`${API_BASE}/leaderboards/${category}/refresh`, {
                method: 'POST',
            })
            if (!res.ok) throw new Error('Failed to refresh leaderboard')
            return res.json()
        },
    })
}
