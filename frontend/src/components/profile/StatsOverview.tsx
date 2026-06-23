"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Trophy, Swords, Target, Zap, Flame, Calendar, Clock, Award, Star } from "lucide-react";
import { EloChart } from "@/components/profile/EloChart";
import { PlayerStats } from "@/types/profile";
import { EloPoint } from "@/types/user";

interface StatsOverviewProps {
  stats: PlayerStats;
  eloHistory: EloPoint[];
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
}

function StatCard({ label, value, icon, accent, trend, description }: StatCardProps) {
  return (
    <Card className="hover:shadow-md transition-all duration-200 hover:scale-105">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <span className={accent}>{icon}</span>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-black tracking-tight">{value}</p>
          {trend && (
            <div className={`flex items-center gap-1 text-xs ${trend.isPositive ? 'text-success' : 'text-destructive'}`}>
              {trend.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{Math.abs(trend.value)}</span>
            </div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsOverview({ stats, eloHistory }: StatsOverviewProps) {
  const { elo, globalRank, winRate, wins, losses, currentStreak } = stats;
  
  // Calculate additional stats
  const totalGames = wins + losses;
  const eloChange = eloHistory.length >= 2 
    ? eloHistory[eloHistory.length - 1].elo - eloHistory[eloHistory.length - 2].elo 
    : 0;
  
  // Calculate rank change (mock data for demo)
  const rankChange = -15; // Improved by 15 positions
  
  // Get performance rating
  const getPerformanceRating = (winRate: number) => {
    if (winRate >= 80) return { rating: 'Exceptional', color: 'text-purple-600' };
    if (winRate >= 70) return { rating: 'Excellent', color: 'text-success' };
    if (winRate >= 60) return { rating: 'Good', color: 'text-primary' };
    if (winRate >= 50) return { rating: 'Average', color: 'text-yellow-600' };
    return { rating: 'Below Average', color: 'text-destructive' };
  };

  const performance = getPerformanceRating(winRate);

  const statCards = [
    {
      label: "ELO Rating",
      value: elo.toLocaleString(),
      icon: <Zap className="h-5 w-5" />,
      accent: "text-primary",
      trend: eloChange !== 0 ? {
        value: Math.abs(eloChange),
        isPositive: eloChange > 0
      } : undefined,
      description: "Current skill rating"
    },
    {
      label: "Global Rank",
      value: `#${globalRank.toLocaleString()}`,
      icon: <Trophy className="h-5 w-5" />,
      accent: "text-yellow-500",
      trend: rankChange !== 0 ? {
        value: Math.abs(rankChange),
        isPositive: rankChange < 0 // Negative rank change is positive (better rank)
      } : undefined,
      description: "Worldwide ranking"
    },
    {
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      icon: <Target className="h-5 w-5" />,
      accent: "text-success",
      description: performance.rating
    },
    {
      label: "Games Played",
      value: totalGames.toLocaleString(),
      icon: <Swords className="h-5 w-5" />,
      accent: "text-primary",
      description: `${wins}W / ${losses}L`
    },
    {
      label: "Current Streak",
      value: currentStreak > 0 ? `+${currentStreak}` : `${currentStreak}`,
      icon: <Flame className="h-5 w-5" />,
      accent: currentStreak > 0 ? "text-orange-500" : "text-destructive",
      description: currentStreak > 0 ? "Win streak" : currentStreak < 0 ? "Loss streak" : "No streak"
    },
  ];

  // Performance insights
  const insights = [
    {
      title: "Performance Rating",
      value: performance.rating,
      color: performance.color,
      icon: <Star className="h-4 w-4" />
    },
    {
      title: "Games This Week",
      value: "12", // Mock data
      color: "text-primary",
      icon: <Calendar className="h-4 w-4" />
    },
    {
      title: "Avg. Game Duration",
      value: "8m 32s", // Mock data
      color: "text-purple-600",
      icon: <Clock className="h-4 w-4" />
    },
    {
      title: "Best Streak",
      value: "15", // Mock data
      color: "text-orange-600",
      icon: <Award className="h-4 w-4" />
    }
  ];

  return (
    <div className="space-y-6">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Performance Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {insights.map((insight) => (
              <div key={insight.title} className="text-center p-3 rounded-lg bg-muted/50">
                <div className={`flex items-center justify-center gap-1 mb-1 ${insight.color}`}>
                  {insight.icon}
                  <span className="text-sm font-medium">{insight.title}</span>
                </div>
                <p className="text-lg font-bold">{insight.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ELO Chart */}
      {eloHistory.length < 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>ELO History</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground py-8">
            <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Play more games to see your ELO progression</p>
          </CardContent>
        </Card>
      ) : (
        <div>
          <EloChart data={eloHistory} />
        </div>
      )}

      {/* Quick Stats Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <h4 className="font-semibold text-muted-foreground">Recent Performance</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Last 10 games:</span>
                  <span className="font-medium">7W - 3L</span>
                </div>
                <div className="flex justify-between">
                  <span>This month:</span>
                  <span className="font-medium">{winRate.toFixed(0)}% WR</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-muted-foreground">Achievements</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Unlocked:</span>
                  <span className="font-medium">24/50</span>
                </div>
                <div className="flex justify-between">
                  <span>Completion:</span>
                  <span className="font-medium">48%</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-muted-foreground">Social</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Friends:</span>
                  <span className="font-medium">127</span>
                </div>
                <div className="flex justify-between">
                  <span>Online:</span>
                  <span className="font-medium text-success">23</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
