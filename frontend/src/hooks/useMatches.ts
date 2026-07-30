import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Match, MatchWithPlayers, MatchDetail, MatchFilters, ReportScoreRequest } from '@/types/match'
import type { MatchHubDetails } from '@/types/match'

// Fetch a single match
export const useMatch = (matchId: string) => {
  return useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => {
      const data = await api.getMatch(matchId)
      return data as (MatchWithPlayers & Partial<MatchDetail> & Partial<MatchHubDetails>)
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
    mutationFn: async ({ id, result }: { id: string; result: ReportScoreRequest }) => {
      return await api.reportMatchScore(id, result)
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['match', id] })
    },
  })
}
