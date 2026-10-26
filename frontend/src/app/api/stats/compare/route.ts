import { NextRequest, NextResponse } from "next/server";
import { getProfileById } from "@/data/user";
import type { PlayerComparisonStats, BatchPlayerStatsResponse } from "@/types/profile";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerIdsParam = searchParams.get("player_ids") || searchParams.get("playerIds");

  if (!playerIdsParam || playerIdsParam.trim() === "") {
    return NextResponse.json(
      { error: "Missing player_ids parameter", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const ids = playerIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No valid player IDs provided", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const players: Record<string, PlayerComparisonStats> = {};

  for (const id of ids) {
    const data = getProfileById(id);
    if (data) {
      players[id] = {
        playerId: id,
        username: data.profile.username,
        avatar: data.profile.avatar,
        winRate: data.stats.winRate,
        averageElo: data.stats.elo,
        matchesPlayed: data.stats.wins + data.stats.losses,
        tournamentWins: data.stats.tournamentWins ?? 0,
        reputationScore: data.stats.reputationScore ?? 100,
      };
    } else {
      // Gracefully provide default shape for mock testing unknown IDs
      players[id] = {
        playerId: id,
        username: `Player_${id.slice(0, 6)}`,
        winRate: 50.0,
        averageElo: 1200,
        matchesPlayed: 0,
        tournamentWins: 0,
        reputationScore: 100,
      };
    }
  }

  const response: BatchPlayerStatsResponse = { players };
  return NextResponse.json(response);
}
