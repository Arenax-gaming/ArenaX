"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Image as ImageIcon } from "lucide-react";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { LeaderboardPlayer } from "@/types/leaderboard";

export default function LeaderboardPage() {
  const [search, setSearch] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"points" | "wins" | "winRate">("points");
  const [isLoading, setIsLoading] = useState(true);
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        const mockData: LeaderboardPlayer[] = Array.from({ length: 50 }, (_, i) => ({
          rank: i + 1,
          userId: `user-${i}`,
          username: `Player${i + 1}`,
          points: Math.max(0, 10000 - i * 150 + Math.random() * 500),
          wins: Math.floor(Math.random() * 500),
          winRate: 0.4 + Math.random() * 0.4,
          game: ["Chess", "Checkers", "Go", "Poker"][Math.floor(Math.random() * 4)],
        }));
        setPlayers(mockData);
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const filteredPlayers = useMemo(() => {
    let filtered = players;

    if (search) {
      filtered = filtered.filter((player) =>
        player.username.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (gameFilter !== "all") {
      filtered = filtered.filter((player) => player.game === gameFilter);
    }

    filtered.sort((a, b) => {
      if (sortBy === "points") return b.points - a.points;
      if (sortBy === "wins") return b.wins - a.wins;
      return b.winRate - a.winRate;
    });

    return filtered.map((player, index) => ({
      ...player,
      rank: index + 1,
    }));
  }, [players, search, gameFilter, sortBy]);

  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);

  const totalCount = filteredPlayers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pagedPlayers = filteredPlayers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalCount);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, gameFilter, sortBy]);

  const games = ["all", "Chess", "Checkers", "Go", "Poker"];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-muted-foreground">
          Track top performers across ArenaX.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="search-player" className="text-sm font-medium">Search Player</label>
              <Input
                id="search-player"
                placeholder="Search by username..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="game-filter" className="text-sm font-medium">Game</label>
              <Select value={gameFilter} onValueChange={setGameFilter}>
                <SelectTrigger id="game-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {games.map((game) => (
                    <SelectItem key={game} value={game}>
                      {game === "all" ? "All Games" : game}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading leaderboard data...
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No players found matching your filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-semibold">Rank</th>
                      <th className="text-left py-3 px-4 font-semibold">Player</th>
                      <th className="text-left py-3 px-4 font-semibold">Game</th>
                      <th
                        className="text-left py-3 px-4 font-semibold cursor-pointer hover:text-primary"
                        onClick={() => setSortBy("points")}
                      >
                        Points {sortBy === "points" && <ArrowDown className="inline w-4 h-4" />}
                      </th>
                      <th
                        className="text-left py-3 px-4 font-semibold cursor-pointer hover:text-primary"
                        onClick={() => setSortBy("wins")}
                      >
                        Wins {sortBy === "wins" && <ArrowDown className="inline w-4 h-4" />}
                      </th>
                      <th
                        className="text-left py-3 px-4 font-semibold cursor-pointer hover:text-primary"
                        onClick={() => setSortBy("winRate")}
                      >
                        Win Rate {sortBy === "winRate" && <ArrowDown className="inline w-4 h-4" />}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPlayers.map((player) => (
                      <tr key={player.userId} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4">
                          <Badge variant="outline">#{player.rank}</Badge>
                        </td>
                        <td className="py-3 px-4 flex items-center gap-2">
                          <ImageIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                          {player.username}
                        </td>
                        <td className="py-3 px-4">{player.game}</td>
                        <td className="py-3 px-4 font-semibold">
                          {Math.round(player.points)}
                        </td>
                        <td className="py-3 px-4">{player.wins}</td>
                        <td className="py-3 px-4">
                          {(player.winRate * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 text-sm">
                <p className="text-muted-foreground">
                  Showing {rangeStart}–{rangeEnd} of {totalCount} players
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page === totalPages}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
