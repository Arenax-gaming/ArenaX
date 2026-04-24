"use client";

import React from "react";
import { Achievement } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

interface AchievementShowcaseProps {
  achievements: Achievement[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isRecentUnlock(unlockedAt: string): boolean {
  return new Date(unlockedAt).getTime() > Date.now() - THIRTY_DAYS_MS;
}

export function AchievementShowcase({ achievements }: AchievementShowcaseProps) {
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Achievements
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {unlockedCount} / {achievements.length} Unlocked
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {achievements.map((achievement) => (
            <div
              key={achievement.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border bg-muted/30",
                !achievement.unlocked && "opacity-50"
              )}
            >
              {/* Icon */}
              <div className="text-2xl flex-shrink-0 w-10 text-center">
                {achievement.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{achievement.title}</span>

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

                <p className="text-xs text-muted-foreground mt-0.5">{achievement.description}</p>

                {/* Progress bar for locked achievements */}
                {!achievement.unlocked && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>
                        {achievement.progress} / {achievement.total}
                      </span>
                    </div>
                    <div
                      data-testid="progress-bar"
                      className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={achievement.progress}
                      aria-valuemin={0}
                      aria-valuemax={achievement.total}
                    >
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${achievement.total > 0 ? Math.min(100, (achievement.progress / achievement.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {achievements.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No achievements yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
