"use client";

import React, { useState } from "react";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { LogIn, CheckCircle, AlertCircle, Clock, Users, X } from "lucide-react";

interface JoinTournamentButtonProps {
  tournament: Tournament;
}

export function JoinTournamentButton({
  tournament,
}: JoinTournamentButtonProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [joinStatus, setJoinStatus] = useState<
    "idle" | "confirming" | "success" | "error"
  >("idle");
  const [isJoined, setIsJoined] = useState(false);

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
        label: "✓ Already Joined",
        disabled: true,
        variant: "secondary" as const,
      };
    }
    if (isFull) {
      return {
        label: "Tournament Full",
        disabled: true,
        variant: "secondary" as const,
      };
    }
    if (isOngoing) {
      return {
        label: "Tournament Ongoing",
        disabled: true,
        variant: "secondary" as const,
      };
    }
    if (isCompleted) {
      return {
        label: "Tournament Completed",
        disabled: true,
        variant: "secondary" as const,
      };
    }
    if (isClosed) {
      return {
        label: "Registration Closed",
        disabled: true,
        variant: "secondary" as const,
      };
    }
    return {
      label: "Join Tournament",
      disabled: false,
      variant: "primary" as const,
    };
  };

  const buttonState = getButtonState();

  const handleJoinClick = () => {
    // Check if user is authenticated (mock check)
    const isAuthenticated = localStorage.getItem("auth_token") !== null;

    if (!isAuthenticated) {
      setShowModal(true);
      setJoinStatus("idle");
      return;
    }

    setShowModal(true);
    setJoinStatus("confirming");
  };

  const handleConfirmJoin = async () => {
    setJoinStatus("confirming");

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setJoinStatus("success");
    setIsJoined(true);

    // Auto-close after 2 seconds
    setTimeout(() => {
      setShowModal(false);
      setJoinStatus("idle");
    }, 2000);
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
          size="lg"
          className="w-full"
        >
          {buttonState.label}
        </Button>

        {/* Information Cards */}
        {canJoin && (
          <>
            {tournament.entryFee > 0 && (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="text-xs text-blue-900 dark:text-blue-100">
                  <span className="font-semibold">Entry Fee:</span> You will be
                  charged ${tournament.entryFee} upon joining.
                </p>
              </div>
            )}

            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-3">
              <div className="flex gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-green-900 dark:text-green-100">
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
          <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-3">
            <div className="flex gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-900 dark:text-green-100">
                You are registered for this tournament!
              </p>
            </div>
          </div>
        )}

        {isFull && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-900 dark:text-red-100">
                All slots are filled. Join the waitlist.
              </p>
            </div>
          </div>
        )}

        {isOngoing && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
            <div className="flex gap-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-900 dark:text-blue-100">
                This tournament is currently in progress.
              </p>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="bg-gray-50 dark:bg-gray-950/20 border border-gray-200 dark:border-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-900 dark:text-gray-100">
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
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                )}
                {joinStatus === "confirming" && (
                  <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                )}
                {joinStatus === "idle" && (
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
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
                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                    <p className="text-xs text-blue-900 dark:text-blue-100">
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

              {/* Success State */}
              {joinStatus === "success" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Congratulations! You have successfully joined the
                    tournament. Check your email for confirmation details.
                  </p>
                  <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-3">
                    <p className="text-sm text-green-900 dark:text-green-100">
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
