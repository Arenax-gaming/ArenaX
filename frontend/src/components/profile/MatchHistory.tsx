"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { MatchWithPlayers } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { VirtualDynamicList, VirtualDynamicListRenderProps } from "@/components/ui/VirtualDynamicList";
import {
  Trophy,
  Swords,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Search,
  TrendingUp,
  TrendingDown,
  Clock,
  Gamepad2,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Allow either the profile-specific or general MatchWithPlayers shape
type AnyMatchWithPlayers = MatchWithPlayers & {
  scorePlayer1?: number;
  scorePlayer2?: number;
  createdAt?: string;
  completedAt?: string;
};

export interface MatchHistoryFilters {
  gameType?: string;
  result?: "win" | "loss";
  opponentSearch?: string;
  timeRange?: "week" | "month" | "all";
}

interface MatchHistoryProps {
  matches: AnyMatchWithPlayers[];
  currentUserId: string;
  filters?: MatchHistoryFilters;
  onFilterChange?: (filters: MatchHistoryFilters) => void;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  /** Pixel height of the virtual scroll area. Defaults to 560. */
  virtualHeight?: number;
  /** Called when the user scrolls near the bottom */
  onLoadMore?: () => void;
  /** Show spinner while loading more */
  isLoadingMore?: boolean;
  /** Disable virtual scrolling (e.g. for short lists < 20 items) */
  disableVirtualization?: boolean;
}

// ─── Individual match row ─────────────────────────────────────────────────────

interface MatchRowProps {
  match: AnyMatchWithPlayers;
  currentUserId: string;
  index: number;
  measureRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
}

const MatchRow = React.memo(function MatchRow({
  match,
  currentUserId,
  measureRef,
  style,
}: MatchRowProps) {
  const isWinner = match.winnerId === currentUserId;
  const opponentName =
    match.player1Id === currentUserId ? match.player2Username : match.player1Username;
  const myScore = match.score?.split("-")[0] ?? String(match.scorePlayer1 ?? 0);
  const opponentScore = match.score?.split("-")[1] ?? String(match.scorePlayer2 ?? 0);
  const date = new Date(match.date ?? match.createdAt ?? Date.now());
  // Deterministic ELO change based on match id to avoid hydration mismatch
  const eloSeed = match.id.charCodeAt(0) % 25 + 10;
  const eloChange = isWinner ? eloSeed : -eloSeed;

  return (
    <div style={style} role="listitem">
      <div ref={measureRef} className="px-1 py-1.5">
        <Link href={`/matches/${match.id}`} className="block">
          <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-all duration-200 hover:shadow-md cursor-pointer group">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "flex items-center justify-center h-12 w-12 rounded-full font-bold text-sm shrink-0",
                  isWinner
                    ? "bg-success-muted text-green-700 dark:bg-success-muted/40 dark:text-success/80 border-2 border-success/30"
                    : "bg-destructive/10 text-red-700 dark:bg-destructive/20 dark:text-destructive/80 border-2 border-red-200 dark:border-red-800"
                )}
                aria-label={isWinner ? "Win" : "Loss"}
              >
                {isWinner ? "W" : "L"}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-foreground truncate">
                    vs {opponentName}
                  </span>
                  {match.tournamentName && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded-full">
                      <Trophy className="h-3 w-3" aria-hidden="true" />
                      {match.tournamentName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year:
                        date.getFullYear() !== new Date().getFullYear()
                          ? "numeric"
                          : undefined,
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="uppercase tracking-wider font-medium bg-muted px-2 py-0.5 rounded">
                    {match.gameType}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-xl font-bold tabular-nums mb-1">
                  {myScore} - {opponentScore}
                </div>
                <div
                  className={cn(
                    "text-xs font-medium flex items-center gap-1",
                    eloChange > 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {eloChange > 0 ? (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  )}
                  {eloChange > 0 ? "+" : ""}
                  {eloChange} ELO
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export function MatchHistory({
  matches,
  currentUserId,
  filters = {},
  onFilterChange,
  page,
  totalPages,
  onPageChange,
  virtualHeight = 560,
  onLoadMore,
  isLoadingMore = false,
  disableVirtualization = false,
}: MatchHistoryProps) {
  const [showFilters, setShowFilters] = useState(false);

  const gameTypes = useMemo(
    () => Array.from(new Set(matches.map((m) => m.gameType).filter(Boolean))),
    [matches]
  );

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
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
      if (filters.timeRange && filters.timeRange !== "all") {
        const matchDate = new Date(match.date ?? match.createdAt ?? Date.now());
        const daysDiff = Math.floor(
          (Date.now() - matchDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (filters.timeRange === "week" && daysDiff > 7) return false;
        if (filters.timeRange === "month" && daysDiff > 30) return false;
      }
      return true;
    });
  }, [matches, filters, currentUserId]);

  const wins = filteredMatches.filter((m) => m.winnerId === currentUserId).length;
  const losses = filteredMatches.length - wins;
  const winRate = filteredMatches.length > 0 ? (wins / filteredMatches.length) * 100 : 0;
  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined);

  // Use virtualisation only when there are enough items to justify it
  const useVirtual = !disableVirtualization && filteredMatches.length >= 20;

  const clearFilters = () => onFilterChange?.({});

  // Render function for VirtualDynamicList
  const renderMatchItem = useCallback(
    ({ item, index, style, measureRef }: VirtualDynamicListRenderProps<AnyMatchWithPlayers>) => (
      <MatchRow
        key={item.id}
        match={item}
        currentUserId={currentUserId}
        index={index}
        style={style}
        measureRef={measureRef}
      />
    ),
    [currentUserId]
  );

  const showPagination = totalPages !== undefined && onPageChange !== undefined && totalPages > 1;
  const currentPage = page ?? 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Swords className="h-5 w-5" aria-hidden="true" />
            Match History
            {filteredMatches.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredMatches.length} matches)
              </span>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(hasActiveFilters && "border-primary")}
            aria-expanded={showFilters}
            aria-controls="match-history-filters"
          >
            <Filter className="h-4 w-4 mr-2" aria-hidden="true" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full w-2 h-2" aria-hidden="true" />
            )}
          </Button>
        </div>

        {/* Stats summary */}
        {filteredMatches.length > 0 && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t" role="region" aria-label="Match statistics">
            <div className="text-center">
              <p className="text-2xl font-bold text-success" aria-label={`${wins} wins`}>{wins}</p>
              <p className="text-xs text-muted-foreground">Wins</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive" aria-label={`${losses} losses`}>{losses}</p>
              <p className="text-xs text-muted-foreground">Losses</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{winRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Filter controls */}
        {showFilters && (
          <div
            id="match-history-filters"
            className="space-y-4 mb-6 p-4 bg-muted/30 rounded-lg border"
            role="region"
            aria-label="Match filters"
          >
            <div className="flex flex-wrap gap-3">
              {/* Time Range */}
              <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by time range">
                {(["all", "week", "month"] as const).map((range) => {
                  const active = (filters.timeRange ?? "all") === range;
                  return (
                    <button
                      key={range}
                      onClick={() => onFilterChange?.({ ...filters, timeRange: range })}
                      className={cn(
                        "px-3 py-1.5 text-sm capitalize transition-colors",
                        active ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"
                      )}
                      aria-pressed={active}
                    >
                      {range === "all" ? "All Time" : `Past ${range}`}
                    </button>
                  );
                })}
              </div>

              {/* Game type */}
              <select
                value={filters.gameType ?? ""}
                onChange={(e) => onFilterChange?.({ ...filters, gameType: e.target.value || undefined })}
                className="text-sm border rounded-md px-3 py-1.5 bg-background text-foreground min-w-[120px]"
                aria-label="Filter by game type"
              >
                <option value="">All Types</option>
                {gameTypes.map((gt) => (
                  <option key={gt} value={gt}>{gt}</option>
                ))}
              </select>

              {/* Result */}
              <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by result">
                {(["all", "win", "loss"] as const).map((r) => {
                  const active = r === "all" ? !filters.result : filters.result === r;
                  return (
                    <button
                      key={r}
                      onClick={() => onFilterChange?.({ ...filters, result: r === "all" ? undefined : r })}
                      className={cn(
                        "px-3 py-1.5 text-sm capitalize transition-colors",
                        active ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"
                      )}
                      aria-pressed={active}
                    >
                      {r === "all" ? "All" : r === "win" ? "Wins" : "Losses"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Opponent search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search opponent..."
                value={filters.opponentSearch ?? ""}
                onChange={(e) => onFilterChange?.({ ...filters, opponentSearch: e.target.value || undefined })}
                className="w-full pl-10 pr-4 py-2 text-sm border rounded-md bg-background text-foreground"
                aria-label="Search by opponent name"
              />
            </div>

            {hasActiveFilters && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Match list */}
        {filteredMatches.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <Gamepad2 className="h-12 w-12 text-muted-foreground opacity-50" aria-hidden="true" />
            <h3 className="text-lg font-semibold">No matches found</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {hasActiveFilters
                ? "Try adjusting your filters to see more matches"
                : "You haven't played any matches yet. Start competing to build your history!"}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : useVirtual ? (
          <VirtualDynamicList
            listId="match-history"
            items={filteredMatches}
            estimatedItemSize={88}
            height={virtualHeight}
            overscanCount={3}
            renderItem={renderMatchItem}
            onLoadMore={onLoadMore}
            loadingIndicator={
              isLoadingMore ? (
                <div className="flex justify-center py-3 border-t" aria-busy="true">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : null
            }
          />
        ) : (
          // Static render for short lists
          <div className="space-y-3" role="list">
            {filteredMatches.map((match, index) => (
              <MatchRow
                key={match.id}
                match={match}
                currentUserId={currentUserId}
                index={index}
              />
            ))}
          </div>
        )}

        {/* Pagination (used alongside non-virtual render) */}
        {showPagination && !useVirtual && (
          <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-4">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
          </div>
        )}

        {filteredMatches.length > 0 && (
          <div className="flex justify-center mt-6 pt-4 border-t">
            <Link href="/matches">
              <Button variant="outline" size="sm">
                <BarChart3 className="h-4 w-4 mr-2" aria-hidden="true" />
                View Detailed Analytics
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
