"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface SessionExpiredModalProps {
  /** Called when the user confirms they want to re-authenticate. */
  onReauthenticate: () => void;
  /** Called when the user dismisses the modal without re-authenticating. */
  onDismiss: () => void;
  /** Whether a refresh attempt is in progress. */
  isRefreshing?: boolean;
}

/**
 * Shown before a wallet transaction when the auth token has expired or is
 * within 60 s of expiry and the background refresh attempt failed.
 *
 * Blocks transaction submission until the user either re-authenticates or
 * explicitly dismisses.
 */
export function SessionExpiredModal({
  onReauthenticate,
  onDismiss,
  isRefreshing = false,
}: SessionExpiredModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="w-full max-w-sm rounded-lg border bg-card shadow-lg">
        <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert
              className="h-7 w-7 text-destructive"
              aria-hidden="true"
            />
          </div>

          <div>
            <h2
              id="session-expired-title"
              className="text-lg font-semibold text-foreground"
            >
              Session expired
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your session has expired. Please re-authenticate before submitting
              this transaction.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 pt-2">
            <Button
              className="w-full"
              onClick={onReauthenticate}
              loading={isRefreshing}
            >
              Re-authenticate
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={onDismiss}
              disabled={isRefreshing}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
