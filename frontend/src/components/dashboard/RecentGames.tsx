"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { MatchWithPlayers } from "@/types/match";
import { cn } from "@/lib/utils";

interface RecentGamesProps {
  matches: MatchWithPlayers[];
  currentUserId: string;
}

export function RecentGames({ matches, currentUserId }: RecentGamesProps) {
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
                    isWin ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
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
