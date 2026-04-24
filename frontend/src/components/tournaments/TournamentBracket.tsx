"use client";

import React, { useState } from "react";
import { BracketData } from "@/types/bracket";
import { MatchCard } from "./MatchCard";
import { Button } from "@/components/ui/Button";
import { PrizePool } from "./PrizePool";
import { RadioTower, Trophy } from "lucide-react";

interface TournamentBracketProps {
  bracketData: BracketData;
  currentUserId?: string;
}

export function TournamentBracket({ bracketData, currentUserId }: TournamentBracketProps) {
  const [activeSection, setActiveSection] = useState(bracketData.sections[0]?.id ?? "");

  const currentSection = bracketData.sections.find((s) => s.id === activeSection);
  const liveMatchCount = bracketData.activeMatchIds?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Live indicator */}
      {liveMatchCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 dark:border-green-900 dark:bg-green-950/20">
          <RadioTower className="h-4 w-4 animate-pulse text-green-500" />
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            {liveMatchCount} match{liveMatchCount > 1 ? "es" : ""} live
          </span>
        </div>
      )}

      {/* Section tabs (for double elimination) */}
      {bracketData.sections.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {bracketData.sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeSection === section.id
                  ? "bg-blue-600 text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {section.title}
            </button>
          ))}
        </div>
      )}

      {/* Rounds */}
      {currentSection?.rounds.map((round) => (
        <div key={round.roundNumber} className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {round.roundName}
            </h3>
            <span className="text-xs text-muted-foreground">
              · {round.matches.length} match{round.matches.length > 1 ? "es" : ""}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {round.matches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                currentUserId={currentUserId}
                showLink
              />
            ))}
          </div>
        </div>
      ))}

      {/* Prize distribution */}
      {bracketData.prizeDistribution.length > 0 && (
        <PrizePool
          prizePool={bracketData.prizeDistribution.reduce(
            (sum, t) => sum + (t.amount ?? 0),
            0,
          )}
          distribution={bracketData.prizeDistribution}
        />
      )}
    </div>
  );
}
