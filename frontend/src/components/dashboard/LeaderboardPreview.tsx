"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

interface LeaderEntry {
  rank: number;
  username: string;
  elo: number;
  isCurrentUser?: boolean;
}

const mockLeaders: LeaderEntry[] = [
  { rank: 1, username: "NightWalker", elo: 2100 },
  { rank: 2, username: "EliteSniper", elo: 1980 },
  { rank: 3, username: "ShadowNinja", elo: 1870 },
  { rank: 4, username: "DragonSlayer", elo: 1750 },
  { rank: 5, username: "SpeedRunner", elo: 1640 },
  { rank: 420, username: "ProGamer99", elo: 1250, isCurrentUser: true },
];

const rankMedal: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function LeaderboardPreview() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Leaderboard</CardTitle>
          <Link href="/leaderboard" className="text-xs text-primary hover:underline">
            Full board
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {mockLeaders.map((entry, i) => (
            <div key={entry.rank}>
              {i === 5 && (
                <div className="px-6 py-1 text-center text-xs text-muted-foreground">• • •</div>
              )}
              <div
                className={cn(
                  "flex items-center gap-3 px-6 py-2.5 transition-colors",
                  entry.isCurrentUser ? "bg-primary/5" : "hover:bg-muted/40"
                )}
              >
                <span className="w-6 text-center text-sm font-bold">
                  {rankMedal[entry.rank] ?? `#${entry.rank}`}
                </span>
                <p className={cn("flex-1 text-sm font-medium", entry.isCurrentUser && "text-primary")}>
                  {entry.username} {entry.isCurrentUser && <span className="text-xs">(you)</span>}
                </p>
                <span className="text-sm font-mono font-semibold">{entry.elo}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
