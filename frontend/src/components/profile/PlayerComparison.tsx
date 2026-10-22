"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Swords,
  Trophy,
  Target,
  Zap,
  ShieldCheck,
  CheckCircle2,
  X,
  RefreshCw,
  Search,
  UserCheck,
} from "lucide-react";
import { usePlayerComparison } from "@/hooks/usePlayerComparison";
import type {
  PublicProfile,
  PlayerStats,
  FriendEntry,
  PlayerComparisonStats,
} from "@/types/profile";

export interface PlayerComparisonProps {
  /** The primary player being viewed (from profile) */
  primaryProfile: PublicProfile;
  primaryStats?: PlayerStats;
  /** Available friends of the primary player for quick opponent picking */
  availableFriends?: FriendEntry[];
  /** Currently selected opponent ID (from URL query param `opponentId`) */
  selectedOpponentId?: string | null;
  /** Callback when user selects or changes opponent */
  onSelectOpponent: (opponentId: string | null) => void;
  /** Callback when user closes or collapses comparison view */
  onClose?: () => void;
}

export type Winner = "player1" | "player2" | "tie" | "none";

/**
 * Pure comparison logic for each statistical category.
 * Returns which player has the better value, or 'tie' if equal, or 'none' if missing.
 */
export function determineWinner(
  val1: number | null | undefined,
  val2: number | null | undefined,
  higherIsBetter = true
): Winner {
  if (val1 === null || val1 === undefined || Number.isNaN(val1)) return "none";
  if (val2 === null || val2 === undefined || Number.isNaN(val2)) return "none";
  if (val1 === val2) return "tie";
  if (higherIsBetter) {
    return val1 > val2 ? "player1" : "player2";
  }
  return val1 < val2 ? "player1" : "player2";
}

interface StatCategoryDef {
  key: keyof Pick<
    PlayerComparisonStats,
    "winRate" | "averageElo" | "matchesPlayed" | "tournamentWins" | "reputationScore"
  >;
  label: string;
  icon: React.ReactNode;
  format: (val: number | null | undefined) => string;
}

const COMPARISON_CATEGORIES: StatCategoryDef[] = [
  {
    key: "winRate",
    label: "Win Rate",
    icon: <Target className="h-4 w-4" />,
    format: (val) => (val !== null && val !== undefined ? `${val.toFixed(1)}%` : "—"),
  },
  {
    key: "averageElo",
    label: "Average ELO",
    icon: <Zap className="h-4 w-4" />,
    format: (val) => (val !== null && val !== undefined ? Math.round(val).toLocaleString() : "—"),
  },
  {
    key: "matchesPlayed",
    label: "Matches Played",
    icon: <Swords className="h-4 w-4" />,
    format: (val) => (val !== null && val !== undefined ? val.toLocaleString() : "—"),
  },
  {
    key: "tournamentWins",
    label: "Tournament Wins",
    icon: <Trophy className="h-4 w-4" />,
    format: (val) => (val !== null && val !== undefined ? val.toLocaleString() : "—"),
  },
  {
    key: "reputationScore",
    label: "Reputation Score",
    icon: <ShieldCheck className="h-4 w-4" />,
    format: (val) => (val !== null && val !== undefined ? `${val} pts` : "—"),
  },
];

export function PlayerComparison({
  primaryProfile,
  primaryStats,
  availableFriends = [],
  selectedOpponentId,
  onSelectOpponent,
  onClose,
}: PlayerComparisonProps) {
  const [manualInputId, setManualInputId] = useState("");
  const [showSelector, setShowSelector] = useState(!selectedOpponentId);

  // Fetch both players' stats in ONE batch API request
  const {
    player1Stats,
    player2Stats,
    isLoading,
    isError,
    error,
    refetch,
  } = usePlayerComparison(primaryProfile.id, selectedOpponentId);

  // Fallback to local profile stats if API hasn't returned yet or for initial render
  const effectivePlayer1: PlayerComparisonStats = {
    playerId: primaryProfile.id,
    username: primaryProfile.username,
    avatar: primaryProfile.avatar,
    winRate: player1Stats?.winRate ?? primaryStats?.winRate ?? 0,
    averageElo: player1Stats?.averageElo ?? primaryStats?.elo ?? primaryProfile.elo,
    matchesPlayed:
      player1Stats?.matchesPlayed ??
      ((primaryStats?.wins ?? 0) + (primaryStats?.losses ?? 0)),
    tournamentWins:
      player1Stats?.tournamentWins ?? primaryStats?.tournamentWins ?? 0,
    reputationScore:
      player1Stats?.reputationScore ?? primaryStats?.reputationScore ?? 100,
  };

  const opponentFriend = availableFriends.find((f) => f.id === selectedOpponentId);
  const opponentUsername =
    player2Stats?.username ?? opponentFriend?.username ?? selectedOpponentId ?? "Opponent";
  const opponentAvatar = player2Stats?.avatar ?? opponentFriend?.avatar;

  const handleApplyOpponent = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    onSelectOpponent(trimmed);
    setShowSelector(false);
  };

  const handleClearOpponent = () => {
    onSelectOpponent(null);
    setShowSelector(true);
  };

  const isSelectorVisible = showSelector || !selectedOpponentId;

  return (
    <Card
      className="border-primary/20 bg-card shadow-lg overflow-hidden animate-in fade-in duration-300"
      data-testid="player-comparison-view"
    >
      <CardHeader className="bg-muted/30 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Swords className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-xl font-extrabold tracking-tight">
                Head-to-Head Stats Comparison
              </CardTitle>
              <CardDescription>
                Compare performance metrics side by side between players
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedOpponentId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSelector(!showSelector)}
                data-testid="change-opponent-button"
              >
                <Search className="h-4 w-4 mr-1.5" />
                {isSelectorVisible ? "Hide Selector" : "Change Opponent"}
              </Button>
            )}
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close comparison view"
                data-testid="close-comparison-button"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Opponent Selection Panel */}
        {isSelectorVisible && (
          <div
            className="mt-4 pt-4 border-t border-border/60 space-y-3"
            data-testid="opponent-selector"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select an opponent to compare with {primaryProfile.username}:
            </p>

            {/* Quick-pick list from friends/known players */}
            {availableFriends.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableFriends.map((friend) => (
                  <Button
                    key={friend.id}
                    variant={selectedOpponentId === friend.id ? "default" : "outline"}
                    size="sm"
                    className="flex items-center gap-2 text-xs"
                    onClick={() => handleApplyOpponent(friend.id)}
                    data-testid={`select-opponent-${friend.id}`}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>{friend.username}</span>
                    <span className="opacity-70 text-[10px]">({friend.elo} ELO)</span>
                  </Button>
                ))}
              </div>
            )}

            {/* Manual Opponent ID Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleApplyOpponent(manualInputId);
              }}
              className="flex gap-2 max-w-md"
            >
              <input
                type="text"
                placeholder="Enter opponent player ID (e.g. user-456)..."
                value={manualInputId}
                onChange={(e) => setManualInputId(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                aria-label="Opponent ID"
                data-testid="opponent-select-input"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!manualInputId.trim()}
                data-testid="apply-opponent-button"
              >
                Compare
              </Button>
            </form>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-6">
        {/* State: No opponent selected */}
        {!selectedOpponentId ? (
          <div className="py-12 text-center text-muted-foreground space-y-3">
            <Swords className="h-12 w-12 mx-auto opacity-30 text-primary" />
            <p className="text-base font-medium text-foreground">
              No opponent selected for comparison
            </p>
            <p className="text-sm max-w-sm mx-auto">
              Choose an opponent from above or enter a player ID to view side-by-side stats.
            </p>
          </div>
        ) : isLoading ? (
          /* State: Loading single batch API request */
          <div className="py-12 space-y-6 animate-pulse" data-testid="comparison-loading-skeleton">
            <div className="grid grid-cols-2 gap-8 items-center max-w-2xl mx-auto">
              <div className="h-16 bg-muted rounded-xl" />
              <div className="h-16 bg-muted rounded-xl" />
            </div>
            <div className="space-y-3 max-w-2xl mx-auto">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-muted/60 rounded-lg" />
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Retrieving players' statistics in a single batch request...
            </p>
          </div>
        ) : isError ? (
          /* State: Failed API request */
          <div className="py-8 text-center space-y-4" data-testid="comparison-error-state">
            <p className="text-sm font-semibold text-destructive">
              Failed to load comparison statistics.
            </p>
            <p className="text-xs text-muted-foreground">
              {error?.message || "An unexpected error occurred while fetching batch stats."}
            </p>
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClearOpponent}>
                Choose Another Opponent
              </Button>
            </div>
          </div>
        ) : (
          /* State: Success - Side-by-Side Comparison Grid */
          <div className="space-y-6">
            {/* Players Header */}
            <div className="grid grid-cols-2 gap-4 md:gap-8 items-center border-b pb-6">
              {/* Primary Player Column Header */}
              <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
                <div className="relative h-14 w-14 rounded-full border-2 border-primary/20 overflow-hidden bg-muted flex items-center justify-center shrink-0">
                  {effectivePlayer1.avatar ? (
                    <Image
                      src={effectivePlayer1.avatar}
                      alt={effectivePlayer1.username ?? "Player 1"}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-xl font-bold text-muted-foreground">
                      {effectivePlayer1.username?.charAt(0) ?? "P"}
                    </span>
                  )}
                </div>
                <div className="truncate">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    Player 1 (Profile)
                  </span>
                  <h3
                    className="text-lg font-black truncate text-foreground"
                    data-testid="primary-player-name"
                  >
                    {effectivePlayer1.username}
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    {effectivePlayer1.playerId}
                  </span>
                </div>
              </div>

              {/* Opponent Player Column Header */}
              <div className="flex flex-col sm:flex-row-reverse items-center gap-3 text-center sm:text-right">
                <div className="relative h-14 w-14 rounded-full border-2 border-primary/20 overflow-hidden bg-muted flex items-center justify-center shrink-0">
                  {opponentAvatar ? (
                    <Image
                      src={opponentAvatar}
                      alt={opponentUsername}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-xl font-bold text-muted-foreground">
                      {opponentUsername.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="truncate">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    Player 2 (Opponent)
                  </span>
                  <h3
                    className="text-lg font-black truncate text-foreground"
                    data-testid="opponent-player-name"
                  >
                    {opponentUsername}
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedOpponentId}
                  </span>
                </div>
              </div>
            </div>

            {/* Side-by-side stats categories */}
            <div className="space-y-3">
              {COMPARISON_CATEGORIES.map((cat) => {
                const val1 = player1Stats ? player1Stats[cat.key] : effectivePlayer1[cat.key];
                const val2 = player2Stats ? player2Stats[cat.key] : undefined;
                const winner = determineWinner(val1, val2);

                const isP1Winner = winner === "player1";
                const isP2Winner = winner === "player2";

                return (
                  <div
                    key={cat.key}
                    className="p-3 sm:p-4 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors"
                    data-testid={`stat-row-${cat.key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`}
                  >
                    {/* Category Label (Centered) */}
                    <div className="flex items-center justify-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="text-primary">{cat.icon}</span>
                      <span>{cat.label}</span>
                    </div>

                    {/* Side-by-Side Values */}
                    <div className="grid grid-cols-2 gap-4 items-center">
                      {/* Player 1 Value */}
                      <div
                        className={`p-3 rounded-lg flex items-center justify-between text-left transition-all ${
                          isP1Winner
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-bold"
                            : "bg-background/80 text-foreground"
                        }`}
                        data-testid={`p1-stat-${cat.key}`}
                      >
                        <div>
                          <p className="text-lg sm:text-xl font-black tracking-tight">
                            {cat.format(val1)}
                          </p>
                        </div>
                        {isP1Winner && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded"
                            data-testid={`category-winner-${cat.key}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Winner
                          </span>
                        )}
                      </div>

                      {/* Player 2 Value */}
                      <div
                        className={`p-3 rounded-lg flex items-center justify-between flex-row-reverse text-right transition-all ${
                          isP2Winner
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-bold"
                            : "bg-background/80 text-foreground"
                        }`}
                        data-testid={`p2-stat-${cat.key}`}
                      >
                        <div>
                          <p className="text-lg sm:text-xl font-black tracking-tight">
                            {cat.format(val2)}
                          </p>
                        </div>
                        {isP2Winner && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded"
                            data-testid={`category-winner-${cat.key}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Winner
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
