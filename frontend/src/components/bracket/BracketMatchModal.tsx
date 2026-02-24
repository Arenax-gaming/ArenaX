"use client";

import React from "react";
import { BracketMatch, PrizeDistribution } from "@/types/bracket";
import { Button } from "@/components/ui/Button";
import { X, Trophy, Medal, User, TrendingUp, Zap } from "lucide-react";

interface BracketMatchModalProps {
  match: BracketMatch;
  isOpen: boolean;
  onClose: () => void;
  prizeDistribution?: PrizeDistribution[];
}

export function BracketMatchModal({
  match,
  isOpen,
  onClose,
  prizeDistribution,
}: BracketMatchModalProps) {
  if (!isOpen) return null;

  const getStatusLabel = () => {
    switch (match.status) {
      case "pending":
        return { label: "Pending", color: "text-gray-600", bg: "bg-gray-100" };
      case "in_progress":
        return { label: "In Progress", color: "text-blue-600", bg: "bg-blue-100" };
      case "completed":
        return { label: "Completed", color: "text-green-600", bg: "bg-green-100" };
      case "disputed":
        return { label: "Disputed", color: "text-red-600", bg: "bg-red-100" };
    }
  };

  const status = getStatusLabel();
  const hasWinner = match.status === "completed" && match.winnerId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-lg shadow-lg max-w-md w-full animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-semibold text-foreground">Match Details</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Match Status */}
          <div className="flex items-center justify-center">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}
            >
              {status.label}
            </span>
          </div>

          {/* Players */}
          <div className="space-y-4">
            {/* Player 1 */}
            <div
              className={`p-4 rounded-lg border-2 ${
                match.winnerId === match.player1?.id
                  ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                  : "border-muted"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {match.player1?.username || "TBD"}
                      {match.player1?.isCurrentUser && (
                        <span className="ml-2 text-xs text-blue-600">(You)</span>
                      )}
                    </p>
                    {match.player1 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        ELO: {match.player1.elo}
                      </p>
                    )}
                  </div>
                </div>
                {match.status === "completed" && (
                  <div className="text-2xl font-bold text-foreground">
                    {match.scorePlayer1 ?? "-"}
                  </div>
                )}
              </div>
            </div>

            {/* VS */}
            <div className="text-center">
              <span className="text-sm text-muted-foreground">VS</span>
            </div>

            {/* Player 2 */}
            <div
              className={`p-4 rounded-lg border-2 ${
                match.winnerId === match.player2?.id
                  ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                  : "border-muted"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {match.player2?.username || "TBD"}
                      {match.player2?.isCurrentUser && (
                        <span className="ml-2 text-xs text-blue-600">(You)</span>
                      )}
                    </p>
                    {match.player2 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        ELO: {match.player2.elo}
                      </p>
                    )}
                  </div>
                </div>
                {match.status === "completed" && (
                  <div className="text-2xl font-bold text-foreground">
                    {match.scorePlayer2 ?? "-"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Prize Distribution */}
          {prizeDistribution && prizeDistribution.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium text-foreground flex items-center gap-2">
                <Medal className="h-4 w-4" />
                Prize Distribution
              </h3>
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                {prizeDistribution.slice(0, 4).map((prize) => (
                  <div
                    key={prize.position}
                    className="flex justify-between items-center text-sm"
                  >
                    <span className="text-muted-foreground flex items-center gap-2">
                      {prize.position === 1 && <Trophy className="h-3 w-3 text-yellow-500" />}
                      {prize.position === 2 && <Medal className="h-3 w-3 text-gray-400" />}
                      {prize.position === 3 && <Medal className="h-3 w-3 text-orange-400" />}
                      {prize.position > 3 && `${prize.position}${getOrdinalSuffix(prize.position)}`}
                    </span>
                    <span className="font-medium text-foreground">
                      {prize.amount !== undefined
                        ? `$${prize.amount.toLocaleString()}`
                        : `${prize.percentage}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex gap-3">
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
