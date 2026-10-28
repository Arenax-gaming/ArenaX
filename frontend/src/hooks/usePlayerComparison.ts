"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  PlayerComparisonStats,
  BatchPlayerStatsResponse,
} from "@/types/profile";

export interface UsePlayerComparisonResult {
  data: BatchPlayerStatsResponse | undefined;
  player1Stats: PlayerComparisonStats | undefined;
  player2Stats: PlayerComparisonStats | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to retrieve both players' comparison statistics in a single batch API call.
 * Avoids N+1 requests and redundant network calls.
 *
 * @param player1Id The ID of the primary player (profile owner)
 * @param player2Id The ID of the selected opponent
 */
export function usePlayerComparison(
  player1Id: string | undefined,
  player2Id: string | null | undefined
): UsePlayerComparisonResult {
  const shouldFetch = Boolean(
    player1Id && player2Id && player1Id.trim() !== "" && player2Id.trim() !== ""
  );

  const query = useQuery<BatchPlayerStatsResponse, Error>({
    queryKey: ["playerComparison", player1Id, player2Id],
    queryFn: async () => {
      if (!player1Id || !player2Id) {
        throw new Error("Both player IDs are required for stats comparison");
      }
      return api.getPlayerComparisonStats([player1Id, player2Id]);
    },
    enabled: shouldFetch,
    staleTime: 60_000,
  });

  const player1Stats = player1Id ? query.data?.players?.[player1Id] : undefined;
  const player2Stats = player2Id ? query.data?.players?.[player2Id] : undefined;

  return {
    data: query.data,
    player1Stats,
    player2Stats,
    isLoading: query.isLoading && shouldFetch,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
