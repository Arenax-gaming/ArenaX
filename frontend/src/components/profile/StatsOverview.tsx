"use client";

import { Card, CardContent } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Trophy, Swords, Target, Zap, Flame } from "lucide-react";
import { EloChart } from "@/components/profile/EloChart";
import { PlayerStats } from "@/types/profile";
import { EloPoint } from "@/types/user";

interface StatsOverviewProps {
  stats: PlayerStats;
  eloHistory: EloPoint[];
}

export function StatsOverview({ stats, eloHistory }: StatsOverviewProps) {
  const { elo, globalRank, winRate, wins, losses, currentStreak } = stats;

  const statCards = [
    {
      label: "ELO Rating",
      value: elo,
      icon: <Zap className="h-5 w-5" />,
      accent: "text-primary",
    },
    {
      label: "Global Rank",
      value: `#${globalRank}`,
      icon: <Trophy className="h-5 w-5" />,
      accent: "text-yellow-500",
    },
    {
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      icon: <Target className="h-5 w-5" />,
      accent: "text-green-500",
    },
    {
      label: "W / L",
      value: `${wins} / ${losses}`,
      icon: <Swords className="h-5 w-5" />,
      accent: "text-blue-500",
    },
    {
      label: "Streak",
      value: currentStreak > 0 ? `+${currentStreak}` : `${currentStreak}`,
      icon: <Flame className="h-5 w-5" />,
      accent: currentStreak > 0 ? "text-orange-500" : "text-red-500",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </span>
                <span className={stat.accent}>{stat.icon}</span>
              </div>
              <p className="text-2xl font-black tracking-tight">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {eloHistory.length < 2 ? (
        <Card>
          <CardContent className="p-5 text-center text-muted-foreground">
            Insufficient data for chart
          </CardContent>
        </Card>
      ) : (
        <EloChart data={eloHistory} />
      )}
    </div>
  );
}
