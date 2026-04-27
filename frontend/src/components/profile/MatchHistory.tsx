"use client";

import React from "react";
import Link from "next/link";
import { MatchWithPlayers } from "@/types/match";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Trophy, Swords, Calendar, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MatchHistoryFilters {
  gameType?: string;
  result?: "win" | "loss";
  opponentSearch?: string;
}

interface MatchHistoryProps {
  matches: MatchWithPlayers[];
  currentUserId: string;
  filters?: MatchHistoryFilters;
  onFilterChange?: (filters: MatchHistoryFilters) => void;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

export function MatchHistory({
  matches,
  currentUserId,
  filters = {},
  onFilterChange,
  page,
  totalPages,
  onPageChange,
}: MatchHistoryProps) {
  // Derive unique game types from the matches list
  const gameTypes = Array.from(new Set(matches.map((m) => m.gameType).filter(Boolean)));

  // Apply filters client-side
  const filteredMatches = matches.filter((match) => {
    const isWin = match.winnerId === currentUserId;
    const opponentName =
      match.player1Id === currentUserId ? match.player2Username : match.player1Username;

    if (filters.gameType && match.gameType !== filters.gameType) return false;
    if (filters.result === "win" && !isWin) return false;
    if (filters.result === "loss" && isWin) return false;
    if (
      filters.opponentSearch &&
      !opponentName.toLowerCase().includes(filters.opponentSearch.toLowerCase())
    )
      return false;
    return true;
  });

  const handleGameTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange?.({ ...filters, gameType: e.target.value || undefined });
  };

  const handleResultChange = (result: "win" | "loss" | undefined) => {
    onFilterChange?.({ ...filters, result });
  };

  const handleOpponentSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange?.({ ...filters, opponentSearch: e.target.value || undefined });
  };

  const showPagination =
    totalPages !== undefined && onPageChange !== undefined && totalPages > 0;
  const currentPage = page ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Swords className="h-5 w-5" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filter controls */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Game type dropdown */}
          <select
            value={filters.gameType ?? ""}
            onChange={handleGameTypeChange}
            className="text-sm border rounded-md px-2 py-1.5 bg-background text-foreground"
            aria-label="Filter by game type"
          >
            <option value="">All Types</option>
            {gameTypes.map((gt) => (
              <option key={gt} value={gt}>
                {gt}
              </option>
            ))}
          </select>

          {/* Result toggle */}
          <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by result">
            {(["all", "win", "loss"] as const).map((r) => {
              const active =
                r === "all" ? !filters.result : filters.result === r;
              return (
                <button
                  key={r}
                  onClick={() => handleResultChange(r === "all" ? undefined : r)}
                  className={cn(
                    "px-3 py-1.5 text-sm capitalize transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted"
                  )}
                >
                  {r === "all" ? "All" : r === "win" ? "Wins" : "Losses"}
                </button>
              );
            })}
          </div>

          {/* Opponent search */}
          <input
            type="text"
            placeholder="Search opponent..."
            value={filters.opponentSearch ?? ""}
            onChange={handleOpponentSearch}
            className="text-sm border rounded-md px-2 py-1.5 bg-background text-foreground flex-1 min-w-[140px]"
            aria-label="Search opponent"
          />
        </div>

        {/* Match list */}
        <div className="space-y-4">
          {filteredMatches.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matches found</p>
          ) : (
            filteredMatches.map((match) => {
              const isWinner = match.winnerId === currentUserId;
              const opponentName =
                match.player1Id === currentUserId
                  ? match.player2Username
                  : match.player1Username;
              const myScore =
                match.player1Id === currentUserId ? match.scorePlayer1 : match.scorePlayer2;
              const opponentScore =
                match.player1Id === currentUserId ? match.scorePlayer2 : match.scorePlayer1;
              const date = match.completedAt
                ? new Date(match.completedAt)
                : new Date(match.createdAt);

              return (
                <Link
                  key={match.id}
                  href={`/matches/${match.id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-colors cursor-pointer group">
                    <div className="block items-center gap-4">
                      <div
                        className={cn(
                          "flex items-center justify-center h-10 w-10 rounded-full font-bold text-xs uppercase transition-all",
                          isWinner
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800"
                        )}
                      >
                        {isWinner ? "Win" : "Loss"}
                      </div>
                      <div>
                        <div className="block items-center gap-2">
                          <span className="font-semibold text-foreground">vs {opponentName}</span>
                          {match.tournamentName && (
                            <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1">
                              <Trophy className="h-3 w-3" />
                              {match.tournamentName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="h-3 w-3" />
                          {date.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-lg font-bold tabular-nums">
                          {myScore} - {opponentScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                          {match.gameType}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {showPagination && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-md border disabled:opacity-40 hover:bg-muted transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-md border disabled:opacity-40 hover:bg-muted transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
