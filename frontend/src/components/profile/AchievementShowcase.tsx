"use client";

import React, { useState } from "react";
import { Achievement } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Trophy, Filter, Star, Award, Target, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface AchievementShowcaseProps {
  achievements: Achievement[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isRecentUnlock(unlockedAt: string): boolean {
  return new Date(unlockedAt).getTime() > Date.now() - THIRTY_DAYS_MS;
}

type AchievementCategory = 'all' | 'combat' | 'social' | 'progression' | 'special';
type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

const CATEGORY_ICONS: Record<AchievementCategory, React.ReactNode> = {
  all: <Trophy className="h-4 w-4" />,
  combat: <Zap className="h-4 w-4" />,
  social: <Users className="h-4 w-4" />,
  progression: <Target className="h-4 w-4" />,
  special: <Star className="h-4 w-4" />,
};

const RARITY_COLORS: Record<AchievementRarity, string> = {
  common: "border-gray-400 bg-gray-50 dark:bg-gray-900/50",
  rare: "border-blue-400 bg-blue-50 dark:bg-blue-900/20",
  epic: "border-purple-400 bg-purple-50 dark:bg-purple-900/20",
  legendary: "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20",
};

const RARITY_TEXT_COLORS: Record<AchievementRarity, string> = {
  common: "text-gray-600 dark:text-gray-400",
  rare: "text-blue-600 dark:text-blue-400",
  epic: "text-purple-600 dark:text-purple-400",
  legendary: "text-yellow-600 dark:text-yellow-400",
};

// Enhanced Achievement interface (extending the base type)
interface EnhancedAchievement extends Achievement {
  category?: AchievementCategory;
  rarity?: AchievementRarity;
  points?: number;
}

export function AchievementShowcase({ achievements }: AchievementShowcaseProps) {
  const [selectedCategory, setSelectedCategory] = useState<AchievementCategory>('all');
  const [showOnlyUnlocked, setShowOnlyUnlocked] = useState(false);

  // Convert achievements to enhanced format with defaults
  const enhancedAchievements: EnhancedAchievement[] = achievements.map(achievement => ({
    ...achievement,
    category: (achievement as any).category || 'progression',
    rarity: (achievement as any).rarity || 'common',
    points: (achievement as any).points || 10,
  }));

  const filteredAchievements = enhancedAchievements.filter(achievement => {
    if (selectedCategory !== 'all' && achievement.category !== selectedCategory) {
      return false;
    }
    if (showOnlyUnlocked && !achievement.unlocked) {
      return false;
    }
    return true;
  });

  const unlockedCount = enhancedAchievements.filter((a) => a.unlocked).length;
  const totalPoints = enhancedAchievements
    .filter(a => a.unlocked)
    .reduce((sum, a) => sum + (a.points || 0), 0);

  const categories: { key: AchievementCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'combat', label: 'Combat' },
    { key: 'social', label: 'Social' },
    { key: 'progression', label: 'Progress' },
    { key: 'special', label: 'Special' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Achievements
          </span>
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-normal text-muted-foreground">
              {unlockedCount} / {enhancedAchievements.length} Unlocked
            </span>
            <span className="text-xs text-muted-foreground">
              {totalPoints} Points
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="flex gap-1">
            {categories.map((category) => (
              <Button
                key={category.key}
                variant={selectedCategory === category.key ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category.key)}
                className="h-8 px-3 text-xs"
              >
                {CATEGORY_ICONS[category.key]}
                <span className="ml-1">{category.label}</span>
              </Button>
            ))}
          </div>
          <Button
            variant={showOnlyUnlocked ? "default" : "outline"}
            size="sm"
            onClick={() => setShowOnlyUnlocked(!showOnlyUnlocked)}
            className="h-8 px-3 text-xs"
          >
            <Filter className="h-3 w-3 mr-1" />
            Unlocked Only
          </Button>
        </div>

        {/* Achievement Grid */}
        <div className="space-y-3">
          {filteredAchievements.map((achievement) => (
            <div
              key={achievement.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-all",
                RARITY_COLORS[achievement.rarity!],
                !achievement.unlocked && "opacity-60"
              )}
            >
              {/* Icon */}
              <div className="text-2xl flex-shrink-0 w-10 text-center">
                {achievement.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-sm">{achievement.title}</span>

                  {/* Rarity Badge */}
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                    RARITY_TEXT_COLORS[achievement.rarity!],
                    "bg-current/10"
                  )}>
                    <Award className="h-3 w-3" />
                    {achievement.rarity}
                  </span>

                  {/* Points */}
                  <span className="text-xs text-muted-foreground">
                    {achievement.points} pts
                  </span>

                  {/* Unlocked indicator */}
                  {achievement.unlocked && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                      <span>✓</span> Unlocked
                    </span>
                  )}

                  {/* New badge — only for recently unlocked achievements */}
                  {achievement.unlocked &&
                    achievement.unlockedAt &&
                    isRecentUnlock(achievement.unlockedAt) && (
                      <span
                        data-testid="new-badge"
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      >
                        New
                      </span>
                    )}
                </div>

                <p className="text-xs text-muted-foreground mb-2">{achievement.description}</p>

                {/* Progress bar for locked achievements */}
                {!achievement.unlocked && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>
                        {achievement.progress} / {achievement.total}
                      </span>
                    </div>
                    <div
                      data-testid="progress-bar"
                      className="h-2 w-full bg-muted rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={achievement.progress}
                      aria-valuemin={0}
                      aria-valuemax={achievement.total}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          achievement.rarity === 'legendary' ? "bg-gradient-to-r from-yellow-400 to-orange-500" :
                          achievement.rarity === 'epic' ? "bg-gradient-to-r from-purple-400 to-pink-500" :
                          achievement.rarity === 'rare' ? "bg-gradient-to-r from-blue-400 to-cyan-500" :
                          "bg-primary"
                        )}
                        style={{
                          width: `${achievement.total > 0 ? Math.min(100, (achievement.progress / achievement.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Unlock date for completed achievements */}
                {achievement.unlocked && achievement.unlockedAt && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          ))}

          {filteredAchievements.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              {showOnlyUnlocked ? "No unlocked achievements in this category" : "No achievements in this category"}
            </div>
          )}

          {enhancedAchievements.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No achievements yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
