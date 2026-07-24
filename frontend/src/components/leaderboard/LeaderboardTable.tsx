'use client';

import React, { useState, useMemo, useEffect, CSSProperties } from 'react';
import Image from 'next/image';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { useVirtualScrollAnalytics } from '@/hooks/useVirtualScrollAnalytics';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar?: string;
  points: number;
  wins: number;
  winRate: number;
  lastUpdated: Date;
  trend?: 'up' | 'down' | 'stable';
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  isLoading?: boolean;
  sortBy?: 'points' | 'wins' | 'winRate';
  onSortChange?: (sortBy: string) => void;
  /** Height of the virtual scroll container. Defaults to 480. */
  height?: number;
  /** Threshold in pixels from the bottom to trigger onLoadMore */
  loadMoreThreshold?: number;
  /** Called when the user scrolls near the bottom */
  onLoadMore?: () => void;
  /** Show a loading spinner at the bottom while fetching */
  isLoadingMore?: boolean;
}

const ROW_HEIGHT = 56; // px — must match the row's rendered height

// ─── Row renderer (defined outside the component so it stays stable) ─────────

interface RowData {
  entries: LeaderboardEntry[];
  onItemClick: (index: number) => void;
}

function LeaderboardRow({
  index,
  style,
  data,
}: ListChildComponentProps<RowData>) {
  const entry = data.entries[index];
  if (!entry) return null;

  const rankColor =
    entry.rank === 1
      ? 'text-yellow-400'
      : entry.rank === 2
      ? 'text-gray-300'
      : entry.rank === 3
      ? 'text-orange-400'
      : 'text-foreground';

  return (
    <div
      role="row"
      style={style}
      className="flex items-center border-b border-gray-200 dark:border-gray-800 hover:bg-muted dark:hover:bg-background/50 transition-colors"
      onClick={() => data.onItemClick(index)}
    >
      {/* Rank */}
      <div className="w-14 shrink-0 px-4 text-sm font-semibold">
        <span className={rankColor}>#{entry.rank}</span>
      </div>

      {/* Player */}
      <div className="flex-1 flex items-center gap-3 px-4 py-2 min-w-0">
        {entry.avatar ? (
          <Image
            src={entry.avatar}
            alt={entry.username}
            width={32}
            height={32}
            className="w-8 h-8 rounded-full shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
            {entry.username.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="font-medium text-sm text-foreground truncate">
          {entry.username}
        </span>
      </div>

      {/* Points */}
      <div className="w-24 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {entry.points.toLocaleString()}
      </div>

      {/* Wins */}
      <div className="w-16 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {entry.wins}
      </div>

      {/* Win Rate */}
      <div className="w-20 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {(entry.winRate * 100).toFixed(1)}%
      </div>

      {/* Trend */}
      <div className="w-16 shrink-0 px-4 flex justify-center">
        {entry.trend === 'up' && <ChevronUp className="w-5 h-5 text-success" aria-label="Trending up" />}
        {entry.trend === 'down' && <ChevronDown className="w-5 h-5 text-destructive" aria-label="Trending down" />}
        {entry.trend === 'stable' && <span className="text-muted-foreground" aria-label="Stable">—</span>}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({
  entries,
  isLoading = false,
  sortBy = 'points',
  onSortChange,
  height = 480,
  loadMoreThreshold = 200,
  onLoadMore,
  isLoadingMore = false,
}) => {
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const analytics = useVirtualScrollAnalytics('leaderboard-table');
  const hasFiredMountRef = React.useRef(false);
  const loadMoreRef = React.useRef(false);

  const sortedEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      const diff =
        sortBy === 'points' ? a.points - b.points
        : sortBy === 'wins' ? a.wins - b.wins
        : a.winRate - b.winRate;
      return sortDirection === 'asc' ? diff : -diff;
    });
    return sorted.map((entry, i) => ({ ...entry, rank: i + 1 }));
  }, [entries, sortBy, sortDirection]);

  useEffect(() => {
    analytics.trackMountStart();
  }, [analytics]);

  useEffect(() => {
    if (!hasFiredMountRef.current && sortedEntries.length > 0) {
      hasFiredMountRef.current = true;
      const visible = Math.ceil(height / ROW_HEIGHT);
      analytics.trackMountComplete(sortedEntries.length, Math.min(visible + 5, sortedEntries.length));
    }
  }, [sortedEntries.length, height, analytics]);

  const handleSort = (column: 'points' | 'wins' | 'winRate') => {
    if (sortBy === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortDirection('desc');
      onSortChange?.(column);
    }
  };

  const handleScroll = ({ scrollOffset }: { scrollOffset: number }) => {
    const totalHeight = sortedEntries.length * ROW_HEIGHT;
    const visible = Math.ceil(height / ROW_HEIGHT);
    analytics.trackScroll(scrollOffset, totalHeight, visible);

    if (onLoadMore && !loadMoreRef.current) {
      const distanceFromBottom = totalHeight - scrollOffset - height;
      if (distanceFromBottom < loadMoreThreshold) {
        loadMoreRef.current = true;
        onLoadMore();
        // Reset after a short debounce so we don't fire repeatedly
        setTimeout(() => { loadMoreRef.current = false; }, 500);
      }
    }
  };

  const handleItemClick = (index: number) => {
    analytics.trackItemClick(index);
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <div className="w-4 h-4" aria-hidden="true" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-4 h-4" aria-hidden="true" />
      : <ChevronDown className="w-4 h-4" aria-hidden="true" />;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8" aria-busy="true" aria-label="Loading leaderboard">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const rowData: RowData = { entries: sortedEntries, onItemClick: handleItemClick };

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
      role="table"
      aria-label="Leaderboard"
      aria-rowcount={sortedEntries.length}
    >
      {/* Sticky header */}
      <div
        role="rowgroup"
        className="flex items-center bg-muted dark:bg-background border-b border-gray-200 dark:border-gray-800"
      >
        <div role="columnheader" className="w-14 shrink-0 px-4 py-3 text-left text-sm font-semibold text-foreground/70">
          Rank
        </div>
        <div role="columnheader" className="flex-1 px-4 py-3 text-left text-sm font-semibold text-foreground/70">
          Player
        </div>
        {(
          [
            { key: 'points', label: 'Points' },
            { key: 'wins', label: 'Wins' },
            { key: 'winRate', label: 'Win Rate' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            role="columnheader"
            className={`w-${key === 'winRate' ? '20' : key === 'wins' ? '16' : '24'} shrink-0 px-4 py-3 text-right text-sm font-semibold text-foreground/70 hover:bg-muted dark:hover:bg-surface cursor-pointer flex items-center justify-end gap-2`}
            onClick={() => handleSort(key)}
            aria-sort={sortBy === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            {label}
            <SortIcon column={key} />
          </button>
        ))}
        <div role="columnheader" className="w-16 shrink-0 px-4 py-3 text-center text-sm font-semibold text-foreground/70">
          Trend
        </div>
      </div>

      {/* Virtualised rows */}
      {sortedEntries.length === 0 ? (
        <div role="row" className="py-8 text-center text-muted-foreground">
          No leaderboard entries found
        </div>
      ) : (
        <FixedSizeList
          height={height}
          itemCount={sortedEntries.length}
          itemSize={ROW_HEIGHT}
          width="100%"
          overscanCount={5}
          onScroll={handleScroll}
          itemData={rowData}
        >
          {LeaderboardRow}
        </FixedSizeList>
      )}

      {/* Load-more spinner */}
      {isLoadingMore && (
        <div className="flex justify-center py-3 border-t" aria-busy="true" aria-label="Loading more entries">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
};
