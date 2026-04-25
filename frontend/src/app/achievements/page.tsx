import { Trophy } from 'lucide-react';
import { MOCK_ACHIEVEMENTS } from '@/data/achievements';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';

export const metadata = { title: 'Achievements | ArenaX' };

export default function AchievementsPage() {
  const unlocked = MOCK_ACHIEVEMENTS.filter((a) => a.unlocked).length;
  const totalPoints = MOCK_ACHIEVEMENTS.filter((a) => a.unlocked).reduce((sum, a) => sum + a.points, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7" />
            Achievements
          </h1>
          <p className="text-muted-foreground">
            {unlocked} of {MOCK_ACHIEVEMENTS.length} unlocked · {totalPoints} points earned
          </p>
        </div>
        <a
          href="/achievements/progress"
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors self-start"
        >
          📊 View Progress
        </a>
      </div>

      <AchievementGrid achievements={MOCK_ACHIEVEMENTS} />
    </div>
  );
}
