"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  total: number;
  unlocked: boolean;
}

const mockAchievements: Achievement[] = [
  { id: "a1", title: "First Blood", description: "Win your first match", icon: "⚔️", progress: 1, total: 1, unlocked: true },
  { id: "a2", title: "On a Roll", description: "Win 5 matches in a row", icon: "🔥", progress: 3, total: 5, unlocked: false },
  { id: "a3", title: "Tournament Victor", description: "Win a tournament", icon: "🏆", progress: 0, total: 1, unlocked: false },
  { id: "a4", title: "Veteran", description: "Play 50 matches", icon: "🎖️", progress: 32, total: 50, unlocked: false },
  { id: "a5", title: "Sharpshooter", description: "Reach 1500 ELO", icon: "🎯", progress: 1250, total: 1500, unlocked: false },
];

export function AchievementProgress() {
  const unlocked = mockAchievements.filter((a) => a.unlocked).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Achievements</CardTitle>
          <span className="text-xs text-muted-foreground">{unlocked}/{mockAchievements.length} unlocked</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {mockAchievements.map((a) => {
          const pct = Math.min(100, Math.round((a.progress / a.total) * 100));
          return (
            <div key={a.id} className={`flex items-center gap-3 ${a.unlocked ? "opacity-100" : "opacity-70"}`}>
              <span className="text-xl w-8 text-center">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">
                    {a.progress}/{a.total}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${a.unlocked ? "bg-yellow-500" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
