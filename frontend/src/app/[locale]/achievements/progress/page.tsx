import Link from 'next/link';
import { MOCK_ACHIEVEMENTS, CATEGORY_CONFIG, RARITY_CONFIG, AchievementCategory, AchievementRarity } from '@/data/achievements';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ProgressBar } from '@/components/achievements/ProgressBar';
import { RarityIndicator } from '@/components/achievements/RarityIndicator';

export const metadata = { title: 'Achievement Progress | ArenaX' };

export default function AchievementProgressPage() {
  const unlocked = MOCK_ACHIEVEMENTS.filter((a) => a.unlocked).length;
  const total = MOCK_ACHIEVEMENTS.length;
  const totalPoints = MOCK_ACHIEVEMENTS.filter((a) => a.unlocked).reduce((s, a) => s + a.points, 0);
  const maxPoints = MOCK_ACHIEVEMENTS.reduce((s, a) => s + a.points, 0);

  // By category
  const byCategory = Object.keys(CATEGORY_CONFIG).map((cat) => {
    const catAchievements = MOCK_ACHIEVEMENTS.filter((a) => a.category === cat);
    const catUnlocked = catAchievements.filter((a) => a.unlocked).length;
    return { cat: cat as AchievementCategory, total: catAchievements.length, unlocked: catUnlocked };
  });

  // By rarity
  const byRarity = (['common', 'rare', 'epic', 'legendary'] as AchievementRarity[]).map((r) => {
    const rarityAchievements = MOCK_ACHIEVEMENTS.filter((a) => a.rarity === r);
    const rarityUnlocked = rarityAchievements.filter((a) => a.unlocked).length;
    return { rarity: r, total: rarityAchievements.length, unlocked: rarityUnlocked };
  });

  // In-progress (not unlocked, some progress)
  const inProgress = MOCK_ACHIEVEMENTS
    .filter((a) => !a.unlocked && a.progress > 0)
    .sort((a, b) => (b.progress / b.total) - (a.progress / a.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/achievements" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Achievements
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Progress Overview</h1>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Unlocked', value: `${unlocked}/${total}` },
          { label: 'Completion', value: `${Math.round((unlocked / total) * 100)}%` },
          { label: 'Points Earned', value: totalPoints.toLocaleString() },
          { label: 'Points Available', value: maxPoints.toLocaleString() },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Overall Completion</CardTitle>
        </CardHeader>
        <CardContent>
          <ProgressBar value={unlocked} max={total} showLabel animated />
        </CardContent>
      </Card>

      {/* By category */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By Category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byCategory.map(({ cat, total: t, unlocked: u }) => (
            <div key={cat}>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="flex items-center gap-1.5">
                  {CATEGORY_CONFIG[cat].icon} {CATEGORY_CONFIG[cat].label}
                </span>
                <span className="text-muted-foreground">{u}/{t}</span>
              </div>
              <ProgressBar value={u} max={t} animated={false} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* By rarity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By Rarity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byRarity.map(({ rarity, total: t, unlocked: u }) => (
            <div key={rarity}>
              <div className="flex items-center justify-between mb-1 text-sm">
                <RarityIndicator rarity={rarity} />
                <span className="text-muted-foreground">{u}/{t}</span>
              </div>
              <ProgressBar value={u} max={t} animated={false} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* In progress */}
      {inProgress.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Closest to Unlock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {inProgress.map((a) => (
              <Link key={a.id} href={`/achievements/${a.id}`} className="block group">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl">{a.icon}</span>
                  <span className="text-sm font-medium group-hover:underline">{a.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {Math.round((a.progress / a.total) * 100)}%
                  </span>
                </div>
                <ProgressBar value={a.progress} max={a.total} animated={false} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
