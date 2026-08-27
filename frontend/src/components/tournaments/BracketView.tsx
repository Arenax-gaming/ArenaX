"use client";

import React, { useState, useMemo } from "react";
import { BracketData, BracketMatch, BracketPlayer, BracketRound } from "@/types/bracket";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Trophy, ChevronRight, ChevronDown, User, Clock, Trophy as TrophyIcon, Star } from "lucide-react";
import Link from "next/link";

interface BracketViewProps {
  bracketData: BracketData;
  currentUserId?: string;
}

interface MatchNode {
  match: BracketMatch;
  round: BracketRound;
  sectionId: string;
  x: number; // Position in tree structure
  y: number; // Round position
  prevMatchId?: string;
}

// Calculate tree layout coordinates for bracket rounds
function calculateBracketLayout(
  sections: BracketData["sections"],
  currentUserId?: string,
): {
  nodes: MatchNode[];
  roundWidths: Record<string, number>; // max nodes per round per section
  maxRoundCount: number;
} {
  const nodes: MatchNode[] = [];
  const roundWidths: Record<string, number> = {};
  let maxRoundCount = 0;

  for (const section of sections) {
    let sectionMaxWidth = 0;
    
    for (let r = 0; r < section.rounds.length; r++) {
      const round = section.rounds[r];
      const roundKey = `${section.id}-${r}`;
      
      // Count matches in this round
      const matchCount = round.matches.length;
      sectionMaxWidth = Math.max(sectionMaxWidth, matchCount);
      
      for (let m = 0; m < matchCount; m++) {
        const match = round.matches[m];
        nodes.push({
          match,
          round,
          sectionId: section.id,
          x: m,
          y: r,
        });
      }
    }
    
    roundWidths[section.id] = sectionMaxWidth;
    maxRoundCount = Math.max(maxRoundCount, section.rounds.length);
  }

  return { nodes, roundWidths, maxRoundCount };
}

// Find the next match for a player in a bracket section
function getNextMatchId(
  match: BracketMatch,
  section: BracketData["sections"][number],
): string | undefined {
  const currentRoundIndex = section.rounds.findIndex((r) => r.roundNumber === match.round);
  if (currentRoundIndex === -1 || currentRoundIndex >= section.rounds.length - 1) {
    return undefined;
  }

  const nextRound = section.rounds[currentRoundIndex + 1];
  // Find match that has this match as a previous match
  return nextRound.matches.find((m) => 
    m.previousMatchIds?.includes(match.id)
  )?.id;
}

// Find all matches for the current user
function findUserMatches(
  bracketData: BracketData,
  currentUserId: string,
): Set<string> {
  const userMatchIds = new Set<string>();
  
  for (const section of bracketData.sections) {
    for (const round of section.rounds) {
      for (const match of round.matches) {
        if (match.player1?.id === currentUserId || match.player2?.id === currentUserId) {
          userMatchIds.add(match.id);
        }
      }
    }
  }
  
  return userMatchIds;
}

// Calculate progress through bracket (how many matches won)
function calculateBracketProgress(
  bracketData: BracketData,
  currentUserId: string,
): number {
  let progress = 0;
  
  for (const section of bracketData.sections) {
    for (const round of section.rounds) {
      for (const match of round.matches) {
        if (match.player1?.id === currentUserId || match.player2?.id === currentUserId) {
          if (match.status === "completed" && match.winnerId === currentUserId) {
            progress++;
          }
          // Also count matches in progress
          if (match.status === "in_progress" || match.status === "ready") {
            progress += 0.5;
          }
        }
      }
    }
  }
  
  return progress;
}

export function BracketView({ bracketData, currentUserId }: BracketViewProps) {
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set());
  const [highlightedMatchId, setHighlightedMatchId] = useState<string | null>(null);

  const userMatchIds = useMemo(() => {
    if (currentUserId) return findUserMatches(bracketData, currentUserId);
    return new Set<string>();
  }, [bracketData, currentUserId]);

  const userProgress = useMemo(() => {
    if (currentUserId) return calculateBracketProgress(bracketData, currentUserId);
    return 0;
  }, [bracketData, currentUserId]);

  const { nodes, roundWidths } = useMemo(() => {
    return calculateBracketLayout(bracketData.sections, currentUserId);
  }, [bracketData, currentUserId]);

  const isMatchActive = (match: BracketMatch) => {
    return match.player1?.id === currentUserId || match.player2?.id === currentUserId;
  };

  const isMatchWinner = (match: BracketMatch, playerId: string) => {
    return match.status === "completed" && match.winnerId === playerId;
  };

  const getMatchScore = (match: BracketMatch, player: BracketPlayer | null) => {
    if (!player) return null;
    if (player.id === match.player1?.id) return match.scorePlayer1;
    if (player.id === match.player2?.id) return match.scorePlayer2;
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrophyIcon className="h-4 w-4" />
            <span className="text-sm font-medium">Bracket Progress</span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-foreground">
              {currentUserId ? `${Math.round((userProgress / Math.max(1, bracketData.totalRounds)) * 100)}%` : "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {currentUserId ? "to championship" : "View bracket to track progress"}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="text-sm font-medium">Your Matches</span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-primary">
              {userMatchIds.size}
            </div>
            <div className="text-xs text-muted-foreground">
              {userMatchIds.size > 0 ? "total matches remaining" : "not in bracket yet"}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Star className="h-4 w-4" />
            <span className="text-sm font-medium">Next Round Predictions</span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-amber-500">
              {currentUserId ? "Upcoming" : "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {bracketData.sections[0]?.rounds.length ?? 0} rounds remaining
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">Active Matches</span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-success">
              {bracketData.activeMatchIds?.length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              matches currently live
            </div>
          </div>
        </Card>
      </div>

      {/* Tree-based Bracket Container */}
      <div className="overflow-x-auto pb-4">
        {bracketData.sections.map((section, sectionIndex) => (
          <div key={section.id} className="inline-block min-w-full align-top">
            {/* Section Header */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrophyIcon className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">
                  {section.title}
                </h3>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {section.rounds.length} Rounds
              </span>
            </div>

            {/* Bracket Tree - Tree View Layout */}
            <div className="flex gap-6">
              {section.rounds.map((round, roundIndex) => (
                <div key={round.roundNumber} className="flex flex-col gap-4">
                  {/* Round Header */}
                  <div className="sticky top-0 z-10 mb-4 flex items-center justify-between rounded-lg bg-muted/50 p-2 backdrop-blur-sm">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {round.roundName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {round.matches.length} match{round.matches.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Match Nodes in This Round */}
                  <div className="flex flex-col gap-4">
                    {round.matches.map((match) => {
                      const isUserMatch = isMatchActive(match);
                      const p1Score = getMatchScore(match, match.player1);
                      const p2Score = getMatchScore(match, match.player2);
                      const p1Winner = isMatchWinner(match, match.player1?.id || "");
                      const p2Winner = isMatchWinner(match, match.player2?.id || "");
                      const nextMatchId = getNextMatchId(match, section);
                      const hasNextMatch = !!nextMatchId;

                      return (
                        <div
                          key={match.id}
                          onMouseEnter={() => setHighlightedMatchId(match.id)}
                          onMouseLeave={() => setHighlightedMatchId(null)}
                          className={`relative group rounded-lg border transition-all duration-200 ${
                            isUserMatch
                              ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10"
                              : highlightedMatchId === match.id
                              ? "border-primary/30 bg-primary/5"
                              : "border-border bg-card"
                          }`}
                        >
                          {/* Match Label */}
                          <div className="px-4 py-2 border-b border-border/50">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-muted-foreground">
                                {match.label || `Match ${match.matchNumber}`}
                                {match.bestOf && <span className="ml-1 text-[10px] opacity-70">BO{match.bestOf}</span>}
                              </span>
                              {hasNextMatch && (
                                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              )}
                            </div>
                          </div>

                          {/* Player 1 */}
                          <div className={`px-4 py-3 ${p1Winner ? "bg-success/10" : ""}`}>
                            <PlayerRow
                              player={match.player1}
                              score={p1Score}
                              isWinner={p1Winner}
                              isCurrentUser={currentUserId === match.player1?.id}
                            />
                          </div>

                          {/* Player 2 */}
                          <div className={`px-4 py-3 ${p2Winner ? "bg-success/10" : ""}`}>
                            <PlayerRow
                              player={match.player2}
                              score={p2Score}
                              isWinner={p2Winner}
                              isCurrentUser={currentUserId === match.player2?.id}
                            />
                          </div>

                          {/* Status Badge */}
                          <div className="px-4 py-2 border-t border-border/50">
                            <MatchStatus status={match.status} />
                          </div>

                          {/* Next Match Indicator */}
                          {hasNextMatch && (
                            <div className="absolute -right-2 top-1/2 h-8 w-4 -translate-y-1/2 opacity-50 group-hover:opacity-100 transition-opacity">
                              <div className="h-full w-px bg-border" />
                            </div>
                          )}

                          {/* Connector Line to Next Round */}
                          {hasNextMatch && (
                            <Link
                              href={`/matches/${nextMatchId}`}
                              className="absolute -right-6 top-1/2 -translate-y-1/2 w-4 h-px bg-border group-hover:bg-primary"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Section Separator */}
            {sectionIndex < bracketData.sections.length - 1 && (
              <div className="my-8 border-t border-border" />
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-primary" />
          <span>Your match</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-success" />
          <span>Winner</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-amber-500" />
          <span>Next round predicted</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3" />
          <span>Live match</span>
        </div>
      </div>
    </div>
  );
}

// Player row component
function PlayerRow({
  player,
  score,
  isWinner,
  isCurrentUser,
}: {
  player: BracketPlayer | null;
  score: number | undefined;
  isWinner: boolean;
  isCurrentUser: boolean;
}) {
  if (!player) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <span className="text-xs">?</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">TBD</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
          isCurrentUser
            ? "bg-primary"
            : isWinner
            ? "bg-success"
            : "bg-gradient-to-br from-slate-500 to-slate-700"
        }`}
      >
        {player.username.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-semibold truncate ${
            isWinner ? "text-success dark:text-success/80" : "text-foreground"
          }`}
        >
          {player.username}
          {isCurrentUser && <span className="ml-1 text-[10px] text-primary">(you)</span>}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {player.elo && <span>#{player.seed ?? "-"}</span>}
          {player.elo && <span>{player.elo} ELO</span>}
        </div>
      </div>
      {score !== undefined && (
        <span
          className={`text-lg font-bold min-w-[2rem] text-center ${
            isWinner ? "text-success dark:text-success/80" : "text-foreground"
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

// Match status component
function MatchStatus({ status }: { status: BracketMatch["status"] }) {
  const statusConfig = {
    pending: { label: "Pending", color: "text-muted-foreground" },
    ready: { label: "Starting Soon", color: "text-blue-500" },
    in_progress: { label: "Live", color: "text-success animate-pulse" },
    completed: { label: "Finished", color: "text-purple-500" },
    disputed: { label: "Disputed", color: "text-destructive" },
  };

  const config = statusConfig[status];
  
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}
