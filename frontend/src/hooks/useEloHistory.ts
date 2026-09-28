"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EloPoint } from "@/types/user";

export type EloDateRange = "7d" | "30d" | "season" | "all";

/** Sentinel game value meaning "combine every game the player has played" (#1096). */
export const ALL_GAMES = "all";

/** `from`/`to` ISO date strings for a date-range option, `to` always "now". */
export function resolveDateRange(range: EloDateRange, now: Date = new Date()): {
  from?: string;
  to?: string;
} {
  const to = now.toISOString();
  switch (range) {
    case "7d":
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to };
    case "season": {
      // Seasons aren't date-anchored elsewhere in this frontend yet — treat
      // "This Season" as the last 90 days until a real season boundary
      // exists to query against.
      return { from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(), to };
    }
    case "all":
      return {};
  }
}

async function fetchEloHistory(game: string, from?: string, to?: string): Promise<EloPoint[]> {
  const raw = await api.getEloHistory(game, from, to);
  return raw.map((point) => ({ date: point.date, elo: point.elo }));
}

/**
 * ELO history for the chart's current filters (#1096). When `game` is
 * `ALL_GAMES`, fetches every game in `allGames` and merges the results,
 * sorted chronologically, since the backend endpoint is per-game.
 */
export function useEloHistory(game: string, allGames: string[], dateRange: EloDateRange) {
  const { from, to } = resolveDateRange(dateRange);

  return useQuery({
    queryKey: ["eloHistory", game, allGames, dateRange],
    queryFn: async (): Promise<EloPoint[]> => {
      if (game !== ALL_GAMES) {
        return fetchEloHistory(game, from, to);
      }
      const perGame = await Promise.all(allGames.map((g) => fetchEloHistory(g, from, to)));
      return perGame
        .flat()
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    },
    enabled: game === ALL_GAMES ? allGames.length > 0 : Boolean(game),
    staleTime: 30_000,
    // Keep showing the previous range/game's chart (dimmed via isFetching in
    // EloChart) instead of blanking out while the new filter's data loads (#1096).
    placeholderData: keepPreviousData,
  });
}
