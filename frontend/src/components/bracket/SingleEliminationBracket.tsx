"use client";

import React, { useState, useMemo } from "react";
import { BracketData, BracketMatch, BracketMatchStatus } from "@/types/bracket";
import { BracketMatchModal } from "./BracketMatchModal";
import { Button } from "@/components/ui/Button";
import { User, Trophy, Clock, Zap, ChevronRight } from "lucide-react";

interface SingleEliminationBracketProps {
  bracketData: BracketData;
  currentUserId?: string;
}

export function SingleEliminationBracket({
  bracketData,
  currentUserId,
}: SingleEliminationBracketProps) {
  const [selectedMatch, setSelectedMatch] = useState<BracketMatch | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Mark current user's matches
  const processedBracketData = useMemo(() => {
    if (!currentUserId) return bracketData;
    
    return {
      ...bracketData,
      rounds: bracketData.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => ({
          ...match,
          player1: match.player1
            ? { ...match.player1, isCurrentUser: match.player1.id === currentUserId }
            : null,
          player2: match.player2
            ? { ...match.player2, isCurrentUser: match.player2.id === currentUserId }
            : null,
        })),
      })),
    };
  }, [bracketData, currentUserId]);

  const handleMatchClick = (match: BracketMatch) => {
    setSelectedMatch(match);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedMatch(null);
  };

  const getMatchStatusStyles = (match: BracketMatch) => {
    const isUserMatch =
      match.player1?.isCurrentUser || match.player2?.isCurrentUser;
    
    if (isUserMatch) {
      return {
        border: "border-blue-500 dark:border-blue-400",
        bg: "bg-blue-50 dark:bg-blue-950/30",
        badge: "bg-blue-500",
      };
    }

    switch (match.status) {
      case "in_progress":
        return {
          border: "border-green-500 dark:border-green-400",
          bg: "bg-green-50 dark:bg-green-950/30",
          badge: "bg-green-500",
        };
      case "completed":
        return {
          border: "border-gray-300 dark:border-gray-600",
          bg: "bg-muted/30",
          badge: "bg-gray-400",
        };
      case "disputed":
        return {
          border: "border-red-500 dark:border-red-400",
          bg: "bg-red-50 dark:bg-red-950/30",
          badge: "bg-red-500",
        };
      default:
        return {
          border: "border-muted",
          bg: "bg-card",
          badge: "bg-muted-foreground/30",
        };
    }
  };

  return (
    <div className="overflow-x-auto pb-4">
      {/* Bracket Container */}
      <div className="flex gap-8 min-w-max p-4">
        {processedBracketData.rounds.map((round, roundIndex) => (
          <div key={round.roundNumber} className="flex flex-col">
            {/* Round Header */}
            <div className="text-center mb-4">
              <h3 className="font-semibold text-foreground">{round.roundName}</h3>
              <p className="text-xs text-muted-foreground">
                {round.matches.length} matches
              </p>
            </div>

            {/* Matches Container */}
            <div className="flex flex-col justify-around flex-1">
              {round.matches.map((match, matchIndex) => {
                const styles = getMatchStatusStyles(match);
                const isUserMatch =
                  match.player1?.isCurrentUser || match.player2?.isCurrentUser;

                return (
                  <div key={match.id} className="relative">
                    {/* Match Card */}
                    <button
                      onClick={() => handleMatchClick(match)}
                      className={`w-64 p-3 rounded-lg border-2 ${styles.border} ${styles.bg} hover:shadow-md transition-all text-left`}
                    >
                      {/* Match Header */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">
                          Match {match.matchNumber}
                        </span>
                        <span
                          className={`h-2 w-2 rounded-full ${styles.badge}`}
                        />
                      </div>

                      {/* Player 1 */}
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {match.player1 ? (
                            <>
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                                <User className="h-3 w-3 text-muted-foreground" />
                              </div>
                              <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                {match.player1.username}
                                {match.player1.isCurrentUser && (
                                  <span className="ml-1 text-xs text-blue-600">(You)</span>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">
                              TBD
                            </span>
                          )}
                        </div>
                        {match.status === "completed" && match.scorePlayer1 !== undefined && (
                          <span className="text-sm font-bold text-foreground">
                            {match.scorePlayer1}
                          </span>
                        )}
                      </div>

                      {/* Player 2 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {match.player2 ? (
                            <>
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                                <User className="h-3 w-3 text-muted-foreground" />
                              </div>
                              <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                {match.player2.username}
                                {match.player2.isCurrentUser && (
                                  <span className="ml-1 text-xs text-blue-600">(You)</span>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">
                              TBD
                            </span>
                          )}
                        </div>
                        {match.status === "completed" && match.scorePlayer2 !== undefined && (
                          <span className="text-sm font-bold text-foreground">
                            {match.scorePlayer2}
                          </span>
                        )}
                      </div>

                      {/* Status indicator */}
                      {match.status === "in_progress" && (
                        <div className="mt-2 pt-2 border-t flex items-center gap-1 text-xs text-blue-600">
                          <Clock className="h-3 w-3 animate-pulse" />
                          In Progress
                        </div>
                      )}

                      {/* User match indicator */}
                      {isUserMatch && (
                        <div className="mt-2 pt-2 border-t flex items-center gap-1 text-xs text-blue-600">
                          <Zap className="h-3 w-3" />
                          Your Match
                        </div>
                      )}
                    </button>

                    {/* Connector Line (except for last round) */}
                    {roundIndex < processedBracketData.rounds.length - 1 && (
                      <div className="absolute -right-4 top-1/2 transform -translate-y-1/2">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Prize Distribution Legend */}
      {bracketData.prizeDistribution && bracketData.prizeDistribution.length > 0 && (
        <div className="mt-8 p-4 bg-muted/30 rounded-lg">
          <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Prize Distribution
          </h4>
          <div className="flex flex-wrap gap-4">
            {bracketData.prizeDistribution.map((prize) => (
              <div key={prize.position} className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${
                    prize.position === 1
                      ? "bg-yellow-500"
                      : prize.position === 2
                        ? "bg-gray-400"
                        : prize.position === 3
                          ? "bg-orange-400"
                          : "bg-muted-foreground"
                  }`}
                />
                <span className="text-sm text-muted-foreground">
                  {prize.position}
                  {prize.position === 1
                    ? "st"
                    : prize.position === 2
                      ? "nd"
                      : prize.position === 3
                        ? "rd"
                        : "th"}
                  :{" "}
                  {prize.amount !== undefined
                    ? `$${prize.amount.toLocaleString()}`
                    : `${prize.percentage}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match Details Modal */}
      {selectedMatch && (
        <BracketMatchModal
          match={selectedMatch}
          isOpen={modalOpen}
          onClose={handleCloseModal}
          prizeDistribution={bracketData.prizeDistribution}
        />
      )}
    </div>
  );
}
