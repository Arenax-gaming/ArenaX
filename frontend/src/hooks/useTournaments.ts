import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tournament, TournamentFilters } from "@/types/tournament";

/**
 * Builds a flat params object from TournamentFilters, stripping undefined
 * values so URLSearchParams doesn't produce stray `key=undefined` entries.
 */
function filtersToParams(
  filters: TournamentFilters,
): Record<string, string> {
  const p: Record<string, string> = {};
  if (filters.search)          p.search          = filters.search;
  if (filters.status)          p.status          = filters.status;
  if (filters.pageStatus)      p.pageStatus      = filters.pageStatus;
  if (filters.gameType)        p.gameType        = filters.gameType;
  if (filters.tournamentType)  p.tournamentType  = filters.tournamentType;
  if (filters.visibility)      p.visibility      = filters.visibility;
  if (filters.sortBy)          p.sortBy          = filters.sortBy;
  if (filters.sortOrder)       p.sortOrder       = filters.sortOrder;
  if (filters.page !== undefined)         p.page          = String(filters.page);
  if (filters.limit !== undefined)        p.limit         = String(filters.limit);
  if (filters.minEntryFee !== undefined)  p.minEntryFee   = String(filters.minEntryFee);
  if (filters.maxEntryFee !== undefined)  p.maxEntryFee   = String(filters.maxEntryFee);
  if (filters.minPrizePool !== undefined) p.minPrizePool  = String(filters.minPrizePool);
  if (filters.maxPrizePool !== undefined) p.maxPrizePool  = String(filters.maxPrizePool);
  return p;
}

/**
 * Fetches tournaments from the API with optional filters.
 * Every filter change produces a new API call — no client-side filtering.
 */
export function useTournaments(filters: TournamentFilters = {}) {
  return useQuery<Tournament[]>({
    queryKey: ["tournaments", filters],
    queryFn: async () => {
      const params = filtersToParams(filters);
      const data = await api.getTournaments(
        Object.keys(params).length > 0 ? params : undefined,
      );
      // api.getTournaments returns unknown — coerce to Tournament[]
      return (data ?? []) as Tournament[];
    },
    staleTime: 30_000,
  });
}

/**
 * Fetches the list of tournament IDs the authenticated user has joined.
 * Stores a plain string[] in the cache (Sets aren't JSON-serialisable) and
 * converts to a Set at call sites via the `joinedSet` helper below.
 */
export function useJoinedTournaments(userId: string | undefined) {
  return useQuery<string[]>({
    queryKey: ["joinedTournaments", userId],
    queryFn: async () => {
      const data = await api.getJoinedTournaments();
      return (data ?? []).map((t) => t.id);
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });
}
