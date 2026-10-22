"use client";

import React, { useState, useRef, useEffect } from "react";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { X, Zap, Users, Trophy, Clock, CheckCircle, AlertCircle, ShieldAlert, RefreshCw } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import { handleFocusTrap, restoreFocus, announce } from "@/lib/accessibility";

interface QuickJoinModalProps {
  tournament: Tournament;
  isOpen: boolean;
  onClose: () => void;
  onJoinSuccess?: (tournamentId: string) => void;
}

type QuickJoinStatus = "idle" | "confirming" | "success" | "error" | "refunded";

export function QuickJoinModal({
  tournament,
  isOpen,
  onClose,
  onJoinSuccess,
}: QuickJoinModalProps) {
  const { notify } = useNotifications();
  const [joinStatus, setJoinStatus] = useState<QuickJoinStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Idempotency key preserved across retries for unchanged join attempt (#31)
  const idempotencyKeyRef = useRef<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = `quick-join-${tournament.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
    } else {
      if (triggerRef.current) {
        restoreFocus(triggerRef.current);
      }
    }
  }, [isOpen, tournament.id]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && joinStatus !== "confirming") {
        handleClose();
      } else if (modalRef.current) {
        handleFocusTrap(e, modalRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, joinStatus]);

  if (!isOpen) return null;

  const handleConfirmJoin = async () => {
    if (joinStatus === "confirming") return;

    setJoinStatus("confirming");
    setError(null);

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `quick-join-${tournament.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    try {
      await api.joinTournament(tournament.id, undefined, idempotencyKeyRef.current);

      setJoinStatus("success");
      idempotencyKeyRef.current = null;
      announce(`Successfully joined ${tournament.name}`, "polite");

      notify({
        type: "success",
        title: "Tournament Joined",
        message: `You've successfully joined ${tournament.name}!`,
        toast: true,
        toastDuration: 5000,
      });

      onJoinSuccess?.(tournament.id);

      setTimeout(() => {
        setJoinStatus("idle");
        onClose();
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join tournament";
      setError(msg);
      if (msg.toLowerCase().includes("refund")) {
        setJoinStatus("refunded");
      } else {
        setJoinStatus("error");
      }
      announce(`Failed to join tournament: ${msg}`, "assertive");
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-safe backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-join-dialog-title"
      aria-describedby="quick-join-dialog-desc"
    >
      <div
        ref={modalRef}
        className="bg-card border rounded-xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in-95 flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            {joinStatus === "success" && (
              <CheckCircle className="h-5 w-5 text-success dark:text-success/80" />
            )}
            {joinStatus === "confirming" && (
              <Clock className="h-5 w-5 text-primary dark:text-primary/80 animate-spin" />
            )}
            {joinStatus === "idle" && (
              <Users className="h-5 w-5 text-primary dark:text-primary/80" />
            )}
            {(joinStatus === "error" || joinStatus === "refunded") && (
              <AlertCircle className="h-5 w-5 text-destructive dark:text-destructive/80" />
            )}
            <h2 id="quick-join-dialog-title" className="font-semibold text-foreground text-base sm:text-lg">
              {joinStatus === "success"
                ? "Successfully Joined!"
                : joinStatus === "confirming"
                  ? "Reserving Seat…"
                  : joinStatus === "refunded"
                    ? "Registration Refunded"
                    : joinStatus === "error"
                      ? "Join Failed"
                      : "Confirm Tournament Entry"}
            </h2>
          </div>
          {joinStatus !== "confirming" && (
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div id="quick-join-dialog-desc" className="p-5 space-y-4 overflow-y-auto">
          {joinStatus === "idle" && (
            <>
              <p className="text-sm text-muted-foreground">
                You are about to register for <strong className="text-foreground">{tournament.name}</strong>:
              </p>
              <div className="bg-muted/50 rounded-lg p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{tournament.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Entry Fee:</span>
                  </div>
                  <span className="font-semibold text-foreground">
                    {tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Registered:</span>
                  </div>
                  <span className="text-foreground">
                    {tournament.currentParticipants}/{tournament.maxParticipants} players
                  </span>
                </div>
              </div>

              {/* Cancellation & Refund Terms (#31) */}
              <div className="rounded-lg border border-info/30 bg-info-muted/20 p-3 text-xs space-y-1.5 text-info dark:text-info-muted-foreground">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  Cancellation &amp; Refund Terms:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  <li>Full refund if the tournament is cancelled or under-subscribed.</li>
                  <li>Withdrawal allowed up to 1 hour before start time.</li>
                  <li>Non-refundable once tournament brackets start.</li>
                </ul>
              </div>
            </>
          )}

          {joinStatus === "confirming" && (
            <div className="space-y-3 py-2 text-center" role="status" aria-live="polite">
              <div className="flex justify-center">
                <RefreshCw className="h-8 w-8 text-primary animate-spin" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Reserving seat with authoritative server…
              </p>
              <p className="text-xs text-muted-foreground">
                Processing your registration and verifying entry payment.
              </p>
            </div>
          )}

          {joinStatus === "success" && (
            <div className="space-y-3" role="status" aria-live="polite">
              <p className="text-sm text-muted-foreground">
                Congratulations! You have successfully joined the tournament.
              </p>
              <div className="bg-success-muted dark:bg-success-muted/20 border border-success/30 rounded-lg p-3">
                <p className="text-xs text-green-900 dark:text-success-muted-foreground">
                  Tournament starts on{" "}
                  <span className="font-semibold">
                    {new Date(tournament.startTime).toLocaleDateString()}
                  </span>
                  . Check in 15 minutes before your first match.
                </p>
              </div>
            </div>
          )}

          {(joinStatus === "error" || joinStatus === "refunded") && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2" role="alert">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                {joinStatus === "refunded" ? "Registration Refunded" : "Unable to Join Tournament"}
              </p>
              <p className="text-xs text-destructive-foreground/90">{error || "There was an error joining the tournament."}</p>
              <p className="text-xs text-muted-foreground pt-1">
                Retrying will reuse the existing reservation intent safely.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex gap-3">
          {joinStatus === "idle" && (
            <>
              <Button
                variant="secondary"
                onClick={handleClose}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmJoin} className="flex-1 min-h-[44px]">
                Confirm Join
              </Button>
            </>
          )}

          {joinStatus === "confirming" && (
            <Button disabled className="w-full min-h-[44px]" variant="secondary" loading>
              Reserving Seat…
            </Button>
          )}

          {joinStatus === "success" && (
            <Button onClick={handleClose} className="w-full min-h-[44px]">
              Close
            </Button>
          )}

          {(joinStatus === "error" || joinStatus === "refunded") && (
            <>
              <Button
                variant="secondary"
                onClick={handleClose}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmJoin} className="flex-1 min-h-[44px]">
                Retry
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
