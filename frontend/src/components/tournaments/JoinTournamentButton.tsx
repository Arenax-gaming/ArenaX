"use client";

import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { LogIn, CheckCircle, AlertCircle, Clock, Users, X, ShieldAlert, RefreshCw } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import { handleFocusTrap, restoreFocus, announce } from "@/lib/accessibility";

interface JoinTournamentButtonProps {
  tournament: Tournament;
  /** When present, registers the whole party (issue #1102). */
  partyId?: string;
}

export type JoinState = "idle" | "pending" | "confirmed" | "failed" | "refunded";

/** Per-tournament "has this browser joined?" cache entry. */
function joinedQueryKey(tournamentId: string) {
  return ["tournamentJoined", tournamentId] as const;
}

export function JoinTournamentButton({
  tournament,
  partyId,
}: JoinTournamentButtonProps) {
  const router = useRouter();
  const { notify, addToast } = useNotifications();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Idempotency key preserved across retries for unchanged join attempt (#31)
  const idempotencyKeyRef = useRef<string | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { data: isJoined = false } = useQuery({
    queryKey: joinedQueryKey(tournament.id),
    queryFn: () =>
      localStorage.getItem(`tournament-joined-${tournament.id}`) === "true",
    staleTime: Infinity,
  });

  const joinMutation = useMutation({
    mutationFn: (idempKey: string) => api.joinTournament(tournament.id, undefined, idempKey),
    // Resilient to payment latency (#31): UI does not claim a reservation until authoritative response confirms it.
    onError: (error) => {
      if (!mountedRef.current) return;

      const message =
        error instanceof Error
          ? error.message
          : "Unable to join tournament. Please try again.";
      setErrorMessage(message);

      if (message.toLowerCase().includes("refund")) {
        setJoinState("refunded");
      } else {
        setJoinState("failed");
      }

      announce(`Failed to join tournament: ${message}`, "assertive");

      addToast({
        type: "error",
        title: "Failed to Join Tournament",
        message,
        duration: 5000,
      });
    },
    onSuccess: () => {
      // Authoritative confirmation received (#31)
      queryClient.setQueryData(joinedQueryKey(tournament.id), true);
      localStorage.setItem(`tournament-joined-${tournament.id}`, "true");
      idempotencyKeyRef.current = null;

      if (!mountedRef.current) return;

      setJoinState("confirmed");
      announce(`Successfully joined ${tournament.name}`, "polite");

      notify({
        type: "match",
        title: "Tournament Joined",
        message: `You've joined ${tournament.name}. We'll notify you when your match is ready.`,
        link: `/tournaments/${tournament.id}`,
        linkLabel: "View Tournament",
        persistent: true,
        toast: true,
        toastDuration: 5000,
      });

      setTimeout(() => {
        if (mountedRef.current) {
          setShowModal(false);
          setJoinState("idle");
        }
      }, 2000);
    },
  });

  // Focus trap and keyboard management (#40)
  useEffect(() => {
    if (!showModal) {
      if (triggerButtonRef.current) {
        restoreFocus(triggerButtonRef.current);
      }
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && joinState !== "pending") {
        setShowModal(false);
        if (joinState === "confirmed") {
          setJoinState("idle");
        }
      } else if (modalRef.current) {
        handleFocusTrap(e, modalRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showModal, joinState]);

  // Determine button state
  const isFull = tournament.currentParticipants >= tournament.maxParticipants;
  const isOngoing = tournament.status === "in_progress";
  const isCompleted = tournament.status === "completed";
  const isClosed = tournament.status === "registration_closed";
  const canJoin =
    tournament.status === "registration_open" && !isFull && !isJoined;

  const getButtonState = () => {
    if (isJoined) {
      return {
        label: "Registered ✓",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
      };
    }
    if (joinMutation.isPending || joinState === "pending") {
      return {
        label: "Confirming reservation…",
        disabled: true,
        variant: "primary" as const,
        loading: true,
      };
    }
    if (isFull) {
      return {
        label: "Tournament Full",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
      };
    }
    if (isOngoing) {
      return {
        label: "Tournament Ongoing",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
      };
    }
    if (isCompleted) {
      return {
        label: "Tournament Completed",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
      };
    }
    if (isClosed) {
      return {
        label: "Registration Closed",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
      };
    }
    return {
      label: "Join Tournament",
      disabled: false,
      variant: "primary" as const,
      loading: false,
    };
  };

  const buttonState = getButtonState();

  const handleJoinClick = () => {
    setShowModal(true);
    setErrorMessage(null);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `join-${tournament.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    setJoinState("idle");
  };

  const handleConfirmJoin = () => {
    // Guard against duplicate clicks (#31)
    if (joinMutation.isPending || joinState === "pending") return;

    setErrorMessage(null);
    setJoinState("pending");

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `join-${tournament.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    joinMutation.mutate(idempotencyKeyRef.current);
  };

  const handleLoginRedirect = () => {
    router.push(`/login?redirect=/tournaments/${tournament.id}`);
  };

  const handleClose = () => {
    if (joinState === "pending") return;
    setShowModal(false);
    if (joinState === "confirmed") {
      setJoinState("idle");
    }
  };

  return (
    <>
      <div className="space-y-3">
        <Button
          ref={triggerButtonRef}
          onClick={handleJoinClick}
          disabled={buttonState.disabled}
          variant={buttonState.variant}
          loading={buttonState.loading}
          size="lg"
          className="w-full min-h-[44px]"
          aria-haspopup="dialog"
          aria-expanded={showModal}
        >
          {buttonState.label}
        </Button>

        {/* Information Cards */}
        {canJoin && (
          <>
            {tournament.entryFee > 0 && (
              <div className="bg-info-muted dark:bg-info-muted/20 border border-blue-200 dark:border-info/30 rounded-lg p-3">
                <p className="text-xs text-info dark:text-info-muted-foreground">
                  <span className="font-semibold">Entry Fee:</span> You will be
                  charged ${tournament.entryFee} upon joining.
                </p>
              </div>
            )}

            <div className="bg-success-muted dark:bg-success-muted/20 border border-success/30 dark:border-success/30 rounded-lg p-3">
              <div className="flex gap-2">
                <CheckCircle className="h-4 w-4 text-success dark:text-success/80 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-green-900 dark:text-success-muted-foreground">
                  Tournament starts on{" "}
                  <span className="font-semibold">
                    {new Date(tournament.startTime).toLocaleDateString()}
                  </span>
                </p>
              </div>
            </div>
          </>
        )}

        {isJoined && (
          <div className="bg-success-muted dark:bg-success-muted/20 border border-success/30 dark:border-success/30 rounded-lg p-3">
            <div className="flex gap-2">
              <CheckCircle className="h-4 w-4 text-success dark:text-success/80 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-900 dark:text-success-muted-foreground">
                You are registered for this tournament!
              </p>
            </div>
          </div>
        )}

        {isFull && (
          <div className="bg-destructive/5 dark:bg-destructive/10/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-destructive dark:text-destructive/80 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-900 dark:text-destructive-foreground">
                All slots are filled. Join the waitlist.
              </p>
            </div>
          </div>
        )}

        {isOngoing && (
          <div className="bg-info-muted dark:bg-info-muted/20 border border-blue-200 dark:border-info/30 rounded-lg p-3">
            <div className="flex gap-2">
              <Clock className="h-4 w-4 text-primary dark:text-primary/80 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-info dark:text-info-muted-foreground">
                This tournament is currently in progress.
              </p>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="bg-muted dark:bg-gray-950/20 border border-gray-200 dark:border-gray-900 rounded-lg p-3">
            <p className="text-xs text-foreground dark:text-foreground">
              This tournament has already concluded.
            </p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-safe backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-tournament-dialog-title"
          aria-describedby="join-tournament-dialog-desc"
        >
          <div
            ref={modalRef}
            className="bg-card border rounded-xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in-95 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b">
              <div className="flex items-center gap-3">
                {joinState === "pending" && (
                  <Clock className="h-5 w-5 text-primary dark:text-primary/80 animate-spin" />
                )}
                {joinState === "confirmed" && (
                  <CheckCircle className="h-5 w-5 text-success dark:text-success/80" />
                )}
                {(joinState === "failed" || joinState === "refunded") && (
                  <AlertCircle className="h-5 w-5 text-destructive dark:text-destructive/80" />
                )}
                {joinState === "idle" && (
                  <Users className="h-5 w-5 text-primary dark:text-primary/80" />
                )}
                <h2 id="join-tournament-dialog-title" className="font-semibold text-foreground text-base sm:text-lg">
                  {!localStorage.getItem("auth_token")
                    ? "Sign In Required"
                    : joinState === "pending"
                      ? "Reserving Seat…"
                      : joinState === "confirmed"
                        ? "Successfully Joined!"
                        : joinState === "refunded"
                          ? "Registration Refunded"
                          : joinState === "failed"
                            ? "Registration Failed"
                            : "Confirm Tournament Entry"}
                </h2>
              </div>
              {joinState !== "pending" && (
                <button
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[32px] min-w-[32px] flex items-center justify-center"
                  aria-label="Close dialog"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Body */}
            <div id="join-tournament-dialog-desc" className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              {/* Not Authenticated State */}
              {!localStorage.getItem("auth_token") && (
                <>
                  <p className="text-sm text-muted-foreground">
                    You need to be signed in to join a tournament. Create an
                    account or log in to continue.
                  </p>
                  <div className="bg-info-muted dark:bg-info-muted/20 border border-blue-200 dark:border-info/30 rounded-lg p-3">
                    <p className="text-xs text-info dark:text-info-muted-foreground">
                      <span className="font-semibold">Entry Fee:</span> You will
                      be charged ${tournament.entryFee} upon joining.
                    </p>
                  </div>
                </>
              )}

              {/* Idle State with Fee Breakdown & Refund Terms (#31) */}
              {localStorage.getItem("auth_token") && joinState === "idle" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Confirm your registration for <strong className="text-foreground">{tournament.name}</strong>.
                  </p>

                  <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2 text-xs">
                    <div className="flex justify-between text-foreground">
                      <span>Tournament Entry Fee:</span>
                      <span className="font-semibold">
                        {tournament.entryFee > 0 ? `$${tournament.entryFee.toFixed(2)}` : "Free"}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Seat Allocation:</span>
                      <span>Authoritative server reservation</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 text-foreground font-semibold">
                      <span>Total Due:</span>
                      <span>{tournament.entryFee > 0 ? `$${tournament.entryFee.toFixed(2)}` : "Free"}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-info/30 bg-info-muted/20 p-3.5 text-xs text-info dark:text-info-muted-foreground space-y-1.5">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      Cancellation &amp; Refund Terms:
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                      <li>Full automatic refund if tournament is cancelled or under-subscribed.</li>
                      <li>Registrations can be cancelled up to 1 hour before tournament start.</li>
                      <li>Entry fee is non-refundable once bracket matches are live.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Pending State (#31) */}
              {joinState === "pending" && (
                <div className="space-y-3 py-2 text-center" role="status" aria-live="polite">
                  <div className="flex justify-center">
                    <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Reserving your seat with the server…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Please do not close this window. Your reservation and entry payment are being authoritatively verified.
                  </p>
                </div>
              )}

              {/* Failed / Insufficient Funds / Timeout State (#31) */}
              {joinState === "failed" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2" role="alert">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4" />
                    Unable to join tournament
                  </p>
                  <p className="text-xs text-destructive-foreground/90">{errorMessage || "Request failed or timed out."}</p>
                  <p className="text-xs text-muted-foreground pt-1">
                    Retrying will reuse the existing reservation intent without charging you twice.
                  </p>
                </div>
              )}

              {/* Refunded State (#31) */}
              {joinState === "refunded" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200 space-y-2" role="alert">
                  <p className="font-semibold">Registration Refunded</p>
                  <p className="text-xs">{errorMessage || "Your entry fee has been returned to your wallet balance."}</p>
                </div>
              )}

              {/* Confirmed State (#31) */}
              {joinState === "confirmed" && (
                <div className="space-y-3" role="status" aria-live="polite">
                  <p className="text-sm text-muted-foreground">
                    Congratulations! Your seat is authoritatively confirmed. Check your email for full schedule details.
                  </p>
                  <div className="bg-success-muted dark:bg-success-muted/20 border border-success/30 rounded-lg p-3">
                    <p className="text-xs text-green-900 dark:text-success-muted-foreground">
                      Tournament starts on{" "}
                      <span className="font-semibold">
                        {new Date(tournament.startTime).toLocaleDateString()}
                      </span>
                      . Please check in 15 minutes before your first match.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-5 border-t flex gap-3">
              {!localStorage.getItem("auth_token") && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleClose}
                    className="flex-1 min-h-[44px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleLoginRedirect}
                    className="flex-1 gap-2 min-h-[44px]"
                  >
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </Button>
                </>
              )}

              {localStorage.getItem("auth_token") && joinState === "idle" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleClose}
                    className="flex-1 min-h-[44px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmJoin}
                    className="flex-1 min-h-[44px]"
                  >
                    Confirm Join
                  </Button>
                </>
              )}

              {joinState === "pending" && (
                <Button disabled className="w-full min-h-[44px]" variant="secondary" loading>
                  Reserving Seat…
                </Button>
              )}

              {joinState === "confirmed" && (
                <Button onClick={handleClose} className="w-full min-h-[44px]">
                  Close
                </Button>
              )}

              {(joinState === "failed" || joinState === "refunded") && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleClose}
                    className="flex-1 min-h-[44px]"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={handleConfirmJoin}
                    className="flex-1 min-h-[44px]"
                  >
                    Retry
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
