"use client";

import React, { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MatchWithPlayers } from "@/types/match";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 72;
const OVERSCAN = 5;

interface MatchHistoryListProps {
  matches: MatchWithPlayers[];
  currentUserId: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Pixel height of the scroll viewport. Defaults to 560. */
  height?: number;
}

export function MatchHistoryList({
  matches,
  currentUserId,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  height = 560,
}: MatchHistoryListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLAnchorElement>>(new Map());

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? -1;

  // Load the next page once the last rendered row is within the overscan buffer.
  useEffect(() => {
    if (hasMore && !isLoadingMore && onLoadMore && lastIndex >= matches.length - 1 - OVERSCAN) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore, lastIndex, matches.length]);

  const focusRow = useCallback(
    (index: number) => {
      if (index < 0 || index >= matches.length) return;
      virtualizer.scrollToIndex(index, { align: "auto" });
      // Row may not be mounted until the virtualizer re-renders.
      requestAnimationFrame(() => rowRefs.current.get(index)?.focus());
    },
    [matches.length, virtualizer],
  );

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(index - 1);
    }
  };

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{ height, contain: "strict" }}
      role="list"
      aria-label="Match history"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {items.map((row) => {
          const match = matches[row.index];
          const isWinner = match.winnerId === currentUserId;
          const opponent =
            match.player1Id === currentUserId ? match.player2Username : match.player1Username;
          return (
            <div
              key={match.id}
              role="listitem"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <Link
                href={`/matches/${match.id}`}
                ref={(node) => {
                  if (node) rowRefs.current.set(row.index, node);
                  else rowRefs.current.delete(row.index);
                }}
                onKeyDown={(e) => handleKeyDown(e, row.index)}
                className="flex h-full items-center justify-between rounded-lg border bg-muted/40 px-4 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <span className="font-medium">vs {opponent}</span>
                <span className="text-sm text-muted-foreground">{match.gameType}</span>
                <span className={cn("font-semibold", isWinner ? "text-green-500" : "text-red-500")}>
                  {isWinner ? "Win" : "Loss"}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
      {isLoadingMore && (
        <p className="py-2 text-center text-sm text-muted-foreground" aria-live="polite">
          Loading more matches…
        </p>
      )}
    </div>
  );
}
