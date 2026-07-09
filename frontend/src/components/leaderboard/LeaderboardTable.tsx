'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { useVirtualScrollAnalytics } from '@/hooks/useVirtualScrollAnalytics';
import type { LeaderboardEntry } from '@/types/leaderboard';

// Re-export the canonical type so consumers (and existing tests that import
// `LeaderboardEntry` from this module) keep working unchanged.
export type { LeaderboardEntry };

type SortColumn = 'eloRating' | 'wins' | 'winRate';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  isLoading?: boolean;
  sortBy?: SortColumn;
  onSortChange?: (sortBy: SortColumn) => void;
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

const SORT_COLUMNS: { key: SortColumn; label: string; widthClass: string }[] = [
  { key: 'eloRating', label: 'ELO', widthClass: 'w-24' },
  { key: 'wins', label: 'Wins', widthClass: 'w-16' },
  { key: 'winRate', label: 'Win Rate', widthClass: 'w-20' },
];

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

  // Prefer the server-supplied `ranking`; fall back to the row index for
  // optimistic / client-only entry updates.
  const rank = entry.ranking ?? index + 1;
  const rankColor =
    rank === 1
      ? 'text-yellow-400'
      : rank === 2
      ? 'text-gray-300'
      : rank === 3
      ? 'text-orange-400'
      : 'text-foreground';

  return (
    <div
      role="row"
      style={style}
      className="flex items-center border-b border-gray-200 dark:border-gray-800 hover:bg-muted dark:hover:bg-background/50 transition-colors"
      onClick={() => data.onItemClick(index)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); data.onItemClick(index); } }}
      tabIndex={0}
    >
      {/* Rank */}
      <div className="w-14 shrink-0 px-4 text-sm font-semibold">
        <span className={rankColor}>#{rank}</span>
      </div>

      {/* Player */}
      <div className="flex-1 flex items-center gap-3 px-4 py-2 min-w-0">
        {entry.avatarUrl ? (
          <Image
            src={entry.avatarUrl}
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

      {/* ELO */}
      <div className="w-24 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {entry.eloRating.toLocaleString()}
      </div>

      {/* Wins */}
      <div className="w-16 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {entry.wins}
      </div>

      {/* Win Rate */}
      <div className="w-20 shrink-0 px-4 text-sm text-right font-semibold text-foreground">
        {(entry.winRate * 100).toFixed(1)}%
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({
  entries,
  isLoading = false,
  sortBy = 'eloRating',
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
        sortBy === 'eloRating' ? a.eloRating - b.eloRating
        : sortBy === 'wins' ? a.wins - b.wins
        : a.winRate - b.winRate;
      return sortDirection === 'asc' ? diff : -diff;
    });
    return sorted;
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

  const handleSort = (column: SortColumn) => {
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

  const SortIcon = ({ column }: { column: SortColumn }) => {
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
        {SORT_COLUMNS.map(({ key, label, widthClass }) => (
          <button
            key={key}
            role="columnheader"
            className={`${widthClass} shrink-0 px-4 py-3 text-right text-sm font-semibold text-foreground/70 hover:bg-muted dark:hover:bg-surface cursor-pointer flex items-center justify-end gap-2`}
            onClick={() => handleSort(key)}
            aria-sort={sortBy === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            {label}
            <SortIcon column={key} />
          </button>
        ))}
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
