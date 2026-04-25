"use client";

import { useState, useMemo } from 'react';
import { AchievementFull, AchievementCategory } from '@/data/achievements';
import { AchievementCard } from './AchievementCard';
import { CategoryFilter } from './CategoryFilter';

type FilterValue = 'all' | AchievementCategory;
type StatusFilter = 'all' | 'unlocked' | 'locked';

interface AchievementGridProps {
  achievements: AchievementFull[];
}

export function AchievementGrid({ achievements }: AchievementGridProps) {
  const [category, setCategory] = useState<FilterValue>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<FilterValue, number>> = { all: achievements.length };
    achievements.forEach((a) => {
      counts[a.category] = (counts[a.category] ?? 0) + 1;
    });
    return counts;
  }, [achievements]);

  const filtered = useMemo(() => {
    return achievements.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (status === 'unlocked' && !a.unlocked) return false;
      if (status === 'locked' && a.unlocked) return false;
      if (search && !a.title.toLowerCase().includes(search.toLowerCase()) &&
          !a.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [achievements, category, status, search]);

  return (
    <div className="space-y-4">
      {/* Search + status filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder="Search achievements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search achievements"
        />
        <div className="flex gap-2">
          {(['all', 'unlocked', 'locked'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${
                status === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <CategoryFilter selected={category} onChange={setCategory} counts={categoryCounts} />

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">No achievements match your filters.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((a) => (
            <AchievementCard key={a.id} achievement={a} />
          ))}
        </div>
      )}
    </div>
  );
}
