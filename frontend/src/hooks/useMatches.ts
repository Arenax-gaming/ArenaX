import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Match, MatchWithPlayers, MatchDetail, MatchFilters } from '@/types/match'
import { MatchHubDetails } from '@/data/matchHub'

// Fetch a single match
export const useMatch = (matchId: string) => {
  return useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => {
      try {
        const data = await api.getMatch(matchId)
        return data as (MatchWithPlayers & Partial<MatchDetail> & Partial<MatchHubDetails>)
      } catch (e) {
        // Fallback to mock data if API fails (for now)
        const { matchHubDetails } = await import('@/data/matchHub')
        const { mockMatchDetails } = await import('@/data/matches')
        return matchHubDetails[matchId] || mockMatchDetails[matchId] || null
      }
    },
    enabled: !!matchId,
  })
}

// Fetch all matches with filters
export const useMatches = (filters?: MatchFilters) => {
  return useQuery({
    queryKey: ['matches', filters],
    queryFn: async () => {
      const data = await api.getMatches(filters)
      return data as MatchWithPlayers[]
    },
  })
}

// Report match score
export const useReportMatchScore = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, result }: { id: string; result: any }) => {
      return await api.reportMatchScore(id, result)
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['match', id] })
    },
  })
}
