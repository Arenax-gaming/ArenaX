"use client";

import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { StatsOverview } from "@/components/dashboard/StatsOverview";
import { RecentGames } from "@/components/dashboard/RecentGames";
import { AchievementProgress } from "@/components/dashboard/AchievementProgress";
import { FriendsList } from "@/components/dashboard/FriendsList";
import { QuickPlay } from "@/components/dashboard/QuickPlay";
import { LeaderboardPreview } from "@/components/dashboard/LeaderboardPreview";
import { NewsFeed } from "@/components/dashboard/NewsFeed";
import { mockMatchHistory } from "@/data/matches";
import { currentUser } from "@/data/user";

// Derived stats from mock data
const wins = mockMatchHistory.filter((m) => m.winnerId === currentUser.id).length;
const losses = mockMatchHistory.length - wins;
const winRate = mockMatchHistory.length > 0 ? Math.round((wins / mockMatchHistory.length) * 100) : 0;

export default function DashboardPage() {
  const { user } = useAuth();
  const displayUser = user ?? currentUser;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Welcome header */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-muted border-2 border-primary/20 overflow-hidden flex items-center justify-center shrink-0">
          {displayUser.avatar ? (
            <Image src={displayUser.avatar} alt={displayUser.username} width={48} height={48} className="object-cover" unoptimized />
          ) : (
            <span className="text-lg font-bold">{displayUser.username.charAt(0)}</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Welcome back, {displayUser.username}
          </h1>
          <p className="text-sm text-muted-foreground">
            ELO {displayUser.elo} · <Link href="/dashboard/profile" className="text-primary hover:underline">View profile</Link>
          </p>
        </div>
      </div>

      {/* Stats row */}
      <Suspense fallback={<div className="h-28 bg-muted animate-pulse rounded-lg" />}>
        <StatsOverview
          elo={displayUser.elo}
          wins={wins}
          losses={losses}
          winRate={winRate}
          rank={420}
          streak={3}
        />
      </Suspense>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          <RecentGames matches={mockMatchHistory} currentUserId={displayUser.id} />
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
