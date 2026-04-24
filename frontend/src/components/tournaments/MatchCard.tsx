"use client";

import React from "react";
import Link from "next/link";
import { BracketMatch } from "@/types/bracket";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Clock, RadioTower, AlertTriangle, CheckCircle, Swords } from "lucide-react";

interface MatchCardProps {
  match: BracketMatch;
  currentUserId?: string;
  showLink?: boolean;
}

const statusConfig = {
  pending: { label: "Pending", color: "text-gray-500", bg: "bg-gray-100 dark:bg-gray-800" },
  ready: { label: "Ready", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900" },
  in_progress: { label: "Live", color: "text-green-600", bg: "bg-green-100 dark:bg-green-900" },
  completed: { label: "Completed", color: "text-purple-600", bg: "bg-purple-100 dark:bg-purple-900" },
  disputed: { label: "Disputed", color: "text-red-600", bg: "bg-red-100 dark:bg-red-900" },
};

export function MatchCard({ match, currentUserId, showLink = true }: MatchCardProps) {
  const status = statusConfig[match.status];
  const isLive = match.status === "in_progress";
  const isDisputed = match.status === "disputed";
  const isCompleted = match.status === "completed";

  const p1IsWinner = isCompleted && match.winnerId === match.player1?.id;
  const p2IsWinner = isCompleted && match.winnerId === match.player2?.id;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {isLive && <RadioTower className="h-4 w-4 animate-pulse text-green-500" />}
          {isDisputed && <AlertTriangle className="h-4 w-4 text-red-500" />}
          {isCompleted && <CheckCircle className="h-4 w-4 text-purple-500" />}
          {!isLive && !isDisputed && !isCompleted && <Swords className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-medium text-foreground">
            {match.roundLabel ?? `Round ${match.round}`}
          </span>
          {match.bestOf && (
            <span className="text-xs text-muted-foreground">· BO{match.bestOf}</span>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.bg} ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Players */}
      <div className="divide-y">
        {[
          { player: match.player1, score: match.scorePlayer1, isWinner: p1IsWinner },
          { player: match.player2, score: match.scorePlayer2, isWinner: p2IsWinner },
        ].map(({ player, score, isWinner }, idx) => (
          <div
            key={idx}
            className={`flex items-center justify-between px-4 py-3 ${
              isWinner ? "bg-green-50 dark:bg-green-950/20" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                  player?.id === currentUserId
                    ? "bg-blue-600"
                    : "bg-gradient-to-br from-slate-500 to-slate-700"
                }`}
              >
                {player ? player.username.charAt(0).toUpperCase() : "?"}
              </div>
              <div>
                <p className={`text-sm font-semibold ${isWinner ? "text-green-700 dark:text-green-300" : "text-foreground"}`}>
                  {player ? player.username : "TBD"}
                  {player?.id === currentUserId && (
                    <span className="ml-1 text-xs text-blue-500">(you)</span>
                  )}
                </p>
                {player?.elo && (
                  <p className="text-xs text-muted-foreground">{player.elo} ELO</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isWinner && <CheckCircle className="h-4 w-4 text-green-500" />}
              {score !== undefined && (
                <span className={`text-lg font-bold ${isWinner ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>
                  {score}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {(match.scheduledTime || match.venue || showLink) && (
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {match.scheduledTime && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(match.scheduledTime).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {match.venue && <span>{match.venue}</span>}
          </div>
          {showLink && (isLive || isDisputed) && (
            <Link href={`/matches/${match.id}`}>
              <Button size="sm" variant="outline" className="gap-1 text-xs">
                <RadioTower className="h-3 w-3" />
                Match Hub
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Dispute notice */}
      {isDisputed && match.conflictReason && (
        <div className="border-t bg-red-50 px-4 py-2 dark:bg-red-950/20">
          <p className="text-xs text-red-700 dark:text-red-300">{match.conflictReason}</p>
        </div>
      )}
    </Card>
  );
}
