"use client";

/**
 * MatchQueueView — matchmaking queue / live match with a leave guard (#1320).
 *
 * While `status` is "queueing" or "in-match":
 *  - closing or reloading the tab triggers the browser's `beforeunload` prompt;
 *  - in-app links and Back/Forward open a ConfirmDialog explaining the
 *    consequence (losing the queue spot, or forfeiting the match);
 *  - the in-page "Cancel Matchmaking" button asks first, too.
 *
 * When the match ends naturally (`status === "ended"`) or a match is found,
 * the guard switches off, so the move to the lobby/results never asks.
 */

import { useCallback, useState } from "react";
import MatchmakingQueue from "@/components/game/MatchmakingQueue";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useNavigationGuard } from "@/hooks/useNavigationGuard";

export type MatchQueueStatus = "queueing" | "in-match" | "ended";

interface MatchQueueViewProps {
  gameMode: string;
  status?: MatchQueueStatus;
  /** User confirmed leaving the queue from the in-page Cancel button. */
  onLeaveQueue: () => void;
  onMatchFound: (sessionId: string) => void;
  /** Rendered instead of the queue UI while `status === "in-match"`. */
  children?: React.ReactNode;
}

const COPY: Record<Exclude<MatchQueueStatus, "ended">, { title: string; body: string; confirm: string }> = {
  queueing: {
    title: "Leave matchmaking?",
    body: "You'll lose your place in the queue and have to start searching again.",
    confirm: "Leave queue",
  },
  "in-match": {
    title: "Forfeit this match?",
    body: "Leaving now counts as a forfeit: the match is recorded as a loss and may affect your ELO and reputation.",
    confirm: "Forfeit and leave",
  },
};

export function MatchQueueView({
  gameMode,
  status = "queueing",
  onLeaveQueue,
  onMatchFound,
  children,
}: MatchQueueViewProps) {
  // A found match is a natural exit: stop guarding before we navigate to it.
  const [matchFound, setMatchFound] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const active = status !== "ended" && !matchFound;
  const guard = useNavigationGuard(active);
  const copy = COPY[status === "in-match" ? "in-match" : "queueing"];

  const handleMatchFound = useCallback(
    (sessionId: string) => {
      setMatchFound(true);
      onMatchFound(sessionId);
    },
    [onMatchFound]
  );

  const dialogOpen = active && (guard.isBlocked || confirmingCancel);

  const handleConfirm = () => {
    if (confirmingCancel) {
      setConfirmingCancel(false);
      onLeaveQueue();
      return;
    }
    guard.confirm();
  };

  const handleCancel = () => {
    setConfirmingCancel(false);
    guard.cancel();
  };

  return (
    <>
      {status === "in-match" && children ? (
        children
      ) : (
        <MatchmakingQueue
          gameMode={gameMode}
          onCancel={() => setConfirmingCancel(true)}
          onMatchFound={handleMatchFound}
        />
      )}

      <ConfirmDialog
        isOpen={dialogOpen}
        title={copy.title}
        description={copy.body}
        confirmLabel={copy.confirm}
        cancelLabel={status === "in-match" ? "Keep playing" : "Stay in queue"}
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

export default MatchQueueView;
