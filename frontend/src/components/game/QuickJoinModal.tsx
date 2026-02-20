"use client";

import React, { useState } from "react";
import { Tournament } from "@/types/tournament";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CheckCircle, Clock, AlertCircle, Zap } from "lucide-react";

interface QuickJoinModalProps {
  tournament: Tournament;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
}

export function QuickJoinModal({
  tournament,
  isOpen,
  onClose,
  onConfirm,
}: QuickJoinModalProps) {
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const success = await onConfirm();
      if (success) {
        setStatus("success");
        // Auto-close after success
        setTimeout(() => {
          onClose();
          setStatus("idle");
        }, 2000);
      } else {
        setStatus("error");
        setErrorMessage("Failed to join tournament. Please try again.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage("An error occurred. Please try again.");
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Quick Join Tournament"
      size="sm"
    >
      {status === "success" ? (
        // Success State
        <div className="text-center py-6">
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Successfully Joined!
          </h3>
          <p className="text-muted-foreground">
            You have successfully joined {tournament.name}. Check your email for
            confirmation details.
          </p>
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
            <p className="text-sm text-green-600">
              Tournament starts on{" "}
              <span className="font-semibold">
                {new Date(tournament.startTime).toLocaleDateString()}
              </span>
              . Make sure to check in 15 minutes before your first match.
            </p>
          </div>
        </div>
      ) : (
        // Confirm State
        <>
          {/* Tournament Info */}
          <div className="mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              Tournament Details
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tournament</span>
                <span className="font-medium text-foreground line-clamp-1">
                  {tournament.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Game</span>
                <span className="font-medium text-foreground">
                  {tournament.gameType}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Players</span>
                <span className="font-medium text-foreground">
                  {tournament.currentParticipants}/{tournament.maxParticipants}
                </span>
              </div>
            </div>
          </div>

          {/* Entry Fee Confirmation */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-600">Entry Fee</span>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {tournament.entryFee === 0 ? (
                "Free"
              ) : (
                `$${tournament.entryFee}`
              )}
            </p>
            {tournament.entryFee > 0 && (
              <p className="text-xs text-blue-600/80 mt-1">
                You will be charged upon joining
              </p>
            )}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg mb-6">
            <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600">
              By joining, you agree to participate in this tournament. Failure to
              show up may result in penalties.
            </p>
          </div>

          {/* Error Message */}
          {status === "error" && errorMessage && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-600">{errorMessage}</span>
            </div>
          )}

          {/* Loading State */}
          {status === "loading" && (
            <div className="flex items-center justify-center gap-2 p-4 mb-4 text-muted-foreground">
              <Clock className="h-4 w-4 animate-spin" />
              <span>Processing your join request...</span>
            </div>
          )}

          {/* Actions */}
          <ModalFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={status === "loading"}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              loading={status === "loading"}
              disabled={status === "loading"}
            >
              Confirm Join
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
