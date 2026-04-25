import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AchievementFull, RARITY_CONFIG } from '@/data/achievements';
import { ProgressBar } from './ProgressBar';
import { RarityIndicator } from './RarityIndicator';

interface AchievementCardProps {
  achievement: AchievementFull;
  showLink?: boolean;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function AchievementCard({ achievement, showLink = true }: AchievementCardProps) {
  const isNew = achievement.unlockedAt
    ? new Date(achievement.unlockedAt).getTime() > Date.now() - THIRTY_DAYS_MS
    : false;
  const rarityConfig = RARITY_CONFIG[achievement.rarity];

  const inner = (
    <div
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200',
        'bg-card text-card-foreground hover:shadow-md',
        achievement.unlocked ? rarityConfig.border : 'border-border opacity-60',
        showLink && 'cursor-pointer hover:-translate-y-0.5'
      )}
    >
      {/* New badge */}
      {isNew && (
        <span className="absolute top-2 right-2 rounded-full bg-green-500 px-2 py-0.5 text-xs font-bold text-white">
          NEW
        </span>
      )}

      {/* Icon + rarity */}
      <div className="flex items-start justify-between">
        <div className={cn(
          'flex h-14 w-14 items-center justify-center rounded-xl text-3xl',
          achievement.unlocked ? rarityConfig.bg : 'bg-muted'
        )}>
          {achievement.unlocked ? achievement.icon : '🔒'}
        </div>
        <RarityIndicator rarity={achievement.rarity} />
      </div>

      {/* Title + description */}
      <div className="flex-1">
        <h3 className="font-semibold leading-tight">{achievement.title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{achievement.description}</p>
      </div>

      {/* Progress */}
      {!achievement.unlocked && (
        <ProgressBar value={achievement.progress} max={achievement.total} showLabel animated={false} />
      )}

      {/* Unlocked date or points */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {achievement.unlocked && achievement.unlockedAt ? (
          <span>Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}</span>
        ) : (
          <span>{achievement.progress}/{achievement.total}</span>
        )}
        <span className="font-medium text-foreground">+{achievement.points} pts</span>
      </div>
    </div>
  );

  if (!showLink) return inner;
  return <Link href={`/achievements/${achievement.id}`} className="block">{inner}</Link>;
}
