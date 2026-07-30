"use client";

import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface SessionExpiredModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Shown when a proactive token refresh fails before a wallet transaction.
 * The user must re-authenticate before the transaction can proceed.
 */
export function SessionExpiredModal({ open, onClose }: SessionExpiredModalProps) {
  const router = useRouter();

  if (!open) return null;

  const handleReAuthenticate = () => {
    onClose();
    router.push("/login?reason=session_expired");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-description"
    >
      <div className="w-full max-w-sm rounded-lg border bg-card shadow-lg">
        <div className="px-6 py-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <LockKeyhole className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>

          <h2
            id="session-expired-title"
            className="text-lg font-semibold text-foreground"
          >
            Session expired
          </h2>

          <p
            id="session-expired-description"
            className="mt-2 text-sm text-muted-foreground"
          >
            Your session has expired. Please re-authenticate before submitting
            this transaction — your wallet and balances are unaffected.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t px-6 py-4">
          <Button onClick={handleReAuthenticate} className="w-full">
            Re-authenticate
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
