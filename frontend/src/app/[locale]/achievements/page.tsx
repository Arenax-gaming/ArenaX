"use client";

import React from "react";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { AchievementGrid } from "@/components/achievements/AchievementGrid";
import {
  useAchievements,
  usePlayerAchievements,
} from "@/hooks/useAchievements";
import { useAuth } from "@/hooks/useAuth";
import { AchievementCardSkeleton, Skeleton } from "@/components/common/PageSkeleton";

export default function AchievementsPage() {
  const { user } = useAuth();
  const { data: achievements, isLoading: achievementsLoading } =
    useAchievements();
  const { data: playerAchievements, isLoading: playerLoading } =
    usePlayerAchievements(user?.id || "");

  const isLoading = achievementsLoading || playerLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen px-4 py-8 space-y-8" aria-live="polite" aria-label="Loading achievements">
        <span className="sr-only">Loading achievements…</span>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-8 w-8 text-yellow-400 opacity-30" aria-hidden="true" />
              <Skeleton className="h-9 w-40" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-36 rounded-md self-start" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <AchievementCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const unlockedCount = playerAchievements?.unlockedAchievements || 0;
  const totalPoints = playerAchievements?.totalPoints || 0;
  const totalAchievements = playerAchievements?.totalAchievements || 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="space-y-1">
            <h1 className="text-4xl font-bold tracking-tight flex items-center gap-2 text-white">
              <Trophy className="h-8 w-8 text-yellow-400" />
              Achievements
            </h1>
            <p className="text-muted-foreground">
              {unlockedCount} of {totalAchievements} unlocked · {totalPoints}{" "}
              points earned
            </p>
          </div>
          <Link
            href="/achievements/progress"
            className="inline-flex items-center gap-2 rounded-md bg-primary/90 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors self-start"
          >
            📊 View Progress
          </Link>
        </div>

        {achievements && (
          <AchievementGrid
            achievements={achievements.map((a) => ({
              id: a.id,
              title: a.name,
              description: a.description,
              icon: "🏆",
              rarity: a.rarity,
              points: a.points,
              unlocked:
                playerAchievements?.achievements.some(
                  (pa) => pa.achievementId === a.id && pa.isUnlocked,
                ) || false,
              progress:
                playerAchievements?.achievements.find(
                  (pa) => pa.achievementId === a.id,
                )?.progress || 0,
              total:
                playerAchievements?.achievements.find(
                  (pa) => pa.achievementId === a.id,
                )?.maxProgress || 100,
              unlockedAt: playerAchievements?.achievements.find(
                (pa) => pa.achievementId === a.id,
              )?.unlockedAt,
            }))}
          />
        )}
      </div>
    </div>
  );
}
