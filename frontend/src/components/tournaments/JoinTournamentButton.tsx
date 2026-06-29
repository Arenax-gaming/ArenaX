"use client";

import React, { useEffect, useRef, useState } from "react";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { LogIn, CheckCircle, AlertCircle, Clock, Users, X } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";

interface JoinTournamentButtonProps {
  tournament: Tournament;
}

export function JoinTournamentButton({
  tournament,
}: JoinTournamentButtonProps) {
  const router = useRouter();
  const { notify, addToast } = useNotifications();
  const [showModal, setShowModal] = useState(false);
  const [joinStatus, setJoinStatus] = useState<
    "idle" | "confirming" | "success" | "error"
  >("idle");
  const [isJoined, setIsJoined] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Prevents state updates after unmount and guards against duplicate submissions
  const mountedRef = useRef(true);
  const isRequestInFlight = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Determine button state
  const isFull = tournament.currentParticipants >= tournament.maxParticipants;
  const isOngoing = tournament.status === "in_progress";
  const isCompleted = tournament.status === "completed";
  const isClosed = tournament.status === "registration_closed";
  const canJoin =
    tournament.status === "registration_open" && !isFull && !isJoined;

  const getButtonState = () => {
    if (joinLoading) {
      return {
        label: "Joining…",
        disabled: true,
        variant: "primary" as const,
        loading: true,
      };
    }
    if (isJoined) {
      return {
        label: "Registered ✓",
        disabled: true,
        variant: "secondary" as const,
        loading: false,
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

  useEffect(() => {
    const joined = localStorage.getItem(`tournament-joined-${tournament.id}`);
    setIsJoined(joined === "true");
  }, [tournament.id]);

  const handleJoinClick = () => {
    const isAuthenticated = localStorage.getItem("auth_token") !== null;

    setShowModal(true);
    setErrorMessage(null);

    if (!isAuthenticated) {
      setJoinStatus("idle");
      return;
    }

    setJoinStatus("idle");
  };

  const handleConfirmJoin = async () => {
    // Prevent duplicate submissions from rapid clicks
    if (isRequestInFlight.current) return;
    isRequestInFlight.current = true;

    setJoinStatus("confirming");
    setJoinLoading(true);
    setErrorMessage(null);

    try {
      await api.joinTournament(tournament.id);
      if (!mountedRef.current) return;

      setJoinStatus("success");
      setIsJoined(true);
      setJoinLoading(false);
      localStorage.setItem(`tournament-joined-${tournament.id}`, "true");

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
          setJoinStatus("idle");
        }
      }, 2000);
    } catch (error) {
      if (!mountedRef.current) return;

      const message =
        error instanceof Error
          ? error.message
          : "Unable to join tournament. Please try again.";

      setErrorMessage(message);
      setJoinStatus("error");
      setJoinLoading(false);

      addToast({
        type: "error",
        title: "Failed to Join Tournament",
        message,
        duration: 5000,
      });
    } finally {
      isRequestInFlight.current = false;
    }
  };

  const handleLoginRedirect = () => {
    router.push(`/login?redirect=/tournaments/${tournament.id}`);
  };

  return (
    <>
      <div className="space-y-3">
        <Button
          onClick={handleJoinClick}
          disabled={buttonState.disabled}
          variant={buttonState.variant}
          loading={buttonState.loading}
          size="lg"
          className="w-full"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border rounded-lg shadow-lg max-w-sm w-full animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b">
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
                <h2 className="font-semibold text-foreground">
                  {joinStatus === "idle" && !localStorage.getItem("auth_token")
                    ? "Sign In Required"
                    : joinStatus === "success"
                      ? "Successfully Joined!"
                      : "Confirm Join Tournament"}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Not Authenticated State */}
              {joinStatus === "idle" && !localStorage.getItem("auth_token") && (
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

              {/* Confirming State */}
              {joinStatus === "confirming" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Processing your tournament registration...
                  </p>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tournament</span>
                      <span className="font-semibold text-foreground">
                        {tournament.name}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-3">
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

              {joinStatus === "error" && (
                <div className="rounded-lg border border-red-200 bg-destructive/5 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-destructive/10/20 dark:text-destructive-foreground">
                  <p className="font-semibold">Unable to join tournament</p>
                  <p className="mt-2">{errorMessage}</p>
                </div>
              )}

              {/* Success State */}
              {joinStatus === "success" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Congratulations! You have successfully joined the
                    tournament. Check your email for confirmation details.
                  </p>
                  <div className="bg-success-muted dark:bg-success-muted/20 border border-success/30 dark:border-success/30 rounded-lg p-3">
                    <p className="text-sm text-green-900 dark:text-success-muted-foreground">
                      Tournament starts on{" "}
                      <span className="font-semibold">
                        {new Date(tournament.startTime).toLocaleDateString()}
                      </span>
                      . Make sure to check in 15 minutes before your first
                      match.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t flex gap-3">
              {joinStatus === "idle" && !localStorage.getItem("auth_token") && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleLoginRedirect}
                    className="flex-1 gap-2"
                  >
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </Button>
                </>
              )}

              {joinStatus === "confirming" && (
                <Button disabled className="w-full" variant="secondary">
                  Processing...
                </Button>
              )}

              {joinStatus === "success" && (
                <Button onClick={() => setShowModal(false)} className="w-full">
                  Close
                </Button>
              )}

              {joinStatus === "idle" && localStorage.getItem("auth_token") && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleConfirmJoin} className="flex-1">
                    Confirm Join
                  </Button>
                </>
              )}

              {joinStatus === "error" && localStorage.getItem("auth_token") && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                    className="flex-1"
                  >
                    Close
                  </Button>
                  <Button onClick={handleConfirmJoin} className="flex-1">
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
