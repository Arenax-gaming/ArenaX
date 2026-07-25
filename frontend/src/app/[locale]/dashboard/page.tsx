"use client";

import { Suspense, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useMatches } from "@/hooks/useMatches";
import { api } from "@/lib/api";
import { StatsOverview } from "@/components/dashboard/StatsOverview";
import { RecentGames } from "@/components/dashboard/RecentGames";
import { AchievementProgress } from "@/components/dashboard/AchievementProgress";
import { FriendsList } from "@/components/dashboard/FriendsList";
import { QuickPlay } from "@/components/dashboard/QuickPlay";
import { LeaderboardPreview } from "@/components/dashboard/LeaderboardPreview";
import { NewsFeed } from "@/components/dashboard/NewsFeed";

// Skeleton for the stats row while data loads
function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

// Skeleton for recent games while data loads
function RecentGamesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  // Fetch last 5 matches for this user
  const { data: matchesData, isLoading: matchesLoading } = useMatches(
    user ? { mine: true, limit: 5 } : undefined,
  );

  // Fetch real rank, streak and W/L stats from /users/me/stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["profileStats", user?.id],
    queryFn: () => api.getProfileStats(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const matches = matchesData ?? [];

  // Derive wins/losses/winRate from the real match list if stats endpoint
  // hasn't responded yet — fall back to stats endpoint values when available.
  const wins = useMemo(() => {
    if (statsData) return statsData.wins;
    if (!user) return 0;
    return matches.filter((m) => m.winnerId === user.id).length;
  }, [statsData, matches, user]);

  const losses = useMemo(() => {
    if (statsData) return statsData.losses;
    if (!user) return 0;
    return matches.filter((m) => m.winnerId !== user.id).length;
  }, [statsData, matches, user]);

  const winRate = useMemo(() => {
    if (statsData) return Math.round(statsData.win_rate);
    const total = wins + losses;
    return total > 0 ? Math.round((wins / total) * 100) : 0;
  }, [statsData, wins, losses]);

  const rank = statsData?.global_rank ?? 0;
  const streak = statsData?.current_streak ?? 0;

  if (!user) {
    // AuthProvider/ProtectedPage will redirect; show nothing while resolving
    return null;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Welcome header */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-muted border-2 border-primary/20 overflow-hidden flex items-center justify-center shrink-0">
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt={user.username}
              width={48}
              height={48}
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="text-lg font-bold">{user.username.charAt(0)}</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Welcome back, {user.username}
          </h1>
          <p className="text-sm text-muted-foreground">
            ELO {user.elo} ·{" "}
            <Link href="/profile" className="text-primary hover:underline">
              View profile
            </Link>
          </p>
        </div>
      </div>

      {/* Stats row */}
      {statsLoading && matchesLoading ? (
        <StatsSkeleton />
      ) : (
        <Suspense fallback={<StatsSkeleton />}>
          <StatsOverview
            elo={user.elo}
            wins={wins}
            losses={losses}
            winRate={winRate}
            rank={rank}
            streak={streak}
          />
        </Suspense>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {matchesLoading ? (
            <RecentGamesSkeleton />
          ) : (
            <RecentGames matches={matches} currentUserId={user.id} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <AchievementProgress />
            <NewsFeed />
          </div>
        </div>

        {/* Right sidebar — 1/3 width */}
        <div className="space-y-6">
          <QuickPlay />
          <FriendsList compact />
          <LeaderboardPreview />
        </div>
      </div>
    </div>
  );
}
