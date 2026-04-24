"use client";

import { Card, CardContent } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Trophy, Swords, Target, Zap } from "lucide-react";

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
}

export function StatsOverview({ elo, wins, losses, winRate, rank, streak }: StatsOverviewProps) {
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
      accent: "text-green-500",
    },
    {
      label: "W / L",
      value: `${wins} / ${losses}`,
      icon: <Swords className="h-5 w-5" />,
      accent: "text-blue-500",
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
              <p className={`text-xs mt-1 flex items-center gap-1 ${stat.change >= 0 ? "text-green-500" : "text-red-500"}`}>
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
