"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { AlertCircle, CheckCircle, Clock, Send } from "lucide-react";

interface ScoreReportingFormProps {
  player1Name: string;
  player2Name: string;
  currentUserId?: string;
  isPlayer1?: boolean;
  onSubmitScore: (score: number) => Promise<boolean>;
  isMatchActive?: boolean;
  opponentScore?: number | null;
}

export function ScoreReportingForm({
  player1Name,
  player2Name,
  currentUserId,
  isPlayer1 = false,
  onSubmitScore,
  isMatchActive = true,
  opponentScore,
}: ScoreReportingFormProps) {
  const [score, setScore] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPlayerName = isPlayer1 ? player1Name : player2Name;
  const opponentName = isPlayer1 ? player2Name : player1Name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (score < 0) {
      setError("Score cannot be negative");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const success = await onSubmitScore(score);
      if (success) {
        setHasSubmitted(true);
      } else {
        setError("Failed to submit score. Please try again.");
      }
    } catch (err) {
      setError("An error occurred while submitting your score.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUserId) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p>Please log in to report your score.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground">
            Report Your Score
          </h3>
          <p className="text-sm text-muted-foreground">
            Enter your final score for this match
          </p>
        </div>

        {/* Match Info */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="text-center flex-1">
            <p className="text-sm text-muted-foreground">You</p>
            <p className="font-semibold">{currentPlayerName}</p>
          </div>
          <div className="text-center px-4">
            <p className="text-lg font-bold text-muted-foreground">VS</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-sm text-muted-foreground">Opponent</p>
            <p className="font-semibold">{opponentName}</p>
          </div>
        </div>

        {/* Current Score Display */}
        {(opponentScore !== undefined && opponentScore !== null) ? (
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Opponent reported score: <span className="font-bold">{opponentScore}</span>
            </p>
          </div>
        ) : null}

        {/* Submission Status */}
        {hasSubmitted ? (
          <div className="flex items-center justify-center gap-2 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <p className="font-medium text-green-600">
              Score submitted successfully!
            </p>
          </div>
        ) : isMatchActive ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Score Input */}
            <div className="space-y-2">
              <label
                htmlFor="score"
                className="text-sm font-medium text-foreground"
              >
                Your Score
              </label>
              <Input
                id="score"
                type="number"
                min="0"
                value={score}
                onChange={(e) => setScore(parseInt(e.target.value) || 0)}
                placeholder="Enter your score"
                disabled={isSubmitting}
                className="text-center text-lg font-bold"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting || !isMatchActive}
              loading={isSubmitting}
              className="w-full gap-2"
            >
              <Send className="h-4 w-4" />
              Submit Score
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 p-4 bg-muted/50 rounded-lg">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <p className="text-muted-foreground">
              Match is not active for score reporting
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
