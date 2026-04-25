"use client";

import { cn } from '@/lib/utils';
import { AchievementCategory, CATEGORY_CONFIG } from '@/data/achievements';

type FilterValue = 'all' | AchievementCategory;

interface CategoryFilterProps {
  selected: FilterValue;
  onChange: (value: FilterValue) => void;
  counts?: Partial<Record<FilterValue, number>>;
}

const FILTERS: { value: FilterValue; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: '🎮' },
  ...Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => ({
    value: key as AchievementCategory,
    label: cfg.label,
    icon: cfg.icon,
  })),
];

export function CategoryFilter({ selected, onChange, counts }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter achievements by category">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            selected === f.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
          )}
          aria-pressed={selected === f.value}
        >
          <span>{f.icon}</span>
          <span>{f.label}</span>
          {counts?.[f.value] !== undefined && (
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-xs',
              selected === f.value ? 'bg-primary-foreground/20' : 'bg-background'
            )}>
              {counts[f.value]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
