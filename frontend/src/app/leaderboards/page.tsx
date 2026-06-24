"use client";

import React, { useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { CategorySelector } from "@/components/leaderboard/CategorySelector";
import { SeasonSelector } from "@/components/leaderboard/SeasonSelector";
import { PersonalRank } from "@/components/leaderboard/PersonalRank";
import { LeaderboardFilters } from "@/components/leaderboard/LeaderboardFilters";
import { useLeaderboard, useLeaderboardStats } from "@/hooks/useLeaderboard";
import type { LeaderboardCategory } from "@/types/leaderboard";

function LeaderboardsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [category, setCategory] = useState<LeaderboardCategory>("global");
  const [season, setSeason] = useState(() => searchParams.get("season") ?? "current");
  const [sortBy, setSortBy] = useState<"points" | "wins" | "winRate">("points");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSeasonChange = useCallback(
    (newSeason: string) => {
      setSeason(newSeason);
      const params = new URLSearchParams(searchParams.toString());
      if (newSeason === "current") {
        params.delete("season");
      } else {
        params.set("season", newSeason);
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const { data: leaderboardData, isLoading, isFetching } = useLeaderboard(category, 100, 0, season);
  const { data: statsData } = useLeaderboardStats(category);

  const entries = leaderboardData?.entries || [];
  const filteredEntries = entries.filter((entry) =>
    entry.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Leaderboards</h1>
          <p className="text-muted-foreground">Compete and climb the ranks</p>
        </div>

        {/* Stats */}
        {statsData && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-surface/50 rounded-lg p-4 border border-border">
              <p className="text-muted-foreground text-sm mb-1">Total Players</p>
              <p className="text-2xl font-bold text-white">
                {statsData.totalPlayers}
              </p>
            </div>
            <div className="bg-surface/50 rounded-lg p-4 border border-border">
              <p className="text-muted-foreground text-sm mb-1">Average Elo</p>
              <p className="text-2xl font-bold text-white">
                {Math.round(statsData.averageElo)}
              </p>
            </div>
            <div className="bg-surface/50 rounded-lg p-4 border border-border">
              <p className="text-muted-foreground text-sm mb-1">Median Elo</p>
              <p className="text-2xl font-bold text-white">
                {statsData.medianElo}
              </p>
            </div>
            <div className="bg-surface/50 rounded-lg p-4 border border-border">
              <p className="text-muted-foreground text-sm mb-1">Top Player Elo</p>
              <p className="text-2xl font-bold text-white">
                {statsData.topPlayerElo}
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <CategorySelector category={category} onChange={setCategory} />
          <SeasonSelector season={season} onChange={handleSeasonChange} />
          <div className="md:col-span-1">
            <LeaderboardFilters onSearch={setSearchQuery} />
          </div>
        </div>

        {/* Personal Rank */}
        <PersonalRank category={category} season={season} />

        {/* Leaderboard Table */}
        <div className="bg-surface/50 rounded-lg p-6 backdrop-blur border border-border">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              {category === "global"
                ? "Global Rankings"
                : category === "tournaments"
                  ? "Tournament Rankings"
                  : category === "casual"
                    ? "Casual Rankings"
                    : "Ranked Rankings"}
              {isFetching && !isLoading && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading season data…" />
              )}
            </h2>
            <div className="text-sm text-muted-foreground">
              {filteredEntries.length} players
            </div>
          </div>

          <LeaderboardTable
            entries={filteredEntries}
            isLoading={isFetching}
            sortBy={sortBy}
            onSortChange={(col) => setSortBy(col as any)}
          />
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LeaderboardsContent />
    </Suspense>
  );
}
