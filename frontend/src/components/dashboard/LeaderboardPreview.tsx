"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "lucide-react";
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

interface LeaderboardPreviewProps {
  leaders?: LeaderEntry[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function LeaderboardPreviewSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-2.5">
              <div className="h-5 w-6 bg-muted rounded animate-pulse" />
              <div className="flex-1 h-3 bg-muted rounded animate-pulse" />
              <div className="h-4 w-12 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LeaderboardPreviewError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Leaderboard</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">Could not load leaderboard — please try again.</p>
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

export function LeaderboardPreview({
  leaders = mockLeaders,
  isLoading = false,
  isError = false,
  onRetry,
}: LeaderboardPreviewProps) {
  if (isLoading) return <LeaderboardPreviewSkeleton />;
  if (isError) return <LeaderboardPreviewError onRetry={onRetry} />;

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
          {leaders.map((entry, i) => (
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
