"use client";

import { Card, CardContent } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Trophy, Swords, Target, Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Stat {
  label: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  accent?: string;
}

interface StatsOverviewProps {
  elo: number;
  wins: number;
  losses: number;
  winRate: number;
  rank: number;
  streak: number;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function StatSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-8 w-24 bg-muted rounded animate-pulse mt-1" />
        <div className="h-3 w-28 bg-muted rounded animate-pulse mt-2" />
      </CardContent>
    </Card>
  );
}

function StatsErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="col-span-2 lg:col-span-4">
      <Card>
        <CardContent className="p-5 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">Could not load stats — please try again.</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function StatsOverview({
  elo,
  wins,
  losses,
  winRate,
  rank,
  streak,
  isLoading = false,
  isError = false,
  onRetry,
}: StatsOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsErrorFallback onRetry={onRetry} />
      </div>
    );
  }

  const stats: Stat[] = [
    {
      label: "ELO Rating",
      value: elo,
      change: 50,
      icon: <Zap className="h-5 w-5" />,
      accent: "text-primary",
    },
    {
      label: "Global Rank",
      value: `#${rank}`,
      icon: <Trophy className="h-5 w-5" />,
      accent: "text-yellow-500",
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      change: 2.5,
      icon: <Target className="h-5 w-5" />,
      accent: "text-success",
    },
    {
      label: "W / L",
      value: `${wins} / ${losses}`,
      icon: <Swords className="h-5 w-5" />,
      accent: "text-primary",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {stat.label}
              </span>
              <span className={stat.accent}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{stat.value}</p>
            {stat.change !== undefined && (
              <p className={`text-xs mt-1 flex items-center gap-1 ${stat.change >= 0 ? "text-success" : "text-destructive"}`}>
                {stat.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {stat.change >= 0 ? "+" : ""}{stat.change} this week
              </p>
            )}
            {streak > 0 && stat.label === "Win Rate" && (
              <p className="text-xs mt-1 text-orange-500 font-semibold">🔥 {streak} win streak</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
