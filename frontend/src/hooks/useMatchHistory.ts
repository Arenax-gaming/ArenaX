import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MatchWithPlayers, MatchFilters } from '@/types/match'

const PAGE_SIZE = 50

// Paginated match history; each loaded page is appended to `matches`.
export const useMatchHistory = (filters?: Omit<MatchFilters, 'page' | 'limit'>) => {
  const query = useInfiniteQuery({
    queryKey: ['match-history', filters],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const data = await api.getMatches({ ...filters, page: pageParam, limit: PAGE_SIZE })
      return data as MatchWithPlayers[]
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
  })

  return {
    ...query,
    matches: query.data?.pages.flat() ?? [],
  }
}
