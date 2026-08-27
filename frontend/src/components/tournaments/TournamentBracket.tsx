"use client";

import React, { useState } from "react";
import { BracketData } from "@/types/bracket";
import { BracketView } from "./BracketView";
import { RadioTower } from "lucide-react";

interface TournamentBracketProps {
  bracketData: BracketData;
  currentUserId?: string;
}

export function TournamentBracket({ bracketData, currentUserId }: TournamentBracketProps) {
  const liveMatchCount = bracketData.activeMatchIds?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Live indicator */}
      {liveMatchCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-muted px-4 py-2 dark:border-success/30 dark:bg-success-muted/20">
          <RadioTower className="h-4 w-4 animate-pulse text-success" />
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            {liveMatchCount} match{liveMatchCount > 1 ? "es" : ""} live
          </span>
        </div>
      )}

      {/* Bracket View - Tree-based layout */}
      <BracketView bracketData={bracketData} currentUserId={currentUserId} />
    </div>
  );
}
