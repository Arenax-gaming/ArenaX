"use client";

import React from "react";
import { BracketMatch, PrizeDistribution } from "@/types/bracket";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Trophy, Users, Clock, Medal, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface MatchDetailsModalProps {
  match: BracketMatch;
  tournamentName: string;
  isUserParticipant: boolean;
  currentUserId?: string;
  prizeDistribution?: PrizeDistribution[];
  gameType?: string;
  onClose: () => void;
  onReportScore?: () => void;
}

const statusLabels: Record<string, string> = {
  pending: "Pending",
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  disputed: "Disputed",
};

const statusColors: Record<string, string> = {
  pending: "text-gray-600 bg-gray-100",
  ready: "text-blue-600 bg-blue-100",
  in_progress: "text-green-600 bg-green-100",
  completed: "text-purple-600 bg-purple-100",
  disputed: "text-red-600 bg-red-100",
};

export function MatchDetailsModal({
  match,
  tournamentName,
  isUserParticipant,
  currentUserId,
  prizeDistribution = [],
  gameType = "Unknown",
  onClose,
  onReportScore,
}: MatchDetailsModalProps) {
  const isPlayer1 = match.player1?.id === currentUserId;
  const isPlayer2 = match.player2?.id === currentUserId;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Match Details"
      size="lg"
    >
      {/* Tournament Info */}
      <div className="mb-6 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4" />
          <span>{tournamentName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
          <Users className="h-4 w-4" />
          <span>{gameType}</span>
        </div>
      </div>

      {/* Match Status */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              statusColors[match.status] || statusColors.pending
            }`}
          >
            {statusLabels[match.status] || match.status}
          </span>
        </div>
        {isUserParticipant && match.status === "in_progress" && (
          <span className="text-sm text-blue-600 font-medium">
            You are in this match!
          </span>
        )}
      </div>

      {/* Players */}
      <div className="space-y-4 mb-6">
        <h3 className="font-semibold text-foreground">Players</h3>
        
        {/* Player 1 */}
        <div
          className={`p-4 rounded-lg border ${
            match.winnerId === match.player1?.id
              ? "border-green-500 bg-green-50 dark:bg-green-950/20"
              : isPlayer1
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
              : "bg-muted/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <span className="text-lg font-semibold">
                  {match.player1?.username?.charAt(0).toUpperCase() || "?"}
                </span>
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {match.player1?.username || "TBD"}
                  {isPlayer1 && (
                    <span className="ml-2 text-xs text-blue-600">(You)</span>
                  )}
                </p>
                {match.player1?.seedNumber && (
                  <p className="text-xs text-muted-foreground">
                    Seed #{match.player1.seedNumber}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">
                {match.scorePlayer1 ?? "-"}
              </span>
              {match.winnerId === match.player1?.id && (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
            </div>
          </div>
        </div>

        {/* VS */}
        <div className="text-center text-muted-foreground text-sm">VS</div>

        {/* Player 2 */}
        <div
          className={`p-4 rounded-lg border ${
            match.winnerId === match.player2?.id
              ? "border-green-500 bg-green-50 dark:bg-green-950/20"
              : isPlayer2
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
              : "bg-muted/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <span className="text-lg font-semibold">
                  {match.player2?.username?.charAt(0).toUpperCase() || "?"}
                </span>
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {match.player2?.username || "TBD"}
                  {isPlayer2 && (
                    <span className="ml-2 text-xs text-blue-600">(You)</span>
                  )}
                </p>
                {match.player2?.seedNumber && (
                  <p className="text-xs text-muted-foreground">
                    Seed #{match.player2.seedNumber}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">
                {match.scorePlayer2 ?? "-"}
              </span>
              {match.winnerId === match.player2?.id && (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Match Times */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {match.scheduledAt && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">Scheduled</p>
              <p className="font-medium">
                {new Date(match.scheduledAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        )}
        {match.startedAt && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">Started</p>
              <p className="font-medium">
                {new Date(match.startedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        )}
        {match.completedAt && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <div>
              <p className="text-muted-foreground">Completed</p>
              <p className="font-medium">
                {new Date(match.completedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Prize Distribution */}
      {prizeDistribution.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Medal className="h-4 w-4" />
            Prize Distribution
          </h3>
          <div className="space-y-2">
            {prizeDistribution.map((prize) => (
              <div
                key={prize.position}
                className="flex items-center justify-between p-2 bg-muted/30 rounded"
              >
                <span className="text-sm">
                  {prize.positionName}
                </span>
                <span className="font-semibold">
                  ${prize.prizeAmount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disputed Status Warning */}
      {match.status === "disputed" && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg mb-6">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-600">Match Disputed</p>
            <p className="text-sm text-red-600/80">
              This match is under admin review. Please wait while the issue is being resolved.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {isUserParticipant &&
          (match.status === "ready" || match.status === "in_progress") &&
          onReportScore && (
            <Button onClick={onReportScore}>Report Score</Button>
          )}
      </ModalFooter>
    </Modal>
  );
}
