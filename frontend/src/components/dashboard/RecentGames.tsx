"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "lucide-react";
import { MatchWithPlayers } from "@/types/match";
import { cn } from "@/lib/utils";

interface RecentGamesProps {
  matches: MatchWithPlayers[];
  currentUserId: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function RecentGamesSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 bg-muted rounded animate-pulse" />
          <div className="h-3 w-12 bg-muted rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-3">
              <div className="h-6 w-8 bg-muted rounded animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                <div className="h-3 w-20 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-4 w-12 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentGamesError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Recent Games</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">Could not load recent games — please try again.</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentGames({ matches, currentUserId, isLoading = false, isError = false, onRetry }: RecentGamesProps) {
  if (isLoading) return <RecentGamesSkeleton />;
  if (isError) return <RecentGamesError onRetry={onRetry} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Games</CardTitle>
          <Link href="/matches" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {matches.slice(0, 5).map((match) => {
            const isWin = match.winnerId === currentUserId;
            const opponent =
              match.player1Id === currentUserId ? match.player2Username : match.player1Username;
            const myScore =
              match.player1Id === currentUserId ? match.scorePlayer1 : match.scorePlayer2;
            const oppScore =
              match.player1Id === currentUserId ? match.scorePlayer2 : match.scorePlayer1;

            return (
              <div key={match.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/40 transition-colors">
                <span
                  className={cn(
                    "text-xs font-bold uppercase w-8 text-center py-1 rounded",
                    isWin ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                  )}
                >
                  {isWin ? "W" : "L"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">vs {opponent}</p>
                  <p className="text-xs text-muted-foreground">{match.gameType}</p>
                </div>
                {myScore !== undefined && oppScore !== undefined && (
                  <span className="text-sm font-mono font-semibold tabular-nums">
                    {myScore} – {oppScore}
                  </span>
                )}
                {match.completedAt && (
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {new Date(match.completedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            );
          })}
          {matches.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No games yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
