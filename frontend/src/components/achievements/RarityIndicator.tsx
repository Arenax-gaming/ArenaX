import { cn } from '@/lib/utils';
import { AchievementRarity, RARITY_CONFIG } from '@/data/achievements';

interface RarityIndicatorProps {
  rarity: AchievementRarity;
  showLabel?: boolean;
  className?: string;
}

export function RarityIndicator({ rarity, showLabel = true, className }: RarityIndicatorProps) {
  const config = RARITY_CONFIG[rarity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        config.bg,
        config.color,
        className
      )}
    >
      {rarity === 'legendary' && <span>✦</span>}
      {showLabel && config.label}
    </span>
  );
}
