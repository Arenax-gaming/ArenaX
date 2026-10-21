"use client";

import React, { useCallback, useRef, useState, useEffect } from "react";
import { Tournament } from "@/types/tournament";
import { TournamentCardWithQuickJoin } from "./TournamentCardWithQuickJoin";
import { TournamentCardSkeleton } from "./TournamentCardSkeleton";
import { TOURNAMENT_GRID_IMAGE_SIZES } from "@/lib/tournamentImageSizes";
import { VirtualGrid, VirtualGridRenderProps } from "@/components/ui/VirtualGrid";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";

// Tournament cards have a fixed height that fits all content without wrapping
const CARD_HEIGHT = 340; // px
const CARD_MIN_WIDTH = 300; // px — matches md:grid-cols-2 lg:grid-cols-3 intent
const CARD_GAP = 24; // px — matches gap-6

// Number of items below which we skip virtualisation and use static grid
const VIRTUALIZATION_THRESHOLD = 12;

// Number of skeleton cards shown while a tournament page is loading
const SKELETON_COUNT = 6;

// Mobile-first responsive grid shared by cards and skeletons
const GRID_CLASS = "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3";

function SkeletonGrid({ count = SKELETON_COUNT, label }: { count?: number; label: string }) {
  return (
    <div className={GRID_CLASS} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <TournamentCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface TournamentListProps {
  tournaments: Tournament[];
  joinedIds?: Set<string>;
  onJoinSuccess?: (id: string) => void;
  emptyMessage?: string;
  onResetFilters?: () => void;
  /** Height of the virtual scroll container when virtualisation is active */
  virtualHeight?: number;
  /** Called when the user scrolls near the bottom (infinite scroll) */
  onLoadMore?: () => void;
  /** Show skeleton cards below current results while the next page loads */
  isLoadingMore?: boolean;
  /** Show skeleton cards in place of results until the first page arrives */
  isLoading?: boolean;
  /** Show the error state (with retry) when the tournaments query failed */
  isError?: boolean;
  /** Re-triggers the tournaments fetch from the error state */
  onRetry?: () => void;
  /** Localised copy — pass strings from `useTranslations` */
  emptyDescription?: string;
  resetFiltersLabel?: string;
  errorMessage?: string;
  retryLabel?: string;
}

export function TournamentList({
  tournaments,
  joinedIds = new Set(),
  onJoinSuccess,
  emptyMessage = "No tournaments found",
  onResetFilters,
  virtualHeight = 720,
  onLoadMore,
  isLoadingMore = false,
  isLoading = false,
  isError = false,
  onRetry,
  emptyDescription = "Try adjusting your filters",
  resetFiltersLabel = "Reset filters",
  errorMessage = "Failed to load tournaments",
  retryLabel = "Retry",
}: TournamentListProps) {
  const useVirtual = tournaments.length >= VIRTUALIZATION_THRESHOLD;

  const renderTournamentCell = useCallback(
    ({ item, style }: VirtualGridRenderProps<Tournament>) => (
      <div style={style} role="listitem" className="animate-fade-in">
        <TournamentCardWithQuickJoin
          tournament={item}
          isJoined={joinedIds.has(item.id)}
          onJoinSuccess={onJoinSuccess}
          bannerSizes={TOURNAMENT_GRID_IMAGE_SIZES}
        />
      </div>
    ),
    [joinedIds, onJoinSuccess]
  );

  if (isLoading && tournaments.length === 0) {
    return <SkeletonGrid label="Loading tournaments" />;
  }

  if (isError && tournaments.length === 0 && onRetry) {
    return <ErrorState title={errorMessage} retryLabel={retryLabel} onRetry={onRetry} />;
  }

  if (tournaments.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={emptyMessage}
        description={emptyDescription}
        action={
          onResetFilters
            ? { label: resetFiltersLabel, onClick: onResetFilters, variant: "ghost" }
            : undefined
        }
        size="lg"
      />
    );
  }

  if (!useVirtual) {
    // Static grid for small lists — no virtualisation overhead
    return (
      <div className="space-y-6">
        <div className={GRID_CLASS} role="list" aria-label="Tournaments">
          {tournaments.map((tournament) => (
            <div key={tournament.id} role="listitem" className="animate-fade-in">
              <TournamentCardWithQuickJoin
                tournament={tournament}
                isJoined={joinedIds.has(tournament.id)}
                onJoinSuccess={onJoinSuccess}
                bannerSizes={TOURNAMENT_GRID_IMAGE_SIZES}
              />
            </div>
          ))}
        </div>
        {isLoadingMore && <SkeletonGrid count={3} label="Loading more tournaments" />}
      </div>
    );
  }

  return (
    <VirtualGrid
      listId="tournament-list"
      items={tournaments}
      columnMinWidth={CARD_MIN_WIDTH}
      rowHeight={CARD_HEIGHT}
      height={virtualHeight}
      gap={CARD_GAP}
      overscanRowCount={2}
      renderItem={renderTournamentCell}
      onLoadMore={onLoadMore}
      className="rounded-lg"
      loadingIndicator={
        isLoadingMore ? (
          <div className="pt-6">
            <SkeletonGrid count={3} label="Loading more tournaments" />
          </div>
        ) : null
      }
    />
  );
}
