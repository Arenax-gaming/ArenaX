"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  EMPTY_PLAYER_ANALYTICS,
  MatchHistoryEntry,
  MatchHistoryFilter,
  PlayerAnalytics,
} from "@/types/playerAnalytics";

/**
 * Pure client-side filter for match history rows. Kept outside the component
 * (and the network layer) so it can be reused and unit-tested independently.
 */
export function filterMatchHistory(
  history: MatchHistoryEntry[],
  filter: MatchHistoryFilter,
): MatchHistoryEntry[] {
  return history.filter((entry) => {
    if (filter.game && filter.game !== "all" && entry.game !== filter.game) return false;
    if (filter.result && filter.result !== "all" && entry.result !== filter.result) return false;
    if (filter.tournamentId && entry.tournamentId !== filter.tournamentId) return false;
    if (filter.from && new Date(entry.playedAt) < new Date(filter.from)) return false;
    if (filter.to && new Date(entry.playedAt) > new Date(filter.to)) return false;
    return true;
  });
}

/** Distinct game names present in a history list, for filter dropdowns. */
export function collectGames(history: MatchHistoryEntry[]): string[] {
  return Array.from(new Set(history.map((entry) => entry.game))).sort();
}

/**
 * Player analytics for the dashboard (#1266). When the backend endpoint is not
 * available (or returns nothing) the dashboard still renders using the empty
 * shape rather than throwing.
 */
export function usePlayerAnalytics(playerId: string | undefined, filter: MatchHistoryFilter) {
  return useQuery({
    queryKey: ["playerAnalytics", playerId, filter],
    enabled: Boolean(playerId),
    queryFn: async (): Promise<PlayerAnalytics> => {
      if (!playerId) return EMPTY_PLAYER_ANALYTICS;
      const data = await api.getPlayerAnalytics(playerId, {
        game: filter.game,
        result: filter.result,
        tournamentId: filter.tournamentId,
        from: filter.from,
        to: filter.to,
      });
      return data ?? EMPTY_PLAYER_ANALYTICS;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
