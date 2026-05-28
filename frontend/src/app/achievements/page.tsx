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

export default function AchievementsPage() {
  const { user } = useAuth();
  const { data: achievements, isLoading: achievementsLoading } =
    useAchievements();
  const { data: playerAchievements, isLoading: playerLoading } =
    usePlayerAchievements(user?.id || "");

  const isLoading = achievementsLoading || playerLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
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
            <p className="text-gray-400">
              {unlockedCount} of {totalAchievements} unlocked · {totalPoints}{" "}
              points earned
            </p>
          </div>
          <Link
            href="/achievements/progress"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors self-start"
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
