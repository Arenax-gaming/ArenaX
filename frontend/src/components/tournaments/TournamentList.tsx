"use client";

import React, { useCallback, useRef, useState, useEffect } from "react";
import { Tournament } from "@/types/tournament";
import { TournamentCardWithQuickJoin } from "./TournamentCardWithQuickJoin";
import { TournamentCardSkeleton } from "./TournamentCardSkeleton";
import { TOURNAMENT_GRID_IMAGE_SIZES } from "@/lib/tournamentImageSizes";
import { VirtualGrid, VirtualGridRenderProps } from "@/components/ui/VirtualGrid";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";

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

  if (tournaments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16" role="status">
        <Trophy className="mb-4 h-16 w-16 text-muted-foreground" aria-hidden="true" />
        <h3 className="mb-2 text-lg font-semibold text-foreground">{emptyMessage}</h3>
        <p className="mb-4 text-sm text-muted-foreground">Try adjusting your filters</p>
        {onResetFilters && (
          <Button variant="ghost" size="sm" onClick={onResetFilters}>
            Reset filters
          </Button>
        )}
      </div>
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
