"use client";

import React from "react";
import { Tournament } from "@/types/tournament";
import { TournamentCardWithQuickJoin } from "./TournamentCardWithQuickJoin";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TournamentListProps {
  tournaments: Tournament[];
  joinedIds?: Set<string>;
  onJoinSuccess?: (id: string) => void;
  emptyMessage?: string;
  onResetFilters?: () => void;
}

export function TournamentList({
  tournaments,
  joinedIds = new Set(),
  onJoinSuccess,
  emptyMessage = "No tournaments found",
  onResetFilters,
}: TournamentListProps) {
  if (tournaments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Trophy className="mb-4 h-16 w-16 text-muted-foreground" />
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

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {tournaments.map((tournament) => (
        <TournamentCardWithQuickJoin
          key={tournament.id}
          tournament={tournament}
          isJoined={joinedIds.has(tournament.id)}
          onJoinSuccess={onJoinSuccess}
        />
      ))}
    </div>
  );
}
