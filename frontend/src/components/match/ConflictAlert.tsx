"use client";

import React from "react";
import { AlertTriangle, Shield, Users, Clock, XCircle } from "lucide-react";

interface ConflictAlertProps {
  player1Score: number;
  player2Score: number;
  player1Name: string;
  player2Name: string;
  onResolve?: () => void;
  isAdminView?: boolean;
}

export function ConflictAlert({
  player1Score,
  player2Score,
  player1Name,
  player2Name,
  onResolve,
  isAdminView = false,
}: ConflictAlertProps) {
  const scoreDifference = Math.abs(player1Score - player2Score);
  
  return (
    <div className="space-y-4">
      {/* Main Alert Banner */}
      <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-red-600">Score Conflict Detected</h4>
          <p className="text-sm text-red-600/80 mt-1">
            The scores submitted by both players do not match. Match finalization is disabled until the conflict is resolved.
          </p>
        </div>
      </div>

      {/* Score Comparison */}
      <div className="grid grid-cols-2 gap-4">
        {/* Player 1 Score */}
        <div className="p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {player1Name}
            </span>
            <span className="text-lg font-bold">{player1Score}</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(player1Score / Math.max(player1Score, player2Score, 1)) * 100}%` }}
            />
          </div>
        </div>

        {/* Player 2 Score */}
        <div className="p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {player2Name}
            </span>
            <span className="text-lg font-bold">{player2Score}</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(player2Score / Math.max(player1Score, player2Score, 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Difference Warning */}
      <div className="p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900 rounded-lg">
        <div className="flex items-center gap-2 text-orange-600">
          <XCircle className="h-4 w-4" />
          <span className="font-medium">
            Score difference: {scoreDifference} point{scoreDifference !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-sm text-orange-600/80 mt-1">
          Both players must submit matching scores for the match to be finalized.
        </p>
      </div>

      {/* Resolution Steps */}
      <div className="p-4 bg-muted/30 rounded-lg">
        <h5 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Resolution Steps
        </h5>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-medium">
              1
            </span>
            <span>Both players should review and verify their submitted scores</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-medium">
              2
            </span>
            <span>Contact each other to agree on the correct final score</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-medium">
              3
            </span>
            <span>Both players resubmit with the agreed-upon score</span>
          </li>
        </ol>
      </div>

      {/* Admin Review Required */}
      <div className="p-4 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded-lg">
        <div className="flex items-center gap-2 text-purple-600 mb-2">
          <Users className="h-4 w-4" />
          <span className="font-medium">Admin Review Required</span>
        </div>
        <p className="text-sm text-purple-600/80">
          If you cannot resolve the conflict, please request admin assistance. An administrator will review the match and determine the final result.
        </p>
        {isAdminView && onResolve && (
          <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-800">
            <button
              onClick={onResolve}
              className="text-sm font-medium text-purple-600 hover:text-purple-700"
            >
              Resolve Conflict (Admin Only)
            </button>
          </div>
        )}
      </div>

      {/* Wait Time Notice */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>
          Typical resolution time: 5-15 minutes. You will be notified once the conflict is resolved.
        </span>
      </div>
    </div>
  );
}
