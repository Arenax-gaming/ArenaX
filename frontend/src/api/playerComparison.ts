import { api } from "@/lib/api";
import type { PlayerComparisonStats, BatchPlayerStatsResponse } from "@/types/profile";

export type { PlayerComparisonStats, BatchPlayerStatsResponse };

/**
 * Fetch comparison statistics for multiple players in a single batch API call.
 * Retrieves all 5 required statistical categories:
 * - Win rate
 * - Average ELO
 * - Matches played
 * - Tournament wins
 * - Reputation score
 */
export async function fetchPlayerComparisonBatch(
  playerIds: string[]
): Promise<BatchPlayerStatsResponse> {
  return api.getPlayerComparisonStats(playerIds);
}
