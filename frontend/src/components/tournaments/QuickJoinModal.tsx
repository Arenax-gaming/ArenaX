"use client";

import React, { useState } from "react";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { X, Zap, Users, Trophy, Clock, CheckCircle } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";

interface QuickJoinModalProps {
  tournament: Tournament;
  isOpen: boolean;
  onClose: () => void;
  onJoinSuccess?: (tournamentId: string) => void;
}

type JoinStatus = "idle" | "confirming" | "success" | "error";

export function QuickJoinModal({
  tournament,
  isOpen,
  onClose,
  onJoinSuccess,
}: QuickJoinModalProps) {
  const { notify } = useNotifications();
  const [joinStatus, setJoinStatus] = useState<JoinStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirmJoin = async () => {
    setJoinStatus("confirming");
    setError(null);

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setJoinStatus("success");

      notify({
        type: "success",
        title: "Tournament Joined",
        message: `You've successfully joined ${tournament.name}!`,
        toast: true,
        toastDuration: 5000,
      });

      onJoinSuccess?.(tournament.id);

      // Auto-close after 2 seconds
      setTimeout(() => {
        setJoinStatus("idle");
        onClose();
      }, 2000);
    } catch (err) {
      setJoinStatus("error");
      setError(err instanceof Error ? err.message : "Failed to join tournament");
    }
  };

  const handleClose = () => {
    if (joinStatus !== "confirming") {
      setJoinStatus("idle");
      setError(null);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-lg shadow-lg max-w-sm w-full animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            {joinStatus === "success" && (
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            )}
            {joinStatus === "confirming" && (
              <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
            )}
            {joinStatus === "idle" && (
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            )}
            {joinStatus === "error" && (
              <X className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <h2 className="font-semibold text-foreground">
              {joinStatus === "success"
                ? "Successfully Joined!"
                : joinStatus === "error"
                  ? "Join Failed"
                  : "Confirm Join Tournament"}
            </h2>
          </div>
          {joinStatus !== "confirming" && (
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {joinStatus === "idle" && (
            <>
              <p className="text-sm text-muted-foreground">
                You are about to join the following tournament:
              </p>
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {tournament.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    Entry Fee:{" "}
                    <span className="font-semibold">
                      {tournament.entryFee === 0
                        ? "Free"
                        : `$${tournament.entryFee}`}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    Players: {tournament.currentParticipants}/
                    {tournament.maxParticipants}
                  </span>
                </div>
              </div>
              {tournament.entryFee > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                  <p className="text-xs text-blue-900 dark:text-blue-100">
                    <span className="font-semibold">Note:</span> You will be
                    charged ${tournament.entryFee} upon confirmation.
                  </p>
                </div>
              )}
            </>
          )}

          {joinStatus === "confirming" && (
            <>
              <p className="text-sm text-muted-foreground">
                Processing your tournament registration...
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tournament</span>
                  <span className="font-medium text-foreground">
                    {tournament.name}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Entry Fee</span>
                  <span className="font-semibold text-foreground">
                    {tournament.entryFee === 0
                      ? "Free"
                      : `$${tournament.entryFee}`}
                  </span>
                </div>
              </div>
            </>
          )}

          {joinStatus === "success" && (
            <>
              <p className="text-sm text-muted-foreground">
                Congratulations! You have successfully joined the tournament.
              </p>
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-3">
                <p className="text-sm text-green-900 dark:text-green-100">
                  Tournament starts on{" "}
                  <span className="font-semibold">
                    {new Date(tournament.startTime).toLocaleDateString()}
                  </span>
                  . Check in 15 minutes before your first match.
                </p>
              </div>
            </>
          )}

          {joinStatus === "error" && (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
                <p className="text-sm text-red-900 dark:text-red-100">
                  There was an error joining the tournament. Please try again.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex gap-3">
          {joinStatus === "idle" && (
            <>
              <Button
                variant="secondary"
                onClick={handleClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmJoin} className="flex-1">
                Confirm Join
              </Button>
            </>
          )}

          {joinStatus === "confirming" && (
            <Button disabled className="w-full" variant="secondary">
              Processing...
            </Button>
          )}

          {joinStatus === "success" && (
            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          )}

          {joinStatus === "error" && (
            <>
              <Button
                variant="secondary"
                onClick={() => setJoinStatus("idle")}
                className="flex-1"
              >
                Try Again
              </Button>
              <Button onClick={handleClose} className="flex-1">
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
