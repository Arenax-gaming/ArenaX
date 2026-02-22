"use client";

import React from "react";
import { MatchWithPlayers } from "@/types/match";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Trophy, Swords, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface MatchHistoryProps {
  matches: MatchWithPlayers[];
  currentUserId: string;
}

export function MatchHistory({ matches, currentUserId }: MatchHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Swords className="h-5 w-5" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {matches.map((match) => {
            const isWinner = match.winnerId === currentUserId;
            const opponentId = match.player1Id === currentUserId ? match.player2Id : match.player1Id;
            const opponentName = match.player1Id === currentUserId ? match.player2Username : match.player1Username;
            const myScore = match.player1Id === currentUserId ? match.scorePlayer1 : match.scorePlayer2;
            const opponentScore = match.player1Id === currentUserId ? match.scorePlayer2 : match.scorePlayer1;
            const date = match.completedAt ? new Date(match.completedAt) : new Date(match.createdAt);

            return (
              <div
                key={match.id}
                className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-colors"
              >
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
                <div className="text-right">
                  <span className="text-lg font-bold tabular-nums">
                    {myScore} - {opponentScore}
                  </span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                    {match.gameType}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
