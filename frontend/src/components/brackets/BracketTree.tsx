"use client";

import React, { useState } from "react";
import Image from "next/image";
import { BracketData, BracketMatch, BracketPlayer } from "@/types/bracket";
import { Card } from "@/components/ui/Card";

import { Trophy, Users, Clock, User } from "lucide-react";
import { MatchDetailsModal } from "./MatchDetailsModal";

interface BracketTreeProps {
  bracketData: BracketData;
  currentUserId?: string;
  onMatchClick?: (match: BracketMatch) => void;
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  ready: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
  in_progress:
    "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400",
  completed: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400",
  disputed: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
};

export function BracketTree({
  bracketData,
  currentUserId,
  onMatchClick,
}: BracketTreeProps) {
  const [selectedMatch, setSelectedMatch] = useState<BracketMatch | null>(null);

  const handleMatchClick = (match: BracketMatch) => {
    setSelectedMatch(match);
    onMatchClick?.(match);
  };

  const isUserInMatch = (match: BracketMatch): boolean => {
    if (!currentUserId) return false;
    return (
      match.player1?.id === currentUserId || match.player2?.id === currentUserId
    );
  };

  const isUserParticipant = (player: BracketPlayer | null): boolean => {
    if (!currentUserId || !player) return false;
    return player.id === currentUserId;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {bracketData.tournamentName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {bracketData.tournamentType.replace("_", " ").toUpperCase()} Bracket
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{bracketData.rounds[0]?.matches.length * 2 || 0} Players</span>
          </div>
          <div className="flex items-center gap-1">
            <Trophy className="h-4 w-4" />
            <span>{bracketData.rounds.length} Rounds</span>
          </div>
        </div>
      </div>

      {/* Bracket Visualization - Mobile Responsive */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-4 sm:gap-8 min-w-max">
          {bracketData.rounds.map((round, roundIndex) => (
            <div key={round.roundNumber} className="flex flex-col gap-3 sm:gap-4">
              {/* Round Header */}
              <div className="text-center pb-2">
                <h3 className="font-semibold text-foreground text-xs sm:text-sm">
                  {round.roundName}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {round.matches.length} match{round.matches.length !== 1 ? 'es' : ''}
                </p>
              </div>

              {/* Matches */}
              <div className="flex flex-col gap-2 sm:gap-4">
                {round.matches.map((match, matchIndex) => {
                  const isActiveMatch = isUserInMatch(match);
                  const matchStatus = statusColors[match.status] || statusColors.pending;

                  return (
                    <div
                      key={match.id}
                      className="relative"
                    >
                      <Card
                        className={`w-52 sm:w-64 cursor-pointer transition-all hover:shadow-md ${
                          isActiveMatch
                            ? "ring-2 ring-blue-500 ring-offset-2"
                            : ""
                        } ${
                          match.status === "in_progress"
                            ? "border-green-500"
                            : ""
                        }`}
                        onClick={() => handleMatchClick(match)}
                      >
                        {/* Match Header */}
                        <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 border-b bg-muted/50">
                          <span className="text-xs text-muted-foreground">
                            Match {match.matchNumber}
                          </span>
                          <span
                            className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full ${matchStatus}`}
                          >
                            {match.status.replace("_", " ")}
                          </span>
                        </div>

                        {/* Players */}
                        <div className="p-2 sm:p-3 space-y-1.5 sm:space-y-2">
                          {/* Player 1 */}
                          <div
                            className={`flex items-center justify-between p-1.5 sm:p-2 rounded ${
                              match.winnerId === match.player1?.id
                                ? "bg-green-50 dark:bg-green-950/20"
                                : ""
                            } ${
                              isUserParticipant(match.player1)
                                ? "bg-blue-50 dark:bg-blue-950/20"
                                : ""
                            }`}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                              {match.player1?.avatar ? (
                                <Image
                                  src={match.player1.avatar}
                                  alt={match.player1.username}
                                  width={24}
                                  height={24}
                                  className="h-5 w-5 sm:h-6 sm:w-6 rounded-full flex-shrink-0"
                                />
                              ) : (
                                <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground flex-shrink-0" />
                              )}
                              <span className="text-xs sm:text-sm font-medium truncate max-w-[80px] sm:max-w-[100px]">
                                {match.player1?.username || "TBD"}
                              </span>
                              {match.player1?.seedNumber && (
                                <span className="text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
                                  #{match.player1.seedNumber}
                                </span>
                              )}
                            </div>
                            <span className="text-xs sm:text-sm font-bold flex-shrink-0">
                              {match.scorePlayer1 ?? "-"}
                            </span>
                          </div>

                          {/* Player 2 */}
                          <div
                            className={`flex items-center justify-between p-1.5 sm:p-2 rounded ${
                              match.winnerId === match.player2?.id
                                ? "bg-green-50 dark:bg-green-950/20"
                                : ""
                            } ${
                              isUserParticipant(match.player2)
                                ? "bg-blue-50 dark:bg-blue-950/20"
                                : ""
                            }`}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                              {match.player2?.avatar ? (
                                <Image
                                  src={match.player2.avatar}
                                  alt={match.player2.username}
                                  width={24}
                                  height={24}
                                  className="h-5 w-5 sm:h-6 sm:w-6 rounded-full flex-shrink-0"
                                />
                              ) : (
                                <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground flex-shrink-0" />
                              )}
                              <span className="text-xs sm:text-sm font-medium truncate max-w-[80px] sm:max-w-[100px]">
                                {match.player2?.username || "TBD"}
                              </span>
                              {match.player2?.seedNumber && (
                                <span className="text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
                                  #{match.player2.seedNumber}
                                </span>
                              )}
                            </div>
                            <span className="text-xs sm:text-sm font-bold flex-shrink-0">
                              {match.scorePlayer2 ?? "-"}
                            </span>
                          </div>
                        </div>

                        {/* Match Time */}
                        {match.scheduledAt && (
                          <div className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 sm:py-2 border-t text-[10px] sm:text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span>
                              {new Date(match.scheduledAt).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          </div>
                        )}

                        {/* Active Match Indicator */}
                        {isActiveMatch && (
                          <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-blue-500 text-white text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full whitespace-nowrap">
                            Your Match
                          </div>
                        )}
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-purple-500" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Disputed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded ring-2 ring-blue-500" />
          <span>Your Match</span>
        </div>
      </div>

      {/* Match Details Modal */}
      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          tournamentName={bracketData.tournamentName}
          isUserParticipant={isUserInMatch(selectedMatch)}
          currentUserId={currentUserId}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </div>
  );
}
