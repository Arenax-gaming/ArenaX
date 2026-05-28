"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MatchWithPlayers } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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
  BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface MatchHistoryFilters {
  gameType?: string;
  result?: "win" | "loss";
  opponentSearch?: string;
  timeRange?: "week" | "month" | "all";
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

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline";
  };
  size?: "sm" | "md" | "lg";
}

function EmptyState({ icon: Icon, title, description, action, size = "md" }: EmptyStateProps) {
  const sizeClasses = {
    sm: "py-8",
    md: "py-12",
    lg: "py-16"
  };

  return (
    <div className={cn("text-center", sizeClasses[size])}>
      <Icon className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground mb-4 max-w-md mx-auto">{description}</p>
      {action && (
        <Button variant={action.variant || "default"} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
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
  const [showFilters, setShowFilters] = useState(false);
  
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
    
    // Time range filter
    if (filters.timeRange && filters.timeRange !== "all") {
      const matchDate = new Date(match.date);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - matchDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (filters.timeRange === "week" && daysDiff > 7) return false;
      if (filters.timeRange === "month" && daysDiff > 30) return false;
    }
    
    return true;
  });

  // Calculate stats for filtered matches
  const wins = filteredMatches.filter(m => m.winnerId === currentUserId).length;
  const losses = filteredMatches.length - wins;
  const winRate = filteredMatches.length > 0 ? (wins / filteredMatches.length) * 100 : 0;

  const handleGameTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange?.({ ...filters, gameType: e.target.value || undefined });
  };

  const handleResultChange = (result: "win" | "loss" | undefined) => {
    onFilterChange?.({ ...filters, result });
  };

  const handleOpponentSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange?.({ ...filters, opponentSearch: e.target.value || undefined });
  };

  const handleTimeRangeChange = (timeRange: "week" | "month" | "all") => {
    onFilterChange?.({ ...filters, timeRange });
  };

  const clearFilters = () => {
    onFilterChange?.({});
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined);

  const showPagination =
    totalPages !== undefined && onPageChange !== undefined && totalPages > 0;
  const currentPage = page ?? 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Swords className="h-5 w-5" />
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
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full w-2 h-2" />
            )}
          </Button>
        </div>
        
        {/* Stats Summary */}
        {filteredMatches.length > 0 && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{wins}</p>
              <p className="text-xs text-muted-foreground">Wins</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{losses}</p>
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
          <div className="space-y-4 mb-6 p-4 bg-muted/30 rounded-lg border">
            <div className="flex flex-wrap gap-3">
              {/* Time Range */}
              <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by time range">
                {(["all", "week", "month"] as const).map((range) => {
                  const active = (filters.timeRange ?? "all") === range;
                  return (
                    <button
                      key={range}
                      onClick={() => handleTimeRangeChange(range)}
                      className={cn(
                        "px-3 py-1.5 text-sm capitalize transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted"
                      )}
                    >
                      {range === "all" ? "All Time" : `Past ${range}`}
                    </button>
                  );
                })}
              </div>

              {/* Game type dropdown */}
              <select
                value={filters.gameType ?? ""}
                onChange={handleGameTypeChange}
                className="text-sm border rounded-md px-3 py-1.5 bg-background text-foreground min-w-[120px]"
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
                  const active = r === "all" ? !filters.result : filters.result === r;
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
            </div>

            {/* Opponent search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search opponent..."
                value={filters.opponentSearch ?? ""}
                onChange={handleOpponentSearch}
                className="w-full pl-10 pr-4 py-2 text-sm border rounded-md bg-background text-foreground"
                aria-label="Search opponent"
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
        <div className="space-y-3">
          {filteredMatches.length === 0 ? (
            <EmptyState
              icon={Gamepad2}
              title="No matches found"
              description={
                hasActiveFilters
                  ? "Try adjusting your filters to see more matches"
                  : "You haven't played any matches yet. Start competing to build your history!"
              }
              action={
                hasActiveFilters
                  ? {
                    label: "Clear filters",
                    onClick: clearFilters,
                    variant: "outline",
                  }
                  : {
                    label: "Find Match",
                    onClick: () => window.location.href = "/play",
                  }
              }
              size="md"
            />
          ) : (
            filteredMatches.map((match, index) => {
              const isWinner = match.winnerId === currentUserId;
              const opponentName =
                match.player1Id === currentUserId
                  ? match.player2Username
                  : match.player1Username;
              const myScore = match.score.split('-')[0];
              const opponentScore = match.score.split('-')[1];
              const date = new Date(match.date);
              
              // Calculate ELO change (mock data)
              const eloChange = isWinner ? Math.floor(Math.random() * 25) + 10 : -(Math.floor(Math.random() * 25) + 10);

              return (
                <Link
                  key={match.id}
                  href={`/matches/${match.id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-all duration-200 hover:shadow-md cursor-pointer group">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex items-center justify-center h-12 w-12 rounded-full font-bold text-sm transition-all",
                          isWinner
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-2 border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-2 border-red-200 dark:border-red-800"
                        )}
                      >
                        {isWinner ? "W" : "L"}
                      </div>
                      
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground truncate">vs {opponentName}</span>
                          {match.tournamentName && (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded-full">
                              <Trophy className="h-3 w-3" />
                              {match.tournamentName}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {date.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
                            })}
                          </span>
                          
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
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
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xl font-bold tabular-nums mb-1">
                          {myScore} - {opponentScore}
                        </div>
                        
                        <div className={cn(
                          "text-xs font-medium flex items-center gap-1",
                          eloChange > 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {eloChange > 0 ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {eloChange > 0 ? '+' : ''}{eloChange} ELO
                        </div>
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
          <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
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
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Quick Actions */}
        {filteredMatches.length > 0 && (
          <div className="flex justify-center mt-6 pt-4 border-t">
            <Link href="/matches">
              <Button variant="outline" size="sm">
                <BarChart3 className="h-4 w-4 mr-2" />
                View Detailed Analytics
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
